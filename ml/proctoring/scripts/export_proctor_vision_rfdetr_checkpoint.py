from __future__ import annotations

import argparse
import importlib.metadata
import json
from datetime import UTC, datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export an already-trained RF-DETR proctoring checkpoint to ONNX without retraining.",
    )
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--resolution", type=int, default=448)
    parser.add_argument("--report")
    args = parser.parse_args()

    if args.resolution % 32:
        raise ValueError("RF-DETR export resolution must be divisible by 32")

    checkpoint = Path(args.checkpoint).resolve()
    output_dir = Path(args.output_dir).resolve()
    if not checkpoint.is_file():
        raise FileNotFoundError(f"Checkpoint is missing: {checkpoint}")
    output_dir.mkdir(parents=True, exist_ok=True)

    import onnx
    import torch
    from rfdetr import from_checkpoint

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Run this exporter through WSL with the RF-DETR environment.")

    framework_version = importlib.metadata.version("rfdetr")
    print(f"RF-DETR={framework_version}")
    print(f"PyTorch={torch.__version__} CUDA={torch.version.cuda}")
    print(f"GPU={torch.cuda.get_device_name(0)}")
    print(f"checkpoint={checkpoint}")

    model = from_checkpoint(
        str(checkpoint),
        resolution=args.resolution,
        device="cuda",
    )
    returned = model.export(
        format="onnx",
        output_dir=str(output_dir),
        opset_version=18,
        shape=(args.resolution, args.resolution),
        batch_size=1,
        dynamic_batch=False,
        verbose=False,
        notes={
            "purpose": "review-only online-exam proctoring evidence",
            "automatic_penalty": False,
            "source_checkpoint": str(checkpoint),
        },
    )
    exported = Path(returned).resolve() if returned else next(output_dir.rglob("*.onnx"), None)
    if exported is None or not exported.is_file() or exported.stat().st_size == 0:
        raise RuntimeError(f"RF-DETR returned without a usable ONNX file in {output_dir}")

    print("Validating ONNX graph...")
    onnx.checker.check_model(str(exported))
    graph = onnx.load(str(exported), load_external_data=False).graph
    input_names = [item.name for item in graph.input]
    output_names = [item.name for item in graph.output]

    if args.report:
        report_path = Path(args.report).resolve()
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["framework_version"] = framework_version
        report["onnx_model"] = str(exported)
        report["onnx_export_error"] = None
        report["onnx_exported_at"] = datetime.now(UTC).isoformat()
        report["onnx_validation"] = {
            "status": "passed",
            "checker": "onnx.checker.check_model",
            "size_bytes": exported.stat().st_size,
            "inputs": input_names,
            "outputs": output_names,
            "resolution": [args.resolution, args.resolution],
            "batch_size": 1,
        }
        temporary_report = report_path.with_suffix(".json.tmp")
        temporary_report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        temporary_report.replace(report_path)
        print(f"report_updated={report_path}")

    print(f"onnx_model={exported}")
    print(f"onnx_size_bytes={exported.stat().st_size}")
    print("ONNX export and structural validation completed successfully.")


if __name__ == "__main__":
    main()
