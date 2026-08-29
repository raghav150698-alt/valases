from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
import platform
import shutil
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


CLASS_NAMES = ["eye_movement", "hand_move", "mobile_use", "side_watching", "mouth_open"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if hasattr(value, "detach"):
        return value.detach().cpu().item() if value.numel() == 1 else value.detach().cpu().tolist()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def validate_dataset(dataset_root: Path) -> dict[str, Any]:
    report_path = dataset_root / "dataset_report.json"
    if not report_path.is_file():
        raise FileNotFoundError(f"Grouped dataset report is missing: {report_path}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    leakage = report.get("leakage_checks", {})
    if leakage.get("status") != "passed":
        raise RuntimeError(f"Dataset leakage checks did not pass: {leakage}")
    for split in ("train", "valid", "test"):
        images_dir = dataset_root / split / "images"
        labels_dir = dataset_root / split / "labels"
        image_count = sum(1 for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
        if image_count == 0 or not labels_dir.is_dir():
            raise RuntimeError(f"Grouped split {split!r} is missing images or labels")
    return report


def load_ground_truth(image_path: Path) -> dict[int, list[np.ndarray]]:
    label_path = image_path.parent.parent / "labels" / f"{image_path.stem}.txt"
    width, height = Image.open(image_path).size
    boxes: dict[int, list[np.ndarray]] = defaultdict(list)
    for raw_line in label_path.read_text(encoding="utf-8").splitlines():
        fields = raw_line.split()
        if not fields:
            continue
        class_id = int(fields[0])
        center_x, center_y, box_width, box_height = (float(value) for value in fields[1:5])
        x1 = (center_x - box_width / 2.0) * width
        y1 = (center_y - box_height / 2.0) * height
        x2 = (center_x + box_width / 2.0) * width
        y2 = (center_y + box_height / 2.0) * height
        boxes[class_id].append(np.asarray([x1, y1, x2, y2], dtype=np.float32))
    return boxes


def box_iou(left: np.ndarray, right: np.ndarray) -> float:
    intersection_width = max(0.0, min(float(left[2]), float(right[2])) - max(float(left[0]), float(right[0])))
    intersection_height = max(0.0, min(float(left[3]), float(right[3])) - max(float(left[1]), float(right[1])))
    intersection = intersection_width * intersection_height
    left_area = max(0.0, float(left[2] - left[0])) * max(0.0, float(left[3] - left[1]))
    right_area = max(0.0, float(right[2] - right[0])) * max(0.0, float(right[3] - right[1]))
    union = left_area + right_area - intersection
    return intersection / union if union > 0.0 else 0.0


def collect_predictions(model: Any, images_dir: Path, minimum_threshold: float) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    image_paths = sorted(
        (path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS),
        key=lambda path: path.name.lower(),
    )
    for index, image_path in enumerate(image_paths, start=1):
        detections = model.predict(str(image_path), threshold=minimum_threshold)
        predicted: dict[int, list[tuple[float, np.ndarray]]] = defaultdict(list)
        if detections.class_id is not None and detections.confidence is not None:
            for class_id, confidence, box in zip(
                detections.class_id,
                detections.confidence,
                detections.xyxy,
                strict=True,
            ):
                class_index = int(class_id)
                if 0 <= class_index < len(CLASS_NAMES):
                    predicted[class_index].append((float(confidence), np.asarray(box, dtype=np.float32)))
        frames.append(
            {
                "image": str(image_path),
                "ground_truth": load_ground_truth(image_path),
                "predicted": predicted,
            },
        )
        if index % 50 == 0 or index == len(image_paths):
            print(f"threshold-calibration: {index}/{len(image_paths)} frames", flush=True)
    return frames


def score_class(
    frames: list[dict[str, Any]],
    class_id: int,
    threshold: float,
    iou_threshold: float,
) -> dict[str, float | int]:
    true_positive = 0
    false_positive = 0
    false_negative = 0
    flagged_frames = 0
    for frame in frames:
        ground_truth = frame["ground_truth"].get(class_id, [])
        predictions = sorted(
            (
                (confidence, box)
                for confidence, box in frame["predicted"].get(class_id, [])
                if confidence >= threshold
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        if predictions:
            flagged_frames += 1
        matched: set[int] = set()
        for _, prediction in predictions:
            best_index = -1
            best_iou = 0.0
            for ground_truth_index, truth in enumerate(ground_truth):
                if ground_truth_index in matched:
                    continue
                iou = box_iou(prediction, truth)
                if iou > best_iou:
                    best_iou = iou
                    best_index = ground_truth_index
            if best_index >= 0 and best_iou >= iou_threshold:
                matched.add(best_index)
                true_positive += 1
            else:
                false_positive += 1
        false_negative += len(ground_truth) - len(matched)
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 1.0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    f1 = 2.0 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "threshold": threshold,
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "flagged_frames": flagged_frames,
        "false_flags_per_1000_frames": 1000.0 * false_positive / max(1, len(frames)),
    }


def calibrate_review_thresholds(
    model: Any,
    dataset_root: Path,
    target_precision: float,
    iou_threshold: float,
) -> dict[str, Any]:
    calibration_frames = collect_predictions(model, dataset_root / "valid" / "images", 0.01)
    print("Evaluating calibrated thresholds on the untouched test source groups...", flush=True)
    test_frames = collect_predictions(model, dataset_root / "test" / "images", 0.01)
    threshold_grid = [round(value / 100.0, 2) for value in range(5, 100)]
    output: dict[str, Any] = {
        "target_precision": target_precision,
        "iou_threshold": iou_threshold,
        "calibration_split": "valid",
        "final_evaluation_split": "test",
        "review_only": True,
        "auto_penalty": False,
        "classes": {},
    }
    for class_id, class_name in enumerate(CLASS_NAMES):
        candidates = [score_class(calibration_frames, class_id, threshold, iou_threshold) for threshold in threshold_grid]
        eligible = [item for item in candidates if float(item["precision"]) >= target_precision]
        if eligible:
            selected = max(
                eligible,
                key=lambda item: (float(item["recall"]), float(item["precision"]), -float(item["threshold"])),
            )
            target_met = True
        else:
            selected = max(
                candidates,
                key=lambda item: (float(item["precision"]), float(item["recall"]), float(item["f1"])),
            )
            target_met = False
        test_score = score_class(
            test_frames,
            class_id,
            float(selected["threshold"]),
            iou_threshold,
        )
        output["classes"][class_name] = {
            "target_precision_met_on_validation": target_met,
            "selected_threshold": selected["threshold"],
            "validation": selected,
            "test": test_score,
            "runtime_policy": {
                "minimum_consecutive_positive_frames": 3,
                "minimum_event_duration_seconds": 1.5,
                "destination": "recruiter_review_queue",
            },
        }
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune RF-DETR Nano for review-only proctoring behavior detection.")
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--resolution", type=int, default=448)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum-steps", type=int, default=16)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--target-precision", type=float, default=0.97)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--skip-export", action="store_true")
    parser.add_argument("--skip-threshold-calibration", action="store_true")
    args = parser.parse_args()

    if args.resolution % 32:
        raise ValueError("RF-DETR detection resolution must be divisible by 32")
    if not 0.5 <= args.target_precision < 1.0:
        raise ValueError("--target-precision must be in [0.5, 1.0)")

    dataset_root = Path(args.dataset_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_report = validate_dataset(dataset_root)

    import torch
    import rfdetr
    from rfdetr import RFDETRNano, from_checkpoint

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Run this trainer through the WSL PowerShell launcher.")
    torch.set_float32_matmul_precision("high")
    device_name = torch.cuda.get_device_name(0)
    memory_gib = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    framework_version = importlib.metadata.version("rfdetr")
    print(f"RF-DETR={framework_version}")
    print(f"PyTorch={torch.__version__} CUDA={torch.version.cuda}")
    print(f"GPU={device_name} memory={memory_gib:.1f} GiB")
    print(f"dataset={dataset_root}")
    print(f"output={output_dir}")

    resume_checkpoint = output_dir / "checkpoint.pth"
    resume_path = str(resume_checkpoint) if args.resume else None
    if args.resume and not resume_checkpoint.is_file():
        raise FileNotFoundError(f"Resume requested but checkpoint is missing: {resume_checkpoint}")

    model = RFDETRNano(
        gradient_checkpointing=True,
        resolution=args.resolution,
        device="cuda",
    )
    model.train(
        dataset_dir=str(dataset_root),
        dataset_file="yolo",
        output_dir=str(output_dir),
        epochs=max(1, args.epochs),
        batch_size=max(1, args.batch_size),
        grad_accum_steps=max(1, args.grad_accum_steps),
        resolution=args.resolution,
        lr=1e-4,
        lr_encoder=1.5e-4,
        weight_decay=1e-4,
        lr_scheduler="cosine",
        warmup_epochs=3,
        use_ema=True,
        eval_ema_only=True,
        early_stopping=True,
        early_stopping_patience=max(2, args.patience),
        early_stopping_min_delta=0.001,
        early_stopping_use_ema=True,
        skip_best_epochs=3,
        checkpoint_interval=5,
        eval_interval=1,
        multi_scale=False,
        expanded_scales=False,
        scale_jitter=False,
        amp_dtype="auto",
        compute_val_loss=False,
        progress_bar="tqdm",
        tensorboard=True,
        wandb=False,
        mlflow=False,
        clearml=False,
        num_workers=max(0, args.workers),
        seed=args.seed,
        notes={
            "purpose": "review-only online-exam proctoring evidence",
            "split_policy": "source-group-disjoint with exact-image deduplication",
            "automatic_penalty": False,
        },
        device="cuda",
        devices=1,
        resume=resume_path,
    )

    best_checkpoint = output_dir / "checkpoint_best_total.pth"
    if not best_checkpoint.is_file():
        raise FileNotFoundError(f"Training completed without a best checkpoint: {best_checkpoint}")
    best_model = from_checkpoint(
        str(best_checkpoint),
        resolution=args.resolution,
        device="cuda",
    )

    validation_metrics = best_model.evaluate(
        dataset_dir=str(dataset_root),
        dataset_file="yolo",
        split="val",
        device="cuda",
        resolution=args.resolution,
        batch_size=1,
        num_workers=max(0, args.workers),
        output_dir=str(output_dir / "evaluation_valid"),
        tensorboard=False,
        wandb=False,
        mlflow=False,
        clearml=False,
    )
    test_metrics = best_model.evaluate(
        dataset_dir=str(dataset_root / "test_as_valid"),
        dataset_file="yolo",
        split="val",
        device="cuda",
        resolution=args.resolution,
        batch_size=1,
        num_workers=max(0, args.workers),
        output_dir=str(output_dir / "evaluation_test"),
        tensorboard=False,
        wandb=False,
        mlflow=False,
        clearml=False,
    )

    threshold_report: dict[str, Any] | None = None
    threshold_error: str | None = None
    if not args.skip_threshold_calibration:
        try:
            threshold_report = calibrate_review_thresholds(
                best_model,
                dataset_root,
                target_precision=args.target_precision,
                iou_threshold=0.5,
            )
        except Exception as exc:  # preserve the trained checkpoint if optional calibration fails
            threshold_error = f"{type(exc).__name__}: {exc}"
            print(f"WARNING: threshold calibration failed: {threshold_error}", file=sys.stderr)

    export_result: str | None = None
    export_error: str | None = None
    if not args.skip_export:
        export_dir = output_dir / "export"
        export_dir.mkdir(parents=True, exist_ok=True)
        try:
            returned = best_model.export(
                format="onnx",
                output_dir=str(export_dir),
                opset_version=18,
                shape=(args.resolution, args.resolution),
                batch_size=1,
                dynamic_batch=False,
                verbose=False,
            )
            if returned:
                export_result = str(returned)
            else:
                exported_models = sorted(export_dir.rglob("*.onnx"))
                export_result = str(exported_models[0]) if exported_models else None
        except Exception as exc:  # a conversion issue must not discard a successful overnight training run
            export_error = f"{type(exc).__name__}: {exc}"
            print(f"WARNING: ONNX export failed: {export_error}", file=sys.stderr)

    final_report = {
        "completed_at": datetime.now(UTC).isoformat(),
        "framework": "RF-DETR Nano / DINOv2 / PyTorch Lightning",
        "framework_version": framework_version,
        "python": platform.python_version(),
        "pytorch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": {"name": device_name, "memory_gib": memory_gib},
        "dataset": dataset_report,
        "training": {
            "epochs_max": args.epochs,
            "resolution": args.resolution,
            "batch_size": args.batch_size,
            "grad_accum_steps": args.grad_accum_steps,
            "effective_batch_size": args.batch_size * args.grad_accum_steps,
            "gradient_checkpointing": True,
            "ema": True,
            "mixed_precision": True,
            "source_grouped_split": True,
            "exact_deduplication": True,
            "seed": args.seed,
        },
        "best_checkpoint": str(best_checkpoint),
        "validation_metrics": validation_metrics,
        "held_out_test_metrics": test_metrics,
        "review_thresholds": threshold_report,
        "threshold_calibration_error": threshold_error,
        "onnx_model": export_result,
        "onnx_export_error": export_error,
        "deployment_policy": {
            "status": "evaluation_only_not_promoted",
            "decision": "flag_for_recruiter_review_only",
            "automatic_rejection": False,
            "automatic_score_deduction": False,
        },
    }
    report_path = output_dir / "proctor_vision_ultra_report.json"
    report_path.write_text(json.dumps(json_value(final_report), indent=2), encoding="utf-8")
    shutil.copy2(dataset_root / "dataset_report.json", output_dir / "dataset_report.json")
    print(f"best_checkpoint={best_checkpoint}")
    print(f"onnx_model={export_result or 'not exported'}")
    print(f"report={report_path}")
    print("Production model was NOT overwritten. Review the held-out metrics before promotion.")


if __name__ == "__main__":
    main()
