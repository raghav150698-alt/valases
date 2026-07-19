from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import time
from urllib import error, request
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import and_, case, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import (
    ApprovalStatus,
    AssessmentIssue,
    Certificate,
    Course,
    CourseComment,
    CourseFeedback,
    Enrollment,
    Exam,
    AssessmentTask,
    Lesson,
    LessonTopic,
    LiveClassMessage,
    LiveClassParticipant,
    LiveClassPollVote,
    LiveClassSession,
    LiveClassCompletion,
    ProviderNotification,
    ProviderDocument,
    ProviderCourseDraft,
    ProviderProfile,
    ProviderType,
    Question,
    Resource,
    Result,
    User,
    UserRole,
    VideoUploadSession,
    VideoUploadStatus,
)
from app.schemas import (
    CourseCommentReply,
    LessonTopicCreate,
    LessonTopicOut,
    LiveClassBoardUpdate,
    LiveClassHostAction,
    LiveClassMessageCreate,
    LiveClassPollCreate,
    LiveClassScheduleCreate,
    LiveClassScheduleUpdate,
    ProviderDocumentCreate,
    ProviderDocumentOut,
    ProviderComplaintStatusUpdate,
    ProviderFeedbackSeenUpdate,
    ProviderHomeOut,
    ProviderProfileCreate,
    ProviderProfileOut,
)
from app.live_ws import signal_manager
from app.services.certificates import ensure_certificate_pdf, safe_certificate_verification_url
from app.services.identity_verification import verify_identity_via_api
from app.services.media_storage import (
    delete_storage_reference,
    normalize_image_storage_reference,
    resolve_media_url,
    upload_file_to_cloud_storage,
)

router = APIRouter(prefix="/provider", tags=["provider"])
_LIVE_SCHEMA_GUARD_DONE = False
_BUSINESS_REG_ALLOWED = {"cin", "pan", "gst", "national_id", "passport", "tax_id", "other"}
STANDALONE_ASSESSMENT_CATEGORY = "__standalone_assessment__"


def _clean_string_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = value.replace("\n", ",").split(",")
    elif isinstance(value, list):
        raw = value
    else:
        raw = []
    return [str(x).strip() for x in raw if str(x).strip()]


def _draft_pricing_breakdown(base_price_amount: float) -> dict:
    s = get_settings()
    base = max(0.0, float(base_price_amount or 0.0))
    gst_rate = max(0.0, float(s.course_pricing_gst_rate or 0.18))
    commission_rate = max(0.0, float(s.course_pricing_platform_commission_rate or 0.25))
    hosting_fee = max(0.0, float(s.course_pricing_one_time_hosting_fee or 2500.0))
    gst_amount = round(base * gst_rate, 2)
    commission_amount = round(base * commission_rate, 2)
    final_amount = round(base + gst_amount + commission_amount + hosting_fee, 2)
    return {
        "price_currency": str(s.course_pricing_default_currency or "INR").upper(),
        "base_price_amount": round(base, 2),
        "gst_rate": gst_rate,
        "platform_commission_rate": commission_rate,
        "hosting_fee_amount": round(hosting_fee, 2),
        "gst_amount": gst_amount,
        "platform_commission_amount": commission_amount,
        "final_price_amount": final_amount,
    }


def _public_request_base_url(request: Request) -> str:
    xf_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    xf_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    proto = xf_proto or request.url.scheme
    host = xf_host or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}".rstrip("/")


def _media_paths() -> tuple[Path, Path]:
    media_root = Path(get_settings().resolved_media_dir)
    videos_dir = media_root / "videos"
    uploads_dir = media_root / "uploads"
    videos_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    return videos_dir, uploads_dir


def _live_recording_paths(session_id: int, upload_id: str | None = None) -> tuple[Path, Path]:
    media_root = Path(get_settings().resolved_media_dir)
    root = media_root / "live-recordings" / str(int(session_id))
    root.mkdir(parents=True, exist_ok=True)
    if upload_id:
        upload_root = root / upload_id
        upload_root.mkdir(parents=True, exist_ok=True)
    else:
        upload_root = root
    return root, upload_root


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", name.strip())
    return cleaned[:180] if cleaned else f"video_{uuid4().hex}.mp4"


def _chunk_object_path(session_id: str, index: int) -> str:
    return f"upload-chunks/{session_id}/{int(index)}.part"


def _download_bunny_chunk_bytes(object_path: str) -> bytes | None:
    settings = get_settings()
    zone = str(settings.bunny_storage_zone or "").strip()
    access_key = str(settings.bunny_storage_access_key or "").strip()
    endpoint = str(settings.bunny_storage_endpoint or "storage.bunnycdn.com").strip()
    if not (zone and access_key and endpoint):
        return None
    url = f"https://{endpoint}/{zone}/{object_path.lstrip('/')}"
    req = request.Request(
        url,
        method="GET",
        headers={
            "AccessKey": access_key,
            "Accept": "application/octet-stream",
        },
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            status = int(getattr(resp, "status", 0) or 0)
            if status not in {200, 206}:
                return None
            return resp.read() or b""
    except error.HTTPError as exc:
        if int(getattr(exc, "code", 0) or 0) == 404:
            return None
        raise


def _download_bunny_chunk_bytes_with_retry(object_path: str, *, retries: int = 5, delay_seconds: float = 0.35) -> bytes | None:
    """
    Bunny storage can be briefly eventual after chunk PUTs; retry a few times
    before treating a chunk as missing.
    """
    attempts = max(1, int(retries))
    for attempt in range(1, attempts + 1):
        blob = _download_bunny_chunk_bytes(object_path)
        if blob is not None:
            return blob
        if attempt < attempts:
            time.sleep(delay_seconds * attempt)
    return None


def _normalize_business_registration(
    *,
    provider_type: ProviderType,
    reg_type: str | None,
    reg_number: str | None,
    reg_country: str | None,
) -> tuple[str | None, str | None, str | None]:
    if provider_type != ProviderType.BUSINESS:
        return None, None, None
    t = str(reg_type or "").strip().lower()
    n = re.sub(r"\s+", "", str(reg_number or "").strip()).upper()
    c = re.sub(r"[^A-Za-z]", "", str(reg_country or "").strip()).upper()[:8] or "IN"
    if not t or not n:
        raise HTTPException(status_code=400, detail="Business providers must submit registration type and number.")
    if t not in _BUSINESS_REG_ALLOWED:
        raise HTTPException(status_code=400, detail="Unsupported business registration type.")
    if t == "pan" and not re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", n):
        raise HTTPException(status_code=400, detail="Business PAN format is invalid.")
    if t == "gst" and not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][Zz][A-Z0-9]", n):
        raise HTTPException(status_code=400, detail="Business GSTIN format is invalid.")
    if t == "cin" and not re.fullmatch(r"[A-Z0-9]{21}", n):
        raise HTTPException(status_code=400, detail="Business CIN format is invalid.")
    verification = verify_identity_via_api(
        id_type=t,
        id_number=n,
        country_code=c,
        role=UserRole.PROVIDER.value,
    )
    if not verification.verified:
        detail = verification.message or "Business registration verification failed."
        status_code = 503 if ("unavailable" in detail or "not configured" in detail or "http_error=5" in detail) else 400
        raise HTTPException(status_code=status_code, detail=detail)
    return t, n, c


@router.post("/profile", response_model=ProviderProfileOut, status_code=status.HTTP_201_CREATED)
def upsert_profile(
    payload: ProviderProfileCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, allow_unapproved=True)),
):
    reg_type, reg_number, reg_country = _normalize_business_registration(
        provider_type=payload.provider_type,
        reg_type=payload.business_registration_type,
        reg_number=payload.business_registration_number,
        reg_country=payload.business_registration_country,
    )
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == current_user.id))
    if not profile:
        profile = ProviderProfile(
            user_id=current_user.id,
            provider_type=payload.provider_type,
            display_name=payload.display_name,
            description=payload.description,
            business_registration_type=reg_type,
            business_registration_number=reg_number,
            business_registration_country=reg_country,
            approval_status=ApprovalStatus.PENDING,
        )
        db.add(profile)
    else:
        profile.provider_type = payload.provider_type
        profile.display_name = payload.display_name
        profile.description = payload.description
        profile.business_registration_type = reg_type
        profile.business_registration_number = reg_number
        profile.business_registration_country = reg_country
        profile.approval_status = ApprovalStatus.PENDING
        profile.rejection_reason = None
        profile.reviewed_at = None
        profile.reviewed_by_admin_id = None

    db.commit()
    db.refresh(profile)
    return profile


@router.post("/documents", response_model=ProviderDocumentOut, status_code=status.HTTP_201_CREATED)
def upload_document(
    payload: ProviderDocumentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, allow_unapproved=True)),
):
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == current_user.id))
    if not profile:
        raise HTTPException(status_code=404, detail="Provider profile not found")

    doc = ProviderDocument(
        provider_id=profile.id,
        document_type=payload.document_type,
        file_url=payload.file_url,
        status=ApprovalStatus.PENDING,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/status", response_model=ProviderProfileOut)
def provider_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, allow_unapproved=True)),
):
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == current_user.id))
    if not profile:
        raise HTTPException(status_code=404, detail="Provider profile not found")
    return profile


@router.post("/status/{provider_id}/{decision}", response_model=ProviderProfileOut)
def review_provider_status(
    provider_id: int,
    decision: str,
    reason: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    profile = db.get(ProviderProfile, provider_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Provider not found")
    if decision not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail="Decision must be approve or reject")

    profile.approval_status = ApprovalStatus.APPROVED if decision == "approve" else ApprovalStatus.REJECTED
    profile.rejection_reason = None if decision == "approve" else reason
    profile.reviewed_by_admin_id = current_user.id
    profile.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(profile)
    return profile


def _provider_or_404(db: Session, user_id: int) -> ProviderProfile:
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    if not profile:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Provider profile not found")
        try:
            profile = ProviderProfile(
                user_id=user_id,
                provider_type=ProviderType.INDIVIDUAL,
                display_name=user.full_name or user.email.split("@")[0],
                description="",
                approval_status=ApprovalStatus.PENDING,
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Provider profile bootstrap failed: {exc}")
    return profile


def _course_rating_summary(db: Session, course_ids: set[int]) -> dict[int, dict]:
    if not course_ids:
        return {}
    rows = db.execute(
        select(
            CourseFeedback.course_id,
            CourseFeedback.valuable_time_rating,
            CourseFeedback.content_quality_rating,
            CourseFeedback.instructor_clarity_rating,
            CourseFeedback.practical_usefulness_rating,
        ).where(CourseFeedback.course_id.in_(course_ids)),
    ).all()
    totals: dict[int, float] = {}
    counts: dict[int, int] = {}
    for course_id, v1, v2, v3, v4 in rows:
        cid = int(course_id)
        overall = (float(v1 or 0) + float(v2 or 0) + float(v3 or 0) + float(v4 or 0)) / 4.0
        totals[cid] = totals.get(cid, 0.0) + overall
        counts[cid] = counts.get(cid, 0) + 1
    return {
        cid: {
            "average_rating": round((totals[cid] / counts[cid]), 2) if counts[cid] else 0.0,
            "rating_count": int(counts[cid]),
        }
        for cid in counts
    }


def _provider_live_session_or_404(db: Session, provider_id: int, session_id: int) -> LiveClassSession:
    sess = db.get(LiveClassSession, session_id)
    if not sess or sess.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="Live class session not found")
    return sess


def _normalize_recurrence(pattern_raw: str | None, count_raw: int | None, custom_days_raw: list[int] | None) -> tuple[str, int, list[int]]:
    pattern = str(pattern_raw or "none").strip().lower()
    if pattern not in {"none", "daily", "weekly", "weekends", "custom"}:
        pattern = "none"
    count = int(count_raw or 1)
    count = max(1, min(count, 60))
    custom_days = sorted({int(x) for x in (custom_days_raw or []) if 0 <= int(x) <= 6})
    if pattern == "custom" and not custom_days:
        pattern = "none"
    if pattern == "none":
        count = 1
        custom_days = []
    return pattern, count, custom_days


def _build_recurrence_start_times(start_at: datetime, pattern: str, count: int, custom_days: list[int]) -> list[datetime]:
    starts = [start_at]
    if count <= 1 or pattern == "none":
        return starts
    cur = start_at
    while len(starts) < count:
        if pattern == "daily":
            cur = cur + timedelta(days=1)
            starts.append(cur)
            continue
        if pattern == "weekly":
            cur = cur + timedelta(days=7)
            starts.append(cur)
            continue
        # weekends/custom search day-by-day for next valid slot
        target_days = {5, 6} if pattern == "weekends" else set(custom_days)
        probe = cur + timedelta(days=1)
        while probe.weekday() not in target_days:
            probe = probe + timedelta(days=1)
        cur = probe
        starts.append(cur)
    return starts


def _ensure_live_schema_runtime(db: Session, force: bool = False) -> None:
    global _LIVE_SCHEMA_GUARD_DONE
    if _LIVE_SCHEMA_GUARD_DONE and not force:
        return
    bind = db.get_bind()
    dialect = bind.dialect.name
    try:
        if dialect == "postgresql":
            statements = [
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) DEFAULT 'UTC'",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS meeting_mode VARCHAR(20) DEFAULT 'in_app'",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS external_meeting_url VARCHAR(1000)",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'scheduled'",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS max_participants INTEGER DEFAULT 200",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS allow_chat BOOLEAN DEFAULT TRUE",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS allow_raise_hand BOOLEAN DEFAULT TRUE",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS allow_reactions BOOLEAN DEFAULT TRUE",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS board_text TEXT",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS active_poll_key VARCHAR(64)",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS active_poll_question TEXT",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS active_poll_options_json JSON DEFAULT '[]'::json",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS active_poll_open BOOLEAN DEFAULT FALSE",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS recurrence_pattern VARCHAR(20) DEFAULT 'none'",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS recurrence_count INTEGER DEFAULT 1",
                "ALTER TABLE live_class_sessions ADD COLUMN IF NOT EXISTS recurrence_custom_days_json JSON DEFAULT '[]'::json",
                "ALTER TABLE live_class_messages ADD COLUMN IF NOT EXISTS payload_json JSON DEFAULT '{}'::json",
            ]
            for stmt in statements:
                try:
                    db.execute(text(stmt))
                except Exception:
                    pass
            db.commit()
        _LIVE_SCHEMA_GUARD_DONE = True
    except Exception:
        # Keep request flow running; route-level handlers will still return clean HTTP errors.
        db.rollback()


def _live_poll_tally(db: Session, sess: LiveClassSession) -> dict:
    if not sess.active_poll_key:
        return {"total_votes": 0, "votes": []}
    rows = db.execute(
        select(LiveClassPollVote.option_index, func.count(LiveClassPollVote.id))
        .where(and_(LiveClassPollVote.session_id == sess.id, LiveClassPollVote.poll_key == sess.active_poll_key))
        .group_by(LiveClassPollVote.option_index),
    ).all()
    counts = {int(i): int(c) for i, c in rows}
    options = list(sess.active_poll_options_json or [])
    votes = [int(counts.get(i, 0)) for i in range(len(options))]
    return {"total_votes": sum(votes), "votes": votes}


def _provider_live_room_state(db: Session, sess: LiveClassSession) -> dict:
    course = db.get(Course, sess.course_id)
    participant_rows = db.scalars(
        select(LiveClassParticipant)
        .where(and_(LiveClassParticipant.session_id == sess.id, LiveClassParticipant.is_present.is_(True)))
        .order_by(LiveClassParticipant.joined_at.asc()),
    ).all()
    poll_tally = _live_poll_tally(db, sess)
    moderation = signal_manager.moderation_snapshot(int(sess.id))
    return {
        "session": {
            "id": sess.id,
            "room_code": sess.room_code,
            "course_id": sess.course_id,
            "course_title": course.title if course else None,
            "title": sess.title,
            "description": sess.description,
            "timezone": sess.timezone,
            "status": sess.status,
            "scheduled_start_at": sess.scheduled_start_at,
            "scheduled_end_at": sess.scheduled_end_at,
            "started_at": sess.started_at,
            "ended_at": sess.ended_at,
            "meeting_mode": sess.meeting_mode,
            "external_meeting_url": sess.external_meeting_url,
            "video_room_url": f"/live-room/{sess.id}",
            "allow_chat": bool(sess.allow_chat),
            "allow_raise_hand": bool(sess.allow_raise_hand),
            "allow_reactions": bool(sess.allow_reactions),
            "board_text": sess.board_text or "",
            "recurrence_pattern": sess.recurrence_pattern or "none",
            "recurrence_count": int(sess.recurrence_count or 1),
            "recurrence_custom_days": list(sess.recurrence_custom_days_json or []),
            "active_poll": {
                "key": sess.active_poll_key,
                "question": sess.active_poll_question,
                "options": list(sess.active_poll_options_json or []),
                "is_open": bool(sess.active_poll_open),
                "total_votes": poll_tally["total_votes"],
                "votes": poll_tally["votes"],
            },
        },
        "me": {
            "access_status": "admitted",
            "muted": False,
            "removed": False,
            "breakout_room": None,
        },
        "participants": [
            {
                "user_id": p.user_id,
                "display_name": p.display_name,
                "actor_role": p.actor_role,
                "raised_hand": bool(p.raised_hand),
                "joined_at": p.joined_at,
            }
            for p in participant_rows
        ],
        "participant_count": len(participant_rows),
        "moderation": moderation,
    }


@router.get("/workspace/home", response_model=ProviderHomeOut)
def provider_home(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    total_courses = db.scalar(select(func.count(Course.id)).where(Course.provider_id == provider.id)) or 0
    published_courses = (
        db.scalar(select(func.count(Course.id)).where(and_(Course.provider_id == provider.id, Course.is_published.is_(True))))
        or 0
    )
    total_enrollments = (
        db.scalar(select(func.count(Enrollment.id)).join(Course, Course.id == Enrollment.course_id).where(Course.provider_id == provider.id))
        or 0
    )
    exams_created = db.scalar(select(func.count(Exam.id)).join(Course, Course.id == Exam.course_id).where(Course.provider_id == provider.id)) or 0
    certificates_issued = (
        db.scalar(select(func.count(Certificate.id)).where(Certificate.provider_id == provider.id)) or 0
    )
    result_rows = db.execute(
        select(Result.passed).join(Exam, Exam.id == Result.exam_id).join(Course, Course.id == Exam.course_id).where(Course.provider_id == provider.id),
    ).all()
    total_results = len(result_rows)
    passed_results = sum(1 for row in result_rows if row[0])
    pass_percentage = round((passed_results / total_results) * 100, 2) if total_results > 0 else 0
    unread_notifications = (
        db.scalar(
            select(func.count(ProviderNotification.id)).where(
                and_(ProviderNotification.provider_id == provider.id, ProviderNotification.is_read.is_(False)),
            ),
        )
        or 0
    )
    return ProviderHomeOut(
        total_courses=total_courses,
        published_courses=published_courses,
        total_enrollments=total_enrollments,
        exams_created=exams_created,
        certificates_issued=certificates_issued,
        pass_percentage=pass_percentage,
        unread_notifications=unread_notifications,
    )


@router.post("/workspace/content/lessons/{lesson_id}/topics", response_model=LessonTopicOut, status_code=status.HTTP_201_CREATED)
def add_lesson_topic(
    lesson_id: int,
    payload: LessonTopicCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    # Validate lesson ownership through course module relation.
    from app.models.entities import CourseModule  # local import to avoid circular edits

    module = db.get(CourseModule, lesson.module_id)
    parent_course = db.get(Course, module.course_id) if module else None
    if not parent_course or parent_course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")

    topic = LessonTopic(
        lesson_id=lesson.id,
        title=payload.title,
        time_seconds=payload.time_seconds,
        thumbnail_data_url=payload.thumbnail_data_url,
    )
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return topic


@router.get("/workspace/content/courses")
def provider_content_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    courses = list(
        db.scalars(
            select(Course).where(
                Course.provider_id == provider.id,
                Course.category != STANDALONE_ASSESSMENT_CATEGORY,
            ),
        ).all(),
    )
    rating_summary = _course_rating_summary(db, {int(c.id) for c in courses})
    pass_stats_rows = db.execute(
        select(
            Exam.course_id,
            func.count(Result.id).label("attempts_count"),
            func.coalesce(
                func.sum(case((Result.passed.is_(True), 1), else_=0)),
                0,
            ).label("passed_count"),
        )
        .join(Result, Result.exam_id == Exam.id)
        .where(Exam.course_id.in_([int(c.id) for c in courses] or [-1]))
        .group_by(Exam.course_id),
    ).all()
    pass_stats_by_course = {
        int(row.course_id): {
            "attempts_count": int(row.attempts_count or 0),
            "passed_count": int(row.passed_count or 0),
        }
        for row in pass_stats_rows
    }
    from app.models.entities import CourseModule  # local import to avoid file-wide refactor

    response = []
    for course in courses:
        modules = list(db.scalars(select(CourseModule).where(CourseModule.course_id == course.id)).all())
        module_items = []
        for module in modules:
            lessons = list(db.scalars(select(Lesson).where(Lesson.module_id == module.id)).all())
            lesson_items = []
            for lesson in lessons:
                topics = list(
                    db.scalars(select(LessonTopic).where(LessonTopic.lesson_id == lesson.id).order_by(LessonTopic.time_seconds)).all(),
                )
                resources = list(
                    db.scalars(select(Resource).where(Resource.lesson_id == lesson.id)).all(),
                )
                lesson_items.append(
                    {
                        "id": lesson.id,
                        "title": lesson.title,
                        "lesson_type": lesson.lesson_type,
                        "recorded_video_url": resolve_media_url(lesson.recorded_video_url),
                        "live_class_url": lesson.live_class_url,
                        "topics": [{"id": t.id, "title": t.title, "time_seconds": t.time_seconds, "thumbnail_data_url": t.thumbnail_data_url} for t in topics],
                        "resources": [{"id": r.id, "title": r.title, "url": r.url, "resource_type": r.resource_type} for r in resources],
                    },
                )
            module_items.append({"id": module.id, "title": module.title, "lessons": lesson_items})
        response.append(
            {
                "id": course.id,
                "title": course.title,
                "thumbnail_url": resolve_media_url(course.thumbnail_url) or course.thumbnail_url,
                "intro_video_url": resolve_media_url(course.intro_video_url) or course.intro_video_url,
                "preview_video_url": resolve_media_url(course.preview_video_url) or course.preview_video_url,
                "main_video_url": resolve_media_url(course.main_video_url) or course.main_video_url,
                "is_published": course.is_published,
                "created_at": course.created_at,
                "status": "active" if course.is_published else "inactive",
                "pass_percentage": (
                    round(
                        (
                            pass_stats_by_course.get(int(course.id), {}).get("passed_count", 0)
                            / max(1, pass_stats_by_course.get(int(course.id), {}).get("attempts_count", 0))
                        ) * 100,
                        2,
                    )
                    if pass_stats_by_course.get(int(course.id), {}).get("attempts_count", 0) > 0
                    else None
                ),
                "average_rating": float((rating_summary.get(int(course.id)) or {}).get("average_rating", 0.0)),
                "rating_count": int((rating_summary.get(int(course.id)) or {}).get("rating_count", 0)),
                "modules": module_items,
            },
        )
    return response


@router.post("/workspace/uploads/init")
def init_video_upload(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    filename = str(payload.get("filename") or "").strip()
    total_chunks = int(payload.get("total_chunks") or 0)
    total_size = int(payload.get("total_size") or 0)
    mime_type = payload.get("mime_type")
    if not filename or total_chunks <= 0:
        raise HTTPException(status_code=400, detail="filename and total_chunks are required")

    _, uploads_dir = _media_paths()
    session_id = uuid4().hex
    stored_filename = f"{session_id}_{_safe_filename(filename)}"
    session_dir = uploads_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    upload = VideoUploadSession(
        session_id=session_id,
        provider_id=provider.id,
        original_filename=filename,
        stored_filename=stored_filename,
        mime_type=mime_type,
        total_size=total_size,
        total_chunks=total_chunks,
        received_chunks=0,
        status=VideoUploadStatus.INITIATED,
    )
    db.add(upload)
    db.commit()
    return {"session_id": session_id, "total_chunks": total_chunks}


@router.put("/workspace/uploads/{session_id}/chunk")
async def upload_video_chunk(
    session_id: str,
    index: int,
    chunk: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    upload = db.scalar(select(VideoUploadSession).where(VideoUploadSession.session_id == session_id))
    if not upload or upload.provider_id != provider.id:
        raise HTTPException(status_code=404, detail="Upload session not found")
    if upload.status == VideoUploadStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Upload already completed")
    if index < 0 or index >= upload.total_chunks:
        raise HTTPException(status_code=400, detail="Invalid chunk index")

    _, uploads_dir = _media_paths()
    session_dir = uploads_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    chunk_path = session_dir / f"{index}.part"
    data = await chunk.read()
    if chunk_path.exists():
        return {"session_id": session_id, "index": index, "status": "already_received", "received_chunks": upload.received_chunks}
    chunk_path.write_bytes(data)

    upload.received_chunks += 1
    upload.status = VideoUploadStatus.UPLOADING
    db.commit()
    return {"session_id": session_id, "index": index, "status": "received", "received_chunks": upload.received_chunks, "total_chunks": upload.total_chunks}


@router.get("/workspace/uploads/{session_id}")
def upload_video_status(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    upload = db.scalar(select(VideoUploadSession).where(VideoUploadSession.session_id == session_id))
    if not upload or upload.provider_id != provider.id:
        raise HTTPException(status_code=404, detail="Upload session not found")
    return {
        "session_id": upload.session_id,
        "status": upload.status,
        "received_chunks": upload.received_chunks,
        "total_chunks": upload.total_chunks,
        "file_url": resolve_media_url(upload.file_url),
        "storage_ref": upload.file_url,
    }


@router.post("/workspace/uploads/{session_id}/complete")
def complete_video_upload(
    session_id: str,
    course_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    upload = db.scalar(select(VideoUploadSession).where(VideoUploadSession.session_id == session_id))
    if not upload or upload.provider_id != provider.id:
        raise HTTPException(status_code=404, detail="Upload session not found")
    settings = get_settings()
    backend = settings.resolved_object_storage_backend
    videos_dir, uploads_dir = _media_paths()
    session_dir = uploads_dir / session_id
    final_path = videos_dir / upload.stored_filename
    if not session_dir.exists():
        upload.status = VideoUploadStatus.FAILED
        db.commit()
        raise HTTPException(status_code=400, detail="Upload session files are missing")
    if course_id:
        course = db.get(Course, int(course_id))
        if not course or int(course.provider_id or 0) != int(provider.id):
            raise HTTPException(status_code=404, detail="Course not found for upload finalize")

    try:
        missing_chunks: list[int] = []
        with final_path.open("wb") as out:
            for idx in range(upload.total_chunks):
                part = session_dir / f"{idx}.part"
                if not part.exists():
                    missing_chunks.append(idx)
                    continue
                with part.open("rb") as inp:
                    while True:
                        chunk = inp.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
        upload.received_chunks = upload.total_chunks - len(missing_chunks)
        db.commit()
        if missing_chunks:
            first_missing = missing_chunks[0]
            raise HTTPException(status_code=400, detail=f"Upload is incomplete (missing chunk {first_missing})")

        for idx in range(upload.total_chunks):
            part = session_dir / f"{idx}.part"
            if part.exists():
                part.unlink()
        if session_dir.exists():
            session_dir.rmdir()
    except HTTPException:
        upload.status = VideoUploadStatus.FAILED
        db.commit()
        raise
    except Exception as exc:
        upload.status = VideoUploadStatus.FAILED
        upload.error_message = str(exc)
        db.commit()
        raise HTTPException(status_code=500, detail="Failed to merge uploaded chunks")

    try:
        object_path = f"videos/{upload.stored_filename}"
        if course_id:
            object_path = f"videos/course-{int(course_id)}/{upload.stored_filename}"
        upload.file_url = upload_file_to_cloud_storage(
            final_path,
            object_path=object_path,
            content_type=upload.mime_type or "video/mp4",
        )
    except Exception as exc:
        if backend == "local":
            upload.file_url = f"/media/videos/{upload.stored_filename}"
        else:
            upload.status = VideoUploadStatus.FAILED
            upload.error_message = f"Cloud upload failed: {exc}"
            db.commit()
            raise HTTPException(status_code=500, detail="Failed to upload video to cloud storage")
    upload.status = VideoUploadStatus.COMPLETED
    db.commit()

    try:
        if backend != "local":
            final_path.unlink(missing_ok=True)
    except Exception:
        pass
    return {
        "session_id": upload.session_id,
        "file_url": resolve_media_url(upload.file_url),
        "storage_ref": upload.file_url,
        "status": upload.status,
    }


@router.post("/workspace/uploads/intro")
def upload_intro_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    filename = _safe_filename(file.filename or f"intro_{uuid4().hex}.mp4")
    suffix = Path(filename).suffix or ".mp4"
    temp_name = f"intro_{int(provider.id)}_{uuid4().hex}{suffix}"
    videos_dir, _ = _media_paths()
    temp_path = videos_dir / temp_name
    try:
        with temp_path.open("wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        storage_ref = upload_file_to_cloud_storage(
            temp_path,
            object_path=f"intro-videos/provider-{int(provider.id)}/{temp_name}",
            content_type=file.content_type or "video/mp4",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload intro video: {exc}") from exc
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass
    return {"uploaded": True, "file_url": resolve_media_url(storage_ref) or storage_ref, "storage_ref": storage_ref}


@router.post("/workspace/courses/drafts")
def save_course_draft(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    draft_id = payload.get("draft_id")
    draft = db.get(ProviderCourseDraft, int(draft_id)) if draft_id else None
    if draft and draft.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if not draft:
        draft = ProviderCourseDraft(provider_id=provider.id)
        db.add(draft)

    draft.title = str(payload.get("title") or "")
    draft.level = str(payload.get("level") or "Beginner")
    draft.category = str(payload.get("category") or "General")
    draft.suitable_age_ranges = list(payload.get("suitable_age_ranges") or [])
    draft.description = str(payload.get("description") or "")
    thumbnail_input = payload.get("thumbnail_url")
    try:
        draft.thumbnail_url = normalize_image_storage_reference(
            thumbnail_input,
            object_prefix=f"course-thumbnails/provider-{provider.id}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid draft thumbnail: {exc}") from exc
    draft.includes_exam = bool(payload.get("includes_exam", True))
    draft.intro_video_url = str(payload.get("intro_video_url") or "").strip() or None
    draft.video_url = payload.get("video_url")
    base_price_amount = float(payload.get("base_price_amount") or 0.0)
    breakdown = _draft_pricing_breakdown(base_price_amount)
    draft.price_currency = breakdown["price_currency"]
    draft.base_price_amount = breakdown["base_price_amount"]
    draft.gst_rate = breakdown["gst_rate"]
    draft.platform_commission_rate = breakdown["platform_commission_rate"]
    draft.hosting_fee_amount = breakdown["hosting_fee_amount"]
    draft.gst_amount = breakdown["gst_amount"]
    draft.platform_commission_amount = breakdown["platform_commission_amount"]
    draft.final_price_amount = breakdown["final_price_amount"]
    draft.topics_json = payload.get("topics") or []
    db.commit()
    db.refresh(draft)
    return {
        "draft_id": draft.id,
        "title": draft.title,
        "level": draft.level,
        "category": draft.category,
        "suitable_age_ranges": list(draft.suitable_age_ranges or []),
        "description": draft.description,
        "thumbnail_url": resolve_media_url(draft.thumbnail_url) or draft.thumbnail_url,
        "includes_exam": draft.includes_exam,
        "intro_video_url": draft.intro_video_url,
        "intro_video_play_url": resolve_media_url(draft.intro_video_url),
        "video_url": draft.video_url,
        "price_currency": draft.price_currency,
        "base_price_amount": float(draft.base_price_amount or 0.0),
        "gst_rate": float(draft.gst_rate or 0.0),
        "platform_commission_rate": float(draft.platform_commission_rate or 0.0),
        "hosting_fee_amount": float(draft.hosting_fee_amount or 0.0),
        "gst_amount": float(draft.gst_amount or 0.0),
        "platform_commission_amount": float(draft.platform_commission_amount or 0.0),
        "final_price_amount": float(draft.final_price_amount or 0.0),
        "topics": draft.topics_json,
        "updated_at": draft.updated_at,
    }


@router.get("/workspace/courses/drafts")
def list_course_drafts(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    drafts = list(
        db.scalars(select(ProviderCourseDraft).where(ProviderCourseDraft.provider_id == provider.id).order_by(ProviderCourseDraft.updated_at.desc())).all(),
    )
    return [
        {
            "draft_id": d.id,
            "title": d.title,
            "level": d.level,
            "category": d.category,
            "suitable_age_ranges": list(d.suitable_age_ranges or []),
            "intro_video_url": d.intro_video_url,
            "video_url": d.video_url,
            "price_currency": d.price_currency,
            "base_price_amount": float(d.base_price_amount or 0.0),
            "final_price_amount": float(d.final_price_amount or 0.0),
            "topics_count": len(d.topics_json or []),
            "updated_at": d.updated_at,
        }
        for d in drafts
    ]


@router.get("/workspace/courses/drafts/{draft_id}")
def get_course_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    draft = db.get(ProviderCourseDraft, draft_id)
    if not draft or draft.provider_id != provider.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {
        "draft_id": draft.id,
        "title": draft.title,
        "level": draft.level,
        "category": draft.category,
        "suitable_age_ranges": list(draft.suitable_age_ranges or []),
        "description": draft.description,
        "thumbnail_url": resolve_media_url(draft.thumbnail_url) or draft.thumbnail_url,
        "includes_exam": draft.includes_exam,
        "intro_video_url": draft.intro_video_url,
        "intro_video_play_url": resolve_media_url(draft.intro_video_url),
        "video_url": draft.video_url,
        "video_play_url": resolve_media_url(draft.video_url),
        "price_currency": draft.price_currency,
        "base_price_amount": float(draft.base_price_amount or 0.0),
        "gst_rate": float(draft.gst_rate or 0.0),
        "platform_commission_rate": float(draft.platform_commission_rate or 0.0),
        "hosting_fee_amount": float(draft.hosting_fee_amount or 0.0),
        "gst_amount": float(draft.gst_amount or 0.0),
        "platform_commission_amount": float(draft.platform_commission_amount or 0.0),
        "final_price_amount": float(draft.final_price_amount or 0.0),
        "topics": draft.topics_json or [],
        "updated_at": draft.updated_at,
    }


@router.delete("/workspace/courses/drafts/{draft_id}")
def delete_course_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    draft = db.get(ProviderCourseDraft, draft_id)
    if not draft or draft.provider_id != provider.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    db.commit()
    return {"deleted": True, "draft_id": draft_id}


@router.get("/workspace/assessments")
def provider_assessments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    provider = _provider_or_404(db, current_user.id)
    query = select(Exam, Course).join(Course, Course.id == Exam.course_id)
    if current_user.role != UserRole.ADMIN:
        query = query.where(Course.provider_id == provider.id)
    rows = db.execute(query).all()
    question_counts = {
        exam_id: count
        for exam_id, count in db.execute(
            select(Question.exam_id, func.count(Question.id)).group_by(Question.exam_id),
        ).all()
    }
    issued_counts = {
        int(exam_id): int(count)
        for exam_id, count in db.execute(
            select(AssessmentIssue.exam_id, func.count(AssessmentIssue.id)).group_by(AssessmentIssue.exam_id),
        ).all()
    }
    taken_counts = {
        int(exam_id): int(count)
        for exam_id, count in db.execute(
            select(AssessmentIssue.exam_id, func.count(AssessmentIssue.id))
            .where(AssessmentIssue.status.in_(["completed", "manual_review"]))
            .group_by(AssessmentIssue.exam_id),
        ).all()
    }
    task_by_exam = {
        task.assessment_id: task
        for task in db.scalars(select(AssessmentTask).where(AssessmentTask.assessment_id.in_([exam.id for exam, _ in rows]))).all()
    } if rows else {}
    return [
        {
            "exam_id": exam.id,
            "title": exam.title,
            "assessment_type": exam.assessment_type or "mcq",
            "instructions": exam.instructions or "",
            "about": exam.assessment_about or "",
            "tools": _clean_string_list(exam.tools_json or []),
            "topics": _clean_string_list(exam.topics_json or []),
            "status": exam.status,
            "pass_score": exam.pass_score,
            "max_attempts": exam.max_attempts,
            "negative_marking": exam.negative_marking,
            "shuffle_questions": exam.shuffle_questions,
            "shuffle_options": exam.shuffle_options,
            "certificate_enabled": exam.certificate_enabled,
            "timing_mode": exam.timing_mode,
            "duration_minutes": exam.duration_minutes,
            "time_per_question_seconds": exam.time_per_question_seconds,
            "questions_per_attempt": exam.questions_per_attempt,
            "total_marks": exam.total_marks,
            "question_count": int(question_counts.get(exam.id, 0)),
            "issued_count": int(issued_counts.get(exam.id, 0)),
            "taken_count": int(taken_counts.get(exam.id, 0)),
            "task": (
                {
                    "id": task_by_exam[exam.id].id,
                    "type": task_by_exam[exam.id].type,
                    "title": task_by_exam[exam.id].title,
                    "description": task_by_exam[exam.id].description,
                    "instructions": task_by_exam[exam.id].instructions,
                    "marks": task_by_exam[exam.id].marks,
                    "metadata": task_by_exam[exam.id].metadata_json or {},
                    "expected_output": task_by_exam[exam.id].expected_output_json or {},
                    "grading_config": task_by_exam[exam.id].grading_config_json or {},
                }
                if exam.id in task_by_exam else None
            ),
        }
        for exam, course in rows
    ]


@router.get("/workspace/live-classes")
def provider_live_classes(
    course_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    try:
        _ensure_live_schema_runtime(db)
        provider = _provider_or_404(db, current_user.id)
        q = select(LiveClassSession).where(LiveClassSession.provider_id == provider.id)
        if course_id:
            q = q.where(LiveClassSession.course_id == course_id)
        rows = db.scalars(q.order_by(LiveClassSession.scheduled_start_at.desc(), LiveClassSession.id.desc())).all()
        courses = {c.id: c for c in db.scalars(select(Course).where(Course.provider_id == provider.id)).all()}
        items = []
        for sess in rows:
            participant_count = int(
                db.scalar(
                    select(func.count(LiveClassParticipant.id)).where(
                        and_(LiveClassParticipant.session_id == sess.id, LiveClassParticipant.is_present.is_(True)),
                    ),
                )
                or 0
            )
            items.append(
                {
                    "session_id": sess.id,
                    "course_id": sess.course_id,
                    "course_title": (courses.get(sess.course_id).title if courses.get(sess.course_id) else None),
                    "course_category": (courses.get(sess.course_id).category if courses.get(sess.course_id) else None),
                    "room_code": sess.room_code,
                    "title": sess.title,
                    "description": sess.description,
                    "timezone": sess.timezone,
                    "status": sess.status,
                    "scheduled_start_at": sess.scheduled_start_at,
                    "scheduled_end_at": sess.scheduled_end_at,
                    "started_at": sess.started_at,
                    "ended_at": sess.ended_at,
                    "meeting_mode": sess.meeting_mode,
                    "external_meeting_url": sess.external_meeting_url,
                    "video_room_url": f"/live-room/{sess.id}",
                    "participant_count": participant_count,
                    "allow_chat": bool(sess.allow_chat),
                    "allow_raise_hand": bool(sess.allow_raise_hand),
                    "allow_reactions": bool(sess.allow_reactions),
                    "recurrence_pattern": sess.recurrence_pattern or "none",
                    "recurrence_count": int(sess.recurrence_count or 1),
                    "recurrence_custom_days": list(sess.recurrence_custom_days_json or []),
                },
            )
        return {"items": items}
    except Exception as exc:
        db.rollback()
        try:
            _ensure_live_schema_runtime(db, force=True)
        except Exception:
            pass
        # Fail-safe for production bootstrap issues: keep workspace usable.
        return {"items": [], "degraded": True, "error": f"live_classes_unavailable: {exc}"}


@router.post("/workspace/live-classes", status_code=status.HTTP_201_CREATED)
def create_live_class_schedule(
    payload: LiveClassScheduleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    _ensure_live_schema_runtime(db)
    provider = _provider_or_404(db, current_user.id)
    schedule_title = payload.title.strip()
    if payload.course_id:
        course = db.get(Course, payload.course_id)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found. Select a valid course from your provider workspace.")
        if course.provider_id != provider.id:
            raise HTTPException(status_code=403, detail="You can only schedule classes for your own courses.")
    else:
        # Live classes are treated as standalone offerings and get an auto-created course record.
        course = Course(
            provider_id=provider.id,
            title=schedule_title,
            description=(payload.description or f"Live class session: {schedule_title}"),
            category="Live Class",
            thumbnail_url=None,
            includes_certification_exam=True,
            is_published=True,
        )
        db.add(course)
        db.flush()
    if payload.scheduled_end_at and payload.scheduled_end_at <= payload.scheduled_start_at:
        raise HTTPException(status_code=400, detail="scheduled_end_at must be after scheduled_start_at")
    meeting_mode = str(payload.meeting_mode or "in_app").strip().lower()
    if meeting_mode not in {"in_app", "external"}:
        raise HTTPException(status_code=400, detail="meeting_mode must be in_app or external")
    if meeting_mode == "external" and not str(payload.external_meeting_url or "").strip():
        raise HTTPException(status_code=400, detail="external_meeting_url is required for external mode")
    recurrence_pattern, recurrence_count, recurrence_custom_days = _normalize_recurrence(
        payload.recurrence_pattern,
        payload.recurrence_count,
        payload.recurrence_custom_days,
    )
    scheduled_starts = _build_recurrence_start_times(
        payload.scheduled_start_at,
        recurrence_pattern,
        recurrence_count,
        recurrence_custom_days,
    )
    duration = None
    if payload.scheduled_end_at:
        duration = payload.scheduled_end_at - payload.scheduled_start_at
    try:
        created_ids: list[int] = []
        first_room_code = ""
        for idx, start_at in enumerate(scheduled_starts):
            end_at = (start_at + duration) if duration is not None else None
            sess = LiveClassSession(
                course_id=course.id,
                provider_id=provider.id,
                room_code=uuid4().hex[:10].upper(),
                title=schedule_title,
                description=(payload.description or "").strip() or None,
                timezone=(payload.timezone or "UTC").strip() or "UTC",
                meeting_mode=meeting_mode,
                external_meeting_url=(payload.external_meeting_url or "").strip() or None,
                status="scheduled",
                scheduled_start_at=start_at,
                scheduled_end_at=end_at,
                max_participants=int(payload.max_participants),
                allow_chat=bool(payload.allow_chat),
                allow_raise_hand=bool(payload.allow_raise_hand),
                allow_reactions=bool(payload.allow_reactions),
                recurrence_pattern=recurrence_pattern,
                recurrence_count=recurrence_count,
                recurrence_custom_days_json=recurrence_custom_days,
            )
            db.add(sess)
            db.flush()
            created_ids.append(int(sess.id))
            if idx == 0:
                first_room_code = str(sess.room_code)
            db.add(
                LiveClassMessage(
                    session_id=sess.id,
                    user_id=current_user.id,
                    actor_name=current_user.full_name,
                    actor_role="provider",
                    message_type="system",
                    content=f"Live class '{sess.title}' scheduled.",
                    payload_json={},
                ),
            )
        db.flush()
        db.add(
            ProviderNotification(
                provider_id=provider.id,
                event_type="live_class_schedule",
                message=f"{len(created_ids)} live session(s) scheduled for '{schedule_title}'.",
                ref_type="live_class",
                ref_id=created_ids[0] if created_ids else None,
                is_read=False,
            ),
        )
        db.commit()
        return {
            "created": True,
            "session_id": created_ids[0] if created_ids else None,
            "session_ids": created_ids,
            "room_code": first_room_code,
            "course_id": course.id,
            "course_title": course.title,
            "course_auto_created": bool(payload.course_id is None),
            "recurrence_pattern": recurrence_pattern,
            "recurrence_count": recurrence_count,
        }
    except SQLAlchemyError as exc:
        db.rollback()
        _ensure_live_schema_runtime(db, force=True)
        raise HTTPException(status_code=500, detail=f"Unable to schedule live class: {exc}")


@router.patch("/workspace/live-classes/{session_id}")
def update_live_class_schedule(
    session_id: int,
    payload: LiveClassScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    data = payload.model_dump(exclude_unset=True)
    if "meeting_mode" in data and data["meeting_mode"] is not None:
        mode = str(data["meeting_mode"]).strip().lower()
        if mode not in {"in_app", "external"}:
            raise HTTPException(status_code=400, detail="meeting_mode must be in_app or external")
        data["meeting_mode"] = mode
    if data.get("meeting_mode") == "external" and not str(data.get("external_meeting_url") or sess.external_meeting_url or "").strip():
        raise HTTPException(status_code=400, detail="external_meeting_url is required for external mode")
    if "recurrence_custom_days" in data:
        data["recurrence_custom_days_json"] = data.pop("recurrence_custom_days") or []
    if any(k in data for k in ("recurrence_pattern", "recurrence_count", "recurrence_custom_days_json")):
        pattern, count, custom_days = _normalize_recurrence(
            data.get("recurrence_pattern", sess.recurrence_pattern),
            data.get("recurrence_count", sess.recurrence_count),
            data.get("recurrence_custom_days_json", sess.recurrence_custom_days_json),
        )
        data["recurrence_pattern"] = pattern
        data["recurrence_count"] = count
        data["recurrence_custom_days_json"] = custom_days
    next_start = data.get("scheduled_start_at", sess.scheduled_start_at)
    next_end = data.get("scheduled_end_at", sess.scheduled_end_at)
    if next_end and next_end <= next_start:
        raise HTTPException(status_code=400, detail="scheduled_end_at must be after scheduled_start_at")
    for key, value in data.items():
        setattr(sess, key, value)
    db.commit()
    return {"updated": True, "session_id": sess.id}


@router.post("/workspace/live-classes/{session_id}/start")
def start_live_class(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    if sess.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled class cannot be started")
    now = datetime.now(timezone.utc)
    sess.status = "live"
    sess.started_at = now
    db.add(
        LiveClassMessage(
            session_id=sess.id,
            user_id=current_user.id,
            actor_name=current_user.full_name,
            actor_role="provider",
            message_type="system",
            content="Class is now live.",
            payload_json={},
        ),
    )
    db.commit()
    return {"started": True, "session_id": sess.id, "status": sess.status}


@router.post("/workspace/live-classes/{session_id}/end")
def end_live_class(
    session_id: int,
    unlock_assessment: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    now = datetime.now(timezone.utc)
    sess.status = "ended"
    sess.ended_at = now
    db.add(
        LiveClassMessage(
            session_id=sess.id,
            user_id=current_user.id,
            actor_name=current_user.full_name,
            actor_role="provider",
            message_type="system",
            content="Class has ended.",
            payload_json={},
        ),
    )
    unlocked = 0
    if unlock_assessment:
        enrollments = list(db.scalars(select(Enrollment).where(Enrollment.course_id == sess.course_id)).all())
        for enr in enrollments:
            enr.exam_eligible = True
            enr.progress_pct = max(float(enr.progress_pct or 0), 100.0)
        unlocked = len(enrollments)
        db.add(LiveClassCompletion(course_id=sess.course_id, provider_id=provider.id, note=f"Session #{sess.id} ended"))
    db.commit()
    return {"ended": True, "session_id": sess.id, "status": sess.status, "students_unlocked": unlocked}


@router.post("/workspace/live-classes/{session_id}/join")
def provider_join_live_class(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    signal_manager.register_join_intent(
        int(sess.id),
        int(current_user.id),
        current_user.role.value,
        current_user.full_name or current_user.email,
    )
    participant = db.scalar(
        select(LiveClassParticipant).where(and_(LiveClassParticipant.session_id == sess.id, LiveClassParticipant.user_id == current_user.id)),
    )
    now = datetime.now(timezone.utc)
    if not participant:
        participant = LiveClassParticipant(
            session_id=sess.id,
            user_id=current_user.id,
            actor_role="provider",
            display_name=current_user.full_name or current_user.email,
            is_present=True,
            joined_at=now,
            last_seen_at=now,
            raised_hand=False,
        )
        db.add(participant)
    else:
        participant.is_present = True
        participant.left_at = None
        participant.last_seen_at = now
    db.commit()
    return {"joined": True}


@router.post("/workspace/live-classes/{session_id}/leave")
def provider_leave_live_class(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    participant = db.scalar(
        select(LiveClassParticipant).where(and_(LiveClassParticipant.session_id == sess.id, LiveClassParticipant.user_id == current_user.id)),
    )
    if participant:
        participant.is_present = False
        participant.raised_hand = False
        participant.left_at = datetime.now(timezone.utc)
        participant.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return {"left": True}


@router.get("/workspace/live-classes/{session_id}/room-state")
def provider_live_room_state(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    return _provider_live_room_state(db, sess)


@router.get("/workspace/live-classes/{session_id}/moderation-state")
def provider_live_moderation_state(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    participants = db.scalars(
        select(LiveClassParticipant)
        .where(LiveClassParticipant.session_id == sess.id)
        .order_by(LiveClassParticipant.joined_at.desc()),
    ).all()
    snapshot = signal_manager.moderation_snapshot(sess.id)
    p_map = {int(p.user_id): p for p in participants}
    return {
        "session_id": sess.id,
        "waiting_room_enabled": bool(snapshot.get("waiting_room_enabled", True)),
        "waiting_users": snapshot.get("waiting_users", []),
        "muted_user_ids": snapshot.get("muted_user_ids", []),
        "removed_user_ids": snapshot.get("removed_user_ids", []),
        "breakouts": snapshot.get("breakouts", {}),
        "participants": [
            {
                "user_id": int(p.user_id),
                "display_name": p.display_name,
                "actor_role": p.actor_role,
                "is_present": bool(p.is_present),
                "raised_hand": bool(p.raised_hand),
                "joined_at": p.joined_at,
                "flags": signal_manager.user_flags(sess.id, int(p.user_id)),
            }
            for p in participants
        ],
        "admitted_users": [
            {
                "user_id": int(uid),
                "display_name": (p_map.get(int(uid)).display_name if p_map.get(int(uid)) else f"User {uid}"),
                "flags": signal_manager.user_flags(sess.id, int(uid)),
            }
            for uid in snapshot.get("admitted_user_ids", [])
        ],
    }


@router.post("/workspace/live-classes/{session_id}/host-action")
async def provider_live_host_action(
    session_id: int,
    payload: LiveClassHostAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    action = str(payload.action or "").strip().lower()
    uid = int(payload.target_user_id) if payload.target_user_id is not None else None
    if action == "toggle_waiting_room":
        enabled = bool(payload.enabled if payload.enabled is not None else True)
        signal_manager.set_waiting_room_enabled(sess.id, enabled)
    elif action == "admit" and uid:
        signal_manager.admit_user(sess.id, uid)
    elif action in {"reject", "remove"} and uid:
        signal_manager.remove_user(sess.id, uid)
    elif action in {"mute", "unmute"} and uid:
        signal_manager.mute_user(sess.id, uid, action == "mute")
    elif action == "assign_breakout" and uid:
        signal_manager.assign_breakout(sess.id, uid, payload.room)
    elif action == "clear_breakouts":
        signal_manager.clear_breakouts(sess.id)
    else:
        raise HTTPException(status_code=400, detail="Invalid host action")
    snapshot = signal_manager.moderation_snapshot(sess.id)
    await signal_manager.emit(
        sess.id,
        {
            "type": "moderation",
            "state": snapshot,
            "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
        },
    )
    if uid:
        await signal_manager.emit(
            sess.id,
            {
                "type": "room_flags",
                "flags": signal_manager.user_flags(sess.id, uid),
                "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
            },
            to_user_id=uid,
        )
        if action == "admit":
            await signal_manager.emit(
                sess.id,
                {
                    "type": "room_access",
                    "status": "admitted",
                    "flags": signal_manager.user_flags(sess.id, uid),
                    "ts": int(datetime.now(timezone.utc).timestamp() * 1000),
                },
                to_user_id=uid,
            )
    return {"ok": True, "state": snapshot}


@router.get("/workspace/live-classes/{session_id}/messages")
def provider_live_messages(
    session_id: int,
    after_id: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    limit = max(1, min(limit, 200))
    rows = db.scalars(
        select(LiveClassMessage)
        .where(and_(LiveClassMessage.session_id == sess.id, LiveClassMessage.id > int(after_id)))
        .order_by(LiveClassMessage.id.asc())
        .limit(limit),
    ).all()
    return {
        "items": [
            {
                "id": row.id,
                "message_type": row.message_type,
                "content": row.content,
                "actor_name": row.actor_name,
                "actor_role": row.actor_role,
                "payload": row.payload_json or {},
                "created_at": row.created_at,
            }
            for row in rows
        ]
    }


@router.post("/workspace/live-classes/{session_id}/messages")
def provider_send_live_message(
    session_id: int,
    payload: LiveClassMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    mtype = str(payload.message_type or "chat").strip().lower()
    if mtype not in {"chat", "announcement", "reaction", "signal"}:
        raise HTTPException(status_code=400, detail="Invalid message type")
    if mtype == "chat" and not sess.allow_chat:
        raise HTTPException(status_code=400, detail="Chat is disabled")
    if mtype == "reaction" and not sess.allow_reactions:
        raise HTTPException(status_code=400, detail="Reactions are disabled")
    text = str(payload.content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message content is required")
    row = LiveClassMessage(
        session_id=sess.id,
        user_id=current_user.id,
        actor_name=current_user.full_name,
        actor_role="provider",
        message_type=mtype,
        content=text,
        payload_json=payload.payload or {},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"message_id": row.id}


@router.post("/workspace/live-classes/{session_id}/tools/board")
def provider_update_live_board(
    session_id: int,
    payload: LiveClassBoardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    sess.board_text = payload.board_text
    db.add(
        LiveClassMessage(
            session_id=sess.id,
            user_id=current_user.id,
            actor_name=current_user.full_name,
            actor_role="provider",
            message_type="board_update",
            content="Whiteboard updated.",
            payload_json={},
        ),
    )
    db.commit()
    return {"saved": True}


@router.post("/workspace/live-classes/{session_id}/tools/poll")
def provider_start_live_poll(
    session_id: int,
    payload: LiveClassPollCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    options = [str(x).strip() for x in payload.options if str(x).strip()]
    if len(options) < 2:
        raise HTTPException(status_code=400, detail="Poll requires at least 2 options")
    sess.active_poll_key = uuid4().hex
    sess.active_poll_question = str(payload.question).strip()
    sess.active_poll_options_json = options
    sess.active_poll_open = True
    db.add(
        LiveClassMessage(
            session_id=sess.id,
            user_id=current_user.id,
            actor_name=current_user.full_name,
            actor_role="provider",
            message_type="poll",
            content=f"Poll started: {sess.active_poll_question}",
            payload_json={"options": options},
        ),
    )
    db.commit()
    return {"started": True, "poll_key": sess.active_poll_key}


@router.post("/workspace/live-classes/{session_id}/tools/poll/close")
def provider_close_live_poll(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    sess.active_poll_open = False
    tally = _live_poll_tally(db, sess)
    db.add(
        LiveClassMessage(
            session_id=sess.id,
            user_id=current_user.id,
            actor_name=current_user.full_name,
            actor_role="provider",
            message_type="poll",
            content="Poll closed.",
            payload_json={"tally": tally},
        ),
    )
    db.commit()
    return {"closed": True, "tally": tally}


@router.post("/workspace/live-classes/{session_id}/recordings/init")
def provider_init_live_recording_upload(
    session_id: int,
    filename: str = Form(...),
    mime_type: str = Form("video/webm"),
    total_chunks: int = Form(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    _provider_live_session_or_404(db, provider.id, session_id)
    upload_id = f"{int(current_user.id)}_{int(datetime.now(timezone.utc).timestamp())}_{uuid4().hex[:12]}"
    _, upload_root = _live_recording_paths(session_id, upload_id)
    (upload_root / "chunks").mkdir(parents=True, exist_ok=True)
    meta = upload_root / "meta.json"
    meta.write_text(
        (
            "{"
            f"\"filename\":\"{_safe_filename(filename)}\","
            f"\"mime_type\":\"{mime_type}\","
            f"\"total_chunks\":{max(0, int(total_chunks or 0))},"
            f"\"uploaded\":[]"
            "}"
        ),
        encoding="utf-8",
    )
    return {"upload_id": upload_id}


@router.post("/workspace/live-classes/{session_id}/recordings/chunk")
def provider_upload_live_recording_chunk(
    session_id: int,
    upload_id: str = Form(...),
    index: int = Form(...),
    total_chunks: int = Form(0),
    is_last: bool = Form(False),
    chunk: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    _provider_live_session_or_404(db, provider.id, session_id)
    _, upload_root = _live_recording_paths(session_id, upload_id)
    chunks_dir = upload_root / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    if index < 0:
        raise HTTPException(status_code=400, detail="Invalid chunk index")
    part_path = chunks_dir / f"{int(index):06d}.part"
    with part_path.open("wb") as out:
        out.write(chunk.file.read())
    return {"received": True, "index": int(index), "total_chunks": int(total_chunks or 0), "is_last": bool(is_last)}


@router.post("/workspace/live-classes/{session_id}/recordings/complete")
def provider_complete_live_recording_upload(
    session_id: int,
    upload_id: str = Form(...),
    filename: str = Form("session_recording.webm"),
    mime_type: str = Form("video/webm"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    sess = _provider_live_session_or_404(db, provider.id, session_id)
    root, upload_root = _live_recording_paths(session_id, upload_id)
    chunks_dir = upload_root / "chunks"
    if not chunks_dir.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")
    parts = sorted(chunks_dir.glob("*.part"))
    if not parts:
        raise HTTPException(status_code=400, detail="No chunks uploaded")
    safe_name = _safe_filename(filename or "session_recording.webm")
    final_path = root / f"{upload_id}_{safe_name}"
    with final_path.open("wb") as out:
        for p in parts:
            out.write(p.read_bytes())
    settings = get_settings()
    if settings.resolved_object_storage_backend == "local":
        rel = final_path.relative_to(Path(settings.resolved_media_dir)).as_posix()
        file_url = f"/media/{rel}"
    else:
        file_url = upload_file_to_cloud_storage(
            final_path,
            object_path=f"live-recordings/{int(session_id)}/{final_path.name}",
            content_type=mime_type or "video/webm",
        )
    db.add(
        LiveClassMessage(
            session_id=sess.id,
            user_id=current_user.id,
            actor_name=current_user.full_name,
            actor_role="provider",
            message_type="system",
            content="Live class recording uploaded.",
            payload_json={"recording_url": file_url, "upload_id": upload_id},
        ),
    )
    db.commit()
    try:
        for p in parts:
            p.unlink(missing_ok=True)
        chunks_dir.rmdir()
    except Exception:
        pass
    return {"uploaded": True, "file_url": resolve_media_url(file_url) or file_url, "storage_ref": file_url}


@router.post("/workspace/live-class/{course_id}/complete")
def complete_live_class(
    course_id: int,
    note: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found. Select a valid course from your provider workspace.")
    if course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="You can only complete classes for your own courses.")
    db.add(LiveClassCompletion(course_id=course.id, provider_id=provider.id, note=note))
    enrollments = list(db.scalars(select(Enrollment).where(Enrollment.course_id == course.id)).all())
    for enr in enrollments:
        enr.exam_eligible = True
        enr.progress_pct = max(enr.progress_pct, 100)
    db.commit()
    return {"course_id": course.id, "students_unlocked": len(enrollments), "assessment_access": True}


@router.get("/workspace/feedback/comments")
def provider_comments(
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    query = (
        select(CourseComment, Course, User)
        .join(Course, Course.id == CourseComment.course_id)
        .join(User, User.id == CourseComment.student_id)
        .where(Course.provider_id == provider.id)
    )
    if status_filter:
        query = query.where(CourseComment.provider_status == str(status_filter).strip().lower())
    if search:
        like = f"%{str(search).strip()}%"
        query = query.where(
            (CourseComment.message.ilike(like))
            | (Course.title.ilike(like))
            | (User.full_name.ilike(like))
            | (User.email.ilike(like)),
        )
    rows = db.execute(query.order_by(CourseComment.created_at.desc())).all()
    return [
        {
            "comment_id": comment.id,
            "course_id": course.id,
            "course_title": course.title,
            "student_name": student.full_name,
            "student_email": student.email,
            "message": comment.message,
            "provider_status": comment.provider_status or "new",
            "provider_seen_at": comment.provider_seen_at,
            "provider_reply": comment.provider_reply,
            "created_at": comment.created_at,
            "replied_at": comment.replied_at,
        }
        for comment, course, student in rows
    ]


@router.post("/workspace/feedback/comments/{comment_id}/reply")
def provider_reply_comment(
    comment_id: int,
    payload: CourseCommentReply,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    comment = db.get(CourseComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    course = db.get(Course, comment.course_id)
    if not course or course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")
    comment.provider_reply = payload.reply
    comment.replied_at = datetime.now(timezone.utc)
    comment.provider_seen_at = comment.provider_seen_at or datetime.now(timezone.utc)
    if (comment.provider_status or "new") == "new":
        comment.provider_status = "pending"
    db.commit()
    return {"comment_id": comment.id, "replied": True}


@router.post("/workspace/feedback/comments/{comment_id}/status")
def provider_update_comment_status(
    comment_id: int,
    payload: ProviderComplaintStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    comment = db.get(CourseComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    course = db.get(Course, comment.course_id)
    if not course or course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")
    status_value = str(payload.status or "").strip().lower()
    if status_value not in {"new", "pending", "closed"}:
        raise HTTPException(status_code=400, detail="status must be new, pending, or closed")
    comment.provider_status = status_value
    comment.provider_seen_at = comment.provider_seen_at or datetime.now(timezone.utc)
    db.commit()
    return {"comment_id": comment.id, "status": comment.provider_status}


@router.post("/workspace/feedback/comments/{comment_id}/seen")
def provider_mark_comment_seen(
    comment_id: int,
    payload: ProviderFeedbackSeenUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    comment = db.get(CourseComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    course = db.get(Course, comment.course_id)
    if not course or course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if payload.seen:
        comment.provider_seen_at = datetime.now(timezone.utc)
    else:
        comment.provider_seen_at = None
        comment.provider_status = "new"
    db.commit()
    return {"comment_id": comment.id, "seen": bool(comment.provider_seen_at)}


@router.get("/workspace/feedback/ratings")
def provider_course_feedback(
    state: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    query = (
        select(CourseFeedback, Course, User)
        .join(Course, Course.id == CourseFeedback.course_id)
        .join(User, User.id == CourseFeedback.student_id)
        .where(Course.provider_id == provider.id)
    )
    if state == "new":
        query = query.where(CourseFeedback.provider_seen_at.is_(None))
    elif state == "old":
        query = query.where(CourseFeedback.provider_seen_at.is_not(None))
    rows = db.execute(query.order_by(CourseFeedback.created_at.desc())).all()
    return [
        {
            "feedback_id": fb.id,
            "course_id": course.id,
            "course_title": course.title,
            "student_name": student.full_name,
            "valuable_time_rating": fb.valuable_time_rating,
            "content_quality_rating": fb.content_quality_rating,
            "instructor_clarity_rating": fb.instructor_clarity_rating,
            "practical_usefulness_rating": fb.practical_usefulness_rating,
            "overall_rating": round(
                (
                    float(fb.valuable_time_rating or 0)
                    + float(fb.content_quality_rating or 0)
                    + float(fb.instructor_clarity_rating or 0)
                    + float(fb.practical_usefulness_rating or 0)
                ) / 4,
                2,
            ),
            "comment": fb.comment,
            "provider_seen_at": fb.provider_seen_at,
            "provider_reply": fb.provider_reply,
            "provider_replied_at": fb.provider_replied_at,
            "created_at": fb.created_at,
        }
        for fb, course, student in rows
    ]


@router.post("/workspace/feedback/ratings/{feedback_id}/reply")
def provider_reply_feedback(
    feedback_id: int,
    payload: CourseCommentReply,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    feedback = db.get(CourseFeedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    course = db.get(Course, feedback.course_id)
    if not course or course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")
    feedback.provider_reply = payload.reply
    feedback.provider_replied_at = datetime.now(timezone.utc)
    feedback.provider_seen_at = feedback.provider_seen_at or datetime.now(timezone.utc)
    db.commit()
    return {"feedback_id": feedback.id, "replied": True}


@router.post("/workspace/feedback/ratings/{feedback_id}/seen")
def provider_mark_feedback_seen(
    feedback_id: int,
    payload: ProviderFeedbackSeenUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    feedback = db.get(CourseFeedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    course = db.get(Course, feedback.course_id)
    if not course or course.provider_id != provider.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if payload.seen:
        feedback.provider_seen_at = datetime.now(timezone.utc)
    else:
        feedback.provider_seen_at = None
    db.commit()
    return {"feedback_id": feedback.id, "seen": bool(feedback.provider_seen_at)}


@router.get("/workspace/notifications")
def provider_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    items = list(
        db.scalars(
            select(ProviderNotification).where(ProviderNotification.provider_id == provider.id).order_by(ProviderNotification.created_at.desc()),
        ).all(),
    )
    return [
        {
            "id": n.id,
            "event_type": n.event_type,
            "message": n.message,
            "ref_type": n.ref_type,
            "ref_id": n.ref_id,
            "is_read": n.is_read,
            "created_at": n.created_at,
        }
        for n in items
    ]


@router.post("/workspace/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    note = db.get(ProviderNotification, notification_id)
    if not note or note.provider_id != provider.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    note.is_read = True
    db.commit()
    return {"notification_id": note.id, "is_read": True}


@router.get("/workspace/certifications")
def provider_certifications(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    rows = db.execute(
        select(Certificate, Course, User)
        .join(Course, Course.id == Certificate.course_id)
        .join(User, User.id == Certificate.student_id)
        .where(Certificate.provider_id == provider.id)
        .order_by(Certificate.issued_at.desc()),
    ).all()
    dirty = False
    for cert, _, _ in rows:
        try:
            prev_url = cert.pdf_url
            ensure_certificate_pdf(
                db,
                cert,
                force_regenerate=True,
                verification_base_url=_public_request_base_url(request),
            )
            dirty = dirty or (cert.pdf_url != prev_url)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=f"Certificate refresh failed: {exc}") from exc
    if dirty:
        db.commit()
    return [
        {
            "certificate_id": cert.certificate_id,
            "course_name": course.title,
            "student_name": student.full_name,
            "issued_at": cert.issued_at,
            "download_url": (
                resolve_media_url(cert.pdf_url)
                if resolve_media_url(cert.pdf_url)
                else None
            ),
            "verification_url": safe_certificate_verification_url(
                cert,
                base_url=_public_request_base_url(request),
            ),
        }
        for cert, course, student in rows
    ]
