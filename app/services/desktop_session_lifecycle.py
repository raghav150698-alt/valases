from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import DesktopAppSession, DesktopSessionArtifact
from app.services.desktop_session_broker import DesktopSessionBroker, DesktopSessionBrokerError


TERMINAL_DESKTOP_SESSION_STATES = {"completed", "terminated", "expired", "failed"}


def save_desktop_session_artifacts(
    db: Session,
    session: DesktopAppSession,
    artifacts: list[dict[str, Any]] | None,
) -> list[DesktopSessionArtifact]:
    saved: list[DesktopSessionArtifact] = []
    for raw in list(artifacts or [])[:100]:
        if not isinstance(raw, dict):
            continue
        artifact_key = str(raw.get("artifact_key") or raw.get("key") or "").strip()[:160]
        storage_uri = str(raw.get("storage_uri") or "").strip()[:2000]
        if not artifact_key or not storage_uri.startswith(("s3://", "azure://", "https://")):
            continue
        item = db.scalar(
            select(DesktopSessionArtifact).where(
                DesktopSessionArtifact.session_id == session.id,
                DesktopSessionArtifact.artifact_key == artifact_key,
            ),
        )
        if not item:
            item = DesktopSessionArtifact(session_id=session.id, artifact_key=artifact_key, storage_uri=storage_uri)
        item.artifact_type = str(raw.get("artifact_type") or "working_file").strip()[:80]
        item.storage_uri = storage_uri
        sha256 = str(raw.get("sha256") or "").strip().lower()
        item.sha256 = sha256 if len(sha256) == 64 and all(char in "0123456789abcdef" for char in sha256) else None
        size_bytes = raw.get("size_bytes")
        item.size_bytes = int(size_bytes) if str(size_bytes or "").isdigit() else None
        item.metadata_json = dict(raw.get("metadata") or {}) if isinstance(raw.get("metadata"), dict) else {}
        db.add(item)
        saved.append(item)
    return saved


def finalize_desktop_sessions_for_issue(
    db: Session,
    issue_id: int,
    reason: str,
    *,
    commit: bool = True,
) -> list[dict[str, Any]]:
    sessions = list(
        db.scalars(
            select(DesktopAppSession).where(
                DesktopAppSession.issue_id == issue_id,
                DesktopAppSession.status.not_in(TERMINAL_DESKTOP_SESSION_STATES),
            ),
        ).all(),
    )
    results: list[dict[str, Any]] = []
    broker = DesktopSessionBroker()
    for session in sessions:
        session.active_key = None
        session.status = "finalizing"
        try:
            response = broker.finalize(str(session.provider_session_id or ""), reason)
        except DesktopSessionBrokerError as exc:
            session.status = "finalize_pending"
            session.status_detail = str(exc)[:500]
            results.append({"session_id": session.id, "status": session.status})
            continue
        session.status = str(response.get("status") or "completed")[:30]
        if session.status not in TERMINAL_DESKTOP_SESSION_STATES:
            session.status = "completed"
        session.status_detail = None
        session.ended_at = datetime.now(timezone.utc)
        save_desktop_session_artifacts(db, session, response.get("artifacts"))
        results.append({"session_id": session.id, "status": session.status})
    if sessions and commit:
        db.commit()
    return results


def desktop_session_artifact_payload(db: Session, session_id: str) -> list[dict[str, Any]]:
    rows = list(
        db.scalars(
            select(DesktopSessionArtifact)
            .where(DesktopSessionArtifact.session_id == session_id)
            .order_by(DesktopSessionArtifact.created_at.asc()),
        ).all(),
    )
    return [
        {
            "artifact_key": item.artifact_key,
            "artifact_type": item.artifact_type,
            "storage_uri": item.storage_uri,
            "sha256": item.sha256,
            "size_bytes": item.size_bytes,
            "metadata": item.metadata_json or {},
        }
        for item in rows
    ]
