from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.entities import (
    ApprovalStatus,
    AssessmentIssue,
    AssessmentTask,
    AssessmentTemplate,
    Course,
    Exam,
    ProviderAssessmentTemplateInstall,
    ProviderProfile,
    ProviderType,
    Question,
    User,
    UserRole,
)
from app.services.default_assessments import SUPERSEDED_TEMPLATE_PREFIX, ensure_provider_default_assessments

router = APIRouter(prefix="/provider", tags=["assessment-workspace"])


def _clean_string_list(value) -> list[str]:
    if isinstance(value, str):
        raw = value.replace("\n", ",").split(",")
    elif isinstance(value, list):
        raw = value
    else:
        raw = []
    return [str(item).strip() for item in raw if str(item).strip()]


def _provider_or_404(db: Session, user_id: int) -> ProviderProfile:
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    if profile:
        return profile
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Recruiter profile not found")
    try:
        profile = ProviderProfile(
            user_id=user_id,
            provider_type=ProviderType.BUSINESS,
            display_name=user.full_name or user.email.split("@", 1)[0],
            description="",
            approval_status=ApprovalStatus.PENDING,
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)
        return profile
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Recruiter profile bootstrap failed") from exc


@router.get("/workspace/assessments")
def provider_assessments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER)),
):
    provider = _provider_or_404(db, current_user.id)
    ensure_provider_default_assessments(db, provider)
    rows = db.execute(
        select(Exam, Course)
        .join(Course, Course.id == Exam.course_id)
        .where(Course.provider_id == provider.id),
    ).all()
    rows = [
        (exam, course)
        for exam, course in rows
        if not str(exam.assessment_about or "").startswith(SUPERSEDED_TEMPLATE_PREFIX)
    ]
    exam_ids = [exam.id for exam, _ in rows]
    question_counts = {
        int(exam_id): int(count)
        for exam_id, count in db.execute(
            select(Question.exam_id, func.count(Question.id)).group_by(Question.exam_id),
        ).all()
    }
    competency_counts = {
        int(exam_id): int(count)
        for exam_id, count in db.execute(
            select(Question.exam_id, func.count(func.distinct(Question.competency_tag)))
            .where(Question.competency_tag.is_not(None))
            .group_by(Question.exam_id),
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
            .where(AssessmentIssue.status.in_(["completed", "manual_review", "review_pending", "reviewed"]))
            .group_by(AssessmentIssue.exam_id),
        ).all()
    }
    task_by_exam = {
        task.assessment_id: task
        for task in db.scalars(select(AssessmentTask).where(AssessmentTask.assessment_id.in_(exam_ids))).all()
    } if exam_ids else {}
    template_installs = {
        install.exam_id: install
        for install in db.scalars(
            select(ProviderAssessmentTemplateInstall).where(
                ProviderAssessmentTemplateInstall.provider_id == provider.id,
            ),
        ).all()
    }
    templates_by_id = {
        template.id: template
        for template in db.scalars(
            select(AssessmentTemplate).where(
                AssessmentTemplate.id.in_([install.template_id for install in template_installs.values()]),
            ),
        ).all()
    } if template_installs else {}
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
            "certificate_enabled": False,
            "timing_mode": exam.timing_mode,
            "duration_minutes": exam.duration_minutes,
            "time_per_question_seconds": exam.time_per_question_seconds,
            "questions_per_attempt": exam.questions_per_attempt,
            "total_marks": exam.total_marks,
            "question_count": question_counts.get(exam.id, 0),
            "checkpoint_count": (
                len((task_by_exam[exam.id].grading_config_json or {}).get("checkpoints") or [])
                if exam.id in task_by_exam
                else competency_counts.get(exam.id, 0)
            ),
            "is_platform_default": exam.id in template_installs,
            "template_key": (
                templates_by_id[template_installs[exam.id].template_id].template_key
                if exam.id in template_installs and template_installs[exam.id].template_id in templates_by_id
                else None
            ),
            "template_version": template_installs[exam.id].template_version if exam.id in template_installs else None,
            "issued_count": issued_counts.get(exam.id, 0),
            "taken_count": taken_counts.get(exam.id, 0),
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
                if exam.id in task_by_exam
                else None
            ),
        }
        for exam, _ in rows
    ]
