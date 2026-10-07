from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path


CLASS_NAMES = ["eye_movement", "hand_move", "mobile_use", "side_watching", "mouth_open"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def find_dataset_root(extracted_root: Path) -> Path:
    candidates = [path.parent.parent for path in extracted_root.rglob("train/images") if path.is_dir()]
    if not candidates:
        raise FileNotFoundError(f"Could not find train/images below {extracted_root}")
    augmented = [path for path in candidates if "aug" in str(path).lower()]
    return sorted(augmented or candidates, key=lambda path: len(str(path)))[0]


def validate_split(dataset_root: Path, split: str) -> tuple[int, Counter[int]]:
    images_dir = dataset_root / split / "images"
    labels_dir = dataset_root / split / "labels"
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise FileNotFoundError(f"Missing {split}/images or {split}/labels under {dataset_root}")
    images = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS)
    missing: list[str] = []
    counts: Counter[int] = Counter()
    for image in images:
        label_path = labels_dir / f"{image.stem}.txt"
        if not label_path.exists():
            missing.append(image.name)
            continue
        for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            fields = line.split()
            if not fields:
                continue
            class_id = int(fields[0])
            if class_id < 0 or class_id >= len(CLASS_NAMES):
                raise ValueError(f"Invalid class id {class_id} in {label_path}")
            counts[class_id] += 1
    if missing:
        raise RuntimeError(f"{len(missing)} {split} images are missing labels; first={missing[:5]}")
    return len(images), counts


def write_dataset_yaml(dataset_root: Path, output: Path) -> None:
    root = dataset_root.as_posix()
    content = "\n".join(
        [
            f"path: {root}",
            "train: train/images",
            "val: valid/images",
            "nc: 5",
            "names:",
            *[f"  {index}: {name}" for index, name in enumerate(CLASS_NAMES)],
            "",
        ],
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the five-class Zenodo proctoring behavior detector.")
    parser.add_argument(
        "--dataset-root",
        default="data/proctoring/external_licensed/zenodo_students_behavior",
    )
    parser.add_argument("--model", default="yolo26n.pt")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--imgsz", type=int, default=512)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--project", default="data/proctoring/models/zenodo_behavior_detector")
    parser.add_argument("--name", default="yolo26n_external_v1")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    extracted_root = Path(args.dataset_root).resolve()
    dataset_root = find_dataset_root(extracted_root)
    train_count, train_classes = validate_split(dataset_root, "train")
    valid_count, valid_classes = validate_split(dataset_root, "valid")
    project = Path(args.project).resolve()
    run_dir = project / args.name
    dataset_yaml = project / "zenodo_behavior_5class.yaml"
    write_dataset_yaml(dataset_root, dataset_yaml)

    print(f"dataset_root={dataset_root}")
    print(f"train_images={train_count} valid_images={valid_count}")
    print(f"train_objects={dict(sorted(train_classes.items()))}")
    print(f"valid_objects={dict(sorted(valid_classes.items()))}")
    print(f"dataset_yaml={dataset_yaml}")

    from ultralytics import YOLO

    checkpoint = run_dir / "weights" / "last.pt"
    if args.resume:
        if not checkpoint.exists():
            raise FileNotFoundError(f"Resume requested but checkpoint is missing: {checkpoint}")
        model = YOLO(str(checkpoint))
        results = model.train(resume=True)
    else:
        model = YOLO(args.model)
        results = model.train(
            data=str(dataset_yaml),
            epochs=max(1, args.epochs),
            imgsz=max(320, args.imgsz),
            batch=max(1, args.batch),
            workers=max(0, args.workers),
            patience=max(0, args.patience),
            device=args.device,
            project=str(project),
            name=args.name,
            exist_ok=True,
            cache=False,
            seed=42,
            deterministic=True,
            plots=True,
            verbose=True,
        )

    best = run_dir / "weights" / "best.pt"
    if not best.exists():
        raise FileNotFoundError(f"Training completed without best.pt: {best}")
    best_model = YOLO(str(best))
    validation = best_model.val(data=str(dataset_yaml), split="val", device=args.device)
    onnx_path = best_model.export(
        format="onnx",
        imgsz=max(320, args.imgsz),
        dynamic=False,
        simplify=True,
        nms=True,
        device=args.device,
    )
    metrics = {
        "trained_at": datetime.now(UTC).isoformat(),
        "dataset_root": str(dataset_root),
        "dataset_yaml": str(dataset_yaml),
        "classes": CLASS_NAMES,
        "train_images": train_count,
        "valid_images": valid_count,
        "train_objects": {CLASS_NAMES[key]: value for key, value in sorted(train_classes.items())},
        "valid_objects": {CLASS_NAMES[key]: value for key, value in sorted(valid_classes.items())},
        "model": args.model,
        "best_checkpoint": str(best),
        "onnx_model": str(onnx_path),
        "validation": {key: float(value) for key, value in validation.results_dict.items()},
        "training": {
            key: float(value) if isinstance(value, (int, float)) else str(value)
            for key, value in getattr(results, "results_dict", {}).items()
        },
        "deployment_status": "evaluation_only_do_not_auto-penalize_candidates",
    }
    metrics_path = run_dir / "proctor_detector_report.json"
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"best_checkpoint={best}")
    print(f"onnx_model={onnx_path}")
    print(f"report={metrics_path}")


if __name__ == "__main__":
    main()
