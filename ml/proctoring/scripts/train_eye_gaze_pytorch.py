from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, recall_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, Dataset


class EyeDataset(Dataset):
    def __init__(self, left_eye, right_eye, features, labels):
        self.left_eye = torch.tensor(left_eye, dtype=torch.float32).permute(0, 3, 1, 2) / 255.0
        self.right_eye = torch.tensor(right_eye, dtype=torch.float32).permute(0, 3, 1, 2) / 255.0
        self.features = torch.tensor(features, dtype=torch.float32)
        self.labels = torch.tensor(labels, dtype=torch.float32)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        return self.left_eye[idx], self.right_eye[idx], self.features[idx], self.labels[idx]


class EyeTower(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(3, 24, kernel_size=5, stride=2),
            nn.ReLU(),
            nn.BatchNorm2d(24),
            nn.Conv2d(24, 48, kernel_size=3),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(48, 64, kernel_size=3),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),
        )

    def forward(self, x):
        x = self.net(x)
        return x.flatten(1)


class EyeGazeNet(nn.Module):
    def __init__(self, feature_count: int):
        super().__init__()
        self.eye_tower = EyeTower()
        self.feature_net = nn.Sequential(
            nn.BatchNorm1d(feature_count),
            nn.Linear(feature_count, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
        )
        self.classifier = nn.Sequential(
            nn.Linear(64 + 64 + 32, 128),
            nn.ReLU(),
            nn.Dropout(0.25),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 1),
        )

    def forward(self, left_eye, right_eye, features):
        left_vec = self.eye_tower(left_eye)
        right_vec = self.eye_tower(right_eye)
        feat_vec = self.feature_net(features)
        merged = torch.cat([left_vec, right_vec, feat_vec], dim=1)
        return self.classifier(merged).squeeze(1)


def evaluate(model, loader, device, threshold: float = 0.5):
    model.eval()
    probs = []
    labels = []
    with torch.no_grad():
        for left_eye, right_eye, features, target in loader:
            left_eye = left_eye.to(device)
            right_eye = right_eye.to(device)
            features = features.to(device)
            logits = model(left_eye, right_eye, features)
            probs.extend(torch.sigmoid(logits).cpu().numpy().tolist())
            labels.extend(target.numpy().tolist())
    probs = np.array(probs, dtype=np.float32)
    labels = np.array(labels, dtype=np.int64)
    pred = (probs >= threshold).astype(np.int64)
    return probs, labels, pred


def select_best_threshold(probs: np.ndarray, labels: np.ndarray) -> tuple[float, dict[str, float]]:
    best_threshold = 0.5
    best_metrics = {
        "macro_f1": -1.0,
        "accuracy": 0.0,
        "offscreen_recall": 0.0,
        "onscreen_f1": 0.0,
    }
    for threshold in np.linspace(0.4, 0.65, 11):
        pred = (probs >= threshold).astype(np.int64)
        macro_f1 = f1_score(labels, pred, average="macro", zero_division=0)
        accuracy = accuracy_score(labels, pred)
        offscreen_recall = recall_score(labels, pred, pos_label=0, zero_division=0)
        onscreen_f1 = f1_score(labels, pred, pos_label=1, zero_division=0)
        candidate = {
            "macro_f1": float(macro_f1),
            "accuracy": float(accuracy),
            "offscreen_recall": float(offscreen_recall),
            "onscreen_f1": float(onscreen_f1),
        }
        candidate_key = (
            round(candidate["macro_f1"], 8),
            round(candidate["offscreen_recall"], 8),
            round(candidate["accuracy"], 8),
        )
        best_key = (
            round(best_metrics["macro_f1"], 8),
            round(best_metrics["offscreen_recall"], 8),
            round(best_metrics["accuracy"], 8),
        )
        if candidate_key > best_key:
            best_threshold = float(threshold)
            best_metrics = candidate
    return best_threshold, best_metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="data/proctoring/processed/eye_crops_v1/eye_crop_dataset_v1.npz")
    parser.add_argument("--output-dir", default="data/proctoring/models/eye_gaze_pytorch_v1")
    parser.add_argument("--epochs", type=int, default=16)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--val-size", type=float, default=0.15)
    parser.add_argument("--offscreen-weight", type=float, default=1.6)
    parser.add_argument("--onscreen-weight", type=float, default=1.0)
    parser.add_argument("--score-macro-weight", type=float, default=0.75)
    parser.add_argument("--score-offscreen-weight", type=float, default=0.25)
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
    inner_groups = groups[train_idx]
    inner_y = y[train_idx]
    inner_gss = GroupShuffleSplit(n_splits=1, test_size=args.val_size, random_state=7)
    train_sub_idx, val_idx = next(inner_gss.split(features[train_idx], inner_y, groups=inner_groups))
    full_train_idx = train_idx[train_sub_idx]
    full_val_idx = train_idx[val_idx]

    scaler = StandardScaler()
    Xf_train = scaler.fit_transform(features[full_train_idx]).astype(np.float32)
    Xf_val = scaler.transform(features[full_val_idx]).astype(np.float32)
    Xf_test = scaler.transform(features[test_idx]).astype(np.float32)

    train_ds = EyeDataset(left_eye[full_train_idx], right_eye[full_train_idx], Xf_train, y[full_train_idx])
    val_ds = EyeDataset(left_eye[full_val_idx], right_eye[full_val_idx], Xf_val, y[full_val_idx])
    test_ds = EyeDataset(left_eye[test_idx], right_eye[test_idx], Xf_test, y[test_idx])
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = EyeGazeNet(Xf_train.shape[1]).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    best_state = copy.deepcopy(model.state_dict())
    best_threshold = 0.5
    best_epoch = 0
    best_score = -1.0
    patience_left = args.patience

    history = []
    for epoch in range(args.epochs):
        model.train()
        running_loss = 0.0
        for left_batch, right_batch, feat_batch, target_batch in train_loader:
            left_batch = left_batch.to(device)
            right_batch = right_batch.to(device)
            feat_batch = feat_batch.to(device)
            target_batch = target_batch.to(device)

            optimizer.zero_grad()
            logits = model(left_batch, right_batch, feat_batch)
            sample_weights = torch.where(
                target_batch < 0.5,
                torch.full_like(target_batch, float(args.offscreen_weight)),
                torch.full_like(target_batch, float(args.onscreen_weight)),
            )
            loss_vec = nn.functional.binary_cross_entropy_with_logits(logits, target_batch, reduction="none")
            loss = (loss_vec * sample_weights).mean()
            loss.backward()
            optimizer.step()
            running_loss += float(loss.item()) * len(target_batch)

        avg_loss = running_loss / max(len(train_ds), 1)
        val_probs, val_labels, _ = evaluate(model, val_loader, device, threshold=0.5)
        epoch_threshold, threshold_metrics = select_best_threshold(val_probs, val_labels)
        _, _, val_pred = evaluate(model, val_loader, device, threshold=epoch_threshold)
        val_accuracy = float(accuracy_score(val_labels, val_pred))
        val_f1 = float(f1_score(val_labels, val_pred))
        val_macro_f1 = float(f1_score(val_labels, val_pred, average="macro", zero_division=0))
        val_offscreen_recall = float(recall_score(val_labels, val_pred, pos_label=0, zero_division=0))
        history.append({
            "epoch": epoch + 1,
            "loss": avg_loss,
            "val_accuracy": val_accuracy,
            "val_f1": val_f1,
            "val_macro_f1": val_macro_f1,
            "val_offscreen_recall": val_offscreen_recall,
            "selected_threshold": float(epoch_threshold),
        })
        score = (args.score_macro_weight * val_macro_f1) + (args.score_offscreen_weight * val_offscreen_recall)
        if score > best_score:
            best_score = float(score)
            best_state = copy.deepcopy(model.state_dict())
            best_threshold = float(epoch_threshold)
            best_epoch = epoch + 1
            patience_left = args.patience
        else:
            patience_left -= 1
            if patience_left <= 0:
                break

    model.load_state_dict(best_state)
    probs, labels, pred = evaluate(model, test_loader, device, threshold=best_threshold)

    metrics = {
        "binary_screen_vs_offscreen_accuracy": float(accuracy_score(labels, pred)),
        "binary_screen_vs_offscreen_f1": float(f1_score(labels, pred)),
        "rows_total": int(len(y)),
        "rows_train": int(len(full_train_idx)),
        "rows_val": int(len(full_val_idx)),
        "rows_test": int(len(test_idx)),
        "group_train": int(len(set(groups[full_train_idx]))),
        "group_val": int(len(set(groups[full_val_idx]))),
        "group_test": int(len(set(groups[test_idx]))),
        "model_type": "PyTorch CNN + landmark fusion",
        "device": str(device),
        "selected_threshold": float(best_threshold),
        "best_epoch": int(best_epoch),
        "best_score": float(best_score),
        "offscreen_weight": float(args.offscreen_weight),
        "onscreen_weight": float(args.onscreen_weight),
        "score_macro_weight": float(args.score_macro_weight),
        "score_offscreen_weight": float(args.score_offscreen_weight),
    }

    report = {
        "metrics": metrics,
        "binary_confusion_matrix": confusion_matrix(labels, pred, labels=[0, 1]).tolist(),
        "classification_report": classification_report(labels, pred, output_dict=True, zero_division=0),
        "history": history,
    }

    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "feature_mean": scaler.mean_.tolist(),
            "feature_scale": scaler.scale_.tolist(),
            "feature_count": int(Xf_train.shape[1]),
            "selected_threshold": float(best_threshold),
            "best_epoch": int(best_epoch),
        },
        output_dir / "eye_gaze_pytorch_model.pt",
    )
    (output_dir / "eye_gaze_pytorch_metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
