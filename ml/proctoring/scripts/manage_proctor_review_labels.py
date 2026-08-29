from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal, engine  # noqa: E402
from app.models.entities import (  # noqa: E402
    AssessmentProctorReviewLabel,
    AssessmentReviewClip,
    AssessmentSubmission,
    AuditLog,
)


CONFIRMATION = "DELETE_REVIEW_LABELS_AFTER_TRAINING"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_event(submission: AssessmentSubmission | None, index: int | None) -> dict[str, Any]:
    events = submission.proctoring_events_json if submission else None
    if index is None or not isinstance(events, list) or index < 0 or index >= len(events):
        return {}
    value = events[index]
    return value if isinstance(value, dict) else {}


def export_labels(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    data_path = output_dir / "review_labels.jsonl"
    manifest_path = output_dir / "manifest.json"
    with SessionLocal() as db:
        labels = list(db.scalars(select(AssessmentProctorReviewLabel).order_by(AssessmentProctorReviewLabel.id.asc())).all())
        rows: list[dict[str, Any]] = []
        for label in labels:
            submission = db.get(AssessmentSubmission, label.submission_id) if label.submission_id else None
            clip = db.get(AssessmentReviewClip, label.evidence_clip_id) if label.evidence_clip_id else None
            event = source_event(submission, label.source_event_index)
            details = event.get("details") if isinstance(event.get("details"), dict) else {}
            rows.append(
                {
                    "label_id": label.id,
                    "issue_reference": hashlib.sha256(f"issue:{label.issue_id}".encode()).hexdigest()[:20],
                    "event_key": label.event_key,
                    "event_type": label.event_type,
                    "reviewer_label": label.reviewer_label,
                    "model_disposition": label.model_disposition,
                    "model_confidence": label.model_confidence,
                    "model_policy_version": details.get("policy_version"),
                    "model_policy_rule": details.get("policy_rule"),
                    "event_duration_ms": details.get("duration_ms"),
                    "consecutive_frames": details.get("consecutive_frames"),
                    "face_count": details.get("face_count"),
                    "object_label": details.get("object_label") or details.get("label"),
                    "evidence_type": clip.evidence_type if clip else None,
                    "evidence_file_url": clip.file_url if clip else None,
                    "reviewed_at": label.updated_at.isoformat() if label.updated_at else None,
                }
            )
    temporary = data_path.with_suffix(".jsonl.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as target:
        for row in rows:
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(data_path)
    manifest = {
        "version": "proctor-review-label-export-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "row_count": len(rows),
        "label_ids": [row["label_id"] for row in rows],
        "label_versions": {str(row["label_id"]): row["reviewed_at"] for row in rows},
        "data_file": data_path.name,
        "data_sha256": file_sha256(data_path),
        "contains_candidate_name_or_email": False,
        "purge_confirmation": CONFIRMATION,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"rows={len(rows)}")
    print(f"data={data_path}")
    print(f"manifest={manifest_path}")


def purge_labels(manifest_path: Path, confirmation: str) -> None:
    if confirmation != CONFIRMATION:
        raise ValueError(f"Purge requires --confirm {CONFIRMATION}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    data_path = manifest_path.parent / str(manifest.get("data_file") or "review_labels.jsonl")
    if not data_path.is_file():
        raise FileNotFoundError(f"Training export is missing: {data_path}")
    if file_sha256(data_path) != str(manifest.get("data_sha256") or ""):
        raise ValueError("Training export hash does not match its manifest; purge stopped")
    label_ids = sorted({int(value) for value in (manifest.get("label_ids") or []) if int(value) > 0})
    expected_count = int(manifest.get("row_count") or 0)
    if len(label_ids) != expected_count:
        raise ValueError("Manifest label count is inconsistent; purge stopped")

    deleted = 0
    with SessionLocal() as db:
        if label_ids:
            current_labels = list(db.scalars(select(AssessmentProctorReviewLabel).where(AssessmentProctorReviewLabel.id.in_(label_ids))).all())
            existing = int(db.scalar(select(func.count(AssessmentProctorReviewLabel.id)).where(AssessmentProctorReviewLabel.id.in_(label_ids))) or 0)
            if existing != expected_count:
                raise ValueError("One or more exported labels are missing from the database; purge stopped")
            expected_versions = manifest.get("label_versions") or {}
            changed = [
                label.id
                for label in current_labels
                if (label.updated_at.isoformat() if label.updated_at else None) != expected_versions.get(str(label.id))
            ]
            if changed:
                raise ValueError(f"Labels changed after export; purge stopped for IDs: {changed}")
            result = db.execute(delete(AssessmentProctorReviewLabel).where(AssessmentProctorReviewLabel.id.in_(label_ids)))
            deleted = int(result.rowcount or existing or 0)
        db.add(
            AuditLog(
                actor_user_id=None,
                action="proctor_review_training_data_purged",
                target_type="assessment_proctor_review_label",
                target_id=None,
                details_json={"deleted_count": deleted, "export_sha256": manifest["data_sha256"]},
            ),
        )
        db.commit()
    data_path.unlink()
    receipt = {
        "status": "purged",
        "completed_at": datetime.now(UTC).isoformat(),
        "deleted_database_rows": deleted,
        "deleted_export": str(data_path),
        "export_sha256": manifest["data_sha256"],
    }
    receipt_path = manifest_path.parent / "purge_receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    manifest_path.unlink()
    print(f"deleted_database_rows={deleted}")
    print(f"deleted_export={data_path}")
    print(f"receipt={receipt_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export or purge recruiter proctor-review labels.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export")
    export_parser.add_argument("--output-dir", required=True)
    purge_parser = subparsers.add_parser("purge")
    purge_parser.add_argument("--manifest", required=True)
    purge_parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    AssessmentProctorReviewLabel.__table__.create(bind=engine, checkfirst=True)
    if args.command == "export":
        export_labels(Path(args.output_dir).resolve())
    else:
        purge_labels(Path(args.manifest).resolve(), args.confirm)


if __name__ == "__main__":
    main()
