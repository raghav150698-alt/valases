from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler

from train_head_eye_screen_model_v2 import collect_rows


FEATURE_LABELS = {
    3: "left_eye_open",
    4: "right_eye_open",
    5: "left_gaze_x",
    6: "right_gaze_x",
    7: "left_gaze_y",
    8: "right_gaze_y",
    13: "avg_gaze_x",
    14: "avg_gaze_y",
    15: "vergence_x",
    16: "vergence_y",
    17: "comp_residual_x",
    18: "comp_residual_y",
    19: "yaw_gaze_product",
    20: "pitch_gaze_product",
    21: "yaw_residual_abs",
    22: "pitch_residual_abs",
    23: "eye_open_avg",
    24: "eye_open_diff",
    25: "left_sclera_balance",
    26: "right_sclera_balance",
    27: "head_rotation_mag",
    28: "gaze_rotation_mag",
    29: "residual_mag",
    34: "yaw_plus_gaze_abs",
    35: "pitch_plus_gaze_abs",
}

SELECTED_FEATURES = list(FEATURE_LABELS.keys())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default="data/proctoring/raw/self_collection_v2/05_head_eye_decoupling")
    parser.add_argument("--output-dir", default="data/proctoring/models/head_eye_screen_v3")
    parser.add_argument("--max-frames", type=int, default=20)
    args = parser.parse_args()

    input_root = Path(args.input_root).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = collect_rows(input_root, max_frames=args.max_frames)
    if not rows:
      raise RuntimeError("No usable rows extracted.")

    df = pd.DataFrame(rows)
    source_feature_cols = [f"f{i:02d}" for i in SELECTED_FEATURES]
    X = df[source_feature_cols].to_numpy(dtype=np.float32)
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
        n_estimators=700,
        max_depth=10,
        min_samples_leaf=4,
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
        "feature_count": int(len(source_feature_cols)),
        "selected_features": [FEATURE_LABELS[i] for i in SELECTED_FEATURES],
        "model_type": "RandomForestClassifier",
        "split_type": "GroupShuffleSplit by source_path",
        "feature_strategy": "Anatomy-relative eye/gaze residuals with reduced absolute head-pose dependence",
    }

    report = {
        "metrics": metrics,
        "binary_confusion_matrix": confusion_matrix(y_test, pred, labels=[0, 1]).tolist(),
        "classification_report": classification_report(y_test, pred, output_dict=True, zero_division=0),
        "feature_importance": {
            FEATURE_LABELS[SELECTED_FEATURES[i]]: float(v)
            for i, v in enumerate(model.feature_importances_)
        },
    }

    df.to_csv(output_dir / "head_eye_training_rows_v3.csv", index=False)
    (output_dir / "head_eye_metrics_v3.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    joblib.dump(
        {
            "scaler": scaler,
            "model": model,
            "feature_cols": source_feature_cols,
            "selected_features": SELECTED_FEATURES,
            "selected_feature_labels": [FEATURE_LABELS[i] for i in SELECTED_FEATURES],
            "metrics": metrics,
        },
        output_dir / "head_eye_screen_bundle_v3.joblib",
    )

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
