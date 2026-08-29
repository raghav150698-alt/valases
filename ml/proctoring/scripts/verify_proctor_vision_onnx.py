from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import onnxruntime as ort


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute a smoke inference against an exported proctor ONNX model.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--report")
    args = parser.parse_args()

    model_path = Path(args.model).resolve()
    if not model_path.is_file():
        raise FileNotFoundError(f"ONNX model is missing: {model_path}")

    available_providers = ort.get_available_providers()
    provider = "CUDAExecutionProvider" if "CUDAExecutionProvider" in available_providers else "CPUExecutionProvider"
    session = ort.InferenceSession(str(model_path), providers=[provider])
    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1:
        raise RuntimeError(f"Expected one model input, found {len(inputs)}")

    input_meta = inputs[0]
    if input_meta.shape != [1, 3, 448, 448]:
        raise RuntimeError(f"Unexpected fixed input shape: {input_meta.shape}")
    sample = np.random.default_rng(42).random((1, 3, 448, 448), dtype=np.float32)

    started = time.perf_counter()
    values = session.run(None, {input_meta.name: sample})
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    shapes = [list(value.shape) for value in values]
    if shapes != [[1, 300, 4], [1, 300, 6]]:
        raise RuntimeError(f"Unexpected ONNX output shapes: {shapes}")
    if not all(np.isfinite(value).all() for value in values):
        raise RuntimeError("ONNX inference produced non-finite values")

    result = {
        "status": "passed",
        "runtime": f"onnxruntime {ort.__version__}",
        "provider": provider,
        "input": {"name": input_meta.name, "shape": list(input_meta.shape), "type": input_meta.type},
        "outputs": [
            {"name": meta.name, "shape": shape, "type": meta.type}
            for meta, shape in zip(outputs, shapes, strict=True)
        ],
        "smoke_inference_ms": elapsed_ms,
        "checked_at": datetime.now(UTC).isoformat(),
    }

    if args.report:
        report_path = Path(args.report).resolve()
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["onnx_runtime_validation"] = result
        temporary_report = report_path.with_suffix(".json.tmp")
        temporary_report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        temporary_report.replace(report_path)
        print(f"report_updated={report_path}")

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
