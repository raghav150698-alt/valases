#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=""
epochs="80"
image_size="512"
batch="8"
workers="4"
patience="15"
model="yolo26n.pt"
run_name="yolo26n_external_v1"
resume="0"
skip_install="0"
setup_only="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) repo_root="$2"; shift 2 ;;
    --epochs) epochs="$2"; shift 2 ;;
    --image-size) image_size="$2"; shift 2 ;;
    --batch) batch="$2"; shift 2 ;;
    --workers) workers="$2"; shift 2 ;;
    --patience) patience="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
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

trainer="$repo_root/ml/proctoring/scripts/train_zenodo_behavior_detector.py"
dataset_root="$repo_root/data/proctoring/external_licensed/zenodo_students_behavior"
project_root="$repo_root/data/proctoring/models/zenodo_behavior_detector"
venv_dir="$HOME/.venvs/certora-proctoring-gpu"
python_bin="$venv_dir/bin/python"

if [[ ! -f "$trainer" ]]; then
  echo "Trainer not found: $trainer" >&2
  exit 2
fi
if [[ ! -d "$dataset_root" ]]; then
  echo "Dataset not found: $dataset_root" >&2
  exit 2
fi

if [[ "$skip_install" == "0" ]]; then
  if [[ ! -x "$python_bin" ]]; then
    echo "Creating WSL Python environment: $venv_dir"
    python3 -m venv "$venv_dir"
  fi

  "$python_bin" -m pip install --upgrade pip
  "$python_bin" -m pip install --upgrade \
    torch==2.13.0+cu130 torchvision==0.28.0+cu130 \
    --index-url https://download.pytorch.org/whl/cu130
  "$python_bin" -m pip install --upgrade ultralytics onnx onnxslim
elif [[ ! -x "$python_bin" ]]; then
  echo "WSL GPU environment is missing. Run once without -SkipInstall." >&2
  exit 2
fi

"$python_bin" - <<'PY'
import torch

print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("CUDA is not available inside the WSL PyTorch environment.")
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"GPU memory: {torch.cuda.get_device_properties(0).total_memory / (1024 ** 3):.1f} GiB")
PY

if [[ "$setup_only" == "1" ]]; then
  echo "WSL GPU setup and verification completed."
  exit 0
fi

train_args=(
  "$trainer"
  --dataset-root "$dataset_root"
  --model "$model"
  --epochs "$epochs"
  --imgsz "$image_size"
  --batch "$batch"
  --workers "$workers"
  --patience "$patience"
  --project "$project_root"
  --name "$run_name"
  --device 0
)
if [[ "$resume" == "1" ]]; then
  train_args+=(--resume)
fi

export PYTHONUNBUFFERED=1
exec "$python_bin" "${train_args[@]}"
