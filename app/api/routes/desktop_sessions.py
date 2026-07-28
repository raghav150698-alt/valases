from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.exams import _issued_issue_from_bearer_token
from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import AssessmentIssue, DesktopAppSession, Exam, User, UserRole
from app.services.desktop_session_broker import (
    DesktopSessionBroker,
    DesktopSessionBrokerError,
    candidate_reference,
    desktop_app_spec,
    desktop_session_readiness,
    parse_broker_datetime,
)
from app.services.desktop_session_lifecycle import (
    TERMINAL_DESKTOP_SESSION_STATES,
    desktop_session_artifact_payload,
    finalize_desktop_sessions_for_issue,
    save_desktop_session_artifacts,
)

router = APIRouter(prefix="/desktop-sessions", tags=["desktop-app-sessions"])


class BrokerArtifact(BaseModel):
    artifact_key: str = Field(min_length=1, max_length=160)
    artifact_type: str = Field(default="working_file", max_length=80)
    storage_uri: str = Field(min_length=8, max_length=2000)
    sha256: str | None = Field(default=None, max_length=64)
    size_bytes: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BrokerSessionEvent(BaseModel):
    session_id: str = Field(min_length=36, max_length=36)
    provider_session_id: str | None = Field(default=None, max_length=200)
    host_id: str | None = Field(default=None, max_length=200)
    status: Literal["provisioning", "active", "disconnected", "finalizing", "completed", "terminated", "expired", "failed"]
    status_detail: str | None = Field(default=None, max_length=500)
    artifacts: list[BrokerArtifact] = Field(default_factory=list, max_length=100)


def _serialize_session(db: Session, item: DesktopAppSession, *, include_artifacts: bool = False) -> dict[str, Any]:
    payload = {
        "session_id": item.id,
        "issue_id": item.issue_id,
        "app_key": item.app_key,
        "status": item.status,
        "status_detail": item.status_detail,
        "host_id": item.host_id,
        "lease_expires_at": item.lease_expires_at,
        "last_heartbeat_at": item.last_heartbeat_at,
        "started_at": item.started_at,
        "ended_at": item.ended_at,
    }
    if include_artifacts:
        payload["artifacts"] = desktop_session_artifact_payload(db, item.id)
    return payload


def _candidate_session(authorization: str | None, db: Session) -> tuple[AssessmentIssue, Exam, DesktopAppSession | None]:
    issue = _issued_issue_from_bearer_token(authorization, db)
    exam = db.get(Exam, issue.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Assessment not found")
    session = db.scalar(
        select(DesktopAppSession)
        .where(
            DesktopAppSession.issue_id == issue.id,
            DesktopAppSession.status.not_in(TERMINAL_DESKTOP_SESSION_STATES),
        )
        .order_by(DesktopAppSession.created_at.desc()),
    )
    return issue, exam, session


@router.get("/readiness")
def get_desktop_session_readiness(
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    return desktop_session_readiness()


@router.post("/issued/start", status_code=status.HTTP_201_CREATED)
def start_issued_desktop_session(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    issue, exam, existing = _candidate_session(authorization, db)
    spec = desktop_app_spec(str(exam.assessment_type or ""), settings)
    if not spec or not spec["configured"]:
        raise HTTPException(status_code=503, detail="This desktop assessment environment is not configured")
    if existing:
        if existing.status == "active" and existing.provider_session_id:
            try:
                launch = DesktopSessionBroker(settings).launch(existing.provider_session_id)
            except DesktopSessionBrokerError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            return {**_serialize_session(db, existing), "display_name": spec["display_name"], "launch_url": launch["launch_url"]}
        return {**_serialize_session(db, existing), "display_name": spec["display_name"], "launch_url": None}

    duration_seconds = min(
        max(900, int(settings.desktop_session_timeout_seconds)),
        max(900, int(exam.duration_minutes or 25) * 60 + 900),
    )
    now = datetime.now(timezone.utc)
    session = DesktopAppSession(
        issue_id=issue.id,
        active_key=f"issue:{issue.id}",
        app_key=spec["app_key"],
        broker_provider=str(settings.desktop_session_broker_mode or "disabled").strip().lower(),
        workspace_key=f"assessment-issue-{issue.id}-{secrets.token_hex(8)}",
        candidate_name_snapshot=issue.candidate_name,
        candidate_email_snapshot=issue.candidate_email,
        status="provisioning",
        lease_expires_at=now + timedelta(seconds=duration_seconds),
        last_heartbeat_at=now,
    )
    db.add(session)
    try:
        db.commit()
        db.refresh(session)
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(DesktopAppSession).where(DesktopAppSession.active_key == f"issue:{issue.id}"))
        if not existing:
            raise HTTPException(status_code=409, detail="A desktop session is already being prepared")
        return {**_serialize_session(db, existing), "display_name": spec["display_name"], "launch_url": None}

    try:
        result = DesktopSessionBroker(settings).start(
            session_id=session.id,
            issue_id=issue.id,
            candidate_ref=candidate_reference(issue.id, issue.candidate_email, settings),
            app_key=session.app_key,
            provider_application_id=spec["provider_application_id"],
            workspace_key=session.workspace_key,
            duration_seconds=duration_seconds,
        )
    except DesktopSessionBrokerError as exc:
        session.status = "failed"
        session.status_detail = str(exc)[:500]
        session.active_key = None
        session.ended_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=503, detail="The desktop application could not be started") from exc

    session.provider_session_id = str(result.get("provider_session_id") or "")[:200] or None
    session.host_id = str(result.get("host_id") or "")[:200] or None
    session.status = "active"
    session.status_detail = None
    session.started_at = datetime.now(timezone.utc)
    session.lease_expires_at = parse_broker_datetime(result.get("lease_expires_at")) or session.lease_expires_at
    db.commit()
    return {
        **_serialize_session(db, session),
        "display_name": spec["display_name"],
        "launch_url": result["launch_url"],
    }


@router.get("/issued/current")
def current_issued_desktop_session(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _, exam, session = _candidate_session(authorization, db)
    spec = desktop_app_spec(str(exam.assessment_type or ""))
    if not spec:
        raise HTTPException(status_code=404, detail="This assessment does not use a desktop application")
    if not session:
        return {"status": "not_started", "display_name": spec["display_name"], "launch_url": None}
    launch_url = None
    if session.status == "active" and session.provider_session_id:
        try:
            launch_url = DesktopSessionBroker().launch(session.provider_session_id).get("launch_url")
        except DesktopSessionBrokerError:
            session.status_detail = "A new launch link could not be issued"
            db.commit()
    return {**_serialize_session(db, session), "display_name": spec["display_name"], "launch_url": launch_url}


@router.post("/issued/heartbeat")
def heartbeat_issued_desktop_session(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _, _, session = _candidate_session(authorization, db)
    if not session or session.status not in {"active", "disconnected"}:
        raise HTTPException(status_code=409, detail="No active desktop session")
    if session.lease_expires_at and session.lease_expires_at <= datetime.now(timezone.utc):
        session.status = "expired"
        session.active_key = None
        session.ended_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=410, detail="Desktop session expired")
    if session.provider_session_id:
        try:
            result = DesktopSessionBroker().heartbeat(session.provider_session_id)
            session.status = str(result.get("status") or "active")[:30]
        except DesktopSessionBrokerError:
            session.status_detail = "Broker heartbeat pending"
    session.last_heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    return _serialize_session(db, session)


@router.get("/issues/{issue_id}")
def list_issue_desktop_sessions(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    issue = db.get(AssessmentIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issued assessment not found")
    if current_user.role != UserRole.ADMIN and issue.issuer_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot view this assessment session")
    rows = list(
        db.scalars(
            select(DesktopAppSession)
            .where(DesktopAppSession.issue_id == issue.id)
            .order_by(DesktopAppSession.created_at.desc()),
        ).all(),
    )
    return {"items": [_serialize_session(db, item, include_artifacts=True) for item in rows]}


@router.post("/operations/reconcile")
def reconcile_desktop_sessions(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    now = datetime.now(timezone.utc)
    rows = list(
        db.scalars(
            select(DesktopAppSession)
            .where(
                or_(
                    DesktopAppSession.status == "finalize_pending",
                    (
                        DesktopAppSession.status.in_(("provisioning", "active", "disconnected"))
                        & (DesktopAppSession.lease_expires_at <= now)
                    ),
                ),
            )
            .order_by(DesktopAppSession.updated_at.asc())
            .limit(limit),
        ).all(),
    )
    issue_ids = list(dict.fromkeys(item.issue_id for item in rows))
    results: list[dict[str, Any]] = []
    for issue_id in issue_ids:
        results.extend(
            finalize_desktop_sessions_for_issue(
                db,
                issue_id,
                "lease_expired_or_recovery",
                commit=False,
            ),
        )
    if results:
        db.commit()
    return {
        "checked": len(rows),
        "issues_reconciled": len(issue_ids),
        "results": results,
    }


@router.post("/broker/events")
def receive_broker_session_event(
    payload: BrokerSessionEvent,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    expected = str(get_settings().desktop_session_broker_token or "")
    presented = authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    if not expected or not secrets.compare_digest(expected, presented):
        raise HTTPException(status_code=401, detail="Invalid broker credentials")
    session = db.get(DesktopAppSession, payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Desktop session not found")
    session.provider_session_id = payload.provider_session_id or session.provider_session_id
    session.host_id = payload.host_id or session.host_id
    session.status = payload.status
    session.status_detail = payload.status_detail
    session.last_heartbeat_at = datetime.now(timezone.utc)
    if payload.status == "active" and not session.started_at:
        session.started_at = datetime.now(timezone.utc)
    if payload.status in TERMINAL_DESKTOP_SESSION_STATES:
        session.active_key = None
        session.ended_at = datetime.now(timezone.utc)
    save_desktop_session_artifacts(db, session, [item.model_dump() for item in payload.artifacts])
    db.commit()
    return {"accepted": True, "session_id": session.id, "status": session.status}
