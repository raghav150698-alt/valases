from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import shutil
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


CLASS_NAMES = ["eye_movement", "hand_move", "mobile_use", "side_watching", "mouth_open"]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}
GENERATED_MARKER = ".certora_generated_grouped_dataset"


@dataclass(frozen=True)
class Sample:
    image: Path
    label: Path
    source_split: str
    group: str
    image_sha256: str
    label_sha256: str
    normalized_label: str
    class_counts: tuple[int, ...]


def find_original_dataset_root(extracted_root: Path) -> Path:
    candidates = sorted(
        {path.parent.parent for path in extracted_root.rglob("train/images") if path.is_dir()},
        key=lambda path: (len(str(path)), str(path).lower()),
    )
    if not candidates:
        raise FileNotFoundError(f"Could not find train/images below {extracted_root}")
    original = [path for path in candidates if "org" in str(path).lower() and "aug" not in str(path).lower()]
    if not original:
        original = [path for path in candidates if "org" in str(path).lower()]
    return original[0] if original else candidates[0]


def strip_embedded_image_extensions(stem: str) -> str:
    previous = None
    while stem != previous:
        previous = stem
        stem = re.sub(r"\.(?:jpe?g|png|bmp)$", "", stem, flags=re.IGNORECASE)
    return stem


def source_group(name: str) -> str:
    stem = strip_embedded_image_extensions(Path(name).stem).strip()
    # The publisher prefixes derived frames with one or more "aug" tokens. Keep
    # all such derivatives with the source recording so they can never cross splits.
    stem = re.sub(r"^(?:aug)+", "", stem, flags=re.IGNORECASE).strip(" _-")
    stem = re.sub(r"[\s_-]+\d+$", "", stem).strip(" _-")
    stem = re.sub(r"\s+", " ", stem).lower()
    return stem or strip_embedded_image_extensions(Path(name).stem).lower()


def parse_label(path: Path) -> tuple[tuple[int, ...], str, int]:
    counts = [0] * len(CLASS_NAMES)
    normalized_lines: list[str] = []
    invalid_boxes = 0
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8", errors="strict").splitlines(),
        start=1,
    ):
        fields = raw_line.split()
        if not fields:
            continue
        if len(fields) != 5:
            raise ValueError(f"Expected five YOLO fields in {path}:{line_number}; got {len(fields)}")
        class_id = int(fields[0])
        if class_id < 0 or class_id >= len(CLASS_NAMES):
            raise ValueError(f"Invalid class id {class_id} in {path}:{line_number}")
        coordinates = [float(value) for value in fields[1:]]
        if any(value < 0.0 or value > 1.0 for value in coordinates):
            invalid_boxes += 1
            continue
        if coordinates[2] <= 0.0 or coordinates[3] <= 0.0:
            invalid_boxes += 1
            continue
        counts[class_id] += 1
        normalized_lines.append(" ".join(fields))
    normalized = "\n".join(normalized_lines) + ("\n" if normalized_lines else "")
    return tuple(counts), normalized, invalid_boxes


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_samples(dataset_root: Path) -> tuple[list[Sample], dict[str, int]]:
    samples: list[Sample] = []
    counters: Counter[str] = Counter()
    seen_images: dict[str, Sample] = {}

    for split in ("train", "valid", "test"):
        images_dir = dataset_root / split / "images"
        labels_dir = dataset_root / split / "labels"
        if not images_dir.is_dir():
            continue
        for image in sorted(images_dir.iterdir(), key=lambda path: path.name.lower()):
            if not image.is_file() or image.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            counters["images_seen"] += 1
            label = labels_dir / f"{image.stem}.txt"
            if not label.is_file():
                counters["unlabeled_images_skipped"] += 1
                continue
            class_counts, normalized_label, invalid_boxes = parse_label(label)
            counters["invalid_boxes_removed"] += invalid_boxes
            if not any(class_counts):
                counters["empty_labels_kept"] += 1
            image_hash = sha256_file(image)
            label_hash = hashlib.sha256(normalized_label.encode("utf-8")).hexdigest()
            candidate = Sample(
                image=image.resolve(),
                label=label.resolve(),
                source_split=split,
                group=source_group(image.name),
                image_sha256=image_hash,
                label_sha256=label_hash,
                normalized_label=normalized_label,
                class_counts=class_counts,
            )
            previous = seen_images.get(image_hash)
            if previous is not None:
                if previous.label_sha256 != label_hash:
                    raise RuntimeError(
                        "The same image has conflicting labels: "
                        f"{previous.image} and {candidate.image}",
                    )
                counters["exact_duplicates_removed"] += 1
                continue
            seen_images[image_hash] = candidate
            samples.append(candidate)

    if not samples:
        raise RuntimeError(f"No labeled images found below {dataset_root}")
    counters["unique_labeled_images"] = len(samples)
    return samples, dict(counters)


def sum_counts(samples: list[Sample]) -> tuple[int, ...]:
    totals = [0] * len(CLASS_NAMES)
    for sample in samples:
        for class_id, count in enumerate(sample.class_counts):
            totals[class_id] += count
    return tuple(totals)


def choose_group_split(
    samples: list[Sample],
    fractions: tuple[float, float, float],
    seed: int,
    trials: int,
) -> dict[str, str]:
    grouped: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        grouped[sample.group].append(sample)
    if len(grouped) < 10:
        raise RuntimeError(f"Only {len(grouped)} source groups were detected; safe three-way splitting is not possible")

    group_keys = sorted(grouped)
    total_images = len(samples)
    total_classes = sum_counts(samples)
    target_group_counts = [len(group_keys) * fraction for fraction in fractions]
    best_score = float("inf")
    best_assignment: dict[str, str] | None = None
    split_names = ("train", "valid", "test")
    rng = random.Random(seed)

    for _ in range(max(100, trials)):
        assignment: dict[str, str] = {}
        for group in group_keys:
            draw = rng.random()
            if draw < fractions[0]:
                assignment[group] = "train"
            elif draw < fractions[0] + fractions[1]:
                assignment[group] = "valid"
            else:
                assignment[group] = "test"

        split_samples = {
            split: [sample for sample in samples if assignment[sample.group] == split]
            for split in split_names
        }
        if any(not split_samples[split] for split in split_names):
            continue
        split_group_counts = Counter(assignment.values())
        score = 0.0
        for index, split in enumerate(split_names):
            image_target = max(1.0, total_images * fractions[index])
            score += 2.0 * abs(len(split_samples[split]) - image_target) / image_target
            group_target = max(1.0, target_group_counts[index])
            score += 0.4 * abs(split_group_counts[split] - group_target) / group_target
            class_counts = sum_counts(split_samples[split])
            for class_id, total in enumerate(total_classes):
                class_target = max(1.0, total * fractions[index])
                score += abs(class_counts[class_id] - class_target) / class_target
                if class_counts[class_id] == 0:
                    score += 100.0
        if score < best_score:
            best_score = score
            best_assignment = assignment

    if best_assignment is None:
        raise RuntimeError("Could not find a non-empty, class-complete grouped split")
    return best_assignment


def reset_generated_output(output_root: Path) -> None:
    if output_root.exists():
        marker = output_root / GENERATED_MARKER
        if not marker.is_file():
            raise RuntimeError(
                f"Refusing to replace unmarked directory {output_root}. "
                f"Delete it manually or choose another --output-root.",
            )
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True)
    (output_root / GENERATED_MARKER).write_text(
        "Generated by prepare_zenodo_grouped_dataset.py; safe to rebuild.\n",
        encoding="utf-8",
    )


def safe_link(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        destination.symlink_to(source)
    except OSError:
        # Hard links avoid data duplication when source and destination happen to
        # share a filesystem. Copying multi-gigabyte image data is intentionally forbidden.
        os.link(source, destination)


def materialize_dataset(
    samples: list[Sample],
    assignment: dict[str, str],
    output_root: Path,
) -> dict[str, dict[str, object]]:
    reports: dict[str, dict[str, object]] = {}
    for split in ("train", "valid", "test"):
        selected = [sample for sample in samples if assignment[sample.group] == split]
        selected.sort(key=lambda sample: (sample.group, sample.image.name.lower(), str(sample.image)))
        image_dir = output_root / split / "images"
        label_dir = output_root / split / "labels"
        image_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)
        for sample in selected:
            path_id = hashlib.sha1(str(sample.image).encode("utf-8")).hexdigest()[:12]
            output_name = f"{path_id}_{sample.image.name}"
            output_image = image_dir / output_name
            output_label = label_dir / f"{output_image.stem}.txt"
            safe_link(sample.image, output_image)
            output_label.write_text(sample.normalized_label, encoding="utf-8")
        class_counts = sum_counts(selected)
        reports[split] = {
            "image_count": len(selected),
            "group_count": len({sample.group for sample in selected}),
            "groups": sorted({sample.group for sample in selected}),
            "objects": {CLASS_NAMES[index]: count for index, count in enumerate(class_counts)},
            "source_split_counts": dict(sorted(Counter(sample.source_split for sample in selected).items())),
        }
    return reports


def write_data_yaml(output_root: Path) -> None:
    content = "\n".join(
        [
            f"path: {output_root.as_posix()}",
            "train: train/images",
            "val: valid/images",
            "test: test/images",
            "nc: 5",
            "names:",
            *[f"  {index}: {name}" for index, name in enumerate(CLASS_NAMES)],
            "",
        ],
    )
    (output_root / "data.yaml").write_text(content, encoding="utf-8")


def create_test_as_validation_view(output_root: Path) -> None:
    test_eval = output_root / "test_as_valid"
    (test_eval / "valid").mkdir(parents=True, exist_ok=True)
    safe_link(output_root / "test" / "images", test_eval / "valid" / "images")
    safe_link(output_root / "test" / "labels", test_eval / "valid" / "labels")
    content = "\n".join(
        [
            f"path: {test_eval.as_posix()}",
            "train: valid/images",
            "val: valid/images",
            "nc: 5",
            "names:",
            *[f"  {index}: {name}" for index, name in enumerate(CLASS_NAMES)],
            "",
        ],
    )
    (test_eval / "data.yaml").write_text(content, encoding="utf-8")


def validate_no_leakage(samples: list[Sample], assignment: dict[str, str]) -> None:
    split_groups: dict[str, set[str]] = defaultdict(set)
    split_hashes: dict[str, set[str]] = defaultdict(set)
    for sample in samples:
        split = assignment[sample.group]
        split_groups[split].add(sample.group)
        split_hashes[split].add(sample.image_sha256)
    for left, right in (("train", "valid"), ("train", "test"), ("valid", "test")):
        group_overlap = split_groups[left] & split_groups[right]
        hash_overlap = split_hashes[left] & split_hashes[right]
        if group_overlap or hash_overlap:
            raise RuntimeError(
                f"Leakage detected between {left} and {right}: "
                f"groups={sorted(group_overlap)[:5]} hashes={sorted(hash_overlap)[:5]}",
            )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a deduplicated, source-group-disjoint YOLO dataset for proctor vision training.",
    )
    parser.add_argument(
        "--source-root",
        default="data/proctoring/external_licensed/zenodo_students_behavior",
    )
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--train-fraction", type=float, default=0.72)
    parser.add_argument("--valid-fraction", type=float, default=0.14)
    parser.add_argument("--test-fraction", type=float, default=0.14)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--split-search-trials", type=int, default=20_000)
    args = parser.parse_args()

    fractions = (args.train_fraction, args.valid_fraction, args.test_fraction)
    if any(value <= 0.0 for value in fractions) or abs(sum(fractions) - 1.0) > 1e-6:
        raise ValueError("Train, validation, and test fractions must be positive and sum to 1.0")

    source_root = Path(args.source_root).resolve()
    output_root = Path(args.output_root).resolve()
    dataset_root = find_original_dataset_root(source_root)
    print(f"source_dataset={dataset_root}")
    print("Hashing and validating labeled images (this can take several minutes)...", flush=True)
    samples, collection_report = collect_samples(dataset_root)
    assignment = choose_group_split(
        samples,
        fractions=fractions,
        seed=args.seed,
        trials=args.split_search_trials,
    )
    validate_no_leakage(samples, assignment)
    reset_generated_output(output_root)
    split_report = materialize_dataset(samples, assignment, output_root)
    write_data_yaml(output_root)
    create_test_as_validation_view(output_root)

    report = {
        "created_at": datetime.now(UTC).isoformat(),
        "source_root": str(source_root),
        "selected_dataset_root": str(dataset_root),
        "output_root": str(output_root),
        "classes": CLASS_NAMES,
        "seed": args.seed,
        "fractions": {"train": fractions[0], "valid": fractions[1], "test": fractions[2]},
        "collection": collection_report,
        "splits": split_report,
        "leakage_checks": {
            "source_group_overlap": 0,
            "exact_image_hash_overlap": 0,
            "status": "passed",
        },
        "notes": [
            "Only the publisher's original labeled dataset variant is used.",
            "Source recording groups never cross train, validation, and test.",
            "Exact duplicate images are retained only once.",
            "Invalid zero-size or out-of-range boxes are removed from cleaned labels.",
            "The staged dataset links image bytes and writes only small sanitized label files.",
        ],
    }
    report_path = output_root / "dataset_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output_root": str(output_root), "splits": split_report}, indent=2))
    print(f"dataset_report={report_path}")


if __name__ == "__main__":
    main()
