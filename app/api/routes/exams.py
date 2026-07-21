from datetime import datetime, timedelta, timezone
from html import escape

import random
import re
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from jose import jwt
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import require_role
from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.entities import (
    ApprovalStatus,
    AssessmentIssue,
    AssessmentSubmission,
    AssessmentTask,
    AssessmentType,
    Course,
    CourseModule,
    Exam,
    ExamRule,
    ExamStatus,
    Option,
    ProviderProfile,
    ProviderType,
    Question,
    QuestionType,
    User,
    UserRole,
)
from app.schemas import AssessmentSubmissionIn, AssessmentTaskIn, ExamCreate, ExamOut, ExamRuleUpdate, ExamUpdate, QuestionCreate
from app.services.ai_review import upsert_ai_review
from app.services.default_assessments import install_default_assessment_for_provider, seed_default_assessment_templates
from app.services.notifications import send_email
from app.services.rule_engine import evaluate_exam_rules

router = APIRouter(prefix="/exams", tags=["exams"])
ALLOWED_QUESTIONS_PER_ATTEMPT = {25, 30, 35, 40}
ALLOWED_TIME_PER_QUESTION_SECONDS = {25, 30, 35, 40, 45}
ALLOWED_ASSESSMENT_TYPES = {x.value for x in AssessmentType}
STANDALONE_ASSESSMENT_CATEGORY = "__standalone_assessment__"
ISSUED_TOKEN_ROLE = "issued_candidate"


def _sync_pk_sequence_if_needed(db: Session, table_name: str, pk_col: str = "id") -> None:
    # PostgreSQL-safe sequence heal: set sequence to current MAX(id)
    # so next INSERT uses a free primary key.
    db.execute(
        text(
            f"""
            SELECT setval(
              pg_get_serial_sequence('{table_name}', '{pk_col}'),
              COALESCE((SELECT MAX({pk_col}) FROM {table_name}), 1),
              true
            )
            """,
        ),
    )


def _provider_profile_or_404(db: Session, user_id: int) -> ProviderProfile:
    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    if not profile:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Provider profile not found")
        try:
            profile = ProviderProfile(
                user_id=user_id,
                provider_type=ProviderType.INDIVIDUAL,
                display_name=user.full_name or str(user.email or "Recruiter").split("@")[0],
                description="",
                approval_status=ApprovalStatus.APPROVED if user.role == UserRole.ADMIN else ApprovalStatus.PENDING,
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Provider profile bootstrap failed: {exc}")
    return profile


def _provider_exam_or_403(db: Session, exam_id: int, current_user: User) -> tuple[ProviderProfile, Exam, Course]:
    profile = _provider_profile_or_404(db, current_user.id)
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    course = db.get(Course, exam.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role == UserRole.ADMIN:
        return profile, exam, course
    if course.provider_id != profile.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return profile, exam, course


def _get_or_create_standalone_course(db: Session, profile: ProviderProfile) -> Course:
    existing = db.scalar(
        select(Course).where(
            Course.provider_id == profile.id,
            Course.category == STANDALONE_ASSESSMENT_CATEGORY,
        ),
    )
    if existing:
        return existing
    course = Course(
        provider_id=profile.id,
        title="Standalone Assessments",
        description="Hidden course container for standalone assessments.",
        category=STANDALONE_ASSESSMENT_CATEGORY,
        suitable_age_ranges=[],
        is_published=False,
    )
    db.add(course)
    db.flush()
    return course


class IssueAssessmentRequest(BaseModel):
    candidate_name: str = Field(min_length=2, max_length=200)
    candidate_email: EmailStr


class IssuedCandidateLoginRequest(BaseModel):
    email: EmailStr | None = None
    password: str = Field(min_length=6, max_length=120)


class IssuedCandidateSubmitRequest(BaseModel):
    answers: dict[str, list[int] | int | None] = Field(default_factory=dict)
    submitted_data: dict = Field(default_factory=dict)
    time_taken_seconds: int | None = None
    proctoring_events: list | dict | None = None


class IssuedCandidateProctorEventRequest(BaseModel):
    event_type: str = Field(min_length=2, max_length=120)
    severity: str = "warning"
    details: dict = Field(default_factory=dict)


class IssuedCandidateConsentRequest(BaseModel):
    policy_version: str = Field(min_length=1, max_length=40)
    consent_version: str = Field(min_length=1, max_length=40)
    camera: bool = False
    microphone: bool = False
    recording: bool = False


class AssessmentReviewFinalizeRequest(BaseModel):
    score_pct: float = Field(ge=0, le=100)
    reviewer_notes: str = Field(default="", max_length=4000)


def _create_issued_candidate_token(issue_id: int, session_token: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"assessment_issue:{issue_id}",
        "role": ISSUED_TOKEN_ROLE,
        "issue_id": issue_id,
        "session_token": session_token,
        "exp": now.timestamp() + (60 * 60 * 8),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_issued_candidate_token(token: str) -> tuple[int, str]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid issued-candidate token") from exc
    if payload.get("role") != ISSUED_TOKEN_ROLE:
        raise HTTPException(status_code=403, detail="Invalid token role")
    issue_id = int(payload.get("issue_id") or 0)
    if issue_id <= 0:
        raise HTTPException(status_code=401, detail="Invalid issued-candidate token payload")
    session_token = str(payload.get("session_token") or "").strip()
    if not session_token:
        raise HTTPException(status_code=401, detail="Issued assessment session is no longer valid")
    return issue_id, session_token


def _issued_issue_from_bearer_token(authorization: str | None, db: Session) -> AssessmentIssue:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    issue_id, session_token = _decode_issued_candidate_token(token)
    issue = db.get(AssessmentIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issued assessment not found")
    if str(issue.active_session_token or "") != session_token:
        raise HTTPException(status_code=409, detail="This assessment is already open in another session. Use the latest opened session or ask the recruiter to re-issue.")
    return issue


def _issued_proctoring_state(issue: AssessmentIssue) -> dict:
    result = issue.result_json if isinstance(issue.result_json, dict) else {}
    state = result.get("proctoring") if isinstance(result.get("proctoring"), dict) else {}
    state.setdefault("warning_count", 0)
    state.setdefault("events", [])
    state.setdefault("terminated", False)
    return state


def _internal_assessment_id(exam_id: int) -> str:
    return f"ASM-{int(exam_id):06d}"


def _is_expired(value: datetime | None) -> bool:
    if not value:
        return False
    expires_at = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return expires_at < datetime.now(timezone.utc)


def _questions_for_issued_attempt(db: Session, issue: AssessmentIssue, exam: Exam) -> list[Question]:
    questions = list(db.scalars(select(Question).where(Question.exam_id == exam.id).order_by(Question.id.asc())).all())
    limit = int(exam.questions_per_attempt or 0)
    if limit <= 0 or limit >= len(questions):
        return questions
    shuffled = list(questions)
    random.Random(int(issue.id)).shuffle(shuffled)
    selected_ids = {q.id for q in shuffled[:limit]}
    return [q for q in questions if q.id in selected_ids]


def _task_to_dict(task: AssessmentTask | None, *, include_expected: bool = False) -> dict | None:
    if not task:
        return None
    out = {
        "id": task.id,
        "assessment_id": task.assessment_id,
        "type": task.type,
        "title": task.title,
        "description": task.description,
        "instructions": task.instructions,
        "marks": task.marks,
        "metadata": task.metadata_json or {},
        "grading_config": task.grading_config_json or {},
    }
    if include_expected:
        out["expected_output"] = task.expected_output_json or {}
    return out


def _score_expected_mapping(submitted: dict, expected: dict, total_marks: float) -> tuple[float, dict]:
    if not expected:
        return 0.0, {"matched": 0, "total": 0}
    matched = 0
    total = 0
    for key, expected_value in expected.items():
        total += 1
        if submitted.get(key) == expected_value:
            matched += 1
    score = round((matched / total) * float(total_marks or 0), 2) if total else 0.0
    return score, {"matched": matched, "total": total}


def _values_match(actual, expected, tolerance: float = 0.0) -> bool:
    if isinstance(expected, (int, float)) or isinstance(actual, (int, float)):
        try:
            return abs(float(actual) - float(expected)) <= float(tolerance or 0)
        except (TypeError, ValueError):
            return False
    return str(actual).strip() == str(expected).strip()


def _checkpoint_source_value(source: str, submitted_data: dict):
    if source == "code":
        return submitted_data.get("code") or ""
    if source == "identified_red_flags":
        return submitted_data.get("identified_red_flags") or []
    if source.startswith("field:"):
        return (submitted_data.get("entered_form_values") or {}).get(source.split(":", 1)[1])
    if source.startswith("spreadsheet_value:"):
        cell = source.split(":", 1)[1]
        calculated = submitted_data.get("calculated_values_json") or {}
        final_sheet = submitted_data.get("final_sheet_json") or {}
        qualified = cell if "!" in cell else f"Assessment!{cell}"
        return calculated.get(cell, calculated.get(qualified, final_sheet.get(cell, final_sheet.get(qualified))))
    if source.startswith("spreadsheet_formula:"):
        cell = source.split(":", 1)[1]
        formulas = submitted_data.get("formulas_json") or {}
        final_sheet = submitted_data.get("final_sheet_json") or {}
        qualified = cell if "!" in cell else f"Assessment!{cell}"
        return formulas.get(cell, formulas.get(qualified, final_sheet.get(cell, final_sheet.get(qualified))))
    return submitted_data.get(source)


def _checkpoint_matches(actual, checkpoint: dict) -> tuple[bool, str]:
    expected = checkpoint.get("expected")
    comparator = str(checkpoint.get("comparator") or "exact")
    if comparator == "numeric":
        matched = _values_match(actual, expected, float(checkpoint.get("tolerance") or 0))
    elif comparator == "contains":
        matched = str(expected).casefold() in str(actual or "").casefold()
    elif comparator == "contains_all":
        haystack = str(actual or "").casefold()
        matched = all(str(item).casefold() in haystack for item in (expected or []))
    elif comparator == "regex":
        try:
            matched = bool(re.search(str(expected or ""), str(actual or ""), flags=re.IGNORECASE | re.MULTILINE))
        except re.error:
            matched = False
    elif comparator == "set_contains_all":
        actual_set = {str(item).strip().casefold() for item in (actual or [])}
        matched = all(str(item).strip().casefold() in actual_set for item in (expected or []))
    else:
        matched = _values_match(actual, expected, float(checkpoint.get("tolerance") or 0))
    return matched, "Matched" if matched else "Not matched"


def _evaluate_checkpoints(task: AssessmentTask, submitted_data: dict) -> tuple[float | None, dict] | None:
    grading = task.grading_config_json or {}
    checkpoints = grading.get("checkpoints") if isinstance(grading, dict) else None
    if not isinstance(checkpoints, list) or not checkpoints:
        return None
    total_weight = sum(max(0.0, float(item.get("weight") or 0)) for item in checkpoints if isinstance(item, dict))
    if total_weight <= 0:
        return None
    earned_weight = 0.0
    results = []
    for index, checkpoint in enumerate(checkpoints):
        if not isinstance(checkpoint, dict):
            continue
        weight = max(0.0, float(checkpoint.get("weight") or 0))
        actual = _checkpoint_source_value(str(checkpoint.get("source") or ""), submitted_data)
        matched, explanation = _checkpoint_matches(actual, checkpoint)
        if matched:
            earned_weight += weight
        results.append({
            "id": checkpoint.get("id") or f"checkpoint-{index + 1}",
            "label": checkpoint.get("label") or f"Checkpoint {index + 1}",
            "weight": weight,
            "earned_weight": weight if matched else 0,
            "matched": matched,
            "actual": actual,
            "expected": checkpoint.get("expected"),
            "explanation": explanation,
        })
    score = round((earned_weight / total_weight) * float(task.marks or 0), 2)
    return score, {"evaluation_mode": grading.get("evaluation_mode") or "deterministic", "earned_weight": earned_weight, "total_weight": total_weight, "checkpoints": results}


def _score_spreadsheet_submission(task: AssessmentTask, submitted_data: dict) -> tuple[float, dict]:
    total_marks = float(task.marks or 0)
    expected = task.expected_output_json or {}
    grading = task.grading_config_json or {}
    final_sheet = submitted_data.get("final_sheet_json") or {}
    calculated_values = submitted_data.get("calculated_values_json") or {}
    formulas = submitted_data.get("formulas_json") or {}
    expected_values = expected.get("expected_final_values") or expected.get("values") or {}
    expected_formulas = expected.get("expected_formulas") or {}
    tolerance = float(grading.get("numeric_tolerance", 0.0) or 0.0)
    total_checks = len(expected_values) + len(expected_formulas)
    if total_checks <= 0:
        return 0.0, {"matched": 0, "total": 0, "message": "No spreadsheet scoring rules configured"}
    matched_values = 0
    for cell_ref, expected_value in expected_values.items():
        actual = calculated_values.get(cell_ref, final_sheet.get(cell_ref))
        if _values_match(actual, expected_value, tolerance):
            matched_values += 1
    matched_formulas = 0
    for cell_ref, expected_formula in expected_formulas.items():
        actual_formula = formulas.get(cell_ref, final_sheet.get(cell_ref))
        if str(actual_formula).strip().upper() == str(expected_formula).strip().upper():
            matched_formulas += 1
    matched = matched_values + matched_formulas
    score = round((matched / total_checks) * total_marks, 2)
    return score, {
        "matched": matched,
        "total": total_checks,
        "matched_values": matched_values,
        "expected_values": len(expected_values),
        "matched_formulas": matched_formulas,
        "expected_formulas": len(expected_formulas),
        "numeric_tolerance": tolerance,
        "activity_events": len(submitted_data.get("activity_log") or []),
    }


def _score_task_submission(task: AssessmentTask, submitted_data: dict) -> tuple[float | None, str, dict]:
    total_marks = float(task.marks or 0)
    expected = task.expected_output_json or {}
    grading = task.grading_config_json or {}
    task_type = str(task.type or "")
    checkpoint_result = _evaluate_checkpoints(task, submitted_data)
    if checkpoint_result:
        score, detail = checkpoint_result
        manual_required = bool(grading.get("manual_review_required", False))
        return score, ("manual_review" if manual_required else "auto_scored"), detail
    if task_type == AssessmentType.CODING.value:
        return None, "manual_review", {"message": "No trusted deterministic coding checkpoints are configured"}
    if task_type == AssessmentType.SPREADSHEET.value:
        score, detail = _score_spreadsheet_submission(task, submitted_data)
        return score, "auto_scored", detail
    if task_type in {AssessmentType.ACCOUNTING.value, AssessmentType.TAX_SIMULATOR.value}:
        entered = submitted_data.get("entered_form_values") or {}
        expected_values = expected.get("expected_form_values") or {}
        value_score, value_detail = _score_expected_mapping(entered, expected_values, total_marks * 0.65)
        expected_flags = set(map(str, expected.get("red_flags") or []))
        submitted_flags = set(map(str, submitted_data.get("identified_red_flags") or []))
        flag_score = (len(expected_flags & submitted_flags) / len(expected_flags) * total_marks * 0.35) if expected_flags else 0
        manual_required = bool(grading.get("manual_review_required", True))
        return round(value_score + flag_score, 2), ("manual_review" if manual_required else "auto_scored"), {
            "values": value_detail,
            "red_flags_matched": len(expected_flags & submitted_flags),
            "red_flags_total": len(expected_flags),
        }
    if task_type == AssessmentType.CASE_STUDY.value:
        return None, "manual_review", {"rubric": grading.get("rubric") or expected.get("rubric") or ""}
    return None, "manual_review", {"message": "Unsupported assessment task type"}


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


def _exam_metadata_dict(exam: Exam) -> dict:
    return {
        "about": exam.assessment_about or "",
        "tools": _clean_string_list(exam.tools_json or []),
        "topics": _clean_string_list(exam.topics_json or []),
    }


def _apply_exam_metadata(data: dict) -> dict:
    if "about" in data:
        data["assessment_about"] = str(data.pop("about") or "").strip()
    if "tools" in data:
        data["tools_json"] = _clean_string_list(data.pop("tools"))
    if "topics" in data:
        data["topics_json"] = _clean_string_list(data.pop("topics"))
    return data


def _validate_exam_metadata_values(*, instructions: str | None, about: str | None, tools, topics) -> None:
    if not str(instructions or "").strip():
        raise HTTPException(status_code=400, detail="instructions is required")
    if not str(about or "").strip():
        raise HTTPException(status_code=400, detail="about is required")
    if not _clean_string_list(tools):
        raise HTTPException(status_code=400, detail="tools is required")
    if not _clean_string_list(topics):
        raise HTTPException(status_code=400, detail="topics is required")


def _validate_exam_metadata(exam: Exam) -> None:
    _validate_exam_metadata_values(
        instructions=exam.instructions,
        about=exam.assessment_about,
        tools=exam.tools_json,
        topics=exam.topics_json,
    )


def _safe_send_assessment_issue_email(
    *,
    to_email: str,
    candidate_name: str,
    assessment_title: str,
    login_link: str,
    temporary_password: str,
    expires_at: datetime | None,
    company_name: str,
    privacy_url: str,
    retention_url: str,
) -> dict:
    subject = f"Invitation: {assessment_title} | {company_name}"
    expiry_text = expires_at.strftime("%d %B %Y at %H:%M UTC") if expires_at else "7 days from issue"
    body = (
        f"Hello {candidate_name},\n\n"
        f"{company_name} has invited you to complete: {assessment_title}.\n\n"
        f"Open the assessment: {login_link}\n"
        f"Temporary password: {temporary_password}\n"
        f"Access expires: {expiry_text}\n\n"
        "Review the privacy and assessment instructions before starting. Complete the assessment in one sitting.\n\n"
        f"Privacy: {privacy_url}\nData retention: {retention_url}\n\n"
        f"Regards,\n{company_name}"
    )
    safe_name = escape(candidate_name)
    safe_company = escape(company_name)
    safe_title = escape(assessment_title)
    safe_link = escape(login_link, quote=True)
    safe_password = escape(temporary_password)
    safe_expiry = escape(expiry_text)
    safe_privacy = escape(privacy_url, quote=True)
    safe_retention = escape(retention_url, quote=True)
    html_body = f"""<!doctype html>
<html><body style=\"margin:0;background:#f3f5f7;font-family:Arial,sans-serif;color:#172033\">
<div style=\"max-width:620px;margin:32px auto;padding:0 16px\">
  <div style=\"background:#107c41;padding:22px 26px;color:#fff\"><strong style=\"font-size:20px\">{safe_company}</strong><div style=\"margin-top:4px;opacity:.86\">Assessment invitation</div></div>
  <div style=\"background:#fff;padding:28px 26px;border:1px solid #d8e0ea\">
    <p style=\"font-size:16px\">Hello {safe_name},</p>
    <p>You have been invited by <strong>{safe_company}</strong> to complete <strong>{safe_title}</strong>.</p>
    <p style=\"margin:26px 0\"><a href=\"{safe_link}\" style=\"display:inline-block;background:#107c41;color:#fff;text-decoration:none;padding:13px 20px;border-radius:6px;font-weight:bold\">Open assessment</a></p>
    <table style=\"border-collapse:collapse;width:100%;background:#f8fafc\"><tr><td style=\"padding:12px;font-weight:bold\">Temporary password</td><td style=\"padding:12px\">{safe_password}</td></tr><tr><td style=\"padding:12px;font-weight:bold\">Access expires</td><td style=\"padding:12px\">{safe_expiry}</td></tr></table>
    <p style=\"font-size:14px;color:#526071\">Please review the assessment instructions and privacy information before starting. The assessment link is personal to you.</p>
    <p style=\"font-size:13px\"><a href=\"{safe_privacy}\">Privacy policy</a> &nbsp; <a href=\"{safe_retention}\">Data retention</a></p>
  </div>
  <p style=\"font-size:12px;color:#667085;text-align:center\">This invitation was sent by {safe_company} through Certora Assessments.</p>
</div></body></html>"""
    try:
        return send_email(to_email, subject, body, html_body=html_body)
    except Exception as exc:
        return {"sent": False, "reason": str(exc)}


@router.get("/default-library")
def default_assessment_library(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    del current_user
    output = []
    for template_row in seed_default_assessment_templates(db):
        template = template_row.definition_json or {}
        task = template.get("task") or {}
        checkpoints = (task.get("grading_config") or {}).get("checkpoints") or []
        output.append({
            "id": template["id"],
            "title": template["title"],
            "summary": template["summary"],
            "assessment_type": template["assessment_type"],
            "duration_minutes": template["duration_minutes"],
            "pass_score": template["pass_score"],
            "topics": template["topics"],
            "checkpoint_count": len(checkpoints) or len(template.get("questions") or []),
            "question_count": len(template.get("questions") or []),
            "review_required": bool((task.get("grading_config") or {}).get("manual_review_required", False)),
            "version": template_row.version,
            "storage": "database",
        })
    db.commit()
    return output


@router.get("/default-library/{template_id}")
def get_default_assessment_detail(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    del current_user
    template_row = next((row for row in seed_default_assessment_templates(db) if row.template_key == template_id and row.is_active), None)
    if not template_row:
        raise HTTPException(status_code=404, detail="Default assessment not found")
    db.commit()
    return {**(template_row.definition_json or {}), "version": template_row.version, "storage": "database"}


@router.post("/default-library/{template_id}/install", status_code=status.HTTP_201_CREATED)
def install_default_assessment(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    try:
        exam, template = install_default_assessment_for_provider(db, profile, template_id)
        return {"id": exam.id, "title": exam.title, "assessment_type": exam.assessment_type, "status": exam.status, "installed_from": template.template_key, "template_version": template.version}
    except KeyError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail="Default assessment not found") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to install default assessment: {exc.__class__.__name__}") from exc


@router.post("", response_model=ExamOut, status_code=status.HTTP_201_CREATED)
def create_exam(
    payload: ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    assessment_type = str(payload.assessment_type.value if hasattr(payload.assessment_type, "value") else payload.assessment_type)
    if assessment_type not in ALLOWED_ASSESSMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid assessment_type")
    _validate_exam_metadata_values(
        instructions=payload.instructions,
        about=payload.about,
        tools=payload.tools,
        topics=payload.topics,
    )
    if int(payload.course_id or 0) <= 0:
        course = _get_or_create_standalone_course(db, profile)
        payload.course_id = int(course.id)
    else:
        course = db.get(Course, payload.course_id)
        if not course or course.provider_id != profile.id:
            raise HTTPException(status_code=404, detail="Course not found")
    if assessment_type != AssessmentType.MCQ.value:
        payload.timing_mode = "assessment"
        payload.time_per_question_seconds = None
        payload.questions_per_attempt = 0
        payload.negative_marking = False
        payload.shuffle_questions = False
        payload.shuffle_options = False
    if payload.timing_mode not in {"assessment", "question"}:
        raise HTTPException(status_code=400, detail="timing_mode must be 'assessment' or 'question'")
    if float(payload.pass_score) < 70:
        raise HTTPException(status_code=400, detail="pass_score must be at least 70")
    if int(payload.max_attempts) < 1 or int(payload.max_attempts) > 3:
        raise HTTPException(status_code=400, detail="max_attempts must be between 1 and 3")
    if payload.timing_mode == "question":
        if payload.time_per_question_seconds is None:
            raise HTTPException(status_code=400, detail="time_per_question_seconds is required for question timing mode")
        if payload.time_per_question_seconds not in ALLOWED_TIME_PER_QUESTION_SECONDS:
            raise HTTPException(status_code=400, detail="time_per_question_seconds must be one of: 25, 30, 35, 40, 45")
    if payload.timing_mode == "assessment" and payload.duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="duration_minutes must be greater than 0")
    if assessment_type == AssessmentType.MCQ.value and payload.questions_per_attempt not in ALLOWED_QUESTIONS_PER_ATTEMPT:
        raise HTTPException(status_code=400, detail="questions_per_attempt must be one of: 25, 30, 35, 40")
    try:
        data = _apply_exam_metadata(payload.model_dump())
        data["assessment_type"] = assessment_type
        exam = Exam(**data)
        db.add(exam)
        db.flush()
        db.add(ExamRule(exam_id=exam.id))
        db.commit()
        db.refresh(exam)
        return exam
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create exam: {exc.__class__.__name__}") from exc


@router.put("/{exam_id}", response_model=ExamOut)
def update_exam(
    exam_id: int,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    _, exam, _ = _provider_exam_or_403(db, exam_id, current_user)
    if exam.status == ExamStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="Published exam cannot be edited")

    data = _apply_exam_metadata(payload.model_dump(exclude_unset=True))
    if "assessment_type" in data and data["assessment_type"] is not None:
        data["assessment_type"] = str(data["assessment_type"].value if hasattr(data["assessment_type"], "value") else data["assessment_type"])
        if data["assessment_type"] not in ALLOWED_ASSESSMENT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid assessment_type")
    effective_type = data.get("assessment_type", exam.assessment_type or AssessmentType.MCQ.value)
    timing_mode = data.get("timing_mode", exam.timing_mode)
    duration_minutes = data.get("duration_minutes", exam.duration_minutes)
    time_per_question_seconds = data.get("time_per_question_seconds", exam.time_per_question_seconds)
    questions_per_attempt = data.get("questions_per_attempt", exam.questions_per_attempt)

    if effective_type != AssessmentType.MCQ.value:
        data["timing_mode"] = "assessment"
        data["time_per_question_seconds"] = None
        data["questions_per_attempt"] = 0
        data["negative_marking"] = False
        data["shuffle_questions"] = False
        data["shuffle_options"] = False
        timing_mode = "assessment"
        questions_per_attempt = 0
    if timing_mode not in {"assessment", "question"}:
        raise HTTPException(status_code=400, detail="timing_mode must be 'assessment' or 'question'")
    pass_score = data.get("pass_score", exam.pass_score)
    max_attempts = data.get("max_attempts", exam.max_attempts)
    if pass_score is not None and float(pass_score) < 70:
        raise HTTPException(status_code=400, detail="pass_score must be at least 70")
    if max_attempts is not None and (int(max_attempts) < 1 or int(max_attempts) > 3):
        raise HTTPException(status_code=400, detail="max_attempts must be between 1 and 3")
    if timing_mode == "assessment" and (duration_minutes is None or duration_minutes <= 0):
        raise HTTPException(status_code=400, detail="duration_minutes must be greater than 0")
    if timing_mode == "question":
        if time_per_question_seconds is None:
            raise HTTPException(status_code=400, detail="time_per_question_seconds is required for question timing mode")
        if int(time_per_question_seconds) not in ALLOWED_TIME_PER_QUESTION_SECONDS:
            raise HTTPException(status_code=400, detail="time_per_question_seconds must be one of: 25, 30, 35, 40, 45")
    if effective_type == AssessmentType.MCQ.value and questions_per_attempt is not None and int(questions_per_attempt) not in ALLOWED_QUESTIONS_PER_ATTEMPT:
        raise HTTPException(status_code=400, detail="questions_per_attempt must be one of: 25, 30, 35, 40")

    try:
        for key, value in data.items():
            setattr(exam, key, value)
        db.commit()
        db.refresh(exam)
        return exam
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update exam: {exc.__class__.__name__}") from exc


@router.delete("/{exam_id}")
def delete_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    _, exam, _ = _provider_exam_or_403(db, exam_id, current_user)
    if exam.status == ExamStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="Published exam cannot be deleted")
    question_ids = list(db.scalars(select(Question.id).where(Question.exam_id == exam.id)).all())
    if question_ids:
        db.execute(delete(Option).where(Option.question_id.in_(question_ids)))
        db.execute(delete(Question).where(Question.id.in_(question_ids)))
    db.execute(delete(ExamRule).where(ExamRule.exam_id == exam.id))
    db.delete(exam)
    db.commit()
    return {"deleted": True, "exam_id": exam_id}


@router.post("/{exam_id}/rule")
def update_exam_rule(
    exam_id: int,
    payload: ExamRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    course = db.get(Course, exam.course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=403, detail="Access denied")
    try:
        rule = db.scalar(select(ExamRule).where(ExamRule.exam_id == exam.id))
        if not rule:
            rule = ExamRule(exam_id=exam.id)
            db.add(rule)
        for key, value in payload.model_dump().items():
            setattr(rule, key, value)
        db.commit()
        db.refresh(rule)
        return rule
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save exam rule: {exc.__class__.__name__}") from exc


@router.post("/{exam_id}/questions")
def add_question(
    exam_id: int,
    payload: QuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    course = db.get(Course, exam.course_id)
    if not course or course.provider_id != profile.id:
        raise HTTPException(status_code=403, detail="Access denied")

    if payload.question_type != QuestionType.SHORT_ANSWER and not payload.options:
        raise HTTPException(status_code=400, detail="MCQ question requires options")
    cleaned_options = []
    for idx, opt in enumerate(payload.options or [], start=1):
        text_val = str(opt.option_text or "").strip()
        if not text_val:
            continue
        cleaned_options.append(
            {
                "option_text": text_val,
                "is_correct": bool(opt.is_correct),
                "position": int(opt.position or idx),
            },
        )
    if payload.question_type != QuestionType.SHORT_ANSWER and len(cleaned_options) < 2:
        raise HTTPException(status_code=400, detail="MCQ question requires at least 2 non-empty options")
    if payload.question_type == QuestionType.MCQ_SINGLE and sum(1 for o in cleaned_options if o["is_correct"]) != 1:
        raise HTTPException(status_code=400, detail="Single correct MCQ needs exactly 1 correct option")
    if payload.question_type == QuestionType.MCQ_MULTI and sum(1 for o in cleaned_options if o["is_correct"]) < 1:
        raise HTTPException(status_code=400, detail="Multiple correct MCQ needs at least 1 correct option")

    def _insert_question_and_options() -> dict:
        # Store enum member name in DB for compatibility with legacy enum column sizing/values.
        qtype_db_value = payload.question_type.name if hasattr(payload.question_type, "name") else str(payload.question_type)
        question = Question(
            exam_id=exam.id,
            question_text=payload.question_text,
            question_type=qtype_db_value,
            marks=payload.marks,
            negative_marks=payload.negative_marks,
        )
        db.add(question)
        db.flush()
        created_options: list[dict] = []
        for opt in cleaned_options:
            option = Option(
                question_id=question.id,
                option_text=opt["option_text"],
                is_correct=opt["is_correct"],
                position=opt["position"],
            )
            db.add(option)
            db.flush()
            created_options.append({"id": option.id, "is_correct": option.is_correct})
        db.commit()
        db.refresh(question)
        exam.total_marks = db.scalar(select(func.coalesce(func.sum(Question.marks), 0)).where(Question.exam_id == exam.id))
        db.commit()
        return {"question_id": question.id, "options": created_options}

    try:
        return _insert_question_and_options()
    except IntegrityError as exc:
        db.rollback()
        detail = str(getattr(exc, "orig", exc))
        # Auto-heal PK sequence drift and retry once.
        if "duplicate key value violates unique constraint" in detail and ("options_pkey" in detail or "questions_pkey" in detail):
            _sync_pk_sequence_if_needed(db, "options")
            _sync_pk_sequence_if_needed(db, "questions")
            try:
                return _insert_question_and_options()
            except IntegrityError as retry_exc:
                db.rollback()
                retry_detail = str(getattr(retry_exc, "orig", retry_exc))
                raise HTTPException(status_code=400, detail=f"Failed to add question after sequence sync: {retry_detail}") from retry_exc
        raise HTTPException(status_code=400, detail=f"Failed to add question: {detail}") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add question: {exc.__class__.__name__}") from exc


@router.get("/{exam_id}/questions")
def list_questions(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    _, exam, _ = _provider_exam_or_403(db, exam_id, current_user)
    questions = list(db.scalars(select(Question).where(Question.exam_id == exam.id)).all())
    out = []
    for q in questions:
        options = list(db.scalars(select(Option).where(Option.question_id == q.id).order_by(Option.position)).all())
        out.append(
            {
                "question_id": q.id,
                "question_text": q.question_text,
                "question_type": q.question_type,
                "marks": q.marks,
                "negative_marks": q.negative_marks,
                "options": [
                    {"option_id": o.id, "option_text": o.option_text, "is_correct": o.is_correct, "position": o.position}
                    for o in options
                ],
            },
        )
    return out


@router.delete("/{exam_id}/questions/{question_id}")
def delete_question(
    exam_id: int,
    question_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    _, exam, _ = _provider_exam_or_403(db, exam_id, current_user)
    if exam.status == ExamStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="Published exam cannot be edited")
    question = db.get(Question, question_id)
    if not question or question.exam_id != exam.id:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(question)
    db.flush()
    exam.total_marks = db.scalar(select(func.coalesce(func.sum(Question.marks), 0)).where(Question.exam_id == exam.id))
    db.commit()
    return {"deleted": True, "question_id": question_id}


@router.put("/{exam_id}/task")
def upsert_assessment_task(
    exam_id: int,
    payload: AssessmentTaskIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    _, exam, _ = _provider_exam_or_403(db, exam_id, current_user)
    if exam.status == ExamStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="Published assessment cannot be edited")
    task_type = str(payload.type.value if hasattr(payload.type, "value") else payload.type)
    if task_type == AssessmentType.MCQ.value:
        raise HTTPException(status_code=400, detail="MCQ assessments use the question builder")
    if task_type != str(exam.assessment_type or AssessmentType.MCQ.value):
        raise HTTPException(status_code=400, detail="Task type must match assessment type")
    title = str(payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Task title is required")
    if float(payload.marks or 0) <= 0:
        raise HTTPException(status_code=400, detail="Task marks must be greater than 0")
    task = db.scalar(select(AssessmentTask).where(AssessmentTask.assessment_id == exam.id))
    if not task:
        task = AssessmentTask(assessment_id=exam.id, type=task_type, title=title)
    task.type = task_type
    task.title = title
    task.description = payload.description or ""
    task.instructions = payload.instructions or ""
    task.marks = float(payload.marks or 0)
    task.metadata_json = payload.metadata or {}
    task.expected_output_json = payload.expected_output or {}
    task.grading_config_json = payload.grading_config or {}
    exam.total_marks = float(payload.marks or 0)
    db.add(task)
    db.add(exam)
    db.commit()
    db.refresh(task)
    return _task_to_dict(task, include_expected=True)


@router.get("/{exam_id}/task")
def get_assessment_task(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if current_user.role == UserRole.PROVIDER:
        profile = _provider_profile_or_404(db, current_user.id)
        course = db.get(Course, exam.course_id)
        if not course or course.provider_id != profile.id:
            raise HTTPException(status_code=403, detail="Access denied")
    task = db.scalar(select(AssessmentTask).where(AssessmentTask.assessment_id == exam.id))
    if not task:
        raise HTTPException(status_code=404, detail="Assessment task not found")
    return _task_to_dict(task, include_expected=True)


@router.post("/{exam_id}/ai-review/request")
def request_ai_review(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    settings = get_settings()
    if not settings.enable_ai_review:
        return {"enabled": False, "status": "skipped", "message": "AI review is disabled for this phase."}

    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    if current_user.role == UserRole.PROVIDER:
        profile = _provider_profile_or_404(db, current_user.id)
        course = db.get(Course, exam.course_id)
        if not course or course.provider_id != profile.id:
            raise HTTPException(status_code=403, detail="Access denied")

    exam.status = ExamStatus.IN_REVIEW
    review = upsert_ai_review(db, exam)
    db.commit()
    return {
        "status": review.status,
        "clarity_score": review.clarity_score,
        "certification_readiness_score": review.certification_readiness_score,
        "summary": review.summary,
        "flags": review.flags_json,
    }


@router.get("/{exam_id}/ai-review")
def get_ai_review(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    settings = get_settings()
    if not settings.enable_ai_review:
        return {"enabled": False, "status": "skipped", "message": "AI review is disabled for this phase."}

    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    review = upsert_ai_review(db, exam)
    db.commit()
    return review


@router.post("/{exam_id}/publish", response_model=ExamOut)
def publish_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    settings = get_settings()
    profile = _provider_profile_or_404(db, current_user.id)
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    course = db.get(Course, exam.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role != UserRole.ADMIN and course.provider_id != profile.id:
        raise HTTPException(status_code=403, detail="Access denied")
    _validate_exam_metadata(exam)

    if settings.enable_ai_review:
        upsert_ai_review(db, exam)
    assessment_type = str(exam.assessment_type or AssessmentType.MCQ.value)
    if assessment_type == AssessmentType.MCQ.value:
        total_questions = db.scalar(select(func.count(Question.id)).where(Question.exam_id == exam.id)) or 0
        if total_questions <= 0:
            raise HTTPException(status_code=400, detail="At least one question is required")
        if exam.questions_per_attempt and exam.questions_per_attempt > total_questions:
            raise HTTPException(
                status_code=400,
                detail=f"questions_per_attempt ({exam.questions_per_attempt}) cannot exceed total questions ({total_questions})",
            )
        check = evaluate_exam_rules(db, exam)
        if not check.approved:
            exam.status = ExamStatus.REJECTED
            db.commit()
            raise HTTPException(status_code=400, detail={"message": "Rule check failed", "reasons": check.reasons})
    else:
        task = db.scalar(select(AssessmentTask).where(AssessmentTask.assessment_id == exam.id))
        if not task:
            raise HTTPException(status_code=400, detail="Assessment task is required before publishing")
        if float(task.marks or 0) <= 0:
            raise HTTPException(status_code=400, detail="Assessment task marks must be greater than 0")
        exam.total_marks = float(task.marks or 0)

    exam.status = ExamStatus.PUBLISHED
    db.commit()
    db.refresh(exam)
    return exam


@router.get("/{exam_id}/syllabus-map")
def syllabus_map(
    exam_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    modules = list(db.scalars(select(CourseModule).where(CourseModule.course_id == exam.course_id)).all())
    questions = list(db.scalars(select(Question).where(Question.exam_id == exam.id)).all())
    result = []
    for module in modules:
        matches = [q.id for q in questions if module.title.lower() in q.question_text.lower()]
        result.append({"module_id": module.id, "module_title": module.title, "question_matches": matches})
    return result


@router.post("/{exam_id}/issue")
def issue_assessment_to_candidate(
    exam_id: int,
    payload: IssueAssessmentRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    profile = _provider_profile_or_404(db, current_user.id)
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.status != ExamStatus.PUBLISHED:
        raise HTTPException(status_code=400, detail="Only published assessments can be issued")

    candidate_email = str(payload.candidate_email).strip().lower()
    candidate_name = str(payload.candidate_name).strip()
    temp_password = secrets.token_urlsafe(8)
    issue = AssessmentIssue(
        exam_id=exam.id,
        issuer_user_id=current_user.id,
        candidate_user_id=None,
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        candidate_password_hash=hash_password(temp_password),
        access_key=secrets.token_urlsafe(24),
        access_expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        status="issued",
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    settings = get_settings()
    base_url = (settings.candidate_app_base_url or f"{request.url.scheme}://{request.headers.get('host')}").rstrip("/")
    login_link = f"{base_url}/?issued_key={issue.access_key}"
    email_delivery = _safe_send_assessment_issue_email(
        to_email=candidate_email,
        candidate_name=candidate_name,
        assessment_title=exam.title,
        login_link=login_link,
        temporary_password=temp_password,
        expires_at=issue.access_expires_at,
        company_name=(profile.display_name or settings.app_name or "Your organization").strip(),
        privacy_url=f"{base_url}/legal/privacy-policy.html",
        retention_url=f"{base_url}/legal/data-retention-and-deletion.html",
    )
    return {
        "issued_id": issue.id,
        "exam_id": exam.id,
        "internal_id": _internal_assessment_id(exam.id),
        "candidate_email": candidate_email,
        "temporary_password": temp_password,
        "login_link": login_link,
        "credentials_valid_till": issue.access_expires_at,
        "email_delivery": email_delivery,
        "note": "Credentials were emailed when SMTP is configured. Keep the temporary password visible here as fallback.",
    }


@router.get("/issued/by-me")
def list_issued_assessments_for_provider(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    rows = db.scalars(
        select(AssessmentIssue)
        .where(AssessmentIssue.issuer_user_id == current_user.id)
        .order_by(AssessmentIssue.id.desc()),
    ).all()
    out = []
    for row in rows:
        exam = db.get(Exam, row.exam_id)
        submission = db.scalar(
            select(AssessmentSubmission)
            .where(AssessmentSubmission.issue_id == row.id)
            .order_by(AssessmentSubmission.id.desc())
        )
        out.append(
            {
                "issued_id": row.id,
                "exam_id": row.exam_id,
                "internal_id": _internal_assessment_id(row.exam_id),
                "assessment_title": exam.title if exam else f"Assessment #{row.exam_id}",
                "assessment_type": exam.assessment_type if exam else None,
                "pass_score": exam.pass_score if exam else None,
                "candidate_name": row.candidate_name,
                "candidate_email": row.candidate_email,
                "status": row.status,
                "score_pct": row.score_pct,
                "passed": row.passed,
                "issued_at": row.issued_at,
                "access_expires_at": row.access_expires_at,
                "completed_at": row.completed_at,
                "time_taken_seconds": submission.time_taken_seconds if submission else None,
                "submission_status": submission.status if submission else None,
            },
        )
    return out


@router.get("/issued/{issue_id}/review")
def review_issued_assessment_attempt(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    issue = db.get(AssessmentIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issued assessment not found")
    if current_user.role != UserRole.ADMIN and int(issue.issuer_user_id) != int(current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")
    exam = db.get(Exam, issue.exam_id)
    submission = db.scalar(
        select(AssessmentSubmission)
        .where(AssessmentSubmission.issue_id == issue.id)
        .order_by(AssessmentSubmission.id.desc()),
    )
    task = db.scalar(select(AssessmentTask).where(AssessmentTask.assessment_id == issue.exam_id))
    return {
        "issued_id": issue.id,
        "exam_id": issue.exam_id,
        "assessment_title": exam.title if exam else f"Assessment #{issue.exam_id}",
        "assessment_type": exam.assessment_type if exam else None,
        "candidate_name": issue.candidate_name,
        "candidate_email": issue.candidate_email,
        "status": issue.status,
        "score_pct": issue.score_pct,
        "passed": issue.passed,
        "result": issue.result_json or {},
        "task": _task_to_dict(task, include_expected=True),
        "submission": {
            "id": submission.id,
            "submitted_data": submission.submitted_data_json or {},
            "score": submission.score,
            "auto_score": submission.auto_score,
            "manual_score": submission.manual_score,
            "status": submission.status,
            "submitted_at": submission.submitted_at,
            "time_taken_seconds": submission.time_taken_seconds,
            "proctoring_events": submission.proctoring_events_json,
        } if submission else None,
    }


@router.post("/issued/{issue_id}/review/finalize")
def finalize_issued_assessment_review(
    issue_id: int,
    payload: AssessmentReviewFinalizeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    issue = db.get(AssessmentIssue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issued assessment not found")
    if current_user.role != UserRole.ADMIN and int(issue.issuer_user_id) != int(current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")
    exam = db.get(Exam, issue.exam_id)
    submission = db.scalar(
        select(AssessmentSubmission)
        .where(AssessmentSubmission.issue_id == issue.id)
        .order_by(AssessmentSubmission.id.desc()),
    )
    if not exam or not submission:
        raise HTTPException(status_code=409, detail="No candidate submission is available for review")
    score_pct = round(float(payload.score_pct), 2)
    total_marks = float(exam.total_marks or 0)
    final_marks = round((score_pct / 100.0) * total_marks, 2) if total_marks > 0 else None
    submission.manual_score = final_marks
    submission.score = final_marks
    submission.status = "reviewed"
    issue.score_pct = score_pct
    issue.passed = score_pct >= float(exam.pass_score or 70)
    issue.status = "reviewed"
    result = issue.result_json if isinstance(issue.result_json, dict) else {}
    result["review"] = {
        "reviewer_user_id": current_user.id,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "score_pct": score_pct,
        "passed": issue.passed,
        "notes": payload.reviewer_notes.strip(),
    }
    issue.result_json = result
    db.add(submission)
    db.add(issue)
    db.commit()
    return {"status": issue.status, "score_pct": issue.score_pct, "passed": issue.passed}


@router.get("/catalog/published")
def list_published_assessment_catalog(
    q: str = Query(default="", max_length=120),
    duration: str = Query(default="all", pattern="^(all|short|standard|long)$"),
    sort: str = Query(default="latest", pattern="^(latest|title_asc|duration_asc|pass_desc|popular)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    rows = list(db.scalars(
        select(Exam)
        .where(Exam.status == ExamStatus.PUBLISHED)
        .order_by(Exam.id.desc()),
    ).all())
    needle = str(q or "").strip().lower()
    if needle:
        rows = [
            exam for exam in rows
            if needle in (exam.title or "").lower()
            or needle in _internal_assessment_id(exam.id).lower()
        ]
    if duration == "short":
        rows = [exam for exam in rows if int(exam.duration_minutes or 0) <= 30]
    elif duration == "standard":
        rows = [exam for exam in rows if 30 < int(exam.duration_minutes or 0) <= 45]
    elif duration == "long":
        rows = [exam for exam in rows if int(exam.duration_minutes or 0) > 45]

    issued_counts = {
        int(row._mapping["exam_id"]): int(row._mapping["count"] or 0)
        for row in db.execute(
            select(AssessmentIssue.exam_id, func.count(AssessmentIssue.id).label("count"))
            .where(AssessmentIssue.issuer_user_id == current_user.id)
            .group_by(AssessmentIssue.exam_id),
        ).all()
    }
    taken_counts = {
        int(row._mapping["exam_id"]): int(row._mapping["count"] or 0)
        for row in db.execute(
            select(AssessmentIssue.exam_id, func.count(AssessmentIssue.id).label("count"))
            .where(
                AssessmentIssue.issuer_user_id == current_user.id,
                AssessmentIssue.status.in_(["completed", "manual_review", "review_pending", "reviewed"]),
            )
            .group_by(AssessmentIssue.exam_id),
        ).all()
    }
    question_counts = {
        int(row._mapping["exam_id"]): int(row._mapping["count"] or 0)
        for row in db.execute(
            select(Question.exam_id, func.count(Question.id).label("count"))
            .group_by(Question.exam_id),
        ).all()
    }

    if sort == "title_asc":
        rows.sort(key=lambda exam: (exam.title or "").lower())
    elif sort == "duration_asc":
        rows.sort(key=lambda exam: int(exam.duration_minutes or 0))
    elif sort == "pass_desc":
        rows.sort(key=lambda exam: float(exam.pass_score or 70), reverse=True)
    elif sort == "popular":
        rows.sort(key=lambda exam: issued_counts.get(int(exam.id), 0), reverse=True)
    else:
        rows.sort(key=lambda exam: int(exam.id), reverse=True)

    out = []
    for exam in rows:
        question_count = question_counts.get(int(exam.id), 0)
        out.append(
            {
                "exam_id": exam.id,
                "internal_id": _internal_assessment_id(exam.id),
                "title": exam.title,
                "assessment_type": exam.assessment_type or AssessmentType.MCQ.value,
                "instructions": exam.instructions or "",
                **_exam_metadata_dict(exam),
                "duration_minutes": exam.duration_minutes,
                "timing_mode": getattr(exam, "timing_mode", None),
                "time_per_question_seconds": getattr(exam, "time_per_question_seconds", None),
                "pass_score": exam.pass_score,
                "questions_per_attempt": exam.questions_per_attempt,
                "question_count": question_count,
                "total_marks": exam.total_marks,
                "issued_count": issued_counts.get(int(exam.id), 0),
                "taken_count": taken_counts.get(int(exam.id), 0),
            },
        )
    return out


@router.post("/issued/login")
def issued_candidate_login(payload: IssuedCandidateLoginRequest, db: Session = Depends(get_db)):
    raise HTTPException(status_code=400, detail="Open this assessment from the recruiter email link.")


@router.post("/issued/key/{access_key}/login")
def issued_candidate_login_by_key(access_key: str, payload: IssuedCandidateLoginRequest, db: Session = Depends(get_db)):
    issue = db.scalar(select(AssessmentIssue).where(AssessmentIssue.access_key == access_key))
    if not issue or not verify_password(payload.password, issue.candidate_password_hash):
        raise HTTPException(status_code=401, detail="Invalid issued assessment credentials")
    now = datetime.now(timezone.utc)
    if _is_expired(issue.access_expires_at):
        raise HTTPException(status_code=401, detail="Credentials expired. Ask issuer for re-issue.")
    if issue.credential_used_at and issue.status in {"completed", "manual_review", "review_pending", "reviewed", "terminated"}:
        raise HTTPException(status_code=401, detail="Credentials already used. Ask issuer for re-issue.")
    session_token = secrets.token_urlsafe(32)
    issue.credential_used_at = issue.credential_used_at or now
    issue.active_session_token = session_token
    issue.active_session_started_at = now
    if issue.status == "issued":
        issue.status = "started"
        issue.started_at = now
    db.add(issue)
    db.commit()
    token = _create_issued_candidate_token(issue.id, session_token)
    return {"token": token, "session_token": session_token}


@router.get("/issued/me")
def issued_candidate_get_assessment(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    issue = _issued_issue_from_bearer_token(authorization, db)
    exam = db.get(Exam, issue.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if issue.status in {"completed", "manual_review", "review_pending", "reviewed", "terminated"}:
        return {"status": "submitted", "message": "Your assessment has been submitted for recruiter review."}
    assessment_type = str(exam.assessment_type or AssessmentType.MCQ.value)
    task = db.scalar(select(AssessmentTask).where(AssessmentTask.assessment_id == exam.id)) if assessment_type != AssessmentType.MCQ.value else None
    questions = _questions_for_issued_attempt(db, issue, exam) if assessment_type == AssessmentType.MCQ.value else []
    payload_questions = []
    for q in questions:
        opts = list(db.scalars(select(Option).where(Option.question_id == q.id).order_by(Option.position.asc(), Option.id.asc())).all())
        payload_questions.append(
            {
                "question_id": q.id,
                "question_text": q.question_text,
                "question_type": q.question_type.value,
                "options": [{"id": o.id, "text": o.option_text} for o in opts],
            },
        )
    return {
        "status": issue.status,
        "issued_id": issue.id,
        "candidate_name": issue.candidate_name,
        "assessment_title": exam.title,
        "assessment_type": assessment_type,
        "instructions": exam.instructions or "",
        **_exam_metadata_dict(exam),
        "duration_minutes": exam.duration_minutes,
        "timing_mode": exam.timing_mode,
        "time_per_question_seconds": exam.time_per_question_seconds,
        "questions_per_attempt": exam.questions_per_attempt,
        "pass_score": exam.pass_score,
        "total_marks": exam.total_marks,
        "task": _task_to_dict(task, include_expected=False),
        "questions": payload_questions,
    }


@router.post("/issued/consent")
def issued_candidate_consent(
    payload: IssuedCandidateConsentRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    issue = _issued_issue_from_bearer_token(authorization, db)
    if issue.status in {"completed", "manual_review", "review_pending", "reviewed", "terminated"}:
        raise HTTPException(status_code=409, detail="Assessment is no longer active")
    state = _issued_proctoring_state(issue)
    state["consent"] = {
        "policy_version": payload.policy_version,
        "consent_version": payload.consent_version,
        "camera": bool(payload.camera),
        "microphone": bool(payload.microphone),
        "recording": bool(payload.recording),
        "accepted_at": datetime.now(timezone.utc).isoformat(),
    }
    issue.result_json = {"proctoring": state}
    db.add(issue)
    db.commit()
    return {"accepted": True, "consent": state["consent"]}


@router.post("/issued/proctor-event")
def issued_candidate_proctor_event(
    payload: IssuedCandidateProctorEventRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Record candidate-side policy violations before the final submission.

    Issued candidates do not have a recruiter/student account, so this uses the
    short-lived issued token and keeps a bounded audit trail on the issue row.
    The fifth warning terminates the attempt and forces manual review.
    """
    issue = _issued_issue_from_bearer_token(authorization, db)
    if issue.status in {"completed", "manual_review", "review_pending", "reviewed", "terminated"}:
        return {"warning_count": 0, "should_terminate": True, "status": issue.status}

    severity = str(payload.severity or "warning").strip().lower()
    if severity not in {"info", "warning", "critical"}:
        raise HTTPException(status_code=400, detail="Invalid proctor event severity")
    state = _issued_proctoring_state(issue)
    if severity in {"warning", "critical"}:
        state["warning_count"] = int(state.get("warning_count") or 0) + 1
    event = {
        "event_type": payload.event_type,
        "severity": severity,
        "details": payload.details or {},
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    state["events"] = [*(state.get("events") or [])[-99:], event]
    should_terminate = int(state["warning_count"]) >= 5 or "fullscreen" in payload.event_type.lower()
    if should_terminate:
        state["terminated"] = True
        state["termination_reason"] = "warning_limit_reached"
        issue.status = "terminated"
        issue.completed_at = datetime.now(timezone.utc)
    issue.result_json = {"proctoring": state}
    db.add(issue)
    db.commit()
    return {
        "warning_count": int(state["warning_count"]),
        "should_terminate": should_terminate,
        "status": issue.status,
    }


@router.post("/issued/submit")
def issued_candidate_submit(
    payload: IssuedCandidateSubmitRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    issue = _issued_issue_from_bearer_token(authorization, db)
    if issue.status in {"completed", "manual_review", "review_pending", "reviewed"}:
        raise HTTPException(status_code=409, detail="Assessment already submitted")
    proctoring_state = _issued_proctoring_state(issue)
    forced_manual_review = bool(proctoring_state.get("terminated"))
    submitted_events = payload.proctoring_events or []
    if isinstance(submitted_events, dict):
        submitted_events = [submitted_events]
    recorded_events = [*(proctoring_state.get("events") or []), *submitted_events]
    exam = db.get(Exam, issue.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Assessment not found")

    assessment_type = str(exam.assessment_type or AssessmentType.MCQ.value)
    submitted_at = datetime.now(timezone.utc)
    if assessment_type != AssessmentType.MCQ.value:
        task = db.scalar(select(AssessmentTask).where(AssessmentTask.assessment_id == exam.id))
        if not task:
            raise HTTPException(status_code=400, detail="Assessment task is missing")
        submitted_data = payload.submitted_data or {}
        auto_score, submission_status, score_detail = _score_task_submission(task, submitted_data)
        score_pct = round((float(auto_score or 0) / float(task.marks or 1)) * 100.0, 2) if auto_score is not None and float(task.marks or 0) > 0 else None
        if forced_manual_review:
            submission_status = "manual_review"
        submission = AssessmentSubmission(
            assessment_id=exam.id,
            candidate_id=issue.candidate_user_id,
            issue_id=issue.id,
            assessment_type=assessment_type,
            submitted_data_json=submitted_data,
            score=auto_score,
            auto_score=auto_score,
            manual_score=None,
            status="review_pending",
            started_at=issue.started_at,
            submitted_at=submitted_at,
            time_taken_seconds=payload.time_taken_seconds,
            proctoring_events_json=recorded_events,
        )
        db.add(submission)
        issue.status = "review_pending"
        issue.score_pct = None
        issue.passed = None
        issue.completed_at = submitted_at
        issue.result_json = {
            "assessment_type": assessment_type,
            "provisional_score": auto_score,
            "provisional_score_pct": score_pct,
            "status": "review_pending",
            "automatic_status": submission_status,
            "detail": score_detail,
            "proctoring": proctoring_state,
        }
        db.add(issue)
        db.commit()
        return {
            "status": "submitted",
            "message": "Your assessment has been submitted for recruiter review.",
        }

    questions = _questions_for_issued_attempt(db, issue, exam)
    if not questions:
        raise HTTPException(status_code=400, detail="Assessment has no questions")
    total_marks = 0.0
    awarded_marks = 0.0
    correct_count = 0
    for q in questions:
        total_marks += float(q.marks or 0)
        selected_raw = payload.answers.get(str(q.id))
        selected_ids: list[int] = []
        if isinstance(selected_raw, int):
            selected_ids = [selected_raw]
        elif isinstance(selected_raw, list):
            selected_ids = [int(x) for x in selected_raw if str(x).isdigit()]
        correct_ids = [int(x) for x in db.scalars(select(Option.id).where(Option.question_id == q.id, Option.is_correct.is_(True))).all()]
        is_correct = set(selected_ids) == set(correct_ids) and len(correct_ids) > 0
        if is_correct:
            awarded_marks += float(q.marks or 0)
            correct_count += 1
        elif bool(exam.negative_marking):
            awarded_marks -= float(q.negative_marks or 0)

    percentage = round((awarded_marks / total_marks) * 100.0, 2) if total_marks > 0 else 0.0
    issue.status = "review_pending"
    issue.score_pct = None
    issue.passed = None
    issue.completed_at = submitted_at
    issue.result_json = {"provisional_score_pct": percentage, "detail": {"correct_count": correct_count, "question_count": len(questions), "awarded_marks": awarded_marks, "total_marks": total_marks}, "proctoring": proctoring_state}
    db.add(
        AssessmentSubmission(
            assessment_id=exam.id,
            candidate_id=issue.candidate_user_id,
            issue_id=issue.id,
            assessment_type=assessment_type,
            submitted_data_json={"answers": payload.answers or {}},
            score=awarded_marks,
            auto_score=awarded_marks,
            status="review_pending",
            started_at=issue.started_at,
            submitted_at=submitted_at,
            time_taken_seconds=payload.time_taken_seconds,
            proctoring_events_json=recorded_events,
        ),
    )
    db.add(issue)
    db.commit()

    return {
        "status": "submitted",
        "message": "Your assessment has been submitted for recruiter review.",
    }

