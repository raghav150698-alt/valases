from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from extract_video_features import frame_features, load_image_frame, sample_frames

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}

SCREEN_ZONE_LABELS = {
    "text_area": "Text Area",
    "top_left_non_text": "Top Left",
    "top_center_non_text": "Top Center",
    "top_right_non_text": "Top Right",
    "left_non_text": "Left",
    "right_non_text": "Right",
    "bottom_left_non_text": "Bottom Left",
    "bottom_center_non_text": "Bottom Center",
    "bottom_right_non_text": "Bottom Right",
    "away": "Away",
}


def _slug(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", str(name or "").strip().lower())
    value = re.sub(r"_+", "_", value).strip("_")
    return value


def infer_screen_zone(path: Path) -> str | None:
    slug = _slug(path.stem)
    if slug in {"text_area", "text"}:
        return "text_area"
    if slug in SCREEN_ZONE_LABELS:
        return slug
    if "looking_away" in " ".join(p.lower() for p in path.parts) or slug.startswith("looking_away"):
        return "away"
    return None


def sample_media_frames(path: Path, max_frames: int) -> list[np.ndarray]:
    if path.suffix.lower() in VIDEO_EXTS:
        return sample_frames(str(path), max_frames=max_frames)
    if path.suffix.lower() in IMAGE_EXTS:
        frame = load_image_frame(str(path))
        return [frame] if frame is not None else []
    return []


def raw_landmark_rows(path: Path, max_frames: int) -> list[np.ndarray]:
    rows: list[np.ndarray] = []
    for frame in sample_media_frames(path, max_frames=max_frames):
        vec = frame_features(frame)
        if vec is None or len(vec) < 11:
            continue
        face_count = float(vec[0])
        if face_count < 0.5:
            continue
        rows.append(np.asarray(vec, dtype=np.float32))
    return rows


def build_reference_vector(root: Path, max_frames: int) -> np.ndarray:
    baseline_paths: list[Path] = []
    eye_tracking = root / "01_eye_tracking"
    screen_gaze = root / "02_screen_gaze"
    if eye_tracking.exists():
        baseline_paths.extend([p for p in eye_tracking.rglob("*") if p.is_file() and p.suffix.lower() in (VIDEO_EXTS | IMAGE_EXTS)])
    if screen_gaze.exists():
        baseline_paths.extend(
            [
                p
                for p in screen_gaze.rglob("*")
                if p.is_file() and p.suffix.lower() in (VIDEO_EXTS | IMAGE_EXTS) and infer_screen_zone(p) == "text_area"
            ],
        )

    rows: list[np.ndarray] = []
    for path in baseline_paths:
        rows.extend(raw_landmark_rows(path, max_frames=max_frames))
    if not rows:
        raise RuntimeError(
            "No usable baseline landmark samples were found. Add files to 01_eye_tracking or TEXT AREA media in 02_screen_gaze.",
        )
    mat = np.stack(rows, axis=0)
    return np.median(mat, axis=0).astype(np.float32)


def derived_feature_names() -> list[str]:
    return [
        "nose_left_delta",
        "nose_right_delta",
        "ratio_delta",
        "left_eye_open_delta",
        "right_eye_open_delta",
        "left_gaze_x_delta",
        "right_gaze_x_delta",
        "left_gaze_y_delta",
        "right_gaze_y_delta",
        "mouth_open_delta",
        "avg_gaze_x_delta",
        "avg_gaze_y_delta",
        "gaze_x_skew",
        "gaze_y_skew",
        "eye_open_avg_delta",
        "eye_open_diff_delta",
        "horizontal_magnitude",
        "vertical_magnitude",
        "combined_screen_distance",
    ]


def derive_feature_vector(raw_vec: np.ndarray, ref_vec: np.ndarray) -> np.ndarray:
    raw = np.asarray(raw_vec, dtype=np.float32)
    ref = np.asarray(ref_vec, dtype=np.float32)
    nose_left_delta = float(raw[1] - ref[1])
    nose_right_delta = float(raw[2] - ref[2])
    ratio_delta = float(raw[3] - ref[3])
    left_eye_open_delta = float(raw[4] - ref[4])
    right_eye_open_delta = float(raw[5] - ref[5])
    left_gaze_x_delta = float(raw[6] - ref[6])
    right_gaze_x_delta = float(raw[7] - ref[7])
    left_gaze_y_delta = float(raw[8] - ref[8])
    right_gaze_y_delta = float(raw[9] - ref[9])
    mouth_open_delta = float(raw[10] - ref[10])
    avg_gaze_x_delta = (left_gaze_x_delta + right_gaze_x_delta) / 2.0
    avg_gaze_y_delta = (left_gaze_y_delta + right_gaze_y_delta) / 2.0
    gaze_x_skew = left_gaze_x_delta - right_gaze_x_delta
    gaze_y_skew = left_gaze_y_delta - right_gaze_y_delta
    eye_open_avg_delta = (left_eye_open_delta + right_eye_open_delta) / 2.0
    eye_open_diff_delta = left_eye_open_delta - right_eye_open_delta
    horizontal_magnitude = abs(avg_gaze_x_delta) + (abs(ratio_delta) * 0.7)
    vertical_magnitude = abs(avg_gaze_y_delta)
    combined_screen_distance = math.sqrt((avg_gaze_x_delta ** 2) + (avg_gaze_y_delta ** 2))
    return np.asarray(
        [
            nose_left_delta,
            nose_right_delta,
            ratio_delta,
            left_eye_open_delta,
            right_eye_open_delta,
            left_gaze_x_delta,
            right_gaze_x_delta,
            left_gaze_y_delta,
            right_gaze_y_delta,
            mouth_open_delta,
            avg_gaze_x_delta,
            avg_gaze_y_delta,
            gaze_x_skew,
            gaze_y_skew,
            eye_open_avg_delta,
            eye_open_diff_delta,
            horizontal_magnitude,
            vertical_magnitude,
            combined_screen_distance,
        ],
        dtype=np.float32,
    )


def collect_training_rows(root: Path, ref_vec: np.ndarray, max_frames: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    targets = [
        root / "02_screen_gaze",
        root / "04_looking_away",
    ]
    for folder in targets:
        if not folder.exists():
            continue
        for path in sorted(folder.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue
            if path.suffix.lower() not in (VIDEO_EXTS | IMAGE_EXTS):
                continue
            label = infer_screen_zone(path)
            if label is None:
                continue
            for frame_idx, raw_vec in enumerate(raw_landmark_rows(path, max_frames=max_frames)):
                feat = derive_feature_vector(raw_vec, ref_vec)
                row: dict[str, Any] = {
                    "source_path": str(path),
                    "label": label,
                    "sample_index": frame_idx,
                }
                for idx, value in enumerate(feat.tolist()):
                    row[f"f{idx:02d}"] = float(value)
                rows.append(row)
    return rows


def softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.sum(exp, axis=1, keepdims=True)


def export_browser_model(
    *,
    out_path: Path,
    scaler: StandardScaler,
    model: LogisticRegression,
    feature_names: list[str],
    reference_vec: np.ndarray,
    train_rows: list[dict[str, Any]],
    metrics: dict[str, Any],
) -> None:
    class_names = [str(name) for name in model.classes_.tolist()]
    payload = {
        "version": "screen_gaze_logreg_v1",
        "feature_names": feature_names,
        "class_names": class_names,
        "reference_raw_features": {
            "face_count": float(reference_vec[0]),
            "nose_left": float(reference_vec[1]),
            "nose_right": float(reference_vec[2]),
            "ratio": float(reference_vec[3]),
            "left_eye_open_ratio": float(reference_vec[4]),
            "right_eye_open_ratio": float(reference_vec[5]),
            "left_gaze_x": float(reference_vec[6]),
            "right_gaze_x": float(reference_vec[7]),
            "left_gaze_y": float(reference_vec[8]),
            "right_gaze_y": float(reference_vec[9]),
            "mouth_open_ratio": float(reference_vec[10]),
        },
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "model": {
            "coef": model.coef_.tolist(),
            "intercept": model.intercept_.tolist(),
        },
        "thresholds": {
            "onscreen_min_probability": 0.52,
            "borderline_max_away_probability": 0.36,
            "suspect_away_probability": 0.48,
            "min_top_class_probability": 0.34,
        },
        "display_names": SCREEN_ZONE_LABELS,
        "meta": {
            "training_rows": len(train_rows),
            "unique_sources": len({str(row["source_path"]) for row in train_rows}),
            "metrics": metrics,
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train browser-usable screen gaze classifier from self-collected data.")
    parser.add_argument(
        "--input-root",
        default="data/proctoring/raw/self_collection_v1",
        help="Root folder containing 01_eye_tracking, 02_screen_gaze, and 04_looking_away.",
    )
    parser.add_argument(
        "--output-dir",
        default="data/proctoring/models/screen_gaze",
        help="Directory for training outputs.",
    )
    parser.add_argument(
        "--browser-model-out",
        default="app/web/assets/generated/screen_gaze_model.json",
        help="Browser-readable JSON model path.",
    )
    parser.add_argument("--max-frames", type=int, default=28, help="Maximum frames sampled per media file.")
    parser.add_argument("--test-size", type=float, default=0.2, help="Frame-level holdout ratio for a quick validation slice.")
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    root = Path(args.input_root).resolve()
    if not root.exists():
        raise FileNotFoundError(f"Input root not found: {root}")

    reference_vec = build_reference_vector(root, max_frames=max(8, int(args.max_frames)))
    rows = collect_training_rows(root, reference_vec, max_frames=max(8, int(args.max_frames)))
    if not rows:
        raise RuntimeError("No gaze training rows were extracted from 02_screen_gaze or 04_looking_away.")

    feature_cols = sorted([key for key in rows[0].keys() if re.fullmatch(r"f\d{2}", key)])
    feature_names = derived_feature_names()
    if len(feature_cols) != len(feature_names):
        raise RuntimeError(f"Feature shape mismatch: {len(feature_cols)} columns vs {len(feature_names)} names.")

    X = np.asarray([[float(row[c]) for c in feature_cols] for row in rows], dtype=np.float32)
    y = np.asarray([str(row["label"]) for row in rows])

    counts = Counter(y.tolist())
    if len(counts) < 3:
        raise RuntimeError(f"Need multiple gaze classes to train. Found only: {dict(counts)}")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=max(0.05, min(0.35, float(args.test_size))),
        random_state=int(args.random_state),
        stratify=y,
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    model = LogisticRegression(
        max_iter=5000,
        multi_class="multinomial",
        class_weight="balanced",
        random_state=int(args.random_state),
    )
    model.fit(X_train_s, y_train)

    prob = model.predict_proba(X_test_s)
    pred = model.classes_[np.argmax(prob, axis=1)]
    away_index = list(model.classes_).index("away") if "away" in model.classes_ else None
    away_prob = prob[:, away_index] if away_index is not None else np.zeros((len(prob),), dtype=np.float32)
    screen_pred = np.where(away_prob >= 0.48, "away", "screen")
    screen_true = np.where(y_test == "away", "away", "screen")

    metrics = {
        "frame_validation_accuracy": float(accuracy_score(y_test, pred)),
        "frame_validation_macro_f1": float(f1_score(y_test, pred, average="macro")),
        "screen_vs_away_accuracy": float(accuracy_score(screen_true, screen_pred)),
        "class_counts": dict(sorted(counts.items())),
        "classes": [str(x) for x in model.classes_.tolist()],
        "feature_names": feature_names,
        "holdout_rows": int(len(y_test)),
        "train_rows": int(len(y_train)),
        "source_count": len({str(row["source_path"]) for row in rows}),
        "caveat": (
            "Validation is frame-level because the current self-collected set has only one named video per screen zone. "
            "Treat this as a useful tuning signal, not a final accuracy claim."
        ),
    }

    report = {
        "metrics": metrics,
        "classification_report": classification_report(y_test, pred, output_dict=True, zero_division=0),
        "confusion_matrix": {
            "labels": [str(x) for x in model.classes_.tolist()],
            "matrix": confusion_matrix(y_test, pred, labels=model.classes_).tolist(),
        },
    }

    out_dir = Path(args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    features_out = out_dir / "screen_gaze_training_rows.csv"
    report_out = out_dir / "screen_gaze_metrics.json"
    bundle_out = out_dir / "screen_gaze_bundle.joblib"
    browser_out = Path(args.browser_model_out).resolve()

    import pandas as pd

    pd.DataFrame(rows).to_csv(features_out, index=False)
    report_out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    joblib.dump(
        {
            "reference_vec": reference_vec,
            "feature_names": feature_names,
            "scaler": scaler,
            "model": model,
            "metrics": metrics,
        },
        bundle_out,
    )
    export_browser_model(
        out_path=browser_out,
        scaler=scaler,
        model=model,
        feature_names=feature_names,
        reference_vec=reference_vec,
        train_rows=rows,
        metrics=metrics,
    )

    print(json.dumps({"status": "ok", "output_dir": str(out_dir), "browser_model": str(browser_out), **metrics}, indent=2))


if __name__ == "__main__":
    main()
