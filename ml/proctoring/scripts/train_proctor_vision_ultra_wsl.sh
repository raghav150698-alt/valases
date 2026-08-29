#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=""
epochs="40"
resolution="448"
batch_size="1"
grad_accum_steps="16"
workers="2"
patience="8"
target_precision="0.97"
seed="42"
run_name="rfdetr_nano_grouped_v1"
resume="0"
skip_install="0"
setup_only="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) repo_root="$2"; shift 2 ;;
    --epochs) epochs="$2"; shift 2 ;;
    --resolution) resolution="$2"; shift 2 ;;
    --batch-size) batch_size="$2"; shift 2 ;;
    --grad-accum-steps) grad_accum_steps="$2"; shift 2 ;;
    --workers) workers="$2"; shift 2 ;;
    --patience) patience="$2"; shift 2 ;;
    --target-precision) target_precision="$2"; shift 2 ;;
    --seed) seed="$2"; shift 2 ;;
    --run-name) run_name="$2"; shift 2 ;;
    --resume) resume="1"; shift ;;
    --skip-install) skip_install="1"; shift ;;
    --setup-only) setup_only="1"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$repo_root" || ! -d "$repo_root" ]]; then
  echo "Repository is not accessible in WSL: $repo_root" >&2
  exit 2
fi
if (( resolution % 32 != 0 )); then
  echo "Resolution must be divisible by 32: $resolution" >&2
  exit 2
fi

prepare_script="$repo_root/ml/proctoring/scripts/prepare_zenodo_grouped_dataset.py"
train_script="$repo_root/ml/proctoring/scripts/train_proctor_vision_rfdetr.py"
source_root="$repo_root/data/proctoring/external_licensed/zenodo_students_behavior"
output_dir="$repo_root/data/proctoring/models/proctor_vision_ultra/$run_name"
dataset_root="$HOME/.cache/certora-proctoring/datasets/zenodo_original_grouped_seed_$seed"
bootstrap_dir="$HOME/.venvs/certora-uv-bootstrap"
venv_dir="$HOME/.venvs/certora-proctor-rfdetr-py312"
python_bin="$venv_dir/bin/python"
uv_bin="$bootstrap_dir/bin/uv"

# NVIDIA's Python package CDN can take longer than uv's default 10-second
# connection window even when it is healthy. These limits are deliberately
# generous because the CUDA runtime is a large, one-time download.
export UV_HTTP_CONNECT_TIMEOUT="${UV_HTTP_CONNECT_TIMEOUT:-120}"
export UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-900}"
export UV_HTTP_RETRIES="${UV_HTTP_RETRIES:-10}"

for required_path in "$prepare_script" "$train_script" "$source_root"; do
  if [[ ! -e "$required_path" ]]; then
    echo "Required path is missing: $required_path" >&2
    exit 2
  fi
done

echo "GPU and WSL environment"
nvidia-smi --query-gpu=name,memory.total,temperature.gpu,driver_version --format=csv,noheader
echo "WSL: $(. /etc/os-release && echo "$PRETTY_NAME")"
echo "Disk space:"
df -h "$HOME" "$repo_root" | awk 'NR == 1 || !seen[$1]++'

if [[ "$skip_install" == "0" ]]; then
  if [[ ! -x "$uv_bin" ]]; then
    echo "Creating a small uv bootstrap environment..."
    python3 -m venv "$bootstrap_dir"
    "$bootstrap_dir/bin/python" -m pip install --upgrade pip uv
  fi
  echo "Installing managed Python 3.12 (first run only)..."
  "$uv_bin" python install 3.12
  if [[ ! -x "$python_bin" ]]; then
    "$uv_bin" venv --python 3.12 "$venv_dir"
  fi
  echo "Installing CUDA PyTorch 2.13 and RF-DETR 1.9.4..."
  echo "Download policy: connect timeout ${UV_HTTP_CONNECT_TIMEOUT}s, read timeout ${UV_HTTP_TIMEOUT}s, retries ${UV_HTTP_RETRIES}"
  "$uv_bin" pip install --python "$python_bin" --upgrade \
    torch==2.13.0+cu130 torchvision==0.28.0+cu130 \
    --index-url https://download.pytorch.org/whl/cu130
  "$uv_bin" pip install --python "$python_bin" --upgrade \
    "rfdetr[train,augment,onnx]==1.9.4" \
    "tensorboard>=2.13" "numpy<2.4" pillow
elif [[ ! -x "$python_bin" ]]; then
  echo "RF-DETR WSL environment is missing. Run once without -SkipInstall." >&2
  exit 2
fi

"$python_bin" - <<'PY'
import torch
import rfdetr

print(f"Python-compatible RF-DETR: {getattr(rfdetr, '__version__', 'unknown')}")
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("CUDA is unavailable inside the RF-DETR WSL environment.")
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"GPU memory: {torch.cuda.get_device_properties(0).total_memory / (1024 ** 3):.1f} GiB")
PY

if [[ "$setup_only" == "1" ]]; then
  echo "RF-DETR GPU setup and verification completed. Training was not started."
  exit 0
fi

if [[ "$resume" == "0" && -f "$output_dir/checkpoint.pth" ]]; then
  echo "A prior run already exists at $output_dir" >&2
  echo "Use -Resume -SkipInstall to continue it, or choose a different -RunName." >&2
  exit 2
fi

echo "Preparing exact-deduplicated, source-group-disjoint dataset..."
"$python_bin" "$prepare_script" \
  --source-root "$source_root" \
  --output-root "$dataset_root" \
  --seed "$seed" \
  --split-search-trials 20000

train_args=(
  "$train_script"
  --dataset-root "$dataset_root"
  --output-dir "$output_dir"
  --epochs "$epochs"
  --resolution "$resolution"
  --batch-size "$batch_size"
  --grad-accum-steps "$grad_accum_steps"
  --workers "$workers"
  --patience "$patience"
  --target-precision "$target_precision"
  --seed "$seed"
)
if [[ "$resume" == "1" ]]; then
  train_args+=(--resume)
fi

export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES=0
export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=false
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,max_split_size_mb:128

echo "Starting overnight RF-DETR Nano training. Maximum epochs: $epochs"
echo "Resolution: $resolution, micro-batch: $batch_size, accumulation: $grad_accum_steps"
exec "$python_bin" "${train_args[@]}"
