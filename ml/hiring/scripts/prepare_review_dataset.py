"""Validate and de-identify a reviewed hiring dataset before model evaluation.

This utility intentionally does not train a ranking model. It prepares a bounded
CSV for privacy, legal, and fairness review after the organization has collected
lawful, human-reviewed examples.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path


REQUIRED_COLUMNS = {
    "job_family",
    "required_skills",
    "candidate_skills",
    "resume_summary",
    "human_review_label",
}
ALLOWED_LABELS = {"strong_match", "review", "not_enough_evidence"}
DIRECT_IDENTIFIERS = {"name", "full_name", "email", "phone", "phone_number", "address", "linkedin_url"}
MAX_TEXT_LENGTH = 12_000


def normalized(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def stable_example_id(row: dict[str, str]) -> str:
    payload = "|".join(normalized(row.get(column)) for column in sorted(REQUIRED_COLUMNS))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def prepare(input_path: Path, output_path: Path) -> tuple[int, int]:
    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        fieldnames = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - fieldnames
        if missing:
            raise ValueError(f"Input is missing required columns: {', '.join(sorted(missing))}")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        kept = 0
        rejected = 0
        with output_path.open("w", encoding="utf-8", newline="") as destination:
            writer = csv.DictWriter(destination, fieldnames=["example_id", *sorted(REQUIRED_COLUMNS)])
            writer.writeheader()
            for line_number, row in enumerate(reader, start=2):
                clean = {column: normalized(row.get(column)) for column in REQUIRED_COLUMNS}
                if not all(clean.values()):
                    rejected += 1
                    print(f"Skipping line {line_number}: required value is blank")
                    continue
                if clean["human_review_label"] not in ALLOWED_LABELS:
                    rejected += 1
                    print(f"Skipping line {line_number}: unsupported human_review_label")
                    continue
                if any(len(value) > MAX_TEXT_LENGTH for value in clean.values()):
                    rejected += 1
                    print(f"Skipping line {line_number}: text exceeds {MAX_TEXT_LENGTH} characters")
                    continue

                writer.writerow({"example_id": stable_example_id(clean), **clean})
                kept += 1

    unexpected_identifiers = DIRECT_IDENTIFIERS & fieldnames
    if unexpected_identifiers:
        print(f"Direct identifier columns were ignored: {', '.join(sorted(unexpected_identifiers))}")
    return kept, rejected


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a de-identified reviewed hiring dataset.")
    parser.add_argument("--input", type=Path, required=True, help="Reviewed UTF-8 CSV source")
    parser.add_argument("--output", type=Path, required=True, help="Prepared output CSV")
    args = parser.parse_args()

    kept, rejected = prepare(args.input, args.output)
    print(f"Prepared {kept} examples; rejected {rejected} rows.")
    return 0 if kept else 2


if __name__ == "__main__":
    raise SystemExit(main())
