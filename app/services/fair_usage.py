from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import AuditLog, Course, LessonVideo, VideoWatchProgress


def course_total_duration_seconds(db: Session, course_id: int) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(LessonVideo.duration_seconds), 0)).where(
            and_(LessonVideo.course_id == int(course_id), LessonVideo.ready_status.is_(True)),
        ),
    )
    return int(total or 0)


def fair_usage_allowance_seconds(course: Course, total_duration_seconds: int) -> int:
    if course.admin_fair_usage_override_enabled and course.fair_usage_override_seconds and course.fair_usage_override_seconds > 0:
        return int(course.fair_usage_override_seconds)
    mult = float(course.fair_usage_multiplier or get_settings().fair_usage_default_multiplier or 2.5)
    return int(max(0, total_duration_seconds) * max(0.1, mult))


def _usage_warning_level(ratio: float) -> int:
    s = get_settings()
    if ratio >= float(s.fair_usage_warn_threshold_3 or 1.2):
        return 3
    if ratio >= float(s.fair_usage_warn_threshold_2 or 1.0):
        return 2
    if ratio >= float(s.fair_usage_warn_threshold_1 or 0.8):
        return 1
    return 0


def evaluate_fair_usage(db: Session, *, user_id: int, course_id: int) -> dict:
    course = db.get(Course, int(course_id))
    if not course:
        return {
            "allowance_seconds": 0,
            "consumed_seconds": 0,
            "ratio": 0.0,
            "warning_level": 0,
            "status_flags": [],
        }

    total_duration = course_total_duration_seconds(db, int(course_id))
    allowance = fair_usage_allowance_seconds(course, total_duration)
    consumed = int(
        db.scalar(
            select(func.coalesce(func.sum(VideoWatchProgress.total_watched_seconds), 0)).where(
                and_(VideoWatchProgress.user_id == int(user_id), VideoWatchProgress.course_id == int(course_id)),
            ),
        )
        or 0
    )
    ratio = (float(consumed) / float(allowance)) if allowance > 0 else 0.0
    warning_level = _usage_warning_level(ratio)
    flags: list[str] = []
    if warning_level >= 1:
        flags.append("warn_80")
    if warning_level >= 2:
        flags.append("warn_100")
    if warning_level >= 3:
        flags.append("warn_120")
    if allowance > 0 and consumed >= allowance:
        flags.append("credits_required")
        flags.append("max_watch_reached")

    return {
        "allowance_seconds": allowance,
        "consumed_seconds": consumed,
        "ratio": round(ratio, 4),
        "warning_level": warning_level,
        "status_flags": flags,
        "total_duration_seconds": total_duration,
        "multiplier": float(course.fair_usage_multiplier or 0),
    }


def log_fair_usage_transition(
    db: Session,
    *,
    actor_user_id: int,
    target_user_id: int,
    course_id: int,
    old_level: int,
    new_level: int,
    usage_snapshot: dict,
) -> None:
    if int(new_level) <= int(old_level):
        return
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action="fair_usage_warning",
            target_type="course_purchase",
            target_id=int(course_id),
            details_json={
                "target_user_id": int(target_user_id),
                "old_level": int(old_level),
                "new_level": int(new_level),
                "usage": usage_snapshot,
                "at": datetime.now(timezone.utc).isoformat(),
            },
        ),
    )
