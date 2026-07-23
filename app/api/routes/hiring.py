from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.entities import (
    HiringApplication,
    HiringCandidate,
    HiringComplianceCheck,
    HiringIntegration,
    HiringInterview,
    HiringScorecard,
    HiringStageEvent,
    JobRequisition,
    Organization,
    OrganizationAuditEvent,
    OrganizationMembership,
    ProviderProfile,
    User,
    UserRole,
)

router = APIRouter(prefix="/hiring", tags=["hiring-workspace"])

_MEMBER_ROLES = {"owner", "org_admin", "recruiter", "hiring_manager", "interviewer", "viewer"}
_PIPELINE_STAGES = ["applied", "screening", "assessment", "interview", "offer", "hired", "rejected", "withdrawn"]
_INTEGRATION_PROVIDERS = {"greenhouse", "lever", "workday", "ashby", "bamboohr", "successfactors", "custom_api"}


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=240)


class MembershipCreate(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    role: Literal["owner", "org_admin", "recruiter", "hiring_manager", "interviewer", "viewer"] = "recruiter"


class JobCreate(BaseModel):
    job_code: str = Field(min_length=2, max_length=60)
    title: str = Field(min_length=2, max_length=240)
    department: str = Field(default="General", max_length=160)
    location: str = Field(default="Remote", max_length=180)
    employment_type: str = Field(default="full_time", max_length=50)
    work_arrangement: str = Field(default="hybrid", max_length=40)
    headcount: int = Field(default=1, ge=1, le=10000)
    description: str = Field(default="", max_length=30000)
    responsibilities: list[str] = Field(default_factory=list, max_length=30)
    requirements: list[str] = Field(default_factory=list, max_length=30)
    skills: list[str] = Field(default_factory=list, max_length=50)
    compensation_min: float | None = Field(default=None, ge=0)
    compensation_max: float | None = Field(default=None, ge=0)
    compensation_currency: str = Field(default="USD", min_length=3, max_length=8)


class JobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=240)
    department: str | None = Field(default=None, max_length=160)
    location: str | None = Field(default=None, max_length=180)
    employment_type: str | None = Field(default=None, max_length=50)
    work_arrangement: str | None = Field(default=None, max_length=40)
    status: Literal["draft", "open", "paused", "closed"] | None = None
    headcount: int | None = Field(default=None, ge=1, le=10000)
    description: str | None = Field(default=None, max_length=30000)
    responsibilities: list[str] | None = Field(default=None, max_length=30)
    requirements: list[str] | None = Field(default=None, max_length=30)
    skills: list[str] | None = Field(default=None, max_length=50)


class JobDescriptionDraftRequest(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    department: str = Field(default="General", max_length=160)
    location: str = Field(default="Remote", max_length=180)
    employment_type: str = Field(default="full_time", max_length=50)
    work_arrangement: str = Field(default="hybrid", max_length=40)
    skills: list[str] = Field(default_factory=list, max_length=30)
    responsibilities: list[str] = Field(default_factory=list, max_length=20)
    requirements: list[str] = Field(default_factory=list, max_length=20)


class CandidateCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    email: str = Field(min_length=5, max_length=320)
    phone_number: str | None = Field(default=None, max_length=40)
    headline: str = Field(default="", max_length=300)
    location: str = Field(default="", max_length=180)
    source: str = Field(default="manual", max_length=80)
    resume_text: str = Field(default="", max_length=120000)
    skills: list[str] = Field(default_factory=list, max_length=100)
    experience_years: float | None = Field(default=None, ge=0, le=80)
    consent_obtained: bool = False


class ApplicationCreate(BaseModel):
    job_id: int = Field(gt=0)
    candidate_id: int = Field(gt=0)
    source: str = Field(default="manual", max_length=80)


class StageUpdate(BaseModel):
    stage: Literal["applied", "screening", "assessment", "interview", "offer", "hired", "rejected", "withdrawn"]
    reason: str = Field(default="", max_length=3000)


class InterviewCreate(BaseModel):
    application_id: int = Field(gt=0)
    interview_type: str = Field(default="structured", min_length=2, max_length=80)
    scheduled_at: datetime | None = None
    duration_minutes: int = Field(default=45, ge=15, le=480)
    meeting_url: str | None = Field(default=None, max_length=1000)
    interviewer_user_ids: list[int] = Field(default_factory=list, max_length=20)


class ScorecardCreate(BaseModel):
    recommendation: Literal["strong_yes", "yes", "mixed", "no", "strong_no"]
    overall_score: float = Field(ge=0, le=5)
    competencies: dict[str, float] = Field(default_factory=dict, max_length=30)
    evidence: str = Field(default="", max_length=10000)


class IntegrationUpdate(BaseModel):
    provider: str = Field(min_length=2, max_length=80)
    status: Literal["not_connected", "ready_to_connect", "connected", "paused"] = "ready_to_connect"
    external_account_name: str = Field(default="", max_length=200)
    sync_scope: list[str] = Field(default_factory=list, max_length=20)


def _list_strings(values: list[str]) -> list[str]:
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:100] or "organization"


def _write_audit(db: Session, organization_id: int, actor_user_id: int | None, action: str, target_type: str, target_id: int | None, details: dict | None = None) -> None:
    db.add(
        OrganizationAuditEvent(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details_json=details or {},
        ),
    )


def _is_org_admin(current_user: User, membership: OrganizationMembership | None) -> bool:
    return current_user.role == UserRole.ADMIN or bool(membership and membership.role in {"owner", "org_admin"})


def _ensure_bootstrap_organization(db: Session, user: User) -> tuple[Organization, OrganizationMembership]:
    membership = db.scalar(
        select(OrganizationMembership)
        .where(OrganizationMembership.user_id == user.id, OrganizationMembership.status == "active")
        .order_by(OrganizationMembership.id.asc()),
    )
    if membership:
        organization = db.get(Organization, membership.organization_id)
        if organization:
            return organization, membership

    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user.id))
    display_name = (profile.display_name if profile else "") or user.full_name or user.email.split("@", 1)[0]
    base_slug = _slugify(display_name)
    slug = base_slug
    suffix = 2
    while db.scalar(select(Organization.id).where(Organization.slug == slug)):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    organization = Organization(name=display_name, slug=slug, created_by_user_id=user.id)
    db.add(organization)
    db.flush()
    membership = OrganizationMembership(organization_id=organization.id, user_id=user.id, role="owner")
    db.add(membership)
    _write_audit(db, organization.id, user.id, "organization_bootstrapped", "organization", organization.id)
    db.commit()
    db.refresh(organization)
    db.refresh(membership)
    return organization, membership


def _organization_context(db: Session, current_user: User, organization_id: int | None = None) -> tuple[Organization, OrganizationMembership | None]:
    if organization_id:
        organization = db.get(Organization, organization_id)
        if not organization or organization.status != "active":
            raise HTTPException(status_code=404, detail="Organization not found")
        if current_user.role == UserRole.ADMIN:
            return organization, None
        membership = db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization.id,
                OrganizationMembership.user_id == current_user.id,
                OrganizationMembership.status == "active",
            ),
        )
        if not membership:
            raise HTTPException(status_code=403, detail="You do not have access to this organization")
        return organization, membership
    if current_user.role == UserRole.ADMIN:
        organization = db.scalar(select(Organization).where(Organization.status == "active").order_by(Organization.id.asc()))
        if not organization:
            raise HTTPException(status_code=404, detail="No organization has been created yet")
        return organization, None
    return _ensure_bootstrap_organization(db, current_user)


def _job_or_404(db: Session, organization_id: int, job_id: int) -> JobRequisition:
    job = db.scalar(select(JobRequisition).where(JobRequisition.id == job_id, JobRequisition.organization_id == organization_id))
    if not job:
        raise HTTPException(status_code=404, detail="Job requisition not found")
    return job


def _candidate_or_404(db: Session, organization_id: int, candidate_id: int) -> HiringCandidate:
    candidate = db.scalar(select(HiringCandidate).where(HiringCandidate.id == candidate_id, HiringCandidate.organization_id == organization_id))
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


def _application_or_404(db: Session, organization_id: int, application_id: int) -> HiringApplication:
    application = db.scalar(select(HiringApplication).where(HiringApplication.id == application_id, HiringApplication.organization_id == organization_id))
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    return application


def _serialize_job(job: JobRequisition) -> dict:
    return {
        "id": job.id,
        "job_code": job.job_code,
        "title": job.title,
        "department": job.department,
        "location": job.location,
        "employment_type": job.employment_type,
        "work_arrangement": job.work_arrangement,
        "status": job.status,
        "headcount": job.headcount,
        "description": job.description,
        "responsibilities": job.responsibilities_json or [],
        "requirements": job.requirements_json or [],
        "skills": job.skills_json or [],
        "compensation_min": job.compensation_min,
        "compensation_max": job.compensation_max,
        "compensation_currency": job.compensation_currency,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _serialize_candidate(candidate: HiringCandidate) -> dict:
    return {
        "id": candidate.id,
        "first_name": candidate.first_name,
        "last_name": candidate.last_name,
        "full_name": f"{candidate.first_name} {candidate.last_name}".strip(),
        "email": candidate.email,
        "phone_number": candidate.phone_number,
        "headline": candidate.headline,
        "location": candidate.location,
        "source": candidate.source,
        "skills": candidate.skills_json or [],
        "experience_years": candidate.experience_years,
        "consent_status": candidate.consent_status,
        "created_at": candidate.created_at,
    }


def _screen_application(job: JobRequisition, candidate: HiringCandidate) -> tuple[float, float, str, dict]:
    job_skills = {skill.lower() for skill in _list_strings(job.skills_json or [])}
    candidate_skills = {skill.lower() for skill in _list_strings(candidate.skills_json or [])}
    resume = (candidate.resume_text or "").lower()
    inferred = {skill for skill in job_skills if skill in resume}
    matched = sorted(job_skills & (candidate_skills | inferred))
    missing = sorted(job_skills - set(matched))
    skill_score = 100.0 if not job_skills else (len(matched) / len(job_skills)) * 100.0
    experience_bonus = min(12.0, float(candidate.experience_years or 0) * 2.0)
    score = round(min(100.0, skill_score * 0.88 + experience_bonus), 1)
    confidence = round(min(0.95, 0.35 + (0.6 if job_skills else 0.25) * min(1.0, len(candidate_skills | inferred) / max(1, len(job_skills)))), 2)
    recommendation = "prioritize_human_review" if score >= 70 else "human_review_needed"
    rationale = {
        "matched_skills": matched,
        "missing_skills": missing,
        "evidence_sources": ["candidate profile", "resume text"] if candidate.resume_text else ["candidate profile"],
        "limitations": "This is an evidence-based screening aid. It does not make a hiring or rejection decision.",
    }
    return score, confidence, recommendation, rationale


@router.get("/workspace")
def hiring_workspace(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    jobs = list(db.scalars(select(JobRequisition).where(JobRequisition.organization_id == organization.id).order_by(JobRequisition.updated_at.desc()).limit(6)).all())
    app_count = db.scalar(select(func.count(HiringApplication.id)).where(HiringApplication.organization_id == organization.id)) or 0
    active_jobs = db.scalar(select(func.count(JobRequisition.id)).where(JobRequisition.organization_id == organization.id, JobRequisition.status == "open")) or 0
    interview_count = db.scalar(select(func.count(HiringInterview.id)).where(HiringInterview.organization_id == organization.id, HiringInterview.status == "scheduled")) or 0
    stage_rows = db.execute(
        select(HiringApplication.stage, func.count(HiringApplication.id))
        .where(HiringApplication.organization_id == organization.id)
        .group_by(HiringApplication.stage),
    ).all()
    return {
        "organization": {"id": organization.id, "name": organization.name, "slug": organization.slug, "plan_code": organization.plan_code},
        "membership_role": membership.role if membership else "platform_admin",
        "pipeline_stages": _PIPELINE_STAGES,
        "metrics": {"open_jobs": int(active_jobs), "applications": int(app_count), "scheduled_interviews": int(interview_count)},
        "pipeline": {stage: int(count) for stage, count in stage_rows},
        "recent_jobs": [_serialize_job(job) for job in jobs],
    }


@router.get("/organizations")
def list_organizations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    if current_user.role == UserRole.ADMIN:
        rows = list(db.scalars(select(Organization).where(Organization.status == "active").order_by(Organization.name.asc())).all())
    else:
        ids = select(OrganizationMembership.organization_id).where(OrganizationMembership.user_id == current_user.id, OrganizationMembership.status == "active")
        rows = list(db.scalars(select(Organization).where(Organization.id.in_(ids), Organization.status == "active").order_by(Organization.name.asc())).all())
    return [{"id": row.id, "name": row.name, "slug": row.slug, "plan_code": row.plan_code} for row in rows]


@router.post("/organizations", status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    base_slug = _slugify(payload.name)
    slug = base_slug
    counter = 2
    while db.scalar(select(Organization.id).where(Organization.slug == slug)):
        slug = f"{base_slug}-{counter}"
        counter += 1
    organization = Organization(name=payload.name.strip(), legal_name=(payload.legal_name or "").strip() or None, slug=slug, created_by_user_id=current_user.id)
    db.add(organization)
    db.flush()
    _write_audit(db, organization.id, current_user.id, "organization_created", "organization", organization.id)
    db.commit()
    return {"id": organization.id, "name": organization.name, "slug": organization.slug}


@router.post("/members", status_code=status.HTTP_201_CREATED)
def add_member(
    payload: MembershipCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if not _is_org_admin(current_user, membership):
        raise HTTPException(status_code=403, detail="Only organization administrators can add members")
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.strip().lower()))
    if not user:
        raise HTTPException(status_code=404, detail="User must be provisioned before being added to an organization")
    existing = db.scalar(select(OrganizationMembership).where(OrganizationMembership.organization_id == organization.id, OrganizationMembership.user_id == user.id))
    if existing:
        existing.role = payload.role
        existing.status = "active"
    else:
        db.add(OrganizationMembership(organization_id=organization.id, user_id=user.id, role=payload.role))
    _write_audit(db, organization.id, current_user.id, "organization_member_added", "user", user.id, {"role": payload.role})
    db.commit()
    return {"user_id": user.id, "email": user.email, "role": payload.role}


@router.get("/jobs")
def list_jobs(
    organization_id: int | None = Query(default=None, gt=0),
    job_status: str | None = Query(default=None, max_length=30),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, _ = _organization_context(db, current_user, organization_id)
    query = select(JobRequisition).where(JobRequisition.organization_id == organization.id)
    if job_status:
        query = query.where(JobRequisition.status == job_status)
    rows = list(db.scalars(query.order_by(JobRequisition.updated_at.desc())).all())
    return [_serialize_job(row) for row in rows]


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
def create_job(
    payload: JobCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role == "viewer":
        raise HTTPException(status_code=403, detail="View-only members cannot create jobs")
    job = JobRequisition(
        organization_id=organization.id,
        created_by_user_id=current_user.id,
        job_code=payload.job_code.strip().upper(),
        title=payload.title.strip(),
        department=payload.department.strip() or "General",
        location=payload.location.strip() or "Remote",
        employment_type=payload.employment_type.strip(),
        work_arrangement=payload.work_arrangement.strip(),
        description=payload.description.strip(),
        responsibilities_json=_list_strings(payload.responsibilities),
        requirements_json=_list_strings(payload.requirements),
        skills_json=_list_strings(payload.skills),
        headcount=payload.headcount,
        compensation_min=payload.compensation_min,
        compensation_max=payload.compensation_max,
        compensation_currency=payload.compensation_currency.strip().upper(),
    )
    if job.compensation_min is not None and job.compensation_max is not None and job.compensation_min > job.compensation_max:
        raise HTTPException(status_code=422, detail="Compensation minimum cannot exceed maximum")
    db.add(job)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A job with this code already exists") from exc
    _write_audit(db, organization.id, current_user.id, "job_created", "job", job.id, {"job_code": job.job_code})
    db.commit()
    db.refresh(job)
    return _serialize_job(job)


@router.patch("/jobs/{job_id}")
def update_job(
    job_id: int,
    payload: JobUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role in {"viewer", "interviewer"}:
        raise HTTPException(status_code=403, detail="Your organization role cannot edit jobs")
    job = _job_or_404(db, organization.id, job_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field in {"responsibilities", "requirements", "skills"}:
            setattr(job, f"{field}_json", _list_strings(value or []))
        elif isinstance(value, str):
            setattr(job, field, value.strip())
        else:
            setattr(job, field, value)
    _write_audit(db, organization.id, current_user.id, "job_updated", "job", job.id, {"fields": sorted(payload.model_fields_set)})
    db.commit()
    db.refresh(job)
    return _serialize_job(job)


@router.post("/jobs/draft-description")
def draft_job_description(
    payload: JobDescriptionDraftRequest,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    skills = _list_strings(payload.skills)
    responsibilities = _list_strings(payload.responsibilities)
    requirements = _list_strings(payload.requirements)
    responsibility_lines = responsibilities or [f"Own measurable outcomes for the {payload.title} function", "Partner with cross-functional stakeholders and communicate progress clearly"]
    requirement_lines = requirements or ([f"Demonstrated experience with {', '.join(skills[:4])}" ] if skills else ["Relevant experience delivering measurable business outcomes"])
    description = "\n\n".join(
        [
            f"About the role\nWe are looking for a {payload.title} to join our {payload.department} team. This is a {payload.employment_type.replace('_', ' ')} role based in {payload.location} with a {payload.work_arrangement} working arrangement.",
            "What you will do\n" + "\n".join(f"- {item}" for item in responsibility_lines),
            "What you bring\n" + "\n".join(f"- {item}" for item in requirement_lines),
            "How we hire\nValases uses structured, job-relevant evaluation. Candidates receive clear information about the process and can request reasonable accommodations.",
        ],
    )
    return {"description": description, "skills": skills, "responsibilities": responsibility_lines, "requirements": requirement_lines, "generation_mode": "governed_template"}


@router.get("/candidates")
def list_candidates(
    organization_id: int | None = Query(default=None, gt=0),
    search: str | None = Query(default=None, max_length=160),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, _ = _organization_context(db, current_user, organization_id)
    query = select(HiringCandidate).where(HiringCandidate.organization_id == organization.id)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.where(
            func.lower(HiringCandidate.first_name + " " + HiringCandidate.last_name).like(term)
            | func.lower(HiringCandidate.email).like(term)
        )
    rows = list(db.scalars(query.order_by(HiringCandidate.updated_at.desc())).all())
    return [_serialize_candidate(row) for row in rows]


@router.post("/candidates", status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: CandidateCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role == "viewer":
        raise HTTPException(status_code=403, detail="View-only members cannot add candidates")
    email = payload.email.strip().lower()
    candidate = HiringCandidate(
        organization_id=organization.id,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        email=email,
        phone_number=(payload.phone_number or "").strip() or None,
        headline=payload.headline.strip(),
        location=payload.location.strip(),
        source=payload.source.strip() or "manual",
        resume_text=payload.resume_text.strip(),
        skills_json=_list_strings(payload.skills),
        experience_years=payload.experience_years,
        consent_status="granted" if payload.consent_obtained else "pending",
        consented_at=datetime.now(timezone.utc) if payload.consent_obtained else None,
    )
    db.add(candidate)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A candidate with this email already exists in this organization") from exc
    _write_audit(db, organization.id, current_user.id, "candidate_created", "candidate", candidate.id, {"source": candidate.source})
    db.commit()
    db.refresh(candidate)
    return _serialize_candidate(candidate)


@router.post("/applications", status_code=status.HTTP_201_CREATED)
def create_application(
    payload: ApplicationCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role == "viewer":
        raise HTTPException(status_code=403, detail="View-only members cannot create applications")
    _job_or_404(db, organization.id, payload.job_id)
    _candidate_or_404(db, organization.id, payload.candidate_id)
    application = HiringApplication(
        organization_id=organization.id,
        job_id=payload.job_id,
        candidate_id=payload.candidate_id,
        owner_user_id=current_user.id,
        source=payload.source.strip() or "manual",
    )
    db.add(application)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This candidate already has an application for this job") from exc
    db.add(HiringStageEvent(organization_id=organization.id, application_id=application.id, actor_user_id=current_user.id, to_stage="applied", reason="Application created"))
    _write_audit(db, organization.id, current_user.id, "application_created", "application", application.id)
    db.commit()
    return {"id": application.id, "stage": application.stage, "status": application.status}


@router.get("/applications")
def list_applications(
    organization_id: int | None = Query(default=None, gt=0),
    job_id: int | None = Query(default=None, gt=0),
    stage: str | None = Query(default=None, max_length=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, _ = _organization_context(db, current_user, organization_id)
    query = (
        select(HiringApplication, HiringCandidate, JobRequisition)
        .join(HiringCandidate, HiringCandidate.id == HiringApplication.candidate_id)
        .join(JobRequisition, JobRequisition.id == HiringApplication.job_id)
        .where(HiringApplication.organization_id == organization.id)
    )
    if job_id:
        query = query.where(HiringApplication.job_id == job_id)
    if stage:
        query = query.where(HiringApplication.stage == stage)
    rows = db.execute(query.order_by(HiringApplication.updated_at.desc())).all()
    return [
        {
            "id": application.id,
            "job_id": job.id,
            "job_title": job.title,
            "candidate": _serialize_candidate(candidate),
            "stage": application.stage,
            "status": application.status,
            "source": application.source,
            "ai_match_score": application.ai_match_score,
            "ai_confidence": application.ai_confidence,
            "ai_recommendation": application.ai_recommendation,
            "ai_rationale": application.ai_rationale_json or {},
            "human_decision": application.human_decision,
            "applied_at": application.applied_at,
        }
        for application, candidate, job in rows
    ]


@router.patch("/applications/{application_id}/stage")
def update_application_stage(
    application_id: int,
    payload: StageUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role in {"viewer", "interviewer"}:
        raise HTTPException(status_code=403, detail="Your organization role cannot move candidates")
    application = _application_or_404(db, organization.id, application_id)
    previous_stage = application.stage
    application.stage = payload.stage
    if payload.stage in {"rejected", "withdrawn", "hired"}:
        application.status = "closed"
        application.human_decision = payload.stage
    db.add(HiringStageEvent(organization_id=organization.id, application_id=application.id, actor_user_id=current_user.id, from_stage=previous_stage, to_stage=payload.stage, reason=payload.reason.strip()))
    _write_audit(db, organization.id, current_user.id, "application_stage_changed", "application", application.id, {"from": previous_stage, "to": payload.stage})
    db.commit()
    return {"id": application.id, "stage": application.stage, "status": application.status}


@router.post("/applications/{application_id}/screen")
def screen_application(
    application_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role in {"viewer", "interviewer"}:
        raise HTTPException(status_code=403, detail="Your organization role cannot run screening")
    application = _application_or_404(db, organization.id, application_id)
    job = _job_or_404(db, organization.id, application.job_id)
    candidate = _candidate_or_404(db, organization.id, application.candidate_id)
    score, confidence, recommendation, rationale = _screen_application(job, candidate)
    application.ai_match_score = score
    application.ai_confidence = confidence
    application.ai_recommendation = recommendation
    application.ai_rationale_json = rationale
    _write_audit(db, organization.id, current_user.id, "application_screened", "application", application.id, {"score": score, "recommendation": recommendation})
    db.commit()
    return {"match_score": score, "confidence": confidence, "recommendation": recommendation, "rationale": rationale, "human_review_required": True}


@router.get("/interviews")
def list_interviews(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, _ = _organization_context(db, current_user, organization_id)
    rows = db.execute(
        select(HiringInterview, HiringApplication, HiringCandidate, JobRequisition)
        .join(HiringApplication, HiringApplication.id == HiringInterview.application_id)
        .join(HiringCandidate, HiringCandidate.id == HiringApplication.candidate_id)
        .join(JobRequisition, JobRequisition.id == HiringApplication.job_id)
        .where(HiringInterview.organization_id == organization.id)
        .order_by(HiringInterview.scheduled_at.asc()),
    ).all()
    return [
        {
            "id": interview.id,
            "application_id": application.id,
            "candidate_name": f"{candidate.first_name} {candidate.last_name}".strip(),
            "job_title": job.title,
            "interview_type": interview.interview_type,
            "status": interview.status,
            "scheduled_at": interview.scheduled_at,
            "duration_minutes": interview.duration_minutes,
            "meeting_url": interview.meeting_url,
            "interviewer_user_ids": interview.interviewers_json or [],
        }
        for interview, application, candidate, job in rows
    ]


@router.post("/interviews", status_code=status.HTTP_201_CREATED)
def create_interview(
    payload: InterviewCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role in {"viewer", "interviewer"}:
        raise HTTPException(status_code=403, detail="Your organization role cannot schedule interviews")
    application = _application_or_404(db, organization.id, payload.application_id)
    interview = HiringInterview(
        organization_id=organization.id,
        application_id=application.id,
        scheduled_by_user_id=current_user.id,
        interview_type=payload.interview_type.strip(),
        scheduled_at=payload.scheduled_at,
        duration_minutes=payload.duration_minutes,
        meeting_url=(payload.meeting_url or "").strip() or None,
        interviewers_json=list(dict.fromkeys(payload.interviewer_user_ids)),
    )
    db.add(interview)
    if application.stage not in {"offer", "hired", "rejected", "withdrawn"}:
        previous_stage = application.stage
        application.stage = "interview"
        db.add(HiringStageEvent(organization_id=organization.id, application_id=application.id, actor_user_id=current_user.id, from_stage=previous_stage, to_stage="interview", reason="Interview scheduled"))
    db.flush()
    _write_audit(db, organization.id, current_user.id, "interview_scheduled", "interview", interview.id, {"application_id": application.id})
    db.commit()
    return {"id": interview.id, "status": interview.status, "scheduled_at": interview.scheduled_at}


@router.post("/interviews/{interview_id}/scorecard", status_code=status.HTTP_201_CREATED)
def submit_scorecard(
    interview_id: int,
    payload: ScorecardCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role == "viewer":
        raise HTTPException(status_code=403, detail="View-only members cannot submit scorecards")
    interview = db.scalar(select(HiringInterview).where(HiringInterview.id == interview_id, HiringInterview.organization_id == organization.id))
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    existing = db.scalar(select(HiringScorecard).where(HiringScorecard.interview_id == interview.id, HiringScorecard.reviewer_user_id == current_user.id))
    scorecard = existing or HiringScorecard(organization_id=organization.id, interview_id=interview.id, application_id=interview.application_id, reviewer_user_id=current_user.id)
    scorecard.recommendation = payload.recommendation
    scorecard.overall_score = payload.overall_score
    scorecard.competencies_json = {str(key)[:80]: max(0.0, min(5.0, float(value))) for key, value in payload.competencies.items()}
    scorecard.evidence = payload.evidence.strip()
    scorecard.submitted_at = datetime.now(timezone.utc)
    if not existing:
        db.add(scorecard)
    _write_audit(db, organization.id, current_user.id, "scorecard_submitted", "interview", interview.id, {"recommendation": payload.recommendation})
    db.commit()
    return {"id": scorecard.id, "recommendation": scorecard.recommendation, "overall_score": scorecard.overall_score}


@router.post("/applications/{application_id}/compliance/run")
def run_compliance_checks(
    application_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if membership and membership.role in {"viewer", "interviewer"}:
        raise HTTPException(status_code=403, detail="Your organization role cannot run compliance checks")
    application = _application_or_404(db, organization.id, application_id)
    candidate = _candidate_or_404(db, organization.id, application.candidate_id)
    scorecards = db.scalar(select(func.count(HiringScorecard.id)).where(HiringScorecard.application_id == application.id)) or 0
    checks = {
        "candidate_consent": ("passed" if candidate.consent_status == "granted" else "needs_review", {"consent_status": candidate.consent_status}),
        "structured_evidence": ("passed" if scorecards > 0 else "pending", {"submitted_scorecards": int(scorecards)}),
        "automated_decision_guardrail": ("passed", {"human_review_required": True, "automatic_rejection_enabled": False}),
    }
    results = []
    for check_type, (check_status, details) in checks.items():
        record = db.scalar(select(HiringComplianceCheck).where(HiringComplianceCheck.application_id == application.id, HiringComplianceCheck.check_type == check_type))
        if not record:
            record = HiringComplianceCheck(organization_id=organization.id, application_id=application.id, check_type=check_type)
            db.add(record)
        record.status = check_status
        record.details_json = details
        results.append({"check_type": check_type, "status": check_status, "details": details})
    _write_audit(db, organization.id, current_user.id, "compliance_checks_run", "application", application.id)
    db.commit()
    return {"application_id": application.id, "checks": results, "manual_review_required": any(item[0] != "passed" for item in checks.values())}


@router.get("/integrations")
def list_integrations(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, _ = _organization_context(db, current_user, organization_id)
    rows = list(db.scalars(select(HiringIntegration).where(HiringIntegration.organization_id == organization.id).order_by(HiringIntegration.provider.asc())).all())
    configured = {row.provider: row for row in rows}
    return [
        {
            "provider": provider,
            "status": configured[provider].status if provider in configured else "not_connected",
            "config": configured[provider].config_json if provider in configured else {},
            "last_synced_at": configured[provider].last_synced_at if provider in configured else None,
        }
        for provider in sorted(_INTEGRATION_PROVIDERS)
    ]


@router.put("/integrations")
def configure_integration(
    payload: IntegrationUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    if not _is_org_admin(current_user, membership):
        raise HTTPException(status_code=403, detail="Only organization administrators can configure integrations")
    provider = payload.provider.strip().lower()
    if provider not in _INTEGRATION_PROVIDERS:
        raise HTTPException(status_code=422, detail="Unsupported integration provider")
    record = db.scalar(select(HiringIntegration).where(HiringIntegration.organization_id == organization.id, HiringIntegration.provider == provider))
    if not record:
        record = HiringIntegration(organization_id=organization.id, provider=provider)
        db.add(record)
    record.status = payload.status
    # Credentials are intentionally never accepted or stored here. Connection
    # secrets belong in the deployment secret manager/OAuth flow.
    record.config_json = {"external_account_name": payload.external_account_name.strip(), "sync_scope": _list_strings(payload.sync_scope)}
    _write_audit(db, organization.id, current_user.id, "integration_configured", "integration", record.id, {"provider": provider, "status": record.status})
    db.commit()
    return {"provider": provider, "status": record.status, "config": record.config_json}
