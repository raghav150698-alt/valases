"""Summarise anonymous all-role English pilot observations; never change scores."""
import argparse
import csv
import json
from pathlib import Path
from statistics import mean

FIELDS = ["participant_code", "region", "role_group", "conversation_id", "listening_score_pct", "reading_score_pct", "listening_minutes", "reading_minutes", "writing_minutes", "speaking_minutes", "audio_failed", "microphone_failed", "resume_failed", "feedback"]


def analyse(rows: list[dict]) -> dict:
    groups = {"region": {}, "role_group": {}, "conversation_id": {}}
    seen = set()
    for number, row in enumerate(rows, 2):
        if not row.get("participant_code") or row["participant_code"] in seen:
            raise ValueError(f"Row {number}: participant_code must be present and unique")
        seen.add(row["participant_code"])
        if row.get("region") not in {"US", "UK"} or not row.get("role_group") or not row.get("conversation_id"):
            raise ValueError(f"Row {number}: region, role group and recording are required")
        values = {}
        for name in FIELDS[4:10]:
            value = float(row[name])
            if not 0 <= value <= (100 if "score_pct" in name else 120):
                raise ValueError(f"Row {number}: invalid {name}")
            values[name] = value
        for name in FIELDS[10:13]:
            if row.get(name) not in {"0", "1"}:
                raise ValueError(f"Row {number}: {name} must be 0 or 1")
            values[name] = int(row[name])
        for field, buckets in groups.items():
            buckets.setdefault(row[field], []).append(values)
    summaries = {}
    for field, buckets in groups.items():
        summaries[field] = {key: {"participants": len(values), "means": {name: round(mean(value[name] for value in values), 2) for name in FIELDS[4:10]},
                                      "failures": {name: sum(value[name] for value in values) for name in FIELDS[10:13]},
                                      "sample_note": "Small sample; descriptive only" if len(values) < 20 else "Descriptive only; assessor review required"}
                            for key, values in sorted(buckets.items())}
    return {"participants": len(rows), "groups": summaries, "calibration_status": "Not calibrated",
            "note": "Aggregate discovery report only. No equivalence, fairness or pass-threshold conclusion is inferred."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with args.input.open(encoding="utf-8-sig", newline="") as source:
        report = analyse(list(csv.DictReader(source)))
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered)
