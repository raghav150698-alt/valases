from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".jpeg"}

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


def sample_frames(video_path: str, max_frames: int = 24) -> list[np.ndarray]:
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
        img = cv2.imread(path)
        return img
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


def extract_head_eye_features(frame: np.ndarray) -> np.ndarray | None:
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

        # Human-anatomy inspired head proxies
        head_yaw_proxy = (nose_right - nose_left) / max(nose_left + nose_right, 1e-6)
        head_roll_proxy = math.atan2(eye_dy, eye_dx)
        face_vertical_span = max(abs(mouth_mid_y - eye_mid_y), 1e-6)
        head_pitch_proxy = ((nose.y - eye_mid_y) / face_vertical_span) - 0.5

        # Eyeball relative-to-head behavior
        avg_gaze_x = ((left_gaze_x - 0.5) + (right_gaze_x - 0.5)) / 2.0
        avg_gaze_y = ((left_gaze_y - 0.5) + (right_gaze_y - 0.5)) / 2.0
        vergence_x = abs(left_gaze_x - right_gaze_x)
        vergence_y = abs(left_gaze_y - right_gaze_y)

        # Sclera balance / eyelid symmetry
        left_sclera_balance = left_gaze_x - 0.5
        right_sclera_balance = right_gaze_x - 0.5
        eye_open_avg = (left_eye_open + right_eye_open) / 2.0
        eye_open_diff = left_eye_open - right_eye_open

        # Compensation residual:
        # if head turns right, on-screen gaze usually compensates left a bit.
        comp_residual_x = avg_gaze_x + (0.75 * head_yaw_proxy)
        comp_residual_y = avg_gaze_y + (0.55 * head_pitch_proxy)

        head_rotation_mag = math.sqrt((head_yaw_proxy ** 2) + (head_pitch_proxy ** 2) + (head_roll_proxy ** 2))
        gaze_rotation_mag = math.sqrt((avg_gaze_x ** 2) + (avg_gaze_y ** 2))
        residual_mag = math.sqrt((comp_residual_x ** 2) + (comp_residual_y ** 2))

        features = np.array([
            nose_left,
            nose_right,
            face_ratio,
            left_eye_open,
            right_eye_open,
            left_gaze_x,
            right_gaze_x,
            left_gaze_y,
            right_gaze_y,
            mouth_open,
            head_yaw_proxy,
            head_pitch_proxy,
            head_roll_proxy,
            avg_gaze_x,
            avg_gaze_y,
            vergence_x,
            vergence_y,
            left_sclera_balance,
            right_sclera_balance,
            eye_open_avg,
            eye_open_diff,
            comp_residual_x,
            comp_residual_y,
            head_rotation_mag,
            gaze_rotation_mag,
            residual_mag,
            nose.x - eye_mid_x,
            nose.y - eye_mid_y,
            chin.y - nose.y,
            mouth_mid_y - nose.y,
        ], dtype=np.float32)

        return features
    except Exception:
        return None


def collect_rows(root: Path, max_frames: int = 24) -> list[dict]:
    rows = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_EXTS | IMAGE_EXTS:
            continue

        label = infer_label(path)
        if label == "unknown":
            continue

        frames = []
        if path.suffix.lower() in VIDEO_EXTS:
            frames = sample_frames(str(path), max_frames=max_frames)
        else:
            frame = load_image_frame(str(path))
            if frame is not None:
                frames = [frame]

        for idx, frame in enumerate(frames):
            vec = extract_head_eye_features(frame)
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
    parser.add_argument("--output-dir", default="data/proctoring/models/head_eye_screen")
    parser.add_argument("--max-frames", type=int, default=24)
    args = parser.parse_args()

    input_root = Path(args.input_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = collect_rows(input_root, max_frames=args.max_frames)
    if not rows:
        raise RuntimeError("No usable rows extracted from dataset.")

    df = pd.DataFrame(rows)
    feature_cols = [c for c in df.columns if c.startswith("f")]
    X = df[feature_cols].to_numpy(dtype=np.float32)

    # Binary: on-screen vs off-screen
    y_bin = df["is_on_screen"].astype(int).to_numpy()

    # Multi: detailed head-eye classes
    y_multi = df["label"].astype(str).to_numpy()

    X_train, X_test, yb_train, yb_test, ym_train, ym_test = train_test_split(
        X, y_bin, y_multi,
        test_size=0.2,
        random_state=42,
        stratify=y_multi,
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    binary_model = LogisticRegression(max_iter=4000, class_weight="balanced")
    binary_model.fit(X_train_s, yb_train)
    bin_pred = binary_model.predict(X_test_s)

    multi_model = LogisticRegression(max_iter=5000, class_weight="balanced", multi_class="multinomial")
    multi_model.fit(X_train_s, ym_train)
    multi_pred = multi_model.predict(X_test_s)

    metrics = {
        "binary_screen_vs_offscreen_accuracy": float(accuracy_score(yb_test, bin_pred)),
        "binary_screen_vs_offscreen_f1": float(f1_score(yb_test, bin_pred)),
        "multi_class_accuracy": float(accuracy_score(ym_test, multi_pred)),
        "rows_total": int(len(df)),
        "rows_train": int(len(X_train)),
        "rows_test": int(len(X_test)),
        "class_counts": df["label"].value_counts().to_dict(),
        "feature_count": int(len(feature_cols)),
        "features_note": "Head pose proxies + eyeball pose + eyelid/sclera symmetry + head-eye compensation residuals",
    }

    report = {
        "metrics": metrics,
        "binary_confusion_matrix": confusion_matrix(yb_test, bin_pred, labels=[0, 1]).tolist(),
        "multi_class_report": classification_report(ym_test, multi_pred, output_dict=True, zero_division=0),
    }

    df.to_csv(output_dir / "head_eye_training_rows.csv", index=False)
    (output_dir / "head_eye_metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    joblib.dump(
        {
            "scaler": scaler,
            "binary_model": binary_model,
            "multi_model": multi_model,
            "feature_cols": feature_cols,
            "metrics": metrics,
        },
        output_dir / "head_eye_screen_bundle.joblib",
    )

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
