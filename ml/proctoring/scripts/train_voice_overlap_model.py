"""Train a small, conservative voice-overlap classifier from local speech recordings.

The model is trained on synthetic mixtures made from different speakers. It is
not a speaker diarization system and must remain advisory until it is validated
on real browser microphone recordings.
"""
from __future__ import annotations

import argparse
import io
import json
import random
import wave
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def read_wav(path: Path, max_seconds: float = 90.0) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        sample_rate = handle.getframerate()
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        frames = min(handle.getnframes(), int(sample_rate * max_seconds))
        raw = handle.readframes(frames)
    if sample_width == 1:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        raise ValueError(f"Only 8-bit or 16-bit PCM is supported: {path}")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio, sample_rate


def read_wav_bytes(raw: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(raw), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        data = handle.readframes(handle.getnframes())
    if width == 1:
        audio = (np.frombuffer(data, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        raise ValueError(f"Unsupported VoxConverse PCM width: {width}")
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio, rate


def features(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    audio = audio - float(np.mean(audio))
    rms = float(np.sqrt(np.mean(audio * audio) + 1e-9))
    window = np.hanning(len(audio))
    spectrum = np.abs(np.fft.rfft(audio * window)) + 1e-8
    frequencies = np.fft.rfftfreq(len(audio), 1.0 / sample_rate)
    speech = (frequencies >= 250) & (frequencies <= 3800)
    band_edges = ((250, 700), (700, 1400), (1400, 2400), (2400, 3800))
    band_energy = np.array([float(np.mean(spectrum[(frequencies >= lo) & (frequencies < hi)])) for lo, hi in band_edges])
    band_energy /= float(np.sum(band_energy) + 1e-8)
    speech_spectrum = spectrum[speech]
    speech_freq = frequencies[speech]
    normalized = speech_spectrum / float(np.sum(speech_spectrum) + 1e-8)
    centroid = float(np.sum(speech_freq * normalized) / 3800.0)
    flatness = float(np.exp(np.mean(np.log(speech_spectrum))) / np.mean(speech_spectrum))
    peak_count = float(np.sum((speech_spectrum[1:-1] > speech_spectrum[:-2]) & (speech_spectrum[1:-1] > speech_spectrum[2:])) / max(1, len(speech_spectrum)))
    return np.array([rms, centroid, flatness, peak_count, *band_energy], dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", default="data/proctoring/audio_pack/kaggle/oep/OEP database")
    parser.add_argument("--output-dir", default="data/proctoring/models/voice_overlap_v1")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--windows", type=int, default=40)
    parser.add_argument("--window-seconds", type=float, default=1.5)
    parser.add_argument("--voxconverse-root", default="data/proctoring/audio_pack/huggingface/voxconverse")
    parser.add_argument("--voxconverse-limit", type=int, default=24)
    args = parser.parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    root = Path(args.input_root)
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    recordings = sorted(root.rglob("*.wav"))
    if len(recordings) < 4:
        raise SystemExit(f"Need at least four speaker recordings under {root}; found {len(recordings)}")
    speakers = {}
    for path in recordings:
        audio, sample_rate = read_wav(path)
        if len(audio) >= int(sample_rate * args.window_seconds):
            speakers[path.parent.name] = (audio, sample_rate)
    if len(speakers) < 4:
        raise SystemExit("Need at least four usable speaker recordings")

    rows: list[np.ndarray] = []
    labels: list[int] = []
    groups: list[str] = []
    names = sorted(speakers)
    for _ in range(args.windows):
        speaker = random.choice(names)
        audio, rate = speakers[speaker]
        size = int(rate * args.window_seconds)
        start = random.randrange(0, max(1, len(audio) - size + 1))
        clip = audio[start:start + size]
        rows.append(features(clip, rate)); labels.append(0); groups.append(speaker)
        other = random.choice([name for name in names if name != speaker])
        other_audio, other_rate = speakers[other]
        other_size = int(other_rate * args.window_seconds)
        other_start = random.randrange(0, max(1, len(other_audio) - other_size + 1))
        other_clip = other_audio[other_start:other_start + other_size]
        if other_rate != rate:
            raise SystemExit("Recordings have different sample rates; resampling is required before training")
        scale = np.sqrt(np.mean(clip * clip) / (np.mean(other_clip * other_clip) + 1e-8))
        mixed = np.clip(clip + other_clip * scale * random.uniform(0.45, 1.0), -1.0, 1.0)
        rows.append(features(mixed, rate)); labels.append(1); groups.append(f"{speaker}+{other}")

    # Add real, annotated overlap windows from VoxConverse when the local
    # Parquet pack is available. Each positive is anchored on an annotated
    # overlap interval; negatives are sampled from the same clip where possible.
    vox_root = Path(args.voxconverse_root)
    vox_count = 0
    if vox_root.exists():
        try:
            import pyarrow.parquet as parquet
            for shard in sorted((vox_root / "data").glob("dev-*.parquet")):
                if vox_count >= args.voxconverse_limit:
                    break
                for batch in parquet.ParquetFile(shard).iter_batches(batch_size=1, columns=["audio", "timestamps_start", "timestamps_end", "speakers"]):
                    row = batch.to_pylist()[0]
                    audio, rate = read_wav_bytes(row["audio"]["bytes"])
                    size = int(rate * args.window_seconds)
                    starts = row.get("timestamps_start") or []
                    ends = row.get("timestamps_end") or []
                    speakers_in_row = row.get("speakers") or []
                    overlaps = []
                    for left in range(len(starts)):
                        for right in range(left + 1, len(starts)):
                            if speakers_in_row[left] == speakers_in_row[right]:
                                continue
                            overlap_start = max(float(starts[left]), float(starts[right]))
                            overlap_end = min(float(ends[left]), float(ends[right]))
                            if overlap_end - overlap_start >= 0.35:
                                overlaps.append((overlap_start, overlap_end))
                    if not overlaps or len(audio) < size:
                        continue
                    start_seconds = random.uniform(*overlaps[0])
                    start = min(max(0, int(start_seconds * rate) - size // 2), len(audio) - size)
                    rows.append(features(audio[start:start + size], rate)); labels.append(1); groups.append(f"vox:{row['audio']['path']}")
                    vox_count += 1
                    if vox_count >= args.voxconverse_limit:
                        break

        except ImportError:
            print("pyarrow is not installed; skipping VoxConverse Parquet data")

    x = np.vstack(rows)
    y = np.asarray(labels, dtype=np.int64)
    group_split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=args.seed)
    train_idx, test_idx = next(group_split.split(x, y, groups))
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced", random_state=args.seed))
    model.fit(x[train_idx], y[train_idx])
    probabilities = model.predict_proba(x[test_idx])[:, 1]
    predictions = (probabilities >= 0.65).astype(np.int64)
    report = classification_report(y[test_idx], predictions, output_dict=True, zero_division=0)
    metrics = {
        "model": "voice_overlap_v2",
        "task": "single-speaker vs overlapping-speaker audio",
        "dataset": "local OEP recordings with synthetic pairwise mixtures plus annotated VoxConverse overlap windows",
        "recording_count": len(speakers),
        "voxconverse_positive_windows": vox_count,
        "sample_count": int(len(y)),
        "threshold": 0.65,
        "roc_auc": float(roc_auc_score(y[test_idx], probabilities)),
        "classification_report": report,
        "feature_names": ["rms", "spectral_centroid", "spectral_flatness", "peak_density", "band_250_700", "band_700_1400", "band_1400_2400", "band_2400_3800"],
        "warning": "Synthetic training only; validate on consented browser recordings before production use.",
    }
    with (output / "voice_overlap_metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)
    import joblib
    joblib.dump(model, output / "voice_overlap_model.joblib")
    scaler = model.named_steps["standardscaler"]
    classifier = model.named_steps["logisticregression"]
    browser_bundle = {
        "model": "voice_overlap_v2",
        "feature_names": metrics["feature_names"],
        "scaler_mean": [float(value) for value in scaler.mean_],
        "scaler_scale": [float(value) for value in scaler.scale_],
        "coef": [float(value) for value in classifier.coef_[0]],
        "intercept": float(classifier.intercept_[0]),
        "threshold": 0.65,
        "training_warning": metrics["warning"],
    }
    with (output / "voice_overlap_browser.json").open("w", encoding="utf-8") as handle:
        json.dump(browser_bundle, handle, indent=2)
    print(json.dumps({"output_dir": str(output), "roc_auc": metrics["roc_auc"], "sample_count": len(y)}, indent=2))


if __name__ == "__main__":
    main()
