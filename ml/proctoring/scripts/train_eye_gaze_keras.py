from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler
import tensorflow as tf


def build_model(image_size: int, feature_count: int) -> tf.keras.Model:
    left_input = tf.keras.Input(shape=(image_size, image_size, 3), name="left_eye")
    right_input = tf.keras.Input(shape=(image_size, image_size, 3), name="right_eye")
    feature_input = tf.keras.Input(shape=(feature_count,), name="landmark_features")

    augment = tf.keras.Sequential([
        tf.keras.layers.Rescaling(1.0 / 255.0),
    ], name="rescale")

    eye_tower = tf.keras.Sequential([
        tf.keras.layers.Conv2D(24, 5, strides=2, activation="relu"),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Conv2D(48, 3, activation="relu"),
        tf.keras.layers.MaxPooling2D(),
        tf.keras.layers.Conv2D(64, 3, activation="relu"),
        tf.keras.layers.GlobalAveragePooling2D(),
    ], name="eye_tower")

    left_vec = eye_tower(augment(left_input))
    right_vec = eye_tower(augment(right_input))

    feat_vec = tf.keras.layers.BatchNormalization()(feature_input)
    feat_vec = tf.keras.layers.Dense(32, activation="relu")(feat_vec)
    feat_vec = tf.keras.layers.Dropout(0.2)(feat_vec)

    merged = tf.keras.layers.Concatenate()([left_vec, right_vec, feat_vec])
    merged = tf.keras.layers.Dense(128, activation="relu")(merged)
    merged = tf.keras.layers.Dropout(0.25)(merged)
    merged = tf.keras.layers.Dense(64, activation="relu")(merged)
    merged = tf.keras.layers.Dropout(0.2)(merged)
    output = tf.keras.layers.Dense(1, activation="sigmoid")(merged)

    model = tf.keras.Model(inputs=[left_input, right_input, feature_input], outputs=output)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=[
            tf.keras.metrics.BinaryAccuracy(name="accuracy"),
            tf.keras.metrics.AUC(name="auc"),
        ],
    )
    return model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="data/proctoring/processed/eye_crops_v1/eye_crop_dataset_v1.npz")
    parser.add_argument("--output-dir", default="data/proctoring/models/eye_gaze_keras_v1")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    dataset_path = Path(args.dataset).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    data = np.load(dataset_path, allow_pickle=True)
    left_eye = data["left_eye"]
    right_eye = data["right_eye"]
    features = data["feature_array"].astype(np.float32)
    y = data["y"].astype(np.int64)
    groups = data["groups"].astype(str)

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(gss.split(features, y, groups=groups))

    scaler = StandardScaler()
    Xf_train = scaler.fit_transform(features[train_idx]).astype(np.float32)
    Xf_test = scaler.transform(features[test_idx]).astype(np.float32)

    model = build_model(left_eye.shape[1], Xf_train.shape[1])
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_auc", mode="max", patience=6, restore_best_weights=True),
    ]
    history = model.fit(
        [left_eye[train_idx], right_eye[train_idx], Xf_train],
        y[train_idx],
        validation_split=0.15,
        epochs=args.epochs,
        batch_size=args.batch_size,
        verbose=2,
        callbacks=callbacks,
    )

    probs = model.predict([left_eye[test_idx], right_eye[test_idx], Xf_test], verbose=0).reshape(-1)
    pred = (probs >= 0.5).astype(np.int64)

    metrics = {
        "binary_screen_vs_offscreen_accuracy": float(accuracy_score(y[test_idx], pred)),
        "binary_screen_vs_offscreen_f1": float(f1_score(y[test_idx], pred)),
        "rows_total": int(len(y)),
        "rows_train": int(len(train_idx)),
        "rows_test": int(len(test_idx)),
        "group_train": int(len(set(groups[train_idx]))),
        "group_test": int(len(set(groups[test_idx]))),
        "model_type": "TensorFlow/Keras CNN + landmark fusion",
    }
    report = {
        "metrics": metrics,
        "binary_confusion_matrix": confusion_matrix(y[test_idx], pred, labels=[0, 1]).tolist(),
        "classification_report": classification_report(y[test_idx], pred, output_dict=True, zero_division=0),
        "history": {k: [float(vv) for vv in values] for k, values in history.history.items()},
    }

    model.save(output_dir / "eye_gaze_keras_model.keras")
    np.save(output_dir / "feature_mean.npy", scaler.mean_)
    np.save(output_dir / "feature_scale.npy", scaler.scale_)
    (output_dir / "eye_gaze_keras_metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
