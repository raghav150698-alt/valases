from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import pandas as pd


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def row(path: Path, label: int, source: str, risk_tag: str, split: str = "") -> dict[str, object]:
    return {
        "path": str(path.resolve()),
        "modality": "image",
        "label": int(label),
        "parent": path.parent.name,
        "filename": path.name,
        "file_hash": sha256(path),
        "source": source,
        "risk_tag": risk_tag,
        "split": split,
    }


def add_existing(rows: list[dict[str, object]], manifest: Path) -> None:
    if not manifest.exists():
        return
    frame = pd.read_csv(manifest)
    for record in frame.to_dict(orient="records"):
        path = Path(str(record.get("path", "")))
        if not path.exists() or str(record.get("modality", "")).lower() not in {"image", "video", "audio"}:
            continue
        source = "existing"
        lower = str(path).lower()
        if "oep" in lower:
            source = "kaggle_oep"
        elif "exam_cheating" in lower:
            source = "kaggle_exam_cheating"
        elif "self_collection" in lower:
            source = "local_self_collection"
        rows.append({
            "path": str(path.resolve()),
            "modality": str(record.get("modality", "image")),
            "label": int(record.get("label", 0)),
            "parent": path.parent.name,
            "filename": path.name,
            "file_hash": sha256(path),
            "source": source,
            "risk_tag": "existing",
            "split": "existing",
        })


def add_zenodo(rows: list[dict[str, object]], root: Path) -> None:
    candidates = [p for p in root.rglob("train/images") if p.is_dir()]
    if not candidates:
        return
    dataset_root = candidates[0].parent.parent
    class_names: list[str] = []
    class_files = list(dataset_root.rglob("classes.txt"))
    if class_files:
        class_names = [line.strip() for line in class_files[0].read_text(encoding="utf-8").splitlines() if line.strip()]
    for image in sorted(dataset_root.rglob("images/*")):
        if not image.is_file() or image.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        relative = image.relative_to(dataset_root)
        split = relative.parts[0] if relative.parts else "unknown"
        label_path = dataset_root / split / "labels" / f"{image.stem}.txt"
        if not label_path.exists():
            continue
        class_ids = []
        for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            fields = line.split()
            if fields:
                try:
                    class_ids.append(int(fields[0]))
                except ValueError:
                    pass
        if not class_ids:
            continue
        tags = [class_names[i] if 0 <= i < len(class_names) else f"class_{i}" for i in sorted(set(class_ids))]
        rows.append(row(image, 1, "zenodo_students_behavior_org", "+".join(tags), split))


def add_mendeley_scenarios(rows: list[dict[str, object]], root: Path) -> None:
    if not root.exists():
        return
    for image in sorted(root.rglob("*.jpg")):
        label = image.with_suffix(".txt")
        if label.exists() and label.read_text(encoding="utf-8", errors="ignore").strip():
            scenario = image.parent.name.replace(" ", "_").lower()
            rows.append(row(image, 1, "mendeley_cheating_scenario", scenario, "external"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a deduplicated external video-proctoring manifest.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output", default="data/proctoring/processed/manifest_external_video_dedup.csv")
    args = parser.parse_args()
    repo = Path(args.repo_root).resolve()
    rows: list[dict[str, object]] = []
    for name in ["manifest_oep.csv", "manifest_exam.csv"]:
        add_existing(rows, repo / "data/proctoring/processed" / name)
    external_dir = repo / "data/proctoring/processed/external_manifests"
    for manifest in sorted(external_dir.glob("manifest_*.csv")):
        add_existing(rows, manifest)
    add_zenodo(rows, repo / "data/proctoring/external_licensed/zenodo_students_behavior")
    add_mendeley_scenarios(rows, repo / "data/proctoring/external_licensed/Cheating Scenario Dataset in Online Exam")
    if not rows:
        raise RuntimeError("No usable media found.")
    frame = pd.DataFrame(rows)
    frame["file_hash"] = frame["file_hash"].astype(str)
    before = len(frame)
    frame = frame.drop_duplicates(subset=["file_hash"], keep="first").reset_index(drop=True)
    output = (repo / args.output).resolve() if not Path(args.output).is_absolute() else Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False)
    print(f"manifest={output}")
    print(f"rows_before_dedup={before}")
    print(f"rows_after_dedup={len(frame)}")
    print(frame.groupby(["source", "modality", "label"], dropna=False).size().to_string())
    print("risk_tags:")
    print(frame["risk_tag"].value_counts().to_string())


if __name__ == "__main__":
    main()
