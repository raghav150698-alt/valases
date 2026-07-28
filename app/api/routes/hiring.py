from __future__ import annotations

import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import get_settings
from app.db.session import get_db, set_database_organization_context
from app.models.entities import (
    ApprovalStatus,
    AssessmentIssue,
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
    ProviderType,
    User,
    UserApproval,
    UserRole,
)
from app.services.supabase_auth import invite_supabase_user
from app.services.organization_branding import (
    member_avatar_url,
    normalize_member_avatar,
    normalize_organization_logo,
    organization_logo_url,
)

router = APIRouter(prefix="/hiring", tags=["hiring-workspace"])

_MEMBER_ROLES = {"owner", "org_admin", "recruiter", "custom", "hiring_manager", "interviewer", "viewer"}
_PERMISSIONS = {
    "jobs.view",
    "jobs.manage",
    "candidates.view",
    "candidates.manage",
    "pipeline.view",
    "pipeline.manage",
    "assessments.view",
    "assessments.manage",
    "assessment_results.view",
    "interviews.view",
    "interviews.manage",
    "integrations.view",
    "integrations.manage",
    "reports.view",
    "members.manage",
    "organization.manage",
    "billing.manage",
    "sso.manage",
}
_ROLE_PERMISSIONS = {
    "owner": _PERMISSIONS,
    "org_admin": _PERMISSIONS,
    "recruiter": _PERMISSIONS - {"members.manage", "organization.manage", "billing.manage", "sso.manage"},
    "hiring_manager": {
        "candidates.view",
        "pipeline.view",
        "assessments.view",
        "assessments.manage",
        "assessment_results.view",
        "interviews.view",
        "interviews.manage",
        "reports.view",
    },
    "interviewer": {"candidates.view", "pipeline.view", "assessment_results.view", "interviews.view", "interviews.manage"},
    "viewer": {"jobs.view", "candidates.view", "pipeline.view", "assessments.view", "assessment_results.view", "interviews.view", "reports.view"},
}
_PIPELINE_STAGES = ["applied", "screening", "assessment", "interview", "offer", "hired", "rejected", "withdrawn"]
_INTEGRATION_CATALOG = {
    "greenhouse": {"category": "ats", "connection_mode": "oauth_or_api_key", "capabilities": ["jobs", "candidates", "applications", "stage_updates"]},
    "lever": {"category": "ats", "connection_mode": "oauth", "capabilities": ["jobs", "candidates", "applications", "stage_updates"]},
    "workday": {"category": "ats", "connection_mode": "enterprise_api", "capabilities": ["jobs", "candidates", "applications"]},
    "ashby": {"category": "ats", "connection_mode": "api_key", "capabilities": ["jobs", "candidates", "applications", "stage_updates"]},
    "bamboohr": {"category": "ats", "connection_mode": "oauth", "capabilities": ["jobs", "candidates", "employees"]},
    "successfactors": {"category": "ats", "connection_mode": "enterprise_api", "capabilities": ["jobs", "candidates", "applications"]},
    "google_calendar": {"category": "calendar", "connection_mode": "oauth", "capabilities": ["availability", "calendar_events", "video_meet_links"]},
    "outlook_calendar": {"category": "calendar", "connection_mode": "oauth", "capabilities": ["availability", "calendar_events"]},
    "microsoft_teams": {"category": "meeting", "connection_mode": "oauth", "capabilities": ["meeting_links", "calendar_events"]},
    "zoom": {"category": "meeting", "connection_mode": "oauth", "capabilities": ["meeting_links"]},
    "twilio_voice": {"category": "voice", "connection_mode": "service_credentials", "capabilities": ["candidate_calls", "scheduling_prompts"]},
    "custom_api": {"category": "custom", "connection_mode": "signed_webhook", "capabilities": ["jobs", "candidates", "applications"]},
}
_INTEGRATION_PROVIDERS = set(_INTEGRATION_CATALOG)


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=240)


class OrganizationProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    logo_data_url: str = Field(default="", max_length=800000)


class CurrentUserProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    avatar_data_url: str = Field(default="", max_length=800000)
    remove_avatar: bool = False


class MembershipCreate(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    full_name: str = Field(default="", max_length=200)
    role: Literal["org_admin", "recruiter", "custom"] = "recruiter"
    permissions: list[str] = Field(default_factory=list, max_length=40)
    authentication: Literal["email_invite", "sso_only"] = "email_invite"


class MembershipUpdate(BaseModel):
    role: Literal["org_admin", "recruiter", "custom"]
    permissions: list[str] = Field(default_factory=list, max_length=40)
    status: Literal["active", "suspended"] = "active"


class SsoConfigurationUpdate(BaseModel):
    provider: Literal[
        "microsoft_entra",
        "azure_ad",
        "okta",
        "google_workspace",
        "ping_identity",
        "onelogin",
        "wso2",
        "other_saml",
        "generic_saml",
    ]
    domains: list[str] = Field(min_length=1, max_length=20)
    idp_metadata_url: str = Field(default="", max_length=2000)
    initial_admin_email: str = Field(default="", max_length=320)
    enabled: bool = False
    enforce_for_members: bool = False


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
    evidence: str = Field(min_length=10, max_length=10000)


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


def _clean_permissions(role: str, permissions: list[str] | None = None) -> list[str]:
    if role != "custom":
        return sorted(_ROLE_PERMISSIONS.get(role, set()))
    return sorted({str(item).strip() for item in permissions or [] if str(item).strip() in _PERMISSIONS})


def _membership_permissions(current_user: User, membership: OrganizationMembership | None) -> set[str]:
    if current_user.role == UserRole.ADMIN:
        return set(_PERMISSIONS)
    if not membership:
        return set()
    if membership.role == "custom":
        return set(_clean_permissions("custom", membership.permissions_json or []))
    return set(_ROLE_PERMISSIONS.get(membership.role, set()))


def _require_permission(
    current_user: User,
    membership: OrganizationMembership | None,
    permission: str,
) -> None:
    if permission not in _membership_permissions(current_user, membership):
        raise HTTPException(status_code=403, detail=f"Your organization role does not allow {permission.replace('.', ' ')}")


def _public_integration_config(record: HiringIntegration | None) -> dict:
    config = dict(record.config_json or {}) if record else {}
    return {
        "external_account_name": str(config.get("external_account_name") or ""),
        "sync_scope": list(config.get("sync_scope") or []),
        "connected_at": config.get("connected_at"),
    }


def _oauth_catalog() -> dict:
    raw = str(get_settings().integration_oauth_config_json or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _oauth_state(provider: str, organization_id: int, actor_user_id: int) -> str:
    settings = get_settings()
    return jwt.encode(
        {
            "purpose": "integration_oauth",
            "provider": provider,
            "organization_id": organization_id,
            "actor_user_id": actor_user_id,
            "exp": int(datetime.now(timezone.utc).timestamp()) + 600,
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _integration_fernet() -> Fernet:
    settings = get_settings()
    configured = str(settings.integration_token_encryption_key or "").strip()
    if configured:
        try:
            return Fernet(configured.encode("ascii"))
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=503, detail="Integration token encryption key is invalid") from exc
    if settings.is_production:
        raise HTTPException(status_code=503, detail="Integration token encryption is not configured")
    derived = base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret_key.encode("utf-8")).digest())
    return Fernet(derived)


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
            set_database_organization_context(db, organization.id)
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
        set_database_organization_context(db, organization.id)
        return organization, membership
    if current_user.role == UserRole.ADMIN:
        organization = db.scalar(select(Organization).where(Organization.status == "active").order_by(Organization.id.asc()))
        if not organization:
            raise HTTPException(status_code=404, detail="No organization has been created yet")
        set_database_organization_context(db, organization.id)
        return organization, None
    organization, membership = _ensure_bootstrap_organization(db, current_user)
    set_database_organization_context(db, organization.id)
    return organization, membership


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


def _candidate_ranking(
    application: HiringApplication,
    candidate: HiringCandidate,
    job: JobRequisition,
    assessment_score: float | None,
) -> dict:
    required_skills = {str(skill).strip().lower() for skill in (job.skills_json or []) if str(skill).strip()}
    candidate_skills = {str(skill).strip().lower() for skill in (candidate.skills_json or []) if str(skill).strip()}
    resume = str(candidate.resume_text or "").lower()
    matched_skills = required_skills & (candidate_skills | {skill for skill in required_skills if skill in resume})
    skills_score = round(100.0 if not required_skills else len(matched_skills) / len(required_skills) * 100.0, 1)
    experience_score = round(min(100.0, max(0.0, float(candidate.experience_years or 0) * 10.0)), 1)
    available_scores = [skills_score, experience_score]
    if assessment_score is not None:
        available_scores.append(float(assessment_score))
    average_score = round(sum(available_scores) / len(available_scores), 1)
    return {
        "average_score": average_score,
        "skills_score": skills_score,
        "experience_score": experience_score,
        "assessment_score": assessment_score,
        "matched_skills": len(matched_skills),
        "required_skills": len(required_skills),
    }


def _application_evidence_summary(db: Session, application: HiringApplication) -> dict:
    scorecards = list(
        db.scalars(
            select(HiringScorecard)
            .where(HiringScorecard.application_id == application.id)
            .order_by(HiringScorecard.submitted_at.desc(), HiringScorecard.id.desc()),
        ).all(),
    )
    compliance = list(
        db.scalars(
            select(HiringComplianceCheck)
            .where(HiringComplianceCheck.application_id == application.id)
            .order_by(HiringComplianceCheck.check_type.asc()),
        ).all(),
    )
    submitted_scores = [float(item.overall_score) for item in scorecards if item.overall_score is not None]
    interview_average = round(sum(submitted_scores) / len(submitted_scores), 2) if submitted_scores else None
    screening_complete = application.ai_match_score is not None
    compliance_complete = bool(compliance)
    blocking_checks = [item.check_type for item in compliance if item.status != "passed"]
    evidence_complete = screening_complete and bool(scorecards) and compliance_complete and not blocking_checks
    return {
        "status": "ready_for_human_decision" if evidence_complete else "more_evidence_required",
        "human_review_required": True,
        "screening_complete": screening_complete,
        "scorecard_count": len(scorecards),
        "interview_average": interview_average,
        "compliance_complete": compliance_complete,
        "blocking_checks": blocking_checks,
        "message": (
            "Required evidence is present. A recruiter must make and document the final decision."
            if evidence_complete
            else "Collect the missing screening, interview, or compliance evidence before making a final decision."
        ),
    }


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
        "organization": {
            "id": organization.id,
            "name": organization.name,
            "slug": organization.slug,
            "plan_code": organization.plan_code,
            "logo_url": organization_logo_url(organization.settings_json),
        },
        "membership_role": membership.role if membership else "platform_admin",
        "current_user": {
            "full_name": current_user.full_name or current_user.email.split("@", 1)[0],
            "email": current_user.email,
            "avatar_url": member_avatar_url(organization.settings_json, current_user.id),
        },
        "permissions": sorted(_membership_permissions(current_user, membership) - {"sso.manage"}),
        "permission_catalog": sorted(_PERMISSIONS - {"sso.manage"}),
        "pipeline_stages": _PIPELINE_STAGES,
        "metrics": {"open_jobs": int(active_jobs), "applications": int(app_count), "scheduled_interviews": int(interview_count)},
        "pipeline": {stage: int(count) for stage, count in stage_rows},
        "recent_jobs": [_serialize_job(job) for job in jobs],
    }


@router.patch("/organization/profile")
def update_organization_profile(
    payload: OrganizationProfileUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "organization.manage")
    name = payload.name.strip()
    logo = normalize_organization_logo(payload.logo_data_url)
    previous_name = organization.name
    organization.name = name
    organization_settings = dict(organization.settings_json or {})
    if logo:
        organization_settings["branding"] = {
            **dict(organization_settings.get("branding") or {}),
            "logo_data_url": logo,
        }
        organization.settings_json = organization_settings
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "organization_profile_updated",
        "organization",
        organization.id,
        {"name_changed": previous_name != name, "logo_changed": bool(logo)},
    )
    db.commit()
    return {
        "id": organization.id,
        "name": organization.name,
        "logo_url": organization_logo_url(organization.settings_json),
    }


@router.patch("/profile")
def update_current_user_profile(
    payload: CurrentUserProfileUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, _ = _organization_context(db, current_user, organization_id)
    avatar = normalize_member_avatar(payload.avatar_data_url)
    current_user.full_name = payload.full_name.strip()
    settings_json = dict(organization.settings_json or {})
    profiles = dict(settings_json.get("member_profiles") or {})
    profile = dict(profiles.get(str(current_user.id)) or {})
    if payload.remove_avatar:
        profile.pop("avatar_data_url", None)
    elif avatar:
        profile["avatar_data_url"] = avatar
    if profile:
        profiles[str(current_user.id)] = profile
    else:
        profiles.pop(str(current_user.id), None)
    settings_json["member_profiles"] = profiles
    organization.settings_json = settings_json
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "user_profile_updated",
        "user",
        current_user.id,
        {"avatar_changed": bool(avatar) or payload.remove_avatar},
    )
    db.commit()
    return {
        "full_name": current_user.full_name,
        "email": current_user.email,
        "avatar_url": member_avatar_url(organization.settings_json, current_user.id),
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
    _require_permission(current_user, membership, "members.manage")
    role = payload.role.strip().lower()
    permissions = _clean_permissions(role, payload.permissions)
    if role == "custom" and not permissions:
        raise HTTPException(status_code=422, detail="Choose at least one permission for a custom role")
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    invitation_sent = False
    membership_status = "active"
    if not user:
        full_name = payload.full_name.strip() or email.split("@", 1)[0]
        if payload.authentication == "sso_only":
            sso = dict((organization.settings_json or {}).get("sso") or {})
            domains = {str(domain).strip().lower() for domain in sso.get("domains") or []}
            email_domain = email.rsplit("@", 1)[-1] if "@" in email else ""
            if email_domain not in domains:
                raise HTTPException(status_code=422, detail="The member email must use a domain configured for this organization's SSO")
            membership_status = "pending_sso"
        else:
            try:
                invitation = invite_supabase_user(
                    email=email,
                    full_name=full_name,
                    redirect_to=f"{get_settings().app_base_url.rstrip('/')}/assessment/",
                    settings=get_settings(),
                )
            except ValueError as exc:
                raise HTTPException(status_code=502, detail=f"Could not send the member invitation: {exc}") from exc
            if not invitation.get("configured"):
                raise HTTPException(status_code=503, detail="Supabase member invitations are not configured")
            invitation_sent = bool(invitation.get("sent"))
        user = User(
            email=email,
            full_name=full_name,
            password_hash="sso_pending" if payload.authentication == "sso_only" else "supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        db.add(user)
        db.flush()
        db.add(
            UserApproval(
                user_id=user.id,
                status=ApprovalStatus.APPROVED,
                reviewed_by_admin_id=current_user.id,
                reviewed_at=datetime.now(timezone.utc),
            ),
        )
        db.add(
            ProviderProfile(
                user_id=user.id,
                provider_type=ProviderType.BUSINESS,
                display_name=organization.name,
                description="Valases organization member",
                approval_status=ApprovalStatus.APPROVED,
                reviewed_by_admin_id=current_user.id,
                reviewed_at=datetime.now(timezone.utc),
            ),
        )
    elif payload.authentication == "sso_only":
        existing_for_organization = db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization.id,
                OrganizationMembership.user_id == user.id,
            ),
        )
        if not existing_for_organization and user.password_hash != "sso_pending":
            raise HTTPException(
                status_code=409,
                detail="This email already has a non-SSO account. Use a new work email or add the existing account with an email invitation.",
            )
        membership_status = "pending_sso"
    existing = db.scalar(select(OrganizationMembership).where(OrganizationMembership.organization_id == organization.id, OrganizationMembership.user_id == user.id))
    if existing:
        if existing.role == "owner":
            raise HTTPException(status_code=409, detail="The organization owner role cannot be replaced")
        existing.role = role
        existing.permissions_json = permissions
        existing.status = membership_status
    else:
        db.add(
            OrganizationMembership(
                organization_id=organization.id,
                user_id=user.id,
                role=role,
                permissions_json=permissions,
                status=membership_status,
            ),
        )
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "organization_member_added",
        "user",
        user.id,
        {
            "role": role,
            "permissions": permissions,
            "authentication": payload.authentication,
            "membership_status": membership_status,
        },
    )
    db.commit()
    return {
        "user_id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": role,
        "permissions": permissions,
        "status": membership_status,
        "authentication": payload.authentication,
        "invitation_sent": invitation_sent,
    }


@router.get("/members")
def list_members(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "members.manage")
    rows = db.execute(
        select(OrganizationMembership, User)
        .join(User, User.id == OrganizationMembership.user_id)
        .where(OrganizationMembership.organization_id == organization.id)
        .order_by(User.full_name.asc(), User.email.asc()),
    ).all()
    return [
        {
            "id": member.id,
            "user_id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": member.role,
            "permissions": sorted(_membership_permissions(user, member)) if user.role == UserRole.ADMIN else _clean_permissions(member.role, member.permissions_json or []),
            "status": member.status,
            "is_current_user": user.id == current_user.id,
        }
        for member, user in rows
    ]


@router.patch("/members/{membership_id}")
def update_member(
    membership_id: int,
    payload: MembershipUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "members.manage")
    target = db.get(OrganizationMembership, membership_id)
    if not target or target.organization_id != organization.id:
        raise HTTPException(status_code=404, detail="Organization member not found")
    if target.role == "owner":
        raise HTTPException(status_code=409, detail="The organization owner cannot be modified")
    if target.user_id == current_user.id and payload.status != "active":
        raise HTTPException(status_code=409, detail="You cannot suspend your own organization access")
    permissions = _clean_permissions(payload.role, payload.permissions)
    if payload.role == "custom" and not permissions:
        raise HTTPException(status_code=422, detail="Choose at least one permission for a custom role")
    target.role = payload.role
    target.permissions_json = permissions
    target.status = payload.status
    _write_audit(db, organization.id, current_user.id, "organization_member_updated", "membership", target.id, {"role": target.role, "status": target.status, "permissions": permissions})
    db.commit()
    return {"id": target.id, "role": target.role, "permissions": permissions, "status": target.status}


@router.delete("/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    membership_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "members.manage")
    target = db.get(OrganizationMembership, membership_id)
    if not target or target.organization_id != organization.id:
        raise HTTPException(status_code=404, detail="Organization member not found")
    if target.role == "owner":
        raise HTTPException(status_code=409, detail="The organization owner cannot be removed")
    if target.user_id == current_user.id:
        raise HTTPException(status_code=409, detail="You cannot remove your own organization access")
    target.status = "removed"
    _write_audit(db, organization.id, current_user.id, "organization_member_removed", "membership", target.id)
    db.commit()


@router.get("/jobs")
def list_jobs(
    organization_id: int | None = Query(default=None, gt=0),
    job_status: str | None = Query(default=None, max_length=30),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "jobs.view")
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
    _require_permission(current_user, membership, "jobs.manage")
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
        status="open",
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
    _require_permission(current_user, membership, "jobs.manage")
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
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    _, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "jobs.manage")
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
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "candidates.view")
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
    _require_permission(current_user, membership, "candidates.manage")
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
    _require_permission(current_user, membership, "pipeline.manage")
    _job_or_404(db, organization.id, payload.job_id)
    _candidate_or_404(db, organization.id, payload.candidate_id)
    application = HiringApplication(
        organization_id=organization.id,
        job_id=payload.job_id,
        candidate_id=payload.candidate_id,
        owner_user_id=current_user.id,
        source=payload.source.strip() or "manual",
        stage="screening",
    )
    db.add(application)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This candidate already has an application for this job") from exc
    db.add(HiringStageEvent(organization_id=organization.id, application_id=application.id, actor_user_id=current_user.id, to_stage="screening", reason="Candidate added to recruiter screening"))
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
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "pipeline.view")
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
    application_ids = [application.id for application, _, _ in rows]
    assessment_scores: dict[int, float] = {}
    if application_ids:
        reviewed_issues = list(
            db.scalars(
                select(AssessmentIssue)
                .where(
                    AssessmentIssue.hiring_application_id.in_(application_ids),
                    AssessmentIssue.score_pct.is_not(None),
                )
                .order_by(AssessmentIssue.completed_at.desc(), AssessmentIssue.id.desc()),
            ).all(),
        )
        for issue in reviewed_issues:
            assessment_scores.setdefault(int(issue.hiring_application_id), float(issue.score_pct))
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
            "ranking": _candidate_ranking(
                application,
                candidate,
                job,
                assessment_scores.get(application.id),
            ),
            "applied_at": application.applied_at,
        }
        for application, candidate, job in rows
    ]


@router.get("/applications/{application_id}")
def get_application_detail(
    application_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "pipeline.view")
    application = _application_or_404(db, organization.id, application_id)
    candidate = _candidate_or_404(db, organization.id, application.candidate_id)
    job = _job_or_404(db, organization.id, application.job_id)
    interviews = list(
        db.scalars(
            select(HiringInterview)
            .where(HiringInterview.application_id == application.id)
            .order_by(HiringInterview.scheduled_at.desc(), HiringInterview.id.desc()),
        ).all(),
    )
    scorecards = list(
        db.scalars(
            select(HiringScorecard)
            .where(HiringScorecard.application_id == application.id)
            .order_by(HiringScorecard.submitted_at.desc(), HiringScorecard.id.desc()),
        ).all(),
    )
    compliance = list(
        db.scalars(
            select(HiringComplianceCheck)
            .where(HiringComplianceCheck.application_id == application.id)
            .order_by(HiringComplianceCheck.check_type.asc()),
        ).all(),
    )
    stage_events = list(
        db.scalars(
            select(HiringStageEvent)
            .where(HiringStageEvent.application_id == application.id)
            .order_by(HiringStageEvent.created_at.desc(), HiringStageEvent.id.desc()),
        ).all(),
    )
    return {
        "id": application.id,
        "stage": application.stage,
        "status": application.status,
        "human_decision": application.human_decision,
        "candidate": _serialize_candidate(candidate),
        "job": _serialize_job(job),
        "screening": {
            "match_score": application.ai_match_score,
            "confidence": application.ai_confidence,
            "recommendation": application.ai_recommendation,
            "rationale": application.ai_rationale_json or {},
        },
        "evidence_summary": _application_evidence_summary(db, application),
        "interviews": [
            {
                "id": item.id,
                "status": item.status,
                "interview_type": item.interview_type,
                "scheduled_at": item.scheduled_at,
                "duration_minutes": item.duration_minutes,
                "meeting_url": item.meeting_url,
            }
            for item in interviews
        ],
        "scorecards": [
            {
                "id": item.id,
                "interview_id": item.interview_id,
                "reviewer_user_id": item.reviewer_user_id,
                "recommendation": item.recommendation,
                "overall_score": item.overall_score,
                "competencies": item.competencies_json or {},
                "evidence": item.evidence,
                "submitted_at": item.submitted_at,
            }
            for item in scorecards
        ],
        "compliance_checks": [
            {
                "check_type": item.check_type,
                "status": item.status,
                "details": item.details_json or {},
                "reviewed_at": item.reviewed_at,
            }
            for item in compliance
        ],
        "stage_history": [
            {
                "id": item.id,
                "from_stage": item.from_stage,
                "to_stage": item.to_stage,
                "reason": item.reason,
                "actor_user_id": item.actor_user_id,
                "created_at": item.created_at,
            }
            for item in stage_events
        ],
    }


@router.patch("/applications/{application_id}/stage")
def update_application_stage(
    application_id: int,
    payload: StageUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "pipeline.manage")
    application = _application_or_404(db, organization.id, application_id)
    reason = payload.reason.strip()
    if application.status == "closed" and payload.stage != application.stage:
        raise HTTPException(status_code=409, detail="Closed applications cannot be moved to another stage")
    if payload.stage in {"offer", "hired", "rejected", "withdrawn"} and len(reason) < 10:
        raise HTTPException(status_code=422, detail="Record a decision rationale of at least 10 characters")
    if payload.stage in {"offer", "hired"}:
        scorecard_count = db.scalar(select(func.count(HiringScorecard.id)).where(HiringScorecard.application_id == application.id)) or 0
        if scorecard_count < 1:
            raise HTTPException(status_code=409, detail="At least one structured interview scorecard is required before offer or hire")
    if payload.stage == "hired":
        candidate = _candidate_or_404(db, organization.id, application.candidate_id)
        if candidate.consent_status != "granted":
            raise HTTPException(status_code=409, detail="Candidate data-processing consent must be recorded before hire")
    previous_stage = application.stage
    application.stage = payload.stage
    if payload.stage in {"rejected", "withdrawn", "hired"}:
        application.status = "closed"
        application.human_decision = payload.stage
    db.add(HiringStageEvent(organization_id=organization.id, application_id=application.id, actor_user_id=current_user.id, from_stage=previous_stage, to_stage=payload.stage, reason=reason))
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "application_stage_changed",
        "application",
        application.id,
        {"from": previous_stage, "to": payload.stage, "reason": reason},
    )
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
    _require_permission(current_user, membership, "pipeline.manage")
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
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "interviews.view")
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
    _require_permission(current_user, membership, "interviews.manage")
    application = _application_or_404(db, organization.id, payload.application_id)
    if application.status != "active" or application.stage != "interview":
        raise HTTPException(status_code=409, detail="Interviews can only be scheduled for active candidates in the interview stage")
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
    _require_permission(current_user, membership, "interviews.manage")
    interview = db.scalar(select(HiringInterview).where(HiringInterview.id == interview_id, HiringInterview.organization_id == organization.id))
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    if not payload.competencies:
        raise HTTPException(status_code=422, detail="At least one scored competency is required")
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
    _require_permission(current_user, membership, "pipeline.manage")
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


@router.get("/sso")
def get_sso_configuration(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "sso.manage")
    sso = dict((organization.settings_json or {}).get("sso") or {})
    connection_status = str(sso.get("connection_status") or "not_configured")
    provider = {"azure_ad": "microsoft_entra", "generic_saml": "other_saml"}.get(
        str(sso.get("provider") or ""),
        str(sso.get("provider") or "microsoft_entra"),
    )
    return {
        "provider": provider,
        "domains": list(sso.get("domains") or []),
        "idp_metadata_url": str(sso.get("idp_metadata_url") or ""),
        "initial_admin_email": str(sso.get("initial_admin_email") or ""),
        "enabled": bool(sso.get("enabled")),
        "enforce_for_members": bool(sso.get("enforce_for_members")),
        "connection_status": connection_status,
        "status": "active" if sso.get("enabled") else connection_status,
    }


@router.put("/sso")
def update_sso_configuration(
    payload: SsoConfigurationUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "sso.manage")
    domains = sorted(
        {
            str(domain).strip().lower().lstrip("@")
            for domain in payload.domains
            if "." in str(domain).strip() and "@" not in str(domain).strip()
        },
    )
    if not domains:
        raise HTTPException(status_code=422, detail="Add at least one valid company email domain")
    metadata_url = payload.idp_metadata_url.strip()
    if metadata_url and not metadata_url.startswith("https://"):
        raise HTTPException(status_code=422, detail="Identity-provider metadata must use an HTTPS URL")
    admin_email = payload.initial_admin_email.strip().lower()
    if admin_email:
        admin_domain = admin_email.rsplit("@", 1)[-1] if "@" in admin_email else ""
        if admin_domain not in domains:
            raise HTTPException(status_code=422, detail="The initial administrator must use one of the configured company domains")
    existing_sso = dict((organization.settings_json or {}).get("sso") or {})
    existing_provider = {"azure_ad": "microsoft_entra", "generic_saml": "other_saml"}.get(
        str(existing_sso.get("provider") or ""),
        str(existing_sso.get("provider") or ""),
    )
    configuration_unchanged = (
        existing_provider == payload.provider
        and sorted(str(domain).strip().lower() for domain in existing_sso.get("domains") or []) == domains
        and str(existing_sso.get("idp_metadata_url") or "").strip() == metadata_url
    )
    verified = existing_sso.get("connection_status") == "verified" and configuration_unchanged
    if payload.enabled and not verified:
        raise HTTPException(status_code=409, detail="Complete a successful SAML test login before enabling SSO")
    if payload.enforce_for_members and not payload.enabled:
        raise HTTPException(status_code=422, detail="Enable SSO before requiring it for organization members")
    previous_status = str(existing_sso.get("connection_status") or "")
    connection_status = (
        "verified"
        if verified
        else previous_status
        if configuration_unchanged and previous_status in {"registration_pending", "registered", "error"}
        else "ready_for_registration"
        if metadata_url
        else "metadata_required"
    )
    operator_state = {
        key: existing_sso.get(key)
        for key in ("connection_id", "operator_notes", "last_error", "registered_at", "registered_by_user_id")
        if configuration_unchanged and existing_sso.get(key) is not None
    }
    settings_json = dict(organization.settings_json or {})
    settings_json["sso"] = {
        **operator_state,
        "provider": payload.provider,
        "domains": domains,
        "idp_metadata_url": metadata_url,
        "initial_admin_email": admin_email,
        "enabled": payload.enabled,
        "enforce_for_members": payload.enforce_for_members if payload.enabled else False,
        "connection_status": connection_status,
        "verified_at": existing_sso.get("verified_at"),
        "verified_by_email": existing_sso.get("verified_by_email"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    organization.settings_json = settings_json
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "organization_sso_updated",
        "organization",
        organization.id,
        {
            "provider": payload.provider,
            "domains": domains,
            "metadata_url_configured": bool(metadata_url),
            "enabled": payload.enabled,
            "enforced": payload.enforce_for_members,
        },
    )
    db.commit()
    return {**settings_json["sso"], "status": "active" if payload.enabled else connection_status}


@router.get("/integrations")
def list_integrations(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "integrations.view")
    rows = list(db.scalars(select(HiringIntegration).where(HiringIntegration.organization_id == organization.id).order_by(HiringIntegration.provider.asc())).all())
    configured = {row.provider: row for row in rows}
    oauth_catalog = _oauth_catalog()
    return [
        {
            "provider": provider,
            **_INTEGRATION_CATALOG[provider],
            "status": configured[provider].status if provider in configured else "not_connected",
            "config": _public_integration_config(configured.get(provider)),
            "connect_available": provider in oauth_catalog,
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
    _require_permission(current_user, membership, "integrations.manage")
    provider = payload.provider.strip().lower()
    if provider not in _INTEGRATION_PROVIDERS:
        raise HTTPException(status_code=422, detail="Unsupported integration provider")
    record = db.scalar(select(HiringIntegration).where(HiringIntegration.organization_id == organization.id, HiringIntegration.provider == provider))
    if payload.status == "connected" and (not record or record.status != "connected"):
        raise HTTPException(status_code=409, detail="A connector can only become connected through its verified OAuth or credential callback")
    if not record:
        record = HiringIntegration(organization_id=organization.id, provider=provider)
        db.add(record)
    existing_config = dict(record.config_json or {})
    record.status = payload.status
    # Credentials are intentionally never accepted or stored here. Connection
    # secrets belong in the deployment secret manager/OAuth flow.
    record.config_json = {
        "external_account_name": payload.external_account_name.strip(),
        "sync_scope": _list_strings(payload.sync_scope),
        **({"credentials_encrypted": existing_config["credentials_encrypted"]} if existing_config.get("credentials_encrypted") else {}),
        **({"connected_at": existing_config["connected_at"]} if existing_config.get("connected_at") else {}),
    }
    _write_audit(db, organization.id, current_user.id, "integration_configured", "integration", record.id, {"provider": provider, "status": record.status})
    db.commit()
    return {"provider": provider, "status": record.status, "config": _public_integration_config(record)}


@router.post("/integrations/{provider}/connect")
def begin_integration_connection(
    provider: str,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "integrations.manage")
    provider = provider.strip().lower()
    if provider not in _INTEGRATION_PROVIDERS:
        raise HTTPException(status_code=404, detail="Integration provider not found")
    config = _oauth_catalog().get(provider)
    if not isinstance(config, dict):
        raise HTTPException(
            status_code=409,
            detail=f"{provider.replace('_', ' ').title()} OAuth is not configured for this deployment",
        )
    client_id = str(config.get("client_id") or "").strip()
    authorization_url = str(config.get("authorization_url") or "").strip()
    if not client_id or not authorization_url.startswith("https://"):
        raise HTTPException(status_code=503, detail="The integration OAuth configuration is incomplete")
    callback_url = str(config.get("redirect_uri") or f"{get_settings().app_base_url.rstrip('/')}/hiring/integrations/oauth/callback")
    query = {
        "client_id": client_id,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": " ".join(config.get("scopes") or []),
        "state": _oauth_state(provider, organization.id, current_user.id),
    }
    query.update({str(key): str(value) for key, value in dict(config.get("authorize_params") or {}).items()})
    record = db.scalar(select(HiringIntegration).where(HiringIntegration.organization_id == organization.id, HiringIntegration.provider == provider))
    if not record:
        record = HiringIntegration(organization_id=organization.id, provider=provider, status="ready_to_connect")
        db.add(record)
    else:
        record.status = "ready_to_connect"
    _write_audit(db, organization.id, current_user.id, "integration_connection_started", "integration", record.id, {"provider": provider})
    db.commit()
    return {"provider": provider, "authorization_url": f"{authorization_url}?{urlencode(query)}"}


@router.get("/integrations/oauth/callback", include_in_schema=False)
def complete_integration_connection(
    code: str = Query(min_length=4, max_length=4000),
    state_token: str = Query(alias="state", min_length=20, max_length=5000),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    try:
        state_payload = jwt.decode(state_token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired integration connection state") from exc
    if state_payload.get("purpose") != "integration_oauth":
        raise HTTPException(status_code=400, detail="Invalid integration connection purpose")
    provider = str(state_payload.get("provider") or "").strip().lower()
    organization_id = int(state_payload.get("organization_id") or 0)
    actor_user_id = int(state_payload.get("actor_user_id") or 0)
    config = _oauth_catalog().get(provider)
    if not isinstance(config, dict):
        raise HTTPException(status_code=503, detail="Integration OAuth is no longer configured")
    token_url = str(config.get("token_url") or "").strip()
    client_id = str(config.get("client_id") or "").strip()
    client_secret = str(config.get("client_secret") or "").strip()
    callback_url = str(config.get("redirect_uri") or f"{settings.app_base_url.rstrip('/')}/hiring/integrations/oauth/callback")
    if not token_url.startswith("https://") or not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Integration token exchange is not configured")
    response = httpx.post(
        token_url,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": callback_url,
        },
        headers={"Accept": "application/json"},
        timeout=20,
    )
    if response.status_code not in {200, 201}:
        raise HTTPException(status_code=502, detail="The provider did not complete the integration connection")
    token_payload = response.json()
    if not token_payload.get("access_token"):
        raise HTTPException(status_code=502, detail="The provider did not return an access token")
    set_database_organization_context(db, organization_id)
    record = db.scalar(select(HiringIntegration).where(HiringIntegration.organization_id == organization_id, HiringIntegration.provider == provider))
    if not record:
        record = HiringIntegration(organization_id=organization_id, provider=provider)
        db.add(record)
    public_config = _public_integration_config(record)
    record.status = "connected"
    record.config_json = {
        **public_config,
        "credentials_encrypted": _integration_fernet().encrypt(json.dumps(token_payload).encode("utf-8")).decode("ascii"),
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_audit(db, organization_id, actor_user_id, "integration_connected", "integration", record.id, {"provider": provider})
    db.commit()
    return RedirectResponse(url=f"{settings.app_base_url.rstrip('/')}/assessment/?integration={provider}&connection=success", status_code=303)
