from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from train_head_eye_screen_model_v2 import (
    IMAGE_EXTS,
    VIDEO_EXTS,
    extract_features,
    get_landmarks,
    infer_label,
    is_on_screen_label,
    load_image_frame,
    sample_frames,
)


LEFT_EYE_INDICES = [33, 133, 159, 145, 468, 469, 470, 471, 472]
RIGHT_EYE_INDICES = [362, 263, 386, 374, 473, 474, 475, 476, 477]


def align_face(frame: np.ndarray, landmarks) -> np.ndarray:
    h, w = frame.shape[:2]
    left = landmarks[33]
    right = landmarks[263]
    left_pt = np.array([left.x * w, left.y * h], dtype=np.float32)
    right_pt = np.array([right.x * w, right.y * h], dtype=np.float32)
    eye_center = (left_pt + right_pt) / 2.0
    angle = np.degrees(np.arctan2(right_pt[1] - left_pt[1], right_pt[0] - left_pt[0]))
    rot = cv2.getRotationMatrix2D(tuple(eye_center), angle, 1.0)
    return cv2.warpAffine(frame, rot, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def blur_score(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def normalize_eye_crop(crop_bgr: np.ndarray, size: int) -> np.ndarray:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)
    rgb = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB)
    return cv2.resize(rgb, (size, size), interpolation=cv2.INTER_AREA)


def crop_eye(frame: np.ndarray, landmarks, indices: list[int], size: int = 64, pad_scale: float = 0.45) -> np.ndarray | None:
    h, w = frame.shape[:2]
    points = []
    for idx in indices:
        if idx >= len(landmarks):
            continue
        lm = landmarks[idx]
        points.append((lm.x * w, lm.y * h))
    if len(points) < 4:
        return None

    pts = np.array(points, dtype=np.float32)
    min_xy = pts.min(axis=0)
    max_xy = pts.max(axis=0)
    span = np.maximum(max_xy - min_xy, 1.0)
    pad = span * pad_scale

    x0 = max(int(min_xy[0] - pad[0]), 0)
    y0 = max(int(min_xy[1] - pad[1]), 0)
    x1 = min(int(max_xy[0] + pad[0]), w - 1)
    y1 = min(int(max_xy[1] + pad[1]), h - 1)

    if x1 <= x0 or y1 <= y0:
        return None

    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    return normalize_eye_crop(crop, size=size)


def iter_media_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_EXTS | IMAGE_EXTS:
            continue
        yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default="data/proctoring/raw/self_collection_v2/05_head_eye_decoupling")
    parser.add_argument("--output-dir", default="data/proctoring/processed/eye_crops_v1")
    parser.add_argument("--max-frames", type=int, default=20)
    parser.add_argument("--image-size", type=int, default=64)
    parser.add_argument("--min-blur-score", type=float, default=20.0)
    args = parser.parse_args()

    input_root = Path(args.input_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    left_images: list[np.ndarray] = []
    right_images: list[np.ndarray] = []
    labels: list[int] = []
    label_names: list[str] = []
    groups: list[str] = []
    source_paths: list[str] = []
    sample_indices: list[int] = []
    instance_ids: list[str] = []
    feature_rows: list[np.ndarray] = []
    skipped_blurry = 0
    processed_frames = 0

    for path in iter_media_files(input_root):
        label_name = infer_label(path)
        if label_name == "unknown":
            continue

        if path.suffix.lower() in VIDEO_EXTS:
            frames = sample_frames(str(path), max_frames=args.max_frames)
        else:
            frame = load_image_frame(str(path))
            frames = [frame] if frame is not None else []

        for sample_index, frame in enumerate(frames):
            if frame is None:
                continue
            processed_frames += 1
            if blur_score(frame) < args.min_blur_score:
                skipped_blurry += 1
                continue
            landmarks = get_landmarks(frame)
            if not landmarks:
                continue
            aligned = align_face(frame, landmarks)
            aligned_landmarks = get_landmarks(aligned)
            if not aligned_landmarks:
                continue

            left_eye = crop_eye(aligned, aligned_landmarks, LEFT_EYE_INDICES, size=args.image_size)
            right_eye = crop_eye(aligned, aligned_landmarks, RIGHT_EYE_INDICES, size=args.image_size)
            feat = extract_features(aligned)

            if left_eye is None or right_eye is None or feat is None:
                continue

            left_images.append(left_eye)
            right_images.append(right_eye)
            labels.append(is_on_screen_label(label_name))
            label_names.append(label_name)
            groups.append(str(path))
            source_paths.append(str(path))
            sample_indices.append(sample_index)
            instance_ids.append(f"{path}::{sample_index}")
            feature_rows.append(feat.astype(np.float32))

    if not left_images:
        raise RuntimeError("No usable eye crops extracted.")

    left_array = np.stack(left_images).astype(np.uint8)
    right_array = np.stack(right_images).astype(np.uint8)
    y_array = np.array(labels, dtype=np.int64)
    feature_array = np.stack(feature_rows).astype(np.float32)
    groups_array = np.array(groups, dtype=object)
    label_names_array = np.array(label_names, dtype=object)
    source_array = np.array(source_paths, dtype=object)
    sample_index_array = np.array(sample_indices, dtype=np.int32)
    instance_id_array = np.array(instance_ids, dtype=object)

    np.savez_compressed(
        output_dir / "eye_crop_dataset_v1.npz",
        left_eye=left_array,
        right_eye=right_array,
        y=y_array,
        feature_array=feature_array,
        groups=groups_array,
        label_names=label_names_array,
        source_paths=source_array,
        sample_indices=sample_index_array,
        instance_ids=instance_id_array,
    )

    manifest = {
        "rows_total": int(len(y_array)),
        "image_size": int(args.image_size),
        "max_frames": int(args.max_frames),
        "min_blur_score": float(args.min_blur_score),
        "processed_frames": int(processed_frames),
        "skipped_blurry_frames": int(skipped_blurry),
        "class_counts_binary": {
            "offscreen": int((y_array == 0).sum()),
            "onscreen": int((y_array == 1).sum()),
        },
        "class_counts_labels": {
            label: int(sum(1 for name in label_names if name == label))
            for label in sorted(set(label_names))
        },
        "feature_count": int(feature_array.shape[1]),
    }
    (output_dir / "eye_crop_manifest_v1.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
