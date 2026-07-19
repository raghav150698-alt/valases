from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}

_MEDIAPIPE_SOLUTIONS_AVAILABLE = False
_MEDIAPIPE_TASKS_AVAILABLE = False

try:
    import mediapipe as mp
    _MEDIAPIPE_SOLUTIONS_AVAILABLE = hasattr(mp, "solutions") and hasattr(mp.solutions, "face_mesh")
except Exception:
    mp = None

try:
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core.base_options import BaseOptions
    from mediapipe.tasks.python.vision.core import image as mp_image
    _MEDIAPIPE_TASKS_AVAILABLE = True
except Exception:
    vision = None
    BaseOptions = None
    mp_image = None

_FACE_MESH_CACHE = None
_FACE_LANDMARKER_CACHE = None


def default_face_landmarker_path() -> Path:
    return Path("data/proctoring/models/mediapipe/face_landmarker.task").resolve()


def get_face_mesh():
    global _FACE_MESH_CACHE
    if _FACE_MESH_CACHE is None and _MEDIAPIPE_SOLUTIONS_AVAILABLE:
        try:
            _FACE_MESH_CACHE = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
            )
        except Exception:
            _FACE_MESH_CACHE = None
    return _FACE_MESH_CACHE


def get_face_landmarker():
    global _FACE_LANDMARKER_CACHE
    if _FACE_LANDMARKER_CACHE is not None:
        return _FACE_LANDMARKER_CACHE
    if not _MEDIAPIPE_TASKS_AVAILABLE:
        return None
    asset_path = default_face_landmarker_path()
    if not asset_path.exists():
        return None
    try:
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(asset_path)),
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
        )
        _FACE_LANDMARKER_CACHE = vision.FaceLandmarker.create_from_options(options)
    except Exception:
        _FACE_LANDMARKER_CACHE = None
    return _FACE_LANDMARKER_CACHE


def sample_frames(video_path: str, max_frames: int = 20) -> list[np.ndarray]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        cap.release()
        return []
    indices = np.linspace(0, max(total - 1, 1), num=min(max_frames, total), dtype=int)
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame)
    cap.release()
    return frames


def load_image_frame(path: str) -> np.ndarray | None:
    try:
        return cv2.imread(path)
    except Exception:
        return None


def infer_label(path: Path) -> str:
    s = str(path).lower().replace("-", "_").replace(" ", "_")
    if "head_right_eyes_screen_top_left" in s:
        return "head_right_screen_top_left"
    if "head_left_eyes_screen_top_right" in s:
        return "head_left_screen_top_right"
    if "head_right_eyes_offscreen_right" in s:
        return "offscreen_right"
    if "head_left_eyes_offscreen_left" in s:
        return "offscreen_left"
    if "head_up_eyes_offscreen_up" in s:
        return "offscreen_up"
    if "head_down_eyes_offscreen_down" in s:
        return "offscreen_down"
    if "head_right_eyes_screen_center" in s:
        return "head_right_screen_center"
    if "head_left_eyes_screen_center" in s:
        return "head_left_screen_center"
    if "head_up_eyes_screen_center" in s:
        return "head_up_screen_center"
    if "head_down_eyes_screen_center" in s:
        return "head_down_screen_center"
    if "head_straight_eyes_screen_center" in s:
        return "head_straight_screen_center"
    return "unknown"


def is_on_screen_label(label: str) -> int:
    return 0 if label.startswith("offscreen_") else 1


def get_landmarks(frame: np.ndarray):
    mesh = get_face_mesh()
    landmarker = None if mesh is not None else get_face_landmarker()
    if mesh is None and landmarker is None:
        return None

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    if mesh is not None:
        results = mesh.process(rgb)
        face_landmarks = results.multi_face_landmarks
    else:
        image = mp_image.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        results = landmarker.detect(image)
        face_landmarks = results.face_landmarks

    if not face_landmarks:
        return None
    first_face = face_landmarks[0]
    return first_face.landmark if hasattr(first_face, "landmark") else first_face


def extract_features(frame: np.ndarray) -> np.ndarray | None:
    lm = get_landmarks(frame)
    if not lm:
        return None
    try:
        left_eye = lm[33]
        right_eye = lm[263]
        nose = lm[1]
        chin = lm[152]
        upper_lip = lm[13]
        lower_lip = lm[14]
        mouth_left = lm[78]
        mouth_right = lm[308]
        left_eye_inner = lm[133]
        right_eye_inner = lm[362]
        left_eye_upper = lm[159]
        left_eye_lower = lm[145]
        right_eye_upper = lm[386]
        right_eye_lower = lm[374]
        left_iris = [lm[i] for i in range(468, 473) if i < len(lm)]
        right_iris = [lm[i] for i in range(473, 478) if i < len(lm)]

        eye_dx = right_eye.x - left_eye.x
        eye_dy = right_eye.y - left_eye.y
        eye_dist = math.hypot(eye_dx, eye_dy)
        if eye_dist < 1e-6:
            return None

        nose_left = math.hypot(nose.x - left_eye.x, nose.y - left_eye.y) / eye_dist
        nose_right = math.hypot(nose.x - right_eye.x, nose.y - right_eye.y) / eye_dist
        face_ratio = (nose.x - left_eye.x) / (eye_dx if abs(eye_dx) > 1e-6 else 1e-6)

        left_eye_open = abs(left_eye_lower.y - left_eye_upper.y) / eye_dist
        right_eye_open = abs(right_eye_lower.y - right_eye_upper.y) / eye_dist

        left_gaze_x = 0.5
        left_gaze_y = 0.5
        if left_iris:
            iris_x = sum(p.x for p in left_iris) / len(left_iris)
            iris_y = sum(p.y for p in left_iris) / len(left_iris)
            left_gaze_x = (iris_x - left_eye.x) / ((left_eye_inner.x - left_eye.x) if abs(left_eye_inner.x - left_eye.x) > 1e-6 else 1e-6)
            left_gaze_y = (iris_y - left_eye_upper.y) / ((left_eye_lower.y - left_eye_upper.y) if abs(left_eye_lower.y - left_eye_upper.y) > 1e-6 else 1e-6)

        right_gaze_x = 0.5
        right_gaze_y = 0.5
        if right_iris:
            iris_x = sum(p.x for p in right_iris) / len(right_iris)
            iris_y = sum(p.y for p in right_iris) / len(right_iris)
            right_gaze_x = (iris_x - right_eye_inner.x) / ((right_eye.x - right_eye_inner.x) if abs(right_eye.x - right_eye_inner.x) > 1e-6 else 1e-6)
            right_gaze_y = (iris_y - right_eye_upper.y) / ((right_eye_lower.y - right_eye_upper.y) if abs(right_eye_lower.y - right_eye_upper.y) > 1e-6 else 1e-6)

        mouth_height = math.hypot(lower_lip.x - upper_lip.x, lower_lip.y - upper_lip.y)
        mouth_width = math.hypot(mouth_right.x - mouth_left.x, mouth_right.y - mouth_left.y)
        mouth_open = mouth_height / (mouth_width if mouth_width > 1e-6 else 1e-6)

        eye_mid_x = (left_eye.x + right_eye.x) / 2.0
        eye_mid_y = (left_eye.y + right_eye.y) / 2.0
        mouth_mid_x = (mouth_left.x + mouth_right.x) / 2.0
        mouth_mid_y = (mouth_left.y + mouth_right.y) / 2.0

        head_yaw = (nose_right - nose_left) / max(nose_left + nose_right, 1e-6)
        head_roll = math.atan2(eye_dy, eye_dx)
        face_vertical_span = max(abs(mouth_mid_y - eye_mid_y), 1e-6)
        head_pitch = ((nose.y - eye_mid_y) / face_vertical_span) - 0.5

        avg_gaze_x = ((left_gaze_x - 0.5) + (right_gaze_x - 0.5)) / 2.0
        avg_gaze_y = ((left_gaze_y - 0.5) + (right_gaze_y - 0.5)) / 2.0
        vergence_x = abs(left_gaze_x - right_gaze_x)
        vergence_y = abs(left_gaze_y - right_gaze_y)

        comp_residual_x = avg_gaze_x + (0.75 * head_yaw)
        comp_residual_y = avg_gaze_y + (0.55 * head_pitch)

        # Extra nonlinear anatomy-aware interactions
        yaw_gaze_product = head_yaw * avg_gaze_x
        pitch_gaze_product = head_pitch * avg_gaze_y
        yaw_residual_abs = abs(comp_residual_x)
        pitch_residual_abs = abs(comp_residual_y)
        eye_open_avg = (left_eye_open + right_eye_open) / 2.0
        eye_open_diff = left_eye_open - right_eye_open
        left_sclera_balance = left_gaze_x - 0.5
        right_sclera_balance = right_gaze_x - 0.5
        head_rotation_mag = math.sqrt(head_yaw**2 + head_pitch**2 + head_roll**2)
        gaze_rotation_mag = math.sqrt(avg_gaze_x**2 + avg_gaze_y**2)
        residual_mag = math.sqrt(comp_residual_x**2 + comp_residual_y**2)

        return np.array([
            nose_left, nose_right, face_ratio,
            left_eye_open, right_eye_open,
            left_gaze_x, right_gaze_x, left_gaze_y, right_gaze_y,
            mouth_open,
            head_yaw, head_pitch, head_roll,
            avg_gaze_x, avg_gaze_y,
            vergence_x, vergence_y,
            comp_residual_x, comp_residual_y,
            yaw_gaze_product, pitch_gaze_product,
            yaw_residual_abs, pitch_residual_abs,
            eye_open_avg, eye_open_diff,
            left_sclera_balance, right_sclera_balance,
            head_rotation_mag, gaze_rotation_mag, residual_mag,
            nose.x - eye_mid_x,
            nose.y - eye_mid_y,
            chin.y - nose.y,
            mouth_mid_y - nose.y,
            abs(head_yaw) + abs(avg_gaze_x),
            abs(head_pitch) + abs(avg_gaze_y),
        ], dtype=np.float32)
    except Exception:
        return None


def collect_rows(root: Path, max_frames: int = 20) -> list[dict]:
    rows = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_EXTS | IMAGE_EXTS:
            continue
        label = infer_label(path)
        if label == "unknown":
            continue

        if path.suffix.lower() in VIDEO_EXTS:
            frames = sample_frames(str(path), max_frames=max_frames)
        else:
            frame = load_image_frame(str(path))
            frames = [frame] if frame is not None else []

        for idx, frame in enumerate(frames):
            vec = extract_features(frame)
            if vec is None:
                continue
            row = {
                "source_path": str(path),
                "label": label,
                "is_on_screen": is_on_screen_label(label),
                "sample_index": idx,
            }
            for i, value in enumerate(vec.tolist()):
                row[f"f{i:02d}"] = float(value)
            rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default="data/proctoring/raw/self_collection_v2/05_head_eye_decoupling")
    parser.add_argument("--output-dir", default="data/proctoring/models/head_eye_screen_v2")
    parser.add_argument("--max-frames", type=int, default=20)
    args = parser.parse_args()

    input_root = Path(args.input_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = collect_rows(input_root, max_frames=args.max_frames)
    if not rows:
        raise RuntimeError("No usable rows extracted.")

    df = pd.DataFrame(rows)
    feature_cols = [c for c in df.columns if c.startswith("f")]
    X = df[feature_cols].to_numpy(dtype=np.float32)
    y = df["is_on_screen"].astype(int).to_numpy()
    groups = df["source_path"].astype(str).to_numpy()

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(gss.split(X, y, groups=groups))

    X_train = X[train_idx]
    X_test = X[test_idx]
    y_train = y[train_idx]
    y_test = y[test_idx]

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    model = RandomForestClassifier(
        n_estimators=500,
        max_depth=12,
        min_samples_leaf=3,
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train_s, y_train)
    pred = model.predict(X_test_s)

    metrics = {
        "binary_screen_vs_offscreen_accuracy": float(accuracy_score(y_test, pred)),
        "binary_screen_vs_offscreen_f1": float(f1_score(y_test, pred)),
        "rows_total": int(len(df)),
        "rows_train": int(len(train_idx)),
        "rows_test": int(len(test_idx)),
        "group_train": int(len(set(groups[train_idx]))),
        "group_test": int(len(set(groups[test_idx]))),
        "class_counts": df["label"].value_counts().to_dict(),
        "feature_count": int(len(feature_cols)),
        "model_type": "RandomForestClassifier",
        "split_type": "GroupShuffleSplit by source_path",
    }

    report = {
        "metrics": metrics,
        "binary_confusion_matrix": confusion_matrix(y_test, pred, labels=[0, 1]).tolist(),
        "classification_report": classification_report(y_test, pred, output_dict=True, zero_division=0),
        "feature_importance": {
            feature_cols[i]: float(v)
            for i, v in enumerate(model.feature_importances_)
        },
    }

    df.to_csv(output_dir / "head_eye_training_rows_v2.csv", index=False)
    (output_dir / "head_eye_metrics_v2.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    joblib.dump(
        {
            "scaler": scaler,
            "model": model,
            "feature_cols": feature_cols,
            "metrics": metrics,
        },
        output_dir / "head_eye_screen_bundle_v2.joblib",
    )

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
