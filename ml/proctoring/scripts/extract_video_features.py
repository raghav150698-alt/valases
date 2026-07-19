from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from tqdm import tqdm

# Dynamic import of MediaPipe for robust execution across different systems.
# Newer MediaPipe builds expose Tasks instead of mp.solutions.
_MEDIAPIPE_SOLUTIONS_AVAILABLE = False
_MEDIAPIPE_TASKS_AVAILABLE = False
try:
    import mediapipe as mp
    _MEDIAPIPE_SOLUTIONS_AVAILABLE = hasattr(mp, "solutions") and hasattr(mp.solutions, "face_mesh")
except ImportError:
    mp = None  # type: ignore[assignment]

try:
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core.base_options import BaseOptions
    from mediapipe.tasks.python.vision.core import image as mp_image
    _MEDIAPIPE_TASKS_AVAILABLE = True
except ImportError:
    vision = None  # type: ignore[assignment]
    BaseOptions = None  # type: ignore[assignment]
    mp_image = None  # type: ignore[assignment]

_FACE_MESH_CACHE = None
_FACE_LANDMARKER_CACHE = None


def default_face_landmarker_path() -> Path:
    return Path(__file__).resolve().parents[3] / "data" / "proctoring" / "models" / "mediapipe" / "face_landmarker.task"

def get_face_mesh():
    global _FACE_MESH_CACHE
    if _FACE_MESH_CACHE is None and _MEDIAPIPE_SOLUTIONS_AVAILABLE:
        try:
            _FACE_MESH_CACHE = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=2,
                refine_landmarks=True,
                min_detection_confidence=0.5
            )
        except Exception:
            _FACE_MESH_CACHE = None
    return _FACE_MESH_CACHE


def get_face_landmarker(model_path: Path | None = None):
    global _FACE_LANDMARKER_CACHE
    if _FACE_LANDMARKER_CACHE is not None:
        return _FACE_LANDMARKER_CACHE
    if not _MEDIAPIPE_TASKS_AVAILABLE:
        return None
    asset_path = model_path or default_face_landmarker_path()
    if not asset_path.exists():
        return None
    try:
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(asset_path)),
            num_faces=2,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
        )
        _FACE_LANDMARKER_CACHE = vision.FaceLandmarker.create_from_options(options)
    except Exception:
        _FACE_LANDMARKER_CACHE = None
    return _FACE_LANDMARKER_CACHE


def sample_frames(video_path: str, max_frames: int = 40) -> list[np.ndarray]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        cap.release()
        return []
    indices = np.linspace(0, max(total - 1, 1), num=min(max_frames, total), dtype=int)
    frames: list[np.ndarray] = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame)
    cap.release()
    return frames


def extract_legacy_features(frame: np.ndarray) -> np.ndarray:
    frame = cv2.resize(frame, (320, 180))
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    h_mean = float(np.mean(hsv[:, :, 0]))
    s_mean = float(np.mean(hsv[:, :, 1]))
    v_mean = float(np.mean(hsv[:, :, 2]))
    v_std = float(np.std(hsv[:, :, 2]))
    edge = cv2.Canny(gray, 80, 160)
    edge_ratio = float(np.mean(edge > 0))
    return np.array([h_mean, s_mean, v_mean, v_std, edge_ratio], dtype=np.float32)


def frame_features(frame: np.ndarray) -> np.ndarray:
    mesh = get_face_mesh()
    landmarker = None if mesh is not None else get_face_landmarker()
    if mesh is None and landmarker is None:
        return extract_legacy_features(frame)

    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    if mesh is not None:
        results = mesh.process(rgb)
        face_landmarks = results.multi_face_landmarks
    else:
        image = mp_image.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        results = landmarker.detect(image)
        face_landmarks = results.face_landmarks

    # Fallback default landmark features (11 values)
    # [face_count, nose_left, nose_right, ratio, left_eye_open, right_eye_open, left_gaze_x, right_gaze_x, left_gaze_y, right_gaze_y, mouth_open]
    default_vec = np.array([0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], dtype=np.float32)

    if not face_landmarks:
        return default_vec

    face_count = len(face_landmarks)
    first_face = face_landmarks[0]
    lm = first_face.landmark if hasattr(first_face, "landmark") else first_face

    try:
        left_eye = lm[33]
        right_eye = lm[263]
        nose = lm[1]
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
        eye_dist = np.hypot(eye_dx, eye_dy)
        if eye_dist < 0.00001:
            return default_vec

        nose_left = np.hypot(nose.x - left_eye.x, nose.y - left_eye.y) / eye_dist
        nose_right = np.hypot(nose.x - right_eye.x, nose.y - right_eye.y) / eye_dist
        ratio = (nose.x - left_eye.x) / (eye_dx if abs(eye_dx) > 1e-6 else 1e-6)

        left_eye_open = abs(left_eye_lower.y - left_eye_upper.y) / eye_dist
        right_eye_open = abs(right_eye_lower.y - right_eye_upper.y) / eye_dist

        left_gaze_x = 0.0
        left_gaze_y = 0.0
        if left_iris:
            iris_x = sum(p.x for p in left_iris) / len(left_iris)
            iris_y = sum(p.y for p in left_iris) / len(left_iris)
            denom_x = (left_eye_inner.x - left_eye.x)
            left_gaze_x = (iris_x - left_eye.x) / (denom_x if abs(denom_x) > 1e-6 else 1e-6)
            denom_y = (left_eye_lower.y - left_eye_upper.y)
            left_gaze_y = (iris_y - left_eye_upper.y) / (denom_y if abs(denom_y) > 1e-6 else 1e-6)

        right_gaze_x = 0.0
        right_gaze_y = 0.0
        if right_iris:
            iris_x = sum(p.x for p in right_iris) / len(right_iris)
            iris_y = sum(p.y for p in right_iris) / len(right_iris)
            denom_x = (right_eye.x - right_eye_inner.x)
            right_gaze_x = (iris_x - right_eye_inner.x) / (denom_x if abs(denom_x) > 1e-6 else 1e-6)
            denom_y = (right_eye_lower.y - right_eye_upper.y)
            right_gaze_y = (iris_y - right_eye_upper.y) / (denom_y if abs(denom_y) > 1e-6 else 1e-6)

        mouth_height = np.hypot(lower_lip.x - upper_lip.x, lower_lip.y - upper_lip.y)
        mouth_width = np.hypot(mouth_right.x - mouth_left.x, mouth_right.y - mouth_left.y)
        mouth_open = mouth_height / (mouth_width if mouth_width > 1e-6 else 1e-6)

        return np.array([
            float(face_count),
            float(nose_left),
            float(nose_right),
            float(ratio),
            float(left_eye_open),
            float(right_eye_open),
            float(left_gaze_x),
            float(right_gaze_x),
            float(left_gaze_y),
            float(right_gaze_y),
            float(mouth_open)
        ], dtype=np.float32)

    except Exception:
        return default_vec


def aggregate_video_features(frames: list[np.ndarray]) -> np.ndarray | None:
    if not frames:
        return None
    feats = np.stack([frame_features(f) for f in frames], axis=0)
    return np.concatenate([np.mean(feats, axis=0), np.std(feats, axis=0)], axis=0)


def video_features(video_path: str, max_frames: int = 40) -> np.ndarray | None:
    frames = sample_frames(video_path, max_frames=max_frames)
    return aggregate_video_features(frames)



def load_image_frame(image_path: str) -> np.ndarray | None:
    """Load an image file as a BGR numpy array (same format as cv2.VideoCapture)."""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return None
        return img
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract landmark features from manifest (video + image).")
    parser.add_argument("--manifest", required=True, help="Input manifest CSV from build_manifest.py")
    parser.add_argument("--output", required=True, help="Output features CSV")
    parser.add_argument("--max-frames", type=int, default=40)
    parser.add_argument(
        "--windows-per-video",
        type=int,
        default=1,
        help="Split each video into this many temporal windows and emit one row per window.",
    )
    args = parser.parse_args()

    df = pd.read_csv(args.manifest)

    # Support both video and image modalities
    video_df = df[df["modality"] == "video"].copy()
    image_df = df[df["modality"] == "image"].copy()

    if video_df.empty and image_df.empty:
        raise RuntimeError("No video or image rows found in manifest.")

    rows: list[dict] = []

    # ── Video rows: sample frames and split into temporal windows ──
    if not video_df.empty:
        for rec in tqdm(video_df.to_dict(orient="records"), desc="extract-video-features"):
            frames = sample_frames(rec["path"], max_frames=args.max_frames)
            if not frames:
                continue
            windows = max(1, int(args.windows_per_video))
            frame_chunks = np.array_split(np.arange(len(frames)), windows)
            chunk_idx = 0
            for chunk in frame_chunks:
                if len(chunk) == 0:
                    continue
                chunk_frames = [frames[int(i)] for i in chunk]
                vec = aggregate_video_features(chunk_frames)
                if vec is None:
                    continue
                row = {
                    "path": f"{rec['path']}#w{chunk_idx:02d}",
                    "label": int(rec["label"]),
                }
                for i, value in enumerate(vec.tolist()):
                    row[f"f{i:02d}"] = float(value)
                rows.append(row)
                chunk_idx += 1

    # ── Image rows: single frame per image ──
    if not image_df.empty:
        for rec in tqdm(image_df.to_dict(orient="records"), desc="extract-image-features"):
            frame = load_image_frame(rec["path"])
            if frame is None:
                continue
            vec = aggregate_video_features([frame])
            if vec is None:
                continue
            row = {
                "path": rec["path"],
                "label": int(rec["label"]),
            }
            for i, value in enumerate(vec.tolist()):
                row[f"f{i:02d}"] = float(value)
            rows.append(row)

    out_df = pd.DataFrame(rows)
    if out_df.empty:
        raise RuntimeError("No features extracted.")
    out = Path(args.output).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out, index=False)
    print(f"features rows={len(out_df)} -> {out}")


if __name__ == "__main__":
    main()
