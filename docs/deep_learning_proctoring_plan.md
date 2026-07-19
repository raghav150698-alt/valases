# Deep Learning Proctoring Pipeline

This experiment track adds a shared eye-crop dataset and two deep-learning trainers:

- TensorFlow / Keras
- PyTorch

Both consume the same prepared dataset so their results are comparable.

## 1. Prepare shared eye-crop dataset

```powershell
cd D:\Lenovo\certora
.\.venv-proctoring\Scripts\python.exe .\ml\proctoring\scripts\prepare_eye_crop_dataset.py `
  --input-root .\data\proctoring\raw\self_collection_v2\05_head_eye_decoupling `
  --output-dir .\data\proctoring\processed\eye_crops_v1 `
  --max-frames 20 `
  --image-size 64 `
  --min-blur-score 20
```

Output:

- `data/proctoring/processed/eye_crops_v1/eye_crop_dataset_v1.npz`
- `data/proctoring/processed/eye_crops_v1/eye_crop_manifest_v1.json`

The prep step now uses OpenCV to:

- align the face by eye-line rotation
- normalize eye-crop contrast with CLAHE
- reject blurry frames before training
- preserve frame-level sample IDs so ensemble evaluation compares the exact same samples

## 2. Train TensorFlow / Keras model

```powershell
cd D:\Lenovo\certora
.\.venv-tf311\Scripts\python.exe .\ml\proctoring\scripts\train_eye_gaze_keras.py `
  --dataset .\data\proctoring\processed\eye_crops_v1\eye_crop_dataset_v1.npz `
  --output-dir .\data\proctoring\models\eye_gaze_keras_v1 `
  --epochs 25 `
  --batch-size 32
```

Metrics file:

- `data/proctoring/models/eye_gaze_keras_v1/eye_gaze_keras_metrics.json`

## 3. Train PyTorch model

```powershell
cd D:\Lenovo\certora
.\.venv-pt312\Scripts\python.exe .\ml\proctoring\scripts\train_eye_gaze_pytorch.py `
  --dataset .\data\proctoring\processed\eye_crops_v1\eye_crop_dataset_v1.npz `
  --output-dir .\data\proctoring\models\eye_gaze_pytorch_v3 `
  --epochs 24 `
  --batch-size 32 `
  --lr 0.001 `
  --patience 5 `
  --offscreen-weight 1.4 `
  --onscreen-weight 1.0 `
  --score-macro-weight 0.75 `
  --score-offscreen-weight 0.25
```

Metrics file:

- `data/proctoring/models/eye_gaze_pytorch_v3/eye_gaze_pytorch_metrics.json`

## 4. Evaluate ensemble of classical v2 + best PyTorch model

```powershell
cd D:\Lenovo\certora
.\.venv-pt312\Scripts\python.exe .\ml\proctoring\scripts\evaluate_head_eye_ensemble.py `
  --input-root .\data\proctoring\raw\self_collection_v2\05_head_eye_decoupling `
  --eye-dataset .\data\proctoring\processed\eye_crops_v1\eye_crop_dataset_v1.npz `
  --classical-bundle .\data\proctoring\models\head_eye_screen_v2\head_eye_screen_bundle_v2.before_new_person.joblib `
  --pytorch-model .\data\proctoring\models\eye_gaze_pytorch_v3\eye_gaze_pytorch_model.pt `
  --output-path .\data\proctoring\models\ensemble\head_eye_ensemble_metrics.json `
  --classical-weight 0.55 `
  --pytorch-weight 0.45 `
  --threshold 0.50
```

Metrics file:

- `data/proctoring/models/ensemble/head_eye_ensemble_metrics.json`

## 5. Sweep ensemble weights and threshold

```powershell
cd D:\Lenovo\certora
.\.venv-pt312\Scripts\python.exe .\ml\proctoring\scripts\sweep_head_eye_ensemble.py `
  --input-root .\data\proctoring\raw\self_collection_v2\05_head_eye_decoupling `
  --eye-dataset .\data\proctoring\processed\eye_crops_v1\eye_crop_dataset_v1.npz `
  --classical-bundle .\data\proctoring\models\head_eye_screen_v2\head_eye_screen_bundle_v2.before_new_person.joblib `
  --pytorch-model .\data\proctoring\models\eye_gaze_pytorch_v5\eye_gaze_pytorch_model.pt `
  --output-path .\data\proctoring\models\ensemble\head_eye_ensemble_sweep_v1.json `
  --weight-start 0.30 `
  --weight-stop 0.80 `
  --weight-step 0.05 `
  --threshold-start 0.40 `
  --threshold-stop 0.60 `
  --threshold-step 0.025 `
  --top-k 10
```

This saves the best blend and a ranked top-k table so we can compare ensemble settings without manual trial and error.

## Notes

- The original `.venv-tf311` and `.venv-pt311` environments may need repair if they point to a missing base Python path.
- If that happens, recreate them and install:
  - TensorFlow / Keras in `.venv-tf312`
  - PyTorch in `.venv-pt312`
- OpenCV, NumPy, scikit-learn, mediapipe in the shared prep environment
- If you change blur filtering or preprocessing, rebuild the eye dataset before retraining or re-running ensemble evaluation.

## Goal

Compare the deep models against:

- `head_eye_screen_v2.before_new_person`
- `head_eye_screen_v2`
- `head_eye_screen_v3`

The objective is better cross-person generalization, not just a better score on one individual.
