from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler
import torch

from train_eye_gaze_pytorch import EyeGazeNet, evaluate as evaluate_torch
from train_head_eye_screen_model_v2 import collect_rows


def build_feature_table(input_root: Path, max_frames: int):
    rows = collect_rows(input_root, max_frames=max_frames)
    if not rows:
        raise RuntimeError("No usable rows extracted.")
    import pandas as pd

    df = pd.DataFrame(rows)
    feature_cols = [c for c in df.columns if c.startswith("f")]
    X = df[feature_cols].to_numpy(dtype=np.float32)
    y = df["is_on_screen"].astype(int).to_numpy()
    groups = df["source_path"].astype(str).to_numpy()
    return df, X, y, groups, feature_cols


def build_instance_ids(source_paths: Iterable[str], sample_indices: Iterable[int]) -> np.ndarray:
    return np.array(
        [f"{str(source_path)}::{int(sample_index)}" for source_path, sample_index in zip(source_paths, sample_indices)],
        dtype=object,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default="data/proctoring/raw/self_collection_v2/05_head_eye_decoupling")
    parser.add_argument("--eye-dataset", default="data/proctoring/processed/eye_crops_v1/eye_crop_dataset_v1.npz")
    parser.add_argument("--classical-bundle", default="data/proctoring/models/head_eye_screen_v2/head_eye_screen_bundle_v2.before_new_person.joblib")
    parser.add_argument("--pytorch-model", default="data/proctoring/models/eye_gaze_pytorch_v1/eye_gaze_pytorch_model.pt")
    parser.add_argument("--output-path", default="data/proctoring/models/ensemble/head_eye_ensemble_metrics.json")
    parser.add_argument("--max-frames", type=int, default=20)
    parser.add_argument("--classical-weight", type=float, default=0.55)
    parser.add_argument("--pytorch-weight", type=float, default=0.45)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    input_root = Path(args.input_root).resolve()
    eye_dataset_path = Path(args.eye_dataset).resolve()
    classical_bundle_path = Path(args.classical_bundle).resolve()
    pytorch_model_path = Path(args.pytorch_model).resolve()
    output_path = Path(args.output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    df, X, y, groups, feature_cols = build_feature_table(input_root, max_frames=args.max_frames)
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(gss.split(X, y, groups=groups))

    eye_data = np.load(eye_dataset_path, allow_pickle=True)
    left_eye = eye_data["left_eye"]
    right_eye = eye_data["right_eye"]
    eye_features = eye_data["feature_array"].astype(np.float32)
    eye_y = eye_data["y"].astype(np.int64)
    eye_groups = eye_data["groups"].astype(str)
    eye_source_paths = eye_data["source_paths"].astype(str)
    if "sample_indices" not in eye_data.files:
        raise RuntimeError(
            "Eye dataset is missing sample_indices. Re-run prepare_eye_crop_dataset.py with the updated script."
        )
    eye_sample_indices = eye_data["sample_indices"].astype(np.int32)
    eye_instance_ids = (
        eye_data["instance_ids"].astype(str)
        if "instance_ids" in eye_data.files
        else build_instance_ids(eye_source_paths, eye_sample_indices)
    )
    eye_gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    _, eye_test_idx = next(eye_gss.split(eye_features, eye_y, groups=eye_groups))

    classical_df_test = df.iloc[test_idx].reset_index(drop=True)
    classical_instance_ids = build_instance_ids(
        classical_df_test["source_path"].astype(str).to_numpy(),
        classical_df_test["sample_index"].astype(int).to_numpy(),
    )
    classical_id_to_pos = {instance_id: pos for pos, instance_id in enumerate(classical_instance_ids.tolist())}

    eye_test_instance_ids = eye_instance_ids[eye_test_idx]
    aligned_pairs = [
        (classical_id_to_pos[instance_id], eye_pos)
        for eye_pos, instance_id in enumerate(eye_test_instance_ids.tolist())
        if instance_id in classical_id_to_pos
    ]
    if not aligned_pairs:
        raise RuntimeError(
            "No overlapping samples found between classical test split and eye dataset split. "
            "Rebuild the eye dataset with the updated prep script."
        )

    classical_positions = np.array([pair[0] for pair in aligned_pairs], dtype=np.int64)
    eye_positions = np.array([pair[1] for pair in aligned_pairs], dtype=np.int64)

    classical_bundle = joblib.load(classical_bundle_path)
    classical_scaler: StandardScaler = classical_bundle["scaler"]
    classical_model = classical_bundle["model"]
    classical_X_test = classical_df_test[feature_cols].to_numpy(dtype=np.float32)[classical_positions]
    classical_probs = classical_model.predict_proba(classical_scaler.transform(classical_X_test))[:, 1]

    checkpoint = torch.load(pytorch_model_path, map_location="cpu")
    feature_mean = np.array(checkpoint["feature_mean"], dtype=np.float32)
    feature_scale = np.array(checkpoint["feature_scale"], dtype=np.float32)
    feature_count = int(checkpoint["feature_count"])
    selected_threshold = float(checkpoint.get("selected_threshold", 0.5))

    aligned_eye_idx = eye_test_idx[eye_positions]
    Xf_test = ((eye_features[aligned_eye_idx] - feature_mean) / feature_scale).astype(np.float32)
    from train_eye_gaze_pytorch import EyeDataset

    test_ds = EyeDataset(left_eye[aligned_eye_idx], right_eye[aligned_eye_idx], Xf_test, eye_y[aligned_eye_idx])
    test_loader = torch.utils.data.DataLoader(test_ds, batch_size=32, shuffle=False)

    torch_model = EyeGazeNet(feature_count)
    torch_model.load_state_dict(checkpoint["model_state_dict"])
    torch_model.eval()
    pytorch_probs, labels, _ = evaluate_torch(torch_model, test_loader, torch.device("cpu"), threshold=selected_threshold)

    ensemble_probs = (args.classical_weight * classical_probs) + (args.pytorch_weight * pytorch_probs)
    ensemble_pred = (ensemble_probs >= args.threshold).astype(np.int64)

    report = {
        "metrics": {
            "binary_screen_vs_offscreen_accuracy": float(accuracy_score(labels, ensemble_pred)),
            "binary_screen_vs_offscreen_f1": float(f1_score(labels, ensemble_pred)),
            "rows_evaluated": int(len(labels)),
            "classical_weight": float(args.classical_weight),
            "pytorch_weight": float(args.pytorch_weight),
            "threshold": float(args.threshold),
            "classical_bundle": str(classical_bundle_path),
            "pytorch_model": str(pytorch_model_path),
        },
        "binary_confusion_matrix": confusion_matrix(labels, ensemble_pred, labels=[0, 1]).tolist(),
        "classification_report": classification_report(labels, ensemble_pred, output_dict=True, zero_division=0),
    }
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["metrics"], indent=2))


if __name__ == "__main__":
    main()
