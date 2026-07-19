from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import pandas as pd

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}
AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def calculate_file_hash(path: Path) -> str:
    hasher = hashlib.md5()
    try:
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return ""


def infer_label(path: Path) -> int:
    # Check immediate parent folder and grandparent folder names first,
    # as they carry the most specific class information.
    # "normal" in immediate parent → always label 0, even if an ancestor folder
    # contains a cheating-related keyword (e.g., exam_cheating/normal act/).
    normal_keywords = [
        "normal act",
        "normal_act",
        "normal",
        "non_cheat",
        "noncheat",
        "legitimate",
        "honest",
    ]
    # Check the two most-specific parts of the path (parent, grandparent)
    specific_parts = [p.lower() for p in path.parts[-3:]]
    specific_joined = " ".join(specific_parts)
    if any(k in specific_joined for k in normal_keywords):
        return 0

    # Fall back to full-path keyword check for cheating
    parts = [p.lower() for p in path.parts]
    joined = " ".join(parts)
    suspicious_keywords = [
        "cheat",
        "malpractice",
        "phone",
        "talk",
        "speaking",
        "copy",
        "suspicious",
        "unauthorized",
        "multiple_person",
        "looking_away",
        "giving code",
        "giving object",
        "giving_code",
        "giving_object",
        "looking friend",
        "looking_friend",
    ]
    return 1 if any(k in joined for k in suspicious_keywords) else 0


def infer_modality(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in VIDEO_EXTS:
        return "video"
    if suffix in IMAGE_EXTS:
        return "image"
    if suffix in AUDIO_EXTS:
        return "audio"
    return "other"



def main() -> None:
    parser = argparse.ArgumentParser(description="Build manifest for local proctoring training data.")
    parser.add_argument("--input", required=True, help="Root folder containing downloaded OEP dataset")
    parser.add_argument("--output", required=True, help="Output CSV path")
    args = parser.parse_args()

    root = Path(args.input).resolve()
    if not root.exists():
        raise FileNotFoundError(f"Input path not found: {root}")

    rows: list[dict] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        modality = infer_modality(p)
        if modality == "other":
            continue
        rows.append(
            {
                "path": str(p),
                "modality": modality,
                "label": infer_label(p),
                "parent": p.parent.name,
                "filename": p.name,
                "file_hash": calculate_file_hash(p),
            },
        )

    if not rows:
        raise RuntimeError("No media files found. Check dataset path.")

    df = pd.DataFrame(rows).sort_values(["modality", "label", "path"]).reset_index(drop=True)
    out = Path(args.output).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    print(f"manifest rows={len(df)} -> {out}")
    if not df.empty:
        print(df.groupby(["modality", "label"]).size())



if __name__ == "__main__":
    main()
