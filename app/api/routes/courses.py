from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import Course, CourseModule, Lesson, LiveClassSession, ProviderProfile, Resource, User, UserRole
from app.schemas import CourseCreate, CourseOut, CourseUpdate, LessonCreate, ModuleCreate, ResourceCreate
from app.services.media_storage import delete_storage_reference, normalize_image_storage_reference, resolve_media_url

router = APIRouter(prefix="/courses", tags=["courses"])


def _provider_profile_or_404(db: Session, user_id: int) -> ProviderProfile:
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    if not profile:
        raise HTTPException(status_code=404, detail="Provider profile not found")
    return profile


def _can_delete_course(db: Session, course: Course, current_user: User) -> bool:
    if current_user.role == UserRole.ADMIN and str(current_user.email or "").strip().lower() == "admin@certora.in":
        return True
    if current_user.role != UserRole.PROVIDER:
        return False
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == current_user.id))
    return bool(profile and course.provider_id == profile.id)


def _course_out_payload(course: Course) -> dict:
    out = CourseOut.model_validate(course).model_dump()
    out["thumbnail_url"] = resolve_media_url(course.thumbnail_url) or course.thumbnail_url
    out["intro_video_url"] = resolve_media_url(course.intro_video_url) or course.intro_video_url
    out["preview_video_url"] = resolve_media_url(course.preview_video_url) or course.preview_video_url
    out["main_video_url"] = resolve_media_url(course.main_video_url) or course.main_video_url
    return out


def _pricing_breakdown_from_base(base_price_amount: float) -> dict:
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


def _cleanup_storage_refs(refs: set[str]) -> None:
    for ref in refs:
        try:
            delete_storage_reference(ref)
        except Exception:
            # Storage cleanup should not block business workflow.
            pass


@router.post("", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    if float(payload.base_price_amount or 0.0) <= 0:
        raise HTTPException(status_code=400, detail="Course price is required and must be greater than 0.")
    intro_video_url = str(payload.intro_video_url or "").strip()
    if not intro_video_url:
        raise HTTPException(status_code=400, detail="Intro video URL is required.")
    preview_video_url = str(payload.preview_video_url or "").strip() or intro_video_url
    main_video_url = str(payload.main_video_url or "").strip() or None
    try:
        thumbnail_ref = normalize_image_storage_reference(
            payload.thumbnail_url,
            object_prefix=f"course-thumbnails/provider-{profile.id}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid course thumbnail: {exc}") from exc
    course = Course(
        provider_id=profile.id,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        suitable_age_ranges=list(payload.suitable_age_ranges or []),
        thumbnail_url=thumbnail_ref,
        intro_video_url=intro_video_url,
        preview_video_url=preview_video_url,
        main_video_url=main_video_url,
        includes_certification_exam=payload.includes_certification_exam,
        **_pricing_breakdown_from_base(float(payload.base_price_amount or 0.0)),
        is_published=False,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return _course_out_payload(course)


@router.put("/{course_id}", response_model=CourseOut)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    course = db.get(Course, course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=404, detail="Course not found")

    updates = payload.model_dump(exclude_none=True)
    if "suitable_age_ranges" in updates:
        updates["suitable_age_ranges"] = list(payload.suitable_age_ranges or [])
    if "thumbnail_url" in updates:
        try:
            updates["thumbnail_url"] = normalize_image_storage_reference(
                updates.get("thumbnail_url"),
                object_prefix=f"course-thumbnails/provider-{profile.id}",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid course thumbnail: {exc}") from exc
    if "intro_video_url" in updates:
        updates["intro_video_url"] = str(updates.get("intro_video_url") or "").strip() or None
    if "preview_video_url" in updates:
        updates["preview_video_url"] = str(updates.get("preview_video_url") or "").strip() or None
    if "main_video_url" in updates:
        updates["main_video_url"] = str(updates.get("main_video_url") or "").strip() or None

    for key, value in updates.items():
        if key in {
            "base_price_amount",
            "price_currency",
            "gst_rate",
            "platform_commission_rate",
            "hosting_fee_amount",
            "gst_amount",
            "platform_commission_amount",
            "final_price_amount",
        }:
            continue
        setattr(course, key, value)
    if "base_price_amount" in updates:
        breakdown = _pricing_breakdown_from_base(float(payload.base_price_amount or 0.0))
        for key, value in breakdown.items():
            setattr(course, key, value)
    db.commit()
    db.refresh(course)
    return _course_out_payload(course)


@router.get("", response_model=list[CourseOut])
def list_courses(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == UserRole.PROVIDER:
        profile = _provider_profile_or_404(db, user.id)
        courses = db.scalars(select(Course).where(Course.provider_id == profile.id)).all()
        return [_course_out_payload(c) for c in courses]
    if user.role == UserRole.ADMIN:
        courses = db.scalars(select(Course).order_by(Course.created_at.desc())).all()
        return [_course_out_payload(c) for c in courses]
    courses = db.scalars(select(Course).where(Course.is_published.is_(True))).all()
    return [_course_out_payload(c) for c in courses]


@router.get("/public", response_model=list[CourseOut])
def public_courses(db: Session = Depends(get_db)):
    courses = db.scalars(select(Course).where(Course.is_published.is_(True))).all()
    return [_course_out_payload(c) for c in courses]


@router.get("/live/upcoming")
def public_upcoming_live_courses(
    db: Session = Depends(get_db),
    limit: int = 30,
):
    safe_limit = max(1, min(100, int(limit or 30)))
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(LiveClassSession, Course)
        .join(Course, Course.id == LiveClassSession.course_id)
        .where(Course.is_published.is_(True))
        .where(LiveClassSession.status.in_(["scheduled", "live"]))
        .where((LiveClassSession.scheduled_start_at.is_(None)) | (LiveClassSession.scheduled_start_at >= now))
        .order_by(LiveClassSession.scheduled_start_at.asc(), LiveClassSession.id.desc())
        .limit(safe_limit),
    ).all()
    items = []
    for sess, course in rows:
        items.append(
            {
                "session_id": int(sess.id),
                "course_id": int(course.id),
                "course_title": course.title,
                "course_thumbnail_url": resolve_media_url(course.thumbnail_url) or course.thumbnail_url,
                "intro_video_url": resolve_media_url(course.intro_video_url) or course.intro_video_url,
                "preview_video_url": resolve_media_url(course.preview_video_url) or course.preview_video_url,
                "title": sess.title,
                "status": sess.status,
                "scheduled_start_at": sess.scheduled_start_at,
                "scheduled_end_at": sess.scheduled_end_at,
                "timezone": sess.timezone,
            },
        )
    return {"count": len(items), "items": items}


@router.post("/{course_id}/modules")
def add_module(
    course_id: int,
    payload: ModuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    course = db.get(Course, course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=404, detail="Course not found")
    module = CourseModule(course_id=course.id, **payload.model_dump())
    db.add(module)
    db.commit()
    db.refresh(module)
    return module


@router.post("/modules/{module_id}/lessons")
def add_lesson(
    module_id: int,
    payload: LessonCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    module = db.get(CourseModule, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    course = db.get(Course, module.course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=403, detail="Access denied")
    lesson_payload = payload.model_dump(mode="json")
    lesson_payload["recorded_video_url"] = str(lesson_payload.get("recorded_video_url") or "").strip() or None
    lesson_payload["live_class_url"] = str(lesson_payload.get("live_class_url") or "").strip() or None
    if lesson_payload.get("lesson_type") == "recorded_video" and not lesson_payload.get("recorded_video_url"):
        raise HTTPException(status_code=400, detail="Recorded video URL is required for recorded lessons.")
    if lesson_payload.get("lesson_type") == "live_class_link" and not lesson_payload.get("live_class_url"):
        raise HTTPException(status_code=400, detail="Live class URL is required for live lessons.")

    # Handle enum representation mismatch across environments (name vs value).
    lesson_type_candidates = [payload.lesson_type, payload.lesson_type.value, payload.lesson_type.name]
    for lesson_type_value in lesson_type_candidates:
        try:
            lesson = Lesson(
                module_id=module.id,
                title=lesson_payload["title"],
                lesson_type=lesson_type_value,
                recorded_video_url=lesson_payload.get("recorded_video_url"),
                live_class_url=lesson_payload.get("live_class_url"),
                position=lesson_payload.get("position", 1),
            )
            db.add(lesson)
            db.commit()
            db.refresh(lesson)
            return lesson
        except SQLAlchemyError:
            db.rollback()
            continue
    raise HTTPException(status_code=500, detail="Failed to create lesson.")


@router.post("/lessons/{lesson_id}/resources")
def add_resource_to_lesson(
    lesson_id: int,
    payload: ResourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    module = db.get(CourseModule, lesson.module_id)
    course = db.get(Course, module.course_id) if module else None
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=403, detail="Access denied")
    resource = Resource(lesson_id=lesson.id, **payload.model_dump())
    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


@router.post("/{course_id}/publish", response_model=CourseOut)
def publish_course(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    course = db.get(Course, course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=404, detail="Course not found")
    module_ids = list(db.scalars(select(CourseModule.id).where(CourseModule.course_id == course.id)).all())
    lesson_rows = list(db.scalars(select(Lesson).where(Lesson.module_id.in_(module_ids))).all()) if module_ids else []
    has_playable = any(
        (str(lesson.live_class_url or "").strip() or str(lesson.recorded_video_url or "").strip())
        for lesson in lesson_rows
    )
    if not has_playable:
        raise HTTPException(status_code=400, detail="Add at least one lesson with video/live URL before publishing.")
    if not str(course.intro_video_url or "").strip():
        raise HTTPException(status_code=400, detail="Add an intro video URL before publishing.")
    if not str(course.preview_video_url or "").strip():
        course.preview_video_url = str(course.intro_video_url or "").strip() or None
    if not str(course.main_video_url or "").strip():
        first_recorded = next((str(x.recorded_video_url or "").strip() for x in lesson_rows if str(x.recorded_video_url or "").strip()), "")
        course.main_video_url = first_recorded or None
    course.is_published = True
    db.commit()
    db.refresh(course)
    return _course_out_payload(course)


@router.post("/{course_id}/unpublish", response_model=CourseOut)
def unpublish_course(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    course = db.get(Course, course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=404, detail="Course not found")
    course.is_published = False
    db.commit()
    db.refresh(course)
    return _course_out_payload(course)


@router.delete("/{course_id}")
def delete_course(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not _can_delete_course(db, course, current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    from app.models.entities import (
        AiReviewJob,
        AttemptEvent,
        Certificate,
        CourseComment,
        CourseLesson,
        CourseCompletion,
        CourseFeedback,
        CoursePurchase,
        Enrollment,
        Exam,
        ExamAttempt,
        ExamRule,
        InstructorMapping,
        LessonTopic,
        LessonVideo,
        LiveStreamSession,
        LiveClassCompletion,
        LiveClassMessage,
        LiveClassParticipant,
        LiveClassPollVote,
        LiveClassSession,
        Option,
        ProctorEvent,
        ProctorEvidence,
        ProctorSession,
        ProctorTrainingFeedback,
        Question,
        Result,
        StudentAnswer,
        VerificationRecord,
        VideoWatchProgress,
        VideoWatchSession,
    )

    module_ids = list(db.scalars(select(CourseModule.id).where(CourseModule.course_id == course.id)).all())
    lesson_ids = list(db.scalars(select(Lesson.id).where(Lesson.module_id.in_(module_ids))).all()) if module_ids else []
    stream_lesson_ids = list(db.scalars(select(CourseLesson.id).where(CourseLesson.course_id == course.id)).all())
    lesson_video_ids = list(db.scalars(select(LessonVideo.id).where(LessonVideo.course_id == course.id)).all())
    live_class_session_ids = list(db.scalars(select(LiveClassSession.id).where(LiveClassSession.course_id == course.id)).all())
    exam_ids = list(db.scalars(select(Exam.id).where(Exam.course_id == course.id)).all())
    question_ids = list(db.scalars(select(Question.id).where(Question.exam_id.in_(exam_ids))).all()) if exam_ids else []
    attempt_ids = list(db.scalars(select(ExamAttempt.id).where(ExamAttempt.exam_id.in_(exam_ids))).all()) if exam_ids else []
    result_ids = list(db.scalars(select(Result.id).where(Result.exam_id.in_(exam_ids))).all()) if exam_ids else []
    session_ids = list(
        db.scalars(
            select(ProctorSession.id).where(
                (ProctorSession.exam_id.in_(exam_ids)) if exam_ids else False,
            ),
        ).all(),
    ) if exam_ids else []
    certificate_rows = list(db.scalars(select(Certificate).where(Certificate.course_id == course.id)).all())
    certificate_ids = [int(c.id) for c in certificate_rows]

    storage_refs: set[str] = set()
    if course.thumbnail_url:
        storage_refs.add(str(course.thumbnail_url))
    if lesson_ids:
        lesson_video_refs = db.scalars(select(Lesson.recorded_video_url).where(Lesson.id.in_(lesson_ids))).all()
        for ref in lesson_video_refs:
            if ref:
                storage_refs.add(str(ref))
    if certificate_rows:
        for cert in certificate_rows:
            if cert.pdf_url:
                storage_refs.add(str(cert.pdf_url))
    if session_ids:
        proctor_files = db.scalars(select(ProctorEvidence.file_url).where(ProctorEvidence.session_id.in_(session_ids))).all()
        for ref in proctor_files:
            if ref:
                storage_refs.add(str(ref))

    if certificate_ids:
        db.execute(delete(VerificationRecord).where(VerificationRecord.certificate_id.in_(certificate_ids)))
    if result_ids:
        db.execute(delete(ProctorTrainingFeedback).where(ProctorTrainingFeedback.result_id.in_(result_ids)))
    if attempt_ids:
        db.execute(delete(ProctorTrainingFeedback).where(ProctorTrainingFeedback.attempt_id.in_(attempt_ids)))
        db.execute(delete(AttemptEvent).where(AttemptEvent.attempt_id.in_(attempt_ids)))
        db.execute(delete(StudentAnswer).where(StudentAnswer.attempt_id.in_(attempt_ids)))
    if session_ids:
        db.execute(delete(ProctorTrainingFeedback).where(ProctorTrainingFeedback.session_id.in_(session_ids)))
        db.execute(delete(ProctorEvidence).where(ProctorEvidence.session_id.in_(session_ids)))
        db.execute(delete(ProctorEvent).where(ProctorEvent.session_id.in_(session_ids)))
        db.execute(delete(ProctorSession).where(ProctorSession.id.in_(session_ids)))
    if certificate_ids:
        db.execute(delete(Certificate).where(Certificate.id.in_(certificate_ids)))
    if result_ids:
        db.execute(delete(Result).where(Result.id.in_(result_ids)))
    if attempt_ids:
        db.execute(delete(ExamAttempt).where(ExamAttempt.id.in_(attempt_ids)))
    if exam_ids:
        db.execute(delete(ExamRule).where(ExamRule.exam_id.in_(exam_ids)))
        db.execute(delete(AiReviewJob).where(AiReviewJob.exam_id.in_(exam_ids)))
    if question_ids:
        db.execute(delete(Option).where(Option.question_id.in_(question_ids)))
        db.execute(delete(Question).where(Question.id.in_(question_ids)))
    if exam_ids:
        db.execute(delete(Exam).where(Exam.id.in_(exam_ids)))
    if lesson_ids:
        db.execute(delete(Resource).where(Resource.lesson_id.in_(lesson_ids)))
        db.execute(delete(LessonTopic).where(LessonTopic.lesson_id.in_(lesson_ids)))
        db.execute(delete(Lesson).where(Lesson.id.in_(lesson_ids)))
    if module_ids:
        db.execute(delete(Resource).where(Resource.module_id.in_(module_ids)))
    if module_ids:
        db.execute(delete(CourseModule).where(CourseModule.id.in_(module_ids)))
    if lesson_video_ids:
        db.execute(delete(VideoWatchSession).where(VideoWatchSession.lesson_video_id.in_(lesson_video_ids)))
        db.execute(delete(VideoWatchProgress).where(VideoWatchProgress.lesson_video_id.in_(lesson_video_ids)))
        db.execute(delete(LessonVideo).where(LessonVideo.id.in_(lesson_video_ids)))
    db.execute(delete(VideoWatchSession).where(VideoWatchSession.course_id == course.id))
    db.execute(delete(VideoWatchProgress).where(VideoWatchProgress.course_id == course.id))
    if stream_lesson_ids:
        db.execute(delete(CourseLesson).where(CourseLesson.id.in_(stream_lesson_ids)))
    db.execute(delete(CoursePurchase).where(CoursePurchase.course_id == course.id))
    db.execute(delete(LiveStreamSession).where(LiveStreamSession.course_id == course.id))
    if live_class_session_ids:
        db.execute(delete(LiveClassPollVote).where(LiveClassPollVote.session_id.in_(live_class_session_ids)))
        db.execute(delete(LiveClassMessage).where(LiveClassMessage.session_id.in_(live_class_session_ids)))
        db.execute(delete(LiveClassParticipant).where(LiveClassParticipant.session_id.in_(live_class_session_ids)))
        db.execute(delete(LiveClassSession).where(LiveClassSession.id.in_(live_class_session_ids)))
    db.execute(delete(InstructorMapping).where(InstructorMapping.course_id == course.id))

    db.execute(delete(CourseComment).where(CourseComment.course_id == course.id))
    db.execute(delete(CourseFeedback).where(CourseFeedback.course_id == course.id))
    db.execute(delete(CourseCompletion).where(CourseCompletion.course_id == course.id))
    db.execute(delete(LiveClassCompletion).where(LiveClassCompletion.course_id == course.id))
    db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
    db.delete(course)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Course cannot be deleted because dependent records still exist. Please retry or contact support.",
        )
    _cleanup_storage_refs(storage_refs)
    return {"deleted": True, "course_id": course_id}
