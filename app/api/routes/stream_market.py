from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import (
    AuditLog,
    Course,
    CourseLesson,
    CoursePurchase,
    Creator,
    LessonVideo,
    LiveStreamSession,
    ProviderProfile,
    User,
    UserRole,
    VideoWatchProgress,
    VideoWatchSession,
)
from app.schemas import (
    StreamCourseCreate,
    StreamFairUsageOverrideRequest,
    StreamLessonCreate,
    StreamLicenseIssueRequest,
    StreamLicenseIssueResponse,
    StreamLiveSessionCreate,
    StreamPlaybackTokenRequest,
    StreamPricingRecommendationRequest,
    StreamPurchaseRequest,
    StreamBulkRevokeRequest,
    StreamSessionRevokeRequest,
    StreamVideoUploadInitResponse,
    StreamVideoUploadInitRequest,
    StreamWatchHeartbeatRequest,
)
from app.services.bunny_stream import (
    BunnyStreamError,
    build_playback_urls,
    create_direct_upload,
    generate_playback_token,
    get_video_details,
    is_configured,
    upload_video_content,
)
from app.services.fair_usage import evaluate_fair_usage, log_fair_usage_transition
from app.services.pricing_recommendation import analytics_total_uploaded_minutes, pricing_recommendation_for_course
from app.services.stream_drm import StreamDrmError, issue_stream_license, verify_stream_license

router = APIRouter(prefix="/stream", tags=["stream-market"])
_drm_nonce_cache: dict[str, datetime] = {}
_drm_event_dedupe_cache: dict[str, datetime] = {}


def _provider_profile_or_403(db: Session, user_id: int) -> ProviderProfile:
    p = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == int(user_id)))
    if not p:
        raise HTTPException(status_code=403, detail="Provider profile required")
    return p


def _creator_for_user(db: Session, user: User) -> Creator:
    creator = db.scalar(select(Creator).where(Creator.user_id == int(user.id)))
    if creator:
        return creator
    creator = Creator(user_id=int(user.id), display_name=user.full_name)
    db.add(creator)
    db.flush()
    return creator


def _must_have_course_purchase(db: Session, *, user_id: int, course_id: int) -> CoursePurchase:
    purchase = db.scalar(
        select(CoursePurchase).where(
            and_(
                CoursePurchase.user_id == int(user_id),
                CoursePurchase.course_id == int(course_id),
                CoursePurchase.status == "paid",
            ),
        ),
    )
    if not purchase:
        raise HTTPException(status_code=403, detail="Course not purchased")
    return purchase


def _drm_nonce_key(*, session_id: int, nonce: str) -> str:
    return f"{int(session_id)}:{str(nonce).strip()}"


def _ua_fingerprint(value: str) -> str:
    raw = str(value or "").encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:16]


def _assert_fresh_drm_nonce(*, session_id: int, nonce: str) -> None:
    now = datetime.now(timezone.utc)
    ttl_seconds = max(30, int(get_settings().stream_drm_nonce_ttl_seconds or 240))
    cutoff = now - timedelta(seconds=ttl_seconds)

    expired_keys = [k for k, v in _drm_nonce_cache.items() if v < cutoff]
    for key in expired_keys:
        _drm_nonce_cache.pop(key, None)

    key = _drm_nonce_key(session_id=session_id, nonce=nonce)
    last_seen = _drm_nonce_cache.get(key)
    if last_seen and last_seen >= cutoff:
        raise HTTPException(status_code=409, detail="Duplicate stream heartbeat detected")
    _drm_nonce_cache[key] = now


def _drm_event_dedupe(event_key: str, ttl_seconds: int = 300) -> bool:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=max(30, int(ttl_seconds)))
    expired_keys = [k for k, v in _drm_event_dedupe_cache.items() if v < cutoff]
    for k in expired_keys:
        _drm_event_dedupe_cache.pop(k, None)
    if _drm_event_dedupe_cache.get(event_key):
        return False
    _drm_event_dedupe_cache[event_key] = now
    return True


def _revoke_watch_session(
    db: Session,
    *,
    session: VideoWatchSession,
    actor_user_id: int | None,
    reason: str,
    details: dict | None = None,
) -> None:
    if not session.ended_at:
        session.ended_at = datetime.now(timezone.utc)
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action="stream_session_revoked",
            target_type="video_watch_session",
            target_id=int(session.id),
            details_json={
                "reason": str(reason or "revoked"),
                "user_id": int(session.user_id),
                "course_id": int(session.course_id),
                "lesson_video_id": int(session.lesson_video_id),
                **(details or {}),
            },
        ),
    )


@router.post("/courses")
def create_stream_course(
    payload: StreamCourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_403(db, current_user.id)
    _creator_for_user(db, current_user)
    course = Course(
        provider_id=profile.id,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        includes_certification_exam=False,
        is_published=False,
        fair_usage_multiplier=float(payload.fair_usage_multiplier or 2.5),
    )
    db.add(course)
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="stream_course_created",
            target_type="course",
            target_id=None,
            details_json={"title": payload.title, "category": payload.category},
        ),
    )
    db.commit()
    db.refresh(course)
    return {
        "course_id": course.id,
        "title": course.title,
        "is_published": course.is_published,
        "fair_usage_multiplier": course.fair_usage_multiplier,
    }


@router.post("/courses/{course_id}/lessons")
def create_stream_lesson(
    course_id: int,
    payload: StreamLessonCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    _provider_profile_or_403(db, current_user.id)
    course = db.get(Course, int(course_id))
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    lesson = CourseLesson(
        course_id=course.id,
        title=payload.title,
        position=int(payload.position),
        created_by_user_id=current_user.id,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return {"lesson_id": lesson.id, "course_id": course.id, "title": lesson.title, "position": lesson.position}


@router.get("/courses/{course_id}/lessons")
def list_stream_lessons(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.PROVIDER, UserRole.ADMIN)),
):
    if current_user.role == UserRole.STUDENT:
        _must_have_course_purchase(db, user_id=current_user.id, course_id=int(course_id))
    lessons = db.scalars(select(CourseLesson).where(CourseLesson.course_id == int(course_id)).order_by(CourseLesson.position.asc())).all()
    lesson_ids = [int(x.id) for x in lessons]
    videos = db.scalars(
        select(LessonVideo).where(LessonVideo.lesson_id.in_(lesson_ids) if lesson_ids else False).order_by(LessonVideo.created_at.asc()),
    ).all()
    vids_by_lesson: dict[int, list[LessonVideo]] = {}
    for v in videos:
        vids_by_lesson.setdefault(int(v.lesson_id), []).append(v)
    return {
        "course_id": int(course_id),
        "lessons": [
            {
                "lesson_id": int(ls.id),
                "title": ls.title,
                "position": int(ls.position),
                "videos": [
                    {
                        "lesson_video_id": int(v.id),
                        "internal_id": v.internal_id,
                        "ready": bool(v.ready_status),
                        "duration_seconds": int(v.duration_seconds or 0),
                        "thumbnail_url": v.thumbnail_url,
                    }
                    for v in vids_by_lesson.get(int(ls.id), [])
                ],
            }
            for ls in lessons
        ],
    }


@router.post("/videos/upload-init", response_model=StreamVideoUploadInitResponse)
def init_stream_video_upload(
    payload: StreamVideoUploadInitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    _provider_profile_or_403(db, current_user.id)
    creator = _creator_for_user(db, current_user)
    lesson = db.get(CourseLesson, int(payload.lesson_id))
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    if not is_configured():
        raise HTTPException(status_code=503, detail="Bunny Stream is not configured")

    internal_id = uuid.uuid4().hex
    try:
        direct = create_direct_upload(
            max_duration_seconds=payload.max_duration_seconds,
            metadata={
                "lesson_id": str(lesson.id),
                "course_id": str(lesson.course_id),
                "creator_id": str(creator.id),
                "internal_id": internal_id,
            },
        )
    except BunnyStreamError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    row = LessonVideo(
        course_id=int(lesson.course_id),
        lesson_id=int(lesson.id),
        creator_id=int(creator.id),
        internal_id=internal_id,
        cloudflare_video_uid=direct["uid"],
        upload_status="pending",
        ready_status=False,
        duration_seconds=0,
        direct_upload_url=direct["upload_url"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return StreamVideoUploadInitResponse(
        lesson_video_id=row.id,
        internal_id=row.internal_id,
        cloudflare_video_uid=row.cloudflare_video_uid,
        upload_url=f"/stream/videos/{row.id}/upload",
        expires_at=direct.get("expires_at"),
        status=row.upload_status,
    )


@router.put("/videos/{lesson_video_id}/upload")
@router.post("/videos/{lesson_video_id}/upload")
async def upload_stream_video_content(
    lesson_video_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    row = db.get(LessonVideo, int(lesson_video_id))
    if not row:
        raise HTTPException(status_code=404, detail="Lesson video not found")

    if current_user.role == UserRole.PROVIDER:
        profile = _provider_profile_or_403(db, current_user.id)
        lesson = db.get(CourseLesson, int(row.lesson_id))
        course = db.get(Course, int(lesson.course_id)) if lesson else None
        if not course or int(course.provider_id) != int(profile.id):
            raise HTTPException(status_code=403, detail="Access denied")

    raw_content_type = str(request.headers.get("content-type") or "").lower()
    body = b""
    content_type = "application/octet-stream"

    if "multipart/form-data" in raw_content_type:
        form = await request.form()
        up = form.get("file")
        if not isinstance(up, UploadFile) and not hasattr(up, "read"):
            raise HTTPException(status_code=400, detail="Missing file in multipart body")
        body = await up.read()
        content_type = up.content_type or content_type
    else:
        body = await request.body()
        content_type = request.headers.get("content-type") or content_type

    if not body:
        raise HTTPException(status_code=400, detail="Upload body is empty")

    try:
        upload_video_content(video_uid=row.cloudflare_video_uid, body=body, content_type=content_type)
    except BunnyStreamError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    row.upload_status = "processing"
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "lesson_video_id": row.id,
        "upload_status": row.upload_status,
    }


@router.get("/videos/{lesson_video_id}/status")
def stream_video_status(
    lesson_video_id: int,
    sync: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    row = db.get(LessonVideo, int(lesson_video_id))
    if not row:
        raise HTTPException(status_code=404, detail="Lesson video not found")

    if sync:
        try:
            details = get_video_details(row.cloudflare_video_uid)
            row.upload_status = details["upload_status"]
            row.ready_status = bool(details["ready"])
            row.duration_seconds = int(details["duration_seconds"])
            if details.get("thumbnail_url"):
                row.thumbnail_url = details["thumbnail_url"]
            db.commit()
            db.refresh(row)
        except BunnyStreamError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "lesson_video_id": row.id,
        "internal_id": row.internal_id,
        "cloudflare_video_uid": row.cloudflare_video_uid,
        "upload_status": row.upload_status,
        "ready_status": row.ready_status,
        "duration_seconds": int(row.duration_seconds or 0),
        "thumbnail_url": row.thumbnail_url,
        "updated_at": row.updated_at,
    }


@router.post("/webhooks/bunny")
@router.post("/webhooks/cloudflare")
async def bunny_stream_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    payload = await request.json()
    event = str(payload.get("type") or payload.get("event") or "stream.unknown")
    data = payload.get("data") or payload.get("result") or payload
    uid = str(
        data.get("guid")
        or data.get("videoGuid")
        or data.get("videoId")
        or data.get("uid")
        or data.get("videoUID")
        or "",
    ).strip()
    if not uid:
        return {"ok": True, "ignored": True}

    row = db.scalar(select(LessonVideo).where(LessonVideo.cloudflare_video_uid == uid))
    if not row:
        return {"ok": True, "ignored": True}

    raw_status = data.get("status")
    if isinstance(raw_status, dict):
        state = str(raw_status.get("state") or "").strip().lower()
    else:
        state = str(raw_status or "").strip().lower()
    encode_progress = float(data.get("encodeProgress") or 0.0)
    ready = bool(data.get("readyToStream") or (state == "ready") or ("ready" in event) or encode_progress >= 100.0)
    if not state:
        state = "ready" if ready else ("processing" if encode_progress > 0 else "pending")
    duration = int(float(data.get("duration") or row.duration_seconds or 0))
    thumbnail = data.get("preview") or row.thumbnail_url

    row.upload_status = state or row.upload_status
    row.ready_status = ready or row.ready_status
    row.duration_seconds = duration
    if thumbnail:
        row.thumbnail_url = str(thumbnail)

    db.add(
        AuditLog(
            actor_user_id=None,
            action="bunny_stream_webhook",
            target_type="lesson_video",
            target_id=row.id,
            details_json={"event": event, "uid": uid, "state": row.upload_status, "ready": row.ready_status},
        ),
    )
    db.commit()
    return {"ok": True, "lesson_video_id": row.id, "ready": row.ready_status}


@router.post("/purchases")
def create_course_purchase(
    payload: StreamPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.ADMIN)),
):
    course = db.get(Course, int(payload.course_id))
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    existing = db.scalar(
        select(CoursePurchase).where(
            and_(CoursePurchase.user_id == current_user.id, CoursePurchase.course_id == course.id),
        ),
    )
    if existing and existing.status == "paid":
        return {"purchase_id": existing.id, "status": existing.status, "course_id": course.id, "already_purchased": True}

    # Payment gateway verification hook (replace with real gateway verification in production)
    if float(payload.price_amount or 0) > 0 and not str(payload.payment_ref or "").strip():
        raise HTTPException(status_code=400, detail="payment_ref is required for paid purchase")

    if not existing:
        existing = CoursePurchase(
            user_id=current_user.id,
            course_id=course.id,
            price_amount=float(payload.price_amount),
            currency=str(payload.currency or "INR").upper(),
            payment_ref=(payload.payment_ref or None),
            status="paid",
        )
        db.add(existing)
    else:
        existing.price_amount = float(payload.price_amount)
        existing.currency = str(payload.currency or "INR").upper()
        existing.payment_ref = payload.payment_ref or existing.payment_ref
        existing.status = "paid"

    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="course_purchase",
            target_type="course",
            target_id=course.id,
            details_json={"amount": float(payload.price_amount), "currency": str(payload.currency or "INR").upper()},
        ),
    )
    db.commit()
    db.refresh(existing)
    return {"purchase_id": existing.id, "status": existing.status, "course_id": course.id, "already_purchased": False}


@router.get("/courses/{course_id}/entitlement")
def course_entitlement(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.ADMIN, UserRole.PROVIDER)),
):
    entitled = False
    if current_user.role in {UserRole.ADMIN, UserRole.PROVIDER}:
        entitled = True
    else:
        purchase = db.scalar(
            select(CoursePurchase).where(
                and_(CoursePurchase.user_id == current_user.id, CoursePurchase.course_id == int(course_id), CoursePurchase.status == "paid"),
            ),
        )
        entitled = bool(purchase)
    usage = evaluate_fair_usage(db, user_id=current_user.id, course_id=int(course_id)) if entitled else None
    return {"course_id": int(course_id), "entitled": entitled, "fair_usage": usage}


@router.post("/playback/token")
def issue_stream_playback_token(
    payload: StreamPlaybackTokenRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.ADMIN, UserRole.PROVIDER)),
):
    video = db.get(LessonVideo, int(payload.lesson_video_id))
    if not video:
        raise HTTPException(status_code=404, detail="Lesson video not found")
    if not video.ready_status:
        raise HTTPException(status_code=409, detail="Video is not ready yet")

    if current_user.role not in {UserRole.ADMIN, UserRole.PROVIDER}:
        _must_have_course_purchase(db, user_id=current_user.id, course_id=int(video.course_id))

    usage_before = evaluate_fair_usage(db, user_id=current_user.id, course_id=int(video.course_id))
    if current_user.role not in {UserRole.ADMIN, UserRole.PROVIDER} and (
        int(usage_before.get("allowance_seconds") or 0) > 0
        and int(usage_before.get("consumed_seconds") or 0) >= int(usage_before.get("allowance_seconds") or 0)
    ):
        raise HTTPException(
            status_code=402,
            detail={
                "message": "Maximum watch allowance reached for this course. Please buy credits to continue watching.",
                "credits_required": True,
                "fair_usage": usage_before,
            },
        )

    playback_ttl = max(60, int(get_settings().stream_playback_token_ttl_seconds or 900))
    try:
        token = generate_playback_token(
            video_uid=video.cloudflare_video_uid,
            user_id=current_user.id,
            course_id=video.course_id,
            ttl_seconds=playback_ttl,
        )
        urls = build_playback_urls(video_uid=video.cloudflare_video_uid, token=token)
    except BunnyStreamError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    progress = db.scalar(
        select(VideoWatchProgress).where(
            and_(VideoWatchProgress.user_id == current_user.id, VideoWatchProgress.lesson_video_id == video.id),
        ),
    )
    resume_position = int(progress.resume_position_seconds) if progress else 0

    max_sessions = max(1, int(get_settings().stream_drm_max_concurrent_sessions_per_course or 2))
    active_sessions = db.scalars(
        select(VideoWatchSession)
        .where(
            and_(
                VideoWatchSession.user_id == int(current_user.id),
                VideoWatchSession.course_id == int(video.course_id),
                VideoWatchSession.ended_at.is_(None),
            ),
        )
        .order_by(VideoWatchSession.started_at.asc()),
    ).all()
    if len(active_sessions) >= max_sessions:
        to_revoke_count = len(active_sessions) - max_sessions + 1
        for stale in active_sessions[:to_revoke_count]:
            _revoke_watch_session(
                db,
                session=stale,
                actor_user_id=current_user.id,
                reason="max_concurrent_sessions_exceeded",
                details={"max_sessions": max_sessions},
            )

    session = VideoWatchSession(
        user_id=current_user.id,
        course_id=video.course_id,
        lesson_id=video.lesson_id,
        lesson_video_id=video.id,
        client_app=str(payload.client_app or "web"),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    license_token, license_ttl = issue_stream_license(
        user_id=current_user.id,
        course_id=video.course_id,
        lesson_video_id=video.id,
        session_id=session.id,
        client_app=str(payload.client_app or "web"),
    )

    return {
        "session_id": session.id,
        "lesson_video_id": video.id,
        "video_uid": video.cloudflare_video_uid,
        "playback": urls,
        "expires_in_seconds": playback_ttl,
        "drm_license_token": license_token,
        "drm_license_expires_in_seconds": int(license_ttl),
        "resume_position_seconds": resume_position,
        "fair_usage": usage_before,
    }


@router.post("/license/issue", response_model=StreamLicenseIssueResponse)
def issue_stream_license_token(
    payload: StreamLicenseIssueRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.ADMIN, UserRole.PROVIDER)),
):
    sess = db.get(VideoWatchSession, int(payload.session_id))
    if not sess or int(sess.user_id) != int(current_user.id):
        raise HTTPException(status_code=404, detail="Watch session not found")
    if int(sess.lesson_video_id) != int(payload.lesson_video_id):
        raise HTTPException(status_code=400, detail="Session lesson video mismatch")
    token, ttl = issue_stream_license(
        user_id=current_user.id,
        course_id=sess.course_id,
        lesson_video_id=sess.lesson_video_id,
        session_id=sess.id,
        client_app=str(payload.client_app or "web"),
    )
    return StreamLicenseIssueResponse(
        license_token=token,
        expires_in_seconds=int(ttl),
    )


@router.post("/watch/heartbeat")
def stream_watch_heartbeat(
    payload: StreamWatchHeartbeatRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.ADMIN, UserRole.PROVIDER)),
):
    sess = db.get(VideoWatchSession, int(payload.session_id))
    if not sess or int(sess.user_id) != int(current_user.id):
        raise HTTPException(status_code=404, detail="Watch session not found")
    if sess.ended_at and not payload.ended:
        raise HTTPException(status_code=410, detail="Watch session has ended")
    if int(payload.lesson_video_id) != int(sess.lesson_video_id):
        raise HTTPException(status_code=400, detail="Session lesson video mismatch")

    if bool(get_settings().stream_drm_enforce_heartbeat):
        if not str(payload.drm_license_token or "").strip():
            raise HTTPException(status_code=401, detail="DRM license token required")
        if not str(payload.drm_heartbeat_nonce or "").strip():
            raise HTTPException(status_code=400, detail="DRM heartbeat nonce required")
        try:
            verify_stream_license(
                token=str(payload.drm_license_token),
                user_id=current_user.id,
                course_id=sess.course_id,
                lesson_video_id=sess.lesson_video_id,
                session_id=sess.id,
                client_app=str(sess.client_app or "web"),
            )
            _assert_fresh_drm_nonce(session_id=sess.id, nonce=str(payload.drm_heartbeat_nonce))
        except StreamDrmError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc

    req_ip = str(request.client.host or "").strip() if request.client else ""
    req_ua = str(request.headers.get("user-agent") or "").strip()
    auto_revoke_ip = bool(get_settings().stream_drm_auto_revoke_on_ip_mismatch)
    auto_revoke_ua = bool(get_settings().stream_drm_auto_revoke_on_user_agent_mismatch)

    if sess.ip_address and req_ip and str(sess.ip_address) != req_ip:
        event_key = f"ip:{sess.id}:{sess.ip_address}->{req_ip}"
        if _drm_event_dedupe(event_key):
            db.add(
                AuditLog(
                    actor_user_id=current_user.id,
                    action="stream_drm_anomaly",
                    target_type="video_watch_session",
                    target_id=int(sess.id),
                    details_json={
                        "reason": "ip_mismatch",
                        "old_ip": str(sess.ip_address),
                        "new_ip": req_ip,
                        "course_id": int(sess.course_id),
                        "lesson_video_id": int(sess.lesson_video_id),
                    },
                ),
            )
        if auto_revoke_ip:
            _revoke_watch_session(
                db,
                session=sess,
                actor_user_id=current_user.id,
                reason="ip_mismatch",
                details={"old_ip": str(sess.ip_address), "new_ip": req_ip},
            )
            db.commit()
            raise HTTPException(status_code=403, detail="Session revoked due to IP mismatch")

    if sess.user_agent and req_ua and str(sess.user_agent) != req_ua:
        old_ua_fp = _ua_fingerprint(str(sess.user_agent))
        new_ua_fp = _ua_fingerprint(req_ua)
        event_key = f"ua:{sess.id}:{old_ua_fp}:{new_ua_fp}"
        if _drm_event_dedupe(event_key):
            db.add(
                AuditLog(
                    actor_user_id=current_user.id,
                    action="stream_drm_anomaly",
                    target_type="video_watch_session",
                    target_id=int(sess.id),
                    details_json={
                        "reason": "user_agent_mismatch",
                        "old_user_agent_hash": old_ua_fp,
                        "new_user_agent_hash": new_ua_fp,
                        "course_id": int(sess.course_id),
                        "lesson_video_id": int(sess.lesson_video_id),
                    },
                ),
            )
        if auto_revoke_ua:
            _revoke_watch_session(
                db,
                session=sess,
                actor_user_id=current_user.id,
                reason="user_agent_mismatch",
                details={"old_user_agent_hash": old_ua_fp, "new_user_agent_hash": new_ua_fp},
            )
            db.commit()
            raise HTTPException(status_code=403, detail="Session revoked due to device fingerprint mismatch")

    before_usage = evaluate_fair_usage(db, user_id=current_user.id, course_id=sess.course_id)
    old_level = int(before_usage.get("warning_level") or 0)

    delta = int(payload.watched_seconds_delta or 0)
    sess.consumed_seconds = int(sess.consumed_seconds or 0) + max(0, delta)
    sess.last_position_seconds = max(int(sess.last_position_seconds or 0), int(payload.position_seconds or 0))
    sess.ip_address = req_ip or sess.ip_address
    sess.user_agent = req_ua or sess.user_agent
    if payload.ended:
        sess.ended_at = datetime.now(timezone.utc)

    progress = db.scalar(
        select(VideoWatchProgress).where(
            and_(VideoWatchProgress.user_id == current_user.id, VideoWatchProgress.lesson_video_id == int(sess.lesson_video_id)),
        ),
    )
    if not progress:
        progress = VideoWatchProgress(
            user_id=current_user.id,
            course_id=sess.course_id,
            lesson_id=sess.lesson_id,
            lesson_video_id=sess.lesson_video_id,
            total_watched_seconds=max(0, delta),
            resume_position_seconds=max(0, int(payload.position_seconds or 0)),
            completion_ratio=0,
        )
        db.add(progress)
    else:
        progress.total_watched_seconds = int(progress.total_watched_seconds or 0) + max(0, delta)
        progress.resume_position_seconds = max(int(progress.resume_position_seconds or 0), int(payload.position_seconds or 0))

    video = db.get(LessonVideo, int(payload.lesson_video_id))
    if not video:
        video = db.get(LessonVideo, int(sess.lesson_video_id))
    duration = int(video.duration_seconds or 0) if video else 0
    if duration > 0:
        progress.completion_ratio = min(1.0, float(progress.resume_position_seconds) / float(duration))

    db.commit()

    after_usage = evaluate_fair_usage(db, user_id=current_user.id, course_id=sess.course_id)
    new_level = int(after_usage.get("warning_level") or 0)

    progress.usage_warning_level = new_level
    log_fair_usage_transition(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        course_id=sess.course_id,
        old_level=old_level,
        new_level=new_level,
        usage_snapshot=after_usage,
    )
    db.commit()

    return {
        "ok": True,
        "session_id": sess.id,
        "consumed_seconds": int(sess.consumed_seconds or 0),
        "resume_position_seconds": int(progress.resume_position_seconds or 0),
        "playback_allowed": "credits_required" not in set(after_usage.get("status_flags") or []),
        "credits_required": "credits_required" in set(after_usage.get("status_flags") or []),
        "fair_usage": after_usage,
    }


@router.post("/courses/{course_id}/pricing-recommendation")
def stream_pricing_recommendation(
    course_id: int,
    payload: StreamPricingRecommendationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    course = db.get(Course, int(course_id))
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return pricing_recommendation_for_course(
        db,
        course_id=course.id,
        entered_price=float(payload.entered_price),
        expected_views_per_month=int(payload.expected_views_per_month),
    )


@router.patch("/admin/watch-sessions/{session_id}/revoke")
def admin_revoke_watch_session(
    session_id: int,
    payload: StreamSessionRevokeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    sess = db.get(VideoWatchSession, int(session_id))
    if not sess:
        raise HTTPException(status_code=404, detail="Watch session not found")
    _revoke_watch_session(
        db,
        session=sess,
        actor_user_id=current_user.id,
        reason=str(payload.reason or "admin_revoke"),
    )
    db.commit()
    return {
        "ok": True,
        "session_id": int(sess.id),
        "revoked": True,
        "ended_at": sess.ended_at,
        "reason": str(payload.reason or "admin_revoke"),
    }


@router.get("/admin/security-events")
def stream_admin_security_events(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    max_limit = max(1, min(500, int(limit or 100)))
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.action.in_(
                [
                    "stream_drm_anomaly",
                    "stream_session_revoked",
                ],
            ),
        )
        .order_by(AuditLog.id.desc())
        .limit(max_limit),
    ).all()
    return {
        "events": [
            {
                "id": int(x.id),
                "action": str(x.action),
                "target_type": str(x.target_type or ""),
                "target_id": int(x.target_id) if x.target_id is not None else None,
                "actor_user_id": int(x.actor_user_id) if x.actor_user_id is not None else None,
                "details": x.details_json or {},
                "created_at": x.created_at,
            }
            for x in rows
        ],
    }


@router.patch("/admin/users/{user_id}/revoke-sessions")
def admin_revoke_user_sessions(
    user_id: int,
    payload: StreamBulkRevokeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    where_clause = [VideoWatchSession.user_id == int(user_id), VideoWatchSession.ended_at.is_(None)]
    if payload.course_id is not None:
        where_clause.append(VideoWatchSession.course_id == int(payload.course_id))
    sessions = db.scalars(
        select(VideoWatchSession).where(and_(*where_clause)),
    ).all()
    revoked = 0
    for sess in sessions:
        _revoke_watch_session(
            db,
            session=sess,
            actor_user_id=current_user.id,
            reason=str(payload.reason or "security_incident"),
            details={"bulk_revoke": True},
        )
        revoked += 1
    db.commit()
    return {
        "ok": True,
        "user_id": int(user_id),
        "course_id": int(payload.course_id) if payload.course_id is not None else None,
        "revoked_sessions": int(revoked),
    }


@router.post("/live/sessions")
def create_live_session_stub(
    payload: StreamLiveSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    creator = _creator_for_user(db, current_user)
    row = LiveStreamSession(
        creator_id=creator.id,
        course_id=payload.course_id,
        title=payload.title,
        status="draft",
        scheduled_start_at=payload.scheduled_start_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "live_session_id": row.id,
        "status": row.status,
        "title": row.title,
        "scheduled_start_at": row.scheduled_start_at,
    }


@router.get("/admin/analytics")
def stream_admin_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    uploaded_minutes = analytics_total_uploaded_minutes(db)
    watched_minutes = round(
        float(
            (db.scalar(select(func.coalesce(func.sum(VideoWatchProgress.total_watched_seconds), 0))) or 0) / 60.0,
        ),
        2,
    )

    most_watched_courses_rows = db.execute(
        select(VideoWatchProgress.course_id, func.coalesce(func.sum(VideoWatchProgress.total_watched_seconds), 0).label("watched"))
        .group_by(VideoWatchProgress.course_id)
        .order_by(func.coalesce(func.sum(VideoWatchProgress.total_watched_seconds), 0).desc())
        .limit(10),
    ).all()

    users_exceeding = []
    course_ids = [int(row[0]) for row in most_watched_courses_rows]
    if course_ids:
        progress_rows = db.execute(
            select(VideoWatchProgress.user_id, VideoWatchProgress.course_id, func.coalesce(func.sum(VideoWatchProgress.total_watched_seconds), 0))
            .where(VideoWatchProgress.course_id.in_(course_ids))
            .group_by(VideoWatchProgress.user_id, VideoWatchProgress.course_id),
        ).all()
        for uid, cid, _ in progress_rows:
            usage = evaluate_fair_usage(db, user_id=int(uid), course_id=int(cid))
            if int(usage.get("warning_level") or 0) >= 2:
                users_exceeding.append({"user_id": int(uid), "course_id": int(cid), "usage": usage})

    creators_rows = db.execute(
        select(LessonVideo.creator_id, func.coalesce(func.sum(LessonVideo.duration_seconds), 0).label("seconds"))
        .group_by(LessonVideo.creator_id)
        .order_by(func.coalesce(func.sum(LessonVideo.duration_seconds), 0).desc())
        .limit(10),
    ).all()

    completion_rows = db.execute(
        select(VideoWatchProgress.course_id, func.avg(VideoWatchProgress.completion_ratio))
        .group_by(VideoWatchProgress.course_id),
    ).all()

    return {
        "total_uploaded_minutes": uploaded_minutes,
        "total_watched_minutes": watched_minutes,
        "most_watched_courses": [
            {"course_id": int(cid), "watched_minutes": round(float(sec or 0) / 60.0, 2)}
            for cid, sec in most_watched_courses_rows
        ],
        "users_exceeding_fair_usage": users_exceeding,
        "creators_highest_streaming_consumption": [
            {"creator_id": int(cid), "uploaded_minutes": round(float(sec or 0) / 60.0, 2)}
            for cid, sec in creators_rows
        ],
        "course_completion_rate": [
            {"course_id": int(cid), "avg_completion_pct": round(float(avg or 0) * 100.0, 2)}
            for cid, avg in completion_rows
        ],
    }


@router.patch("/admin/courses/{course_id}/fair-usage")
def admin_update_fair_usage(
    course_id: int,
    payload: StreamFairUsageOverrideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    course = db.get(Course, int(course_id))
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if payload.fair_usage_multiplier is not None:
        course.fair_usage_multiplier = float(payload.fair_usage_multiplier)
    course.admin_fair_usage_override_enabled = bool(payload.override_enabled)
    course.fair_usage_override_seconds = int(payload.override_seconds) if payload.override_seconds else None
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="fair_usage_override_updated",
            target_type="course",
            target_id=course.id,
            details_json={
                "fair_usage_multiplier": course.fair_usage_multiplier,
                "override_enabled": course.admin_fair_usage_override_enabled,
                "override_seconds": course.fair_usage_override_seconds,
            },
        ),
    )
    db.commit()
    return {
        "course_id": course.id,
        "fair_usage_multiplier": course.fair_usage_multiplier,
        "override_enabled": course.admin_fair_usage_override_enabled,
        "override_seconds": course.fair_usage_override_seconds,
    }
