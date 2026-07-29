from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Literal
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse, Response
import jwt
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
    HiringCommunication,
    HiringComplianceCheck,
    HiringIntegration,
    HiringInterview,
    HiringOffer,
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
from app.services.notifications import send_email
from app.services.offer_documents import compensation_totals, public_offer_reference, render_offer_pdf
from app.services.supabase_auth import invite_supabase_user
from app.services.organization_branding import (
    member_avatar_url,
    normalize_member_avatar,
    normalize_organization_logo,
    organization_logo_url,
)

router = APIRouter(prefix="/hiring", tags=["hiring-workspace"])

_MEMBER_ROLES = {"owner", "org_admin", "recruiter", "custom", "hiring_manager", "interviewer", "viewer", "payroll"}
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
    "offers.view",
    "offers.manage",
    "offers.compensation",
    "offers.release",
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
    "payroll": {"offers.view", "offers.compensation"},
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
    role: Literal["org_admin", "recruiter", "payroll", "custom"] = "recruiter"
    permissions: list[str] = Field(default_factory=list, max_length=40)
    authentication: Literal["email_invite", "sso_only"] = "email_invite"


class MembershipUpdate(BaseModel):
    role: Literal["org_admin", "recruiter", "payroll", "custom"]
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


class AtsApplicationImport(BaseModel):
    external_application_id: str = Field(min_length=1, max_length=240)
    external_candidate_id: str = Field(default="", max_length=240)
    external_job_id: str = Field(default="", max_length=240)
    job_code: str = Field(min_length=1, max_length=60)
    job_title: str = Field(min_length=2, max_length=240)
    candidate_email: str = Field(min_length=5, max_length=320)
    candidate_first_name: str = Field(min_length=1, max_length=120)
    candidate_last_name: str = Field(default="", max_length=120)
    candidate_headline: str = Field(default="", max_length=300)
    candidate_location: str = Field(default="", max_length=180)
    candidate_skills: list[str] = Field(default_factory=list, max_length=100)
    candidate_experience_years: float | None = Field(default=None, ge=0, le=80)
    resume_text: str = Field(default="", max_length=120000)
    stage: Literal["applied", "screening", "assessment", "interview", "offer", "hired", "rejected", "withdrawn"] = "applied"
    applied_at: datetime | None = None


class AtsApplicationBatch(BaseModel):
    applications: list[AtsApplicationImport] = Field(min_length=1, max_length=500)


class StageUpdate(BaseModel):
    stage: Literal["applied", "screening", "assessment", "interview", "offer", "hired", "rejected", "withdrawn"]
    reason: str = Field(default="", max_length=3000)


class RejectionRequest(BaseModel):
    reason_code: Literal["position_filled", "skills_not_met", "experience_not_met", "assessment_result", "interview_outcome", "position_closed", "other"]
    notes: str = Field(default="", max_length=3000)
    sender_mode: Literal["company", "recruiter"] = "company"
    subject: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=10000)
    send_email: bool = True


class JobCloseVacanciesRequest(BaseModel):
    sender_mode: Literal["company", "recruiter"] = "company"
    subject: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=10000)
    send_email: bool = True


class PayrollLineItem(BaseModel):
    label: str = Field(min_length=2, max_length=120)
    amount: float = Field(gt=0)
    description: str = Field(default="", max_length=500)


class OfferCreate(BaseModel):
    application_id: int = Field(gt=0)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    pay_frequency: Literal["annual", "monthly", "hourly"] = "annual"
    base_compensation: float | None = Field(default=None, ge=0)
    variable_compensation: float = Field(default=0, ge=0)
    benefits_value: float = Field(default=0, ge=0)
    earnings: list[PayrollLineItem] = Field(default_factory=list, max_length=30)
    deductions: list[PayrollLineItem] = Field(default_factory=list, max_length=30)
    employment_type: str = Field(default="Full-time", min_length=2, max_length=80)
    work_location: str = Field(default="", max_length=240)
    reporting_manager: str = Field(default="", max_length=240)
    probation_months: int = Field(default=6, ge=0, le=24)
    notice_period_days: int = Field(default=30, ge=0, le=365)
    start_date: datetime | None = None
    expires_at: datetime | None = None
    letter_body: str = Field(default="", max_length=30000)
    terms_text: str = Field(default="", max_length=30000)


class OfferUpdate(BaseModel):
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    pay_frequency: Literal["annual", "monthly", "hourly"] | None = None
    base_compensation: float | None = Field(default=None, ge=0)
    variable_compensation: float | None = Field(default=None, ge=0)
    benefits_value: float | None = Field(default=None, ge=0)
    earnings: list[PayrollLineItem] | None = Field(default=None, max_length=30)
    deductions: list[PayrollLineItem] | None = Field(default=None, max_length=30)
    employment_type: str | None = Field(default=None, min_length=2, max_length=80)
    work_location: str | None = Field(default=None, max_length=240)
    reporting_manager: str | None = Field(default=None, max_length=240)
    probation_months: int | None = Field(default=None, ge=0, le=24)
    notice_period_days: int | None = Field(default=None, ge=0, le=365)
    start_date: datetime | None = None
    expires_at: datetime | None = None
    letter_body: str | None = Field(default=None, max_length=30000)
    terms_text: str | None = Field(default=None, max_length=30000)


class OfferDecision(BaseModel):
    signature_name: str = Field(min_length=2, max_length=240)
    accepted: bool
    consent: bool


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


def _is_past(value: datetime | None) -> bool:
    if value is None:
        return False
    comparable = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return comparable <= datetime.now(timezone.utc)


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


def _serialize_job(job: JobRequisition, db: Session | None = None) -> dict:
    filled_count = 0
    if db is not None:
        filled_count = int(
            db.scalar(
                select(func.count(HiringApplication.id)).where(
                    HiringApplication.job_id == job.id,
                    HiringApplication.stage == "hired",
                ),
            ) or 0,
        )
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
        "filled_count": filled_count,
        "openings_remaining": max(0, int(job.headcount or 0) - filled_count),
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


_REJECTION_REASON_LABELS = {
    "position_filled": "the position has been filled",
    "skills_not_met": "the role requires a different skills match",
    "experience_not_met": "the role requires a different experience profile",
    "assessment_result": "the assessment outcome did not meet the role requirements",
    "interview_outcome": "we are proceeding with another candidate after the interview process",
    "position_closed": "the position has been closed",
    "other": "we will not be progressing this application",
}


def _organization_branding(organization: Organization) -> tuple[str, str]:
    return organization.name.strip(), organization_logo_url(organization.settings_json)


def _candidate_message_html(company_name: str, company_logo: str, body: str) -> str:
    safe_company = escape(company_name)
    safe_body = "<br>".join(escape(body).splitlines())
    logo = (
        f'<img src="{escape(company_logo, quote=True)}" width="144" alt="{safe_company}" '
        'style="display:block;max-width:144px;max-height:60px;width:auto;height:auto;border:0">'
        if company_logo.startswith("data:image/")
        else f'<strong style="font-size:21px;color:#173b31">{safe_company}</strong>'
    )
    return f"""<!doctype html><html><body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#17251f">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:34px 16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 0 18px">{logo}</td></tr><tr><td style="height:4px;background:#14805e"></td></tr>
<tr><td style="padding:36px 40px;background:#fff;border:1px solid #dce5e0;border-top:0;font-size:15px;line-height:24px;color:#41534b">{safe_body}</td></tr>
<tr><td align="center" style="padding:22px 12px 0;color:#7b8882;font-size:11px">Sent by {safe_company} through Valases</td></tr>
</table></td></tr></table></body></html>"""


def _candidate_message_email_content(company_name: str, company_logo: str, body: str) -> tuple[str, dict[str, tuple[bytes, str, str]]]:
    html = _candidate_message_html(company_name, company_logo, body)
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,(.+)", company_logo, flags=re.DOTALL)
    if not match:
        return html, {}
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except Exception:
        return html, {}
    if not content:
        return html, {}
    return (
        html.replace(escape(company_logo, quote=True), "cid:company-logo"),
        {"company-logo": (content, "image", match.group(1))},
    )


def _send_candidate_communication(
    db: Session,
    *,
    organization: Organization,
    application: HiringApplication,
    candidate: HiringCandidate,
    job: JobRequisition,
    actor: User,
    communication_type: str,
    template_key: str,
    sender_mode: str,
    subject: str,
    body: str,
    should_send: bool,
) -> HiringCommunication:
    company_name, company_logo = _organization_branding(organization)
    record = HiringCommunication(
        organization_id=organization.id,
        application_id=application.id,
        job_id=job.id,
        candidate_id=candidate.id,
        actor_user_id=actor.id,
        communication_type=communication_type,
        template_key=template_key,
        sender_mode=sender_mode,
        recipient_email=candidate.email,
        subject=subject,
        body_text=body,
        status="draft",
    )
    if should_send:
        try:
            html_body, inline_images = _candidate_message_email_content(company_name, company_logo, body)
            result = send_email(
                candidate.email,
                subject,
                body,
                html_body=html_body,
                inline_images=inline_images,
                reply_to=actor.email if sender_mode == "recruiter" else None,
            )
            record.status = "sent" if result.get("sent") else "failed"
            record.provider_error = str(result.get("reason") or "")[:500] or None
            record.sent_at = datetime.now(timezone.utc) if result.get("sent") else None
        except Exception as exc:
            record.status = "failed"
            record.provider_error = str(exc)[:500]
    db.add(record)
    return record


def _default_rejection_message(
    candidate: HiringCandidate,
    job: JobRequisition,
    organization: Organization,
    reason_code: str,
    sender_mode: str,
    actor: User,
) -> tuple[str, str]:
    company_name = organization.name.strip()
    signatory = actor.full_name.strip() if sender_mode == "recruiter" and actor.full_name else company_name
    subject = f"Update on your application for {job.title}"
    reason = _REJECTION_REASON_LABELS[reason_code]
    body = (
        f"Hello {candidate.first_name},\n\n"
        f"Thank you for the time and effort you invested in the {job.title} process with {company_name}. "
        f"After reviewing your application, {reason}. We will therefore not be moving your application forward.\n\n"
        "We appreciate your interest and wish you every success in your search.\n\n"
        f"Regards,\n{signatory}"
    )
    return subject, body


def _render_message_template(value: str, candidate: HiringCandidate, job: JobRequisition, organization: Organization) -> str:
    return (
        value.replace("{candidate_name}", f"{candidate.first_name} {candidate.last_name}".strip())
        .replace("{first_name}", candidate.first_name)
        .replace("{job_title}", job.title)
        .replace("{company_name}", organization.name)
    )


def _reject_application(
    db: Session,
    *,
    organization: Organization,
    application: HiringApplication,
    candidate: HiringCandidate,
    job: JobRequisition,
    actor: User,
    reason_code: str,
    notes: str,
    sender_mode: str,
    subject: str,
    body: str,
    should_send: bool,
) -> HiringCommunication:
    default_subject, default_body = _default_rejection_message(
        candidate,
        job,
        organization,
        reason_code,
        sender_mode,
        actor,
    )
    final_subject = _render_message_template(subject.strip() or default_subject, candidate, job, organization)
    final_body = _render_message_template(body.strip() or default_body, candidate, job, organization)
    previous_stage = application.stage
    application.stage = "rejected"
    application.status = "closed"
    application.human_decision = reason_code
    db.add(
        HiringStageEvent(
            organization_id=organization.id,
            application_id=application.id,
            actor_user_id=actor.id,
            from_stage=previous_stage,
            to_stage="rejected",
            reason=f"{_REJECTION_REASON_LABELS[reason_code]}. {notes}".strip(),
        ),
    )
    communication = _send_candidate_communication(
        db,
        organization=organization,
        application=application,
        candidate=candidate,
        job=job,
        actor=actor,
        communication_type="application_rejection",
        template_key=reason_code,
        sender_mode=sender_mode,
        subject=final_subject,
        body=final_body,
        should_send=should_send,
    )
    _write_audit(
        db,
        organization.id,
        actor.id,
        "application_rejected",
        "application",
        application.id,
        {"reason_code": reason_code, "email_status": communication.status},
    )
    return communication


def _serialize_offer(offer: HiringOffer) -> dict:
    return {
        "id": offer.id,
        "application_id": offer.application_id,
        "job_id": offer.job_id,
        "candidate_id": offer.candidate_id,
        "offer_reference": public_offer_reference(offer.offer_reference),
        "status": offer.status,
        "job_title": offer.job_title_snapshot,
        "candidate_name": offer.candidate_name_snapshot,
        "candidate_email": offer.candidate_email_snapshot,
        "currency": offer.currency,
        "pay_frequency": offer.pay_frequency,
        "base_compensation": offer.base_compensation,
        "variable_compensation": offer.variable_compensation,
        "benefits_value": offer.benefits_value,
        "earnings": offer.earnings_json or [],
        "deductions": offer.deductions_json or [],
        "gross_cash_compensation": offer.gross_cash_compensation,
        "estimated_net_compensation": offer.estimated_net_compensation,
        "total_ctc": offer.total_ctc,
        "employment_type": offer.employment_type,
        "work_location": offer.work_location,
        "reporting_manager": offer.reporting_manager,
        "probation_months": offer.probation_months,
        "notice_period_days": offer.notice_period_days,
        "start_date": offer.start_date,
        "expires_at": offer.expires_at,
        "letter_body": offer.letter_body,
        "terms_text": offer.terms_text,
        "released_at": offer.released_at,
        "signed_at": offer.signed_at,
        "signature_name": offer.signature_name,
        "released_document_hash": offer.released_document_hash,
        "signed_document_hash": offer.signed_document_hash,
        "created_at": offer.created_at,
        "updated_at": offer.updated_at,
    }


def _offer_document_html(offer: HiringOffer, organization: Organization, *, signed: bool = False) -> str:
    company_name, company_logo = _organization_branding(organization)
    totals = compensation_totals(
        base_compensation=offer.base_compensation,
        variable_compensation=offer.variable_compensation,
        benefits_value=offer.benefits_value,
        earnings=offer.earnings_json,
        deductions=offer.deductions_json,
    )
    logo = (
        f'<img src="{escape(company_logo, quote=True)}" alt="{escape(company_name)}" style="max-width:160px;max-height:64px">'
        if company_logo.startswith("data:image/")
        else f"<h2>{escape(company_name)}</h2>"
    )
    signature = (
        f"""<section style="margin-top:40px;border-top:1px solid #ccd8d2;padding-top:20px">
        <strong>Accepted electronically by {escape(offer.signature_name or '')}</strong><br>
        <span>{escape(offer.signed_at.isoformat() if offer.signed_at else '')}</span>
        </section>"""
        if signed else ""
    )
    rows = [
        ("Position", offer.job_title_snapshot),
        ("Employment type", offer.employment_type or "Full-time"),
        ("Start date", offer.start_date.strftime("%d %B %Y") if offer.start_date else "To be mutually agreed"),
        ("Work location", offer.work_location or "As assigned by the company"),
        ("Reporting manager", offer.reporting_manager or "As notified by the company"),
        ("Probation", f"{int(offer.probation_months or 0)} months"),
        ("Notice period", f"{int(offer.notice_period_days or 0)} days"),
        ("Annual gross cash", f"{offer.currency} {totals['gross_cash']:,.2f}"),
        ("Annual total CTC", f"{offer.currency} {totals['total_ctc']:,.2f}"),
    ]
    detail_rows = "".join(
        f'<tr><td style="padding:10px;border:1px solid #d8e2dd;color:#5d6e66">{escape(label)}</td>'
        f'<td style="padding:10px;border:1px solid #d8e2dd"><strong>{escape(value)}</strong></td></tr>'
        for label, value in rows
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{escape(public_offer_reference(offer.offer_reference))}</title></head>
<body style="font-family:Arial,sans-serif;color:#1b2a24;max-width:760px;margin:40px auto;padding:24px;line-height:1.6">
{logo}<p style="color:#65766e">Private and confidential · {escape(public_offer_reference(offer.offer_reference))}</p>
<h1>Offer of employment</h1><p>Dear {escape(offer.candidate_name_snapshot)},</p>
<div>{'<br>'.join(escape(offer.letter_body).splitlines())}</div>
<table style="width:100%;margin:28px 0;border-collapse:collapse">{detail_rows}</table>
<h2>Principal terms</h2><p>{'<br>'.join(escape(offer.terms_text).splitlines())}</p>
<p>The attached PDF contains the complete appointment terms and detailed compensation schedule. Review both documents before responding.</p>{signature}
</body></html>"""


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
    resume_match_score = round(
        float(application.ai_match_score)
        if application.ai_match_score is not None
        else _screen_application(job, candidate)[0],
        1,
    )
    top_choice_score = round(
        resume_match_score * 0.45
        + skills_score * 0.35
        + experience_score * 0.20,
        1,
    )
    available_scores = [skills_score, experience_score]
    if assessment_score is not None:
        available_scores.append(float(assessment_score))
    average_score = round(sum(available_scores) / len(available_scores), 1)
    return {
        "average_score": average_score,
        "top_choice_score": top_choice_score,
        "resume_match_score": resume_match_score,
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
        "recent_jobs": [_serialize_job(job, db) for job in jobs],
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
    query = select(JobRequisition).where(
        JobRequisition.organization_id == organization.id,
        JobRequisition.status != "deleted",
    )
    if job_status:
        query = query.where(JobRequisition.status == job_status)
    rows = list(db.scalars(query.order_by(JobRequisition.updated_at.desc())).all())
    return [_serialize_job(row, db) for row in rows]


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
    return _serialize_job(job, db)


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
    return _serialize_job(job, db)


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(
    job_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "jobs.manage")
    job = _job_or_404(db, organization.id, job_id)
    active_applications = int(
        db.scalar(
            select(func.count(HiringApplication.id)).where(
                HiringApplication.job_id == job.id,
                HiringApplication.status == "active",
            ),
        ) or 0,
    )
    if active_applications:
        raise HTTPException(
            status_code=409,
            detail="Close or reject the active applications before deleting this job",
        )
    job.status = "deleted"
    _write_audit(db, organization.id, current_user.id, "job_deleted", "job", job.id)
    db.commit()


@router.post("/jobs/{job_id}/close-vacancies")
def close_job_vacancies(
    job_id: int,
    payload: JobCloseVacanciesRequest,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "jobs.manage")
    _require_permission(current_user, membership, "pipeline.manage")
    job = _job_or_404(db, organization.id, job_id)
    applications = list(
        db.scalars(
            select(HiringApplication).where(
                HiringApplication.job_id == job.id,
                HiringApplication.status == "active",
                HiringApplication.stage != "hired",
            ),
        ).all(),
    )
    sent = failed = drafted = 0
    for application in applications:
        candidate = _candidate_or_404(db, organization.id, application.candidate_id)
        communication = _reject_application(
            db,
            organization=organization,
            application=application,
            candidate=candidate,
            job=job,
            actor=current_user,
            reason_code="position_filled",
            notes="Vacancy requirement fulfilled",
            sender_mode=payload.sender_mode,
            subject=payload.subject,
            body=payload.body,
            should_send=payload.send_email,
        )
        sent += int(communication.status == "sent")
        failed += int(communication.status == "failed")
        drafted += int(communication.status == "draft")
    job.status = "paused"
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "job_vacancies_fulfilled",
        "job",
        job.id,
        {"applications_closed": len(applications), "emails_sent": sent, "emails_failed": failed},
    )
    db.commit()
    return {
        "job_id": job.id,
        "status": job.status,
        "applications_closed": len(applications),
        "emails_sent": sent,
        "emails_failed": failed,
        "drafts_created": drafted,
    }


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
    job = _job_or_404(db, organization.id, payload.job_id)
    if job.status != "open":
        raise HTTPException(status_code=409, detail="This job is not accepting applications")
    _candidate_or_404(db, organization.id, payload.candidate_id)
    existing = db.scalar(
        select(HiringApplication).where(
            HiringApplication.organization_id == organization.id,
            HiringApplication.job_id == payload.job_id,
            HiringApplication.candidate_id == payload.candidate_id,
        ),
    )
    if existing and existing.status == "active":
        raise HTTPException(status_code=409, detail="This candidate already has an active application for this role")
    if existing:
        previous_stage = existing.stage
        existing.stage = "screening"
        existing.status = "active"
        existing.owner_user_id = current_user.id
        existing.source = payload.source.strip() or "manual"
        existing.human_decision = None
        existing.ai_match_score = None
        existing.ai_confidence = None
        existing.ai_recommendation = None
        existing.ai_rationale_json = {}
        db.add(
            HiringStageEvent(
                organization_id=organization.id,
                application_id=existing.id,
                actor_user_id=current_user.id,
                from_stage=previous_stage,
                to_stage="screening",
                reason="Candidate reapplied after the previous application was closed",
            ),
        )
        _write_audit(db, organization.id, current_user.id, "application_reactivated", "application", existing.id)
        db.commit()
        return {"id": existing.id, "stage": existing.stage, "status": existing.status}
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
            "external_application_id": application.external_application_id,
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


@router.post("/integrations/{provider}/applications/import")
def import_ats_applications(
    provider: str,
    payload: AtsApplicationBatch,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "integrations.manage")
    normalized_provider = provider.strip().lower()
    catalog = _INTEGRATION_CATALOG.get(normalized_provider)
    if not catalog or catalog["category"] != "ats":
        raise HTTPException(status_code=422, detail="Choose a supported ATS provider")
    integration = db.scalar(
        select(HiringIntegration).where(
            HiringIntegration.organization_id == organization.id,
            HiringIntegration.provider == normalized_provider,
        ),
    )
    if not integration or integration.status != "connected":
        raise HTTPException(status_code=409, detail="Connect this ATS before importing applications")

    created_candidates = 0
    updated_candidates = 0
    created_jobs = 0
    created_applications = 0
    updated_applications = 0
    skipped_inactive_jobs = 0
    for item in payload.applications:
        email = item.candidate_email.strip().lower()
        candidate = db.scalar(
            select(HiringCandidate).where(
                HiringCandidate.organization_id == organization.id,
                HiringCandidate.email == email,
            ),
        )
        if not candidate:
            candidate = HiringCandidate(
                organization_id=organization.id,
                first_name=item.candidate_first_name.strip(),
                last_name=item.candidate_last_name.strip(),
                email=email,
                headline=item.candidate_headline.strip(),
                location=item.candidate_location.strip(),
                source=normalized_provider,
                resume_text=item.resume_text.strip(),
                skills_json=_list_strings(item.candidate_skills),
                experience_years=item.candidate_experience_years,
                consent_status="pending",
            )
            db.add(candidate)
            db.flush()
            created_candidates += 1
        else:
            candidate.headline = item.candidate_headline.strip() or candidate.headline
            candidate.location = item.candidate_location.strip() or candidate.location
            candidate.resume_text = item.resume_text.strip() or candidate.resume_text
            candidate.skills_json = _list_strings([*(candidate.skills_json or []), *item.candidate_skills])
            candidate.experience_years = item.candidate_experience_years if item.candidate_experience_years is not None else candidate.experience_years
            updated_candidates += 1

        job_code = item.job_code.strip()
        job = db.scalar(
            select(JobRequisition).where(
                JobRequisition.organization_id == organization.id,
                JobRequisition.job_code == job_code,
            ),
        )
        if not job:
            job = JobRequisition(
                organization_id=organization.id,
                created_by_user_id=current_user.id,
                job_code=job_code,
                title=item.job_title.strip(),
                status="open",
                department="Imported",
                location="Not specified",
                skills_json=[],
            )
            db.add(job)
            db.flush()
            created_jobs += 1

        if job.status != "open":
            skipped_inactive_jobs += 1
            continue

        application = db.scalar(
            select(HiringApplication).where(
                HiringApplication.organization_id == organization.id,
                HiringApplication.source == normalized_provider,
                HiringApplication.external_application_id == item.external_application_id.strip(),
            ),
        )
        if not application:
            application = db.scalar(
                select(HiringApplication).where(
                    HiringApplication.job_id == job.id,
                    HiringApplication.candidate_id == candidate.id,
                ),
            )
        if application:
            application.source = normalized_provider
            application.external_application_id = item.external_application_id.strip()
            application.external_candidate_id = item.external_candidate_id.strip() or None
            application.external_job_id = item.external_job_id.strip() or None
            updated_applications += 1
        else:
            application = HiringApplication(
                organization_id=organization.id,
                job_id=job.id,
                candidate_id=candidate.id,
                owner_user_id=None,
                source=normalized_provider,
                external_application_id=item.external_application_id.strip(),
                external_candidate_id=item.external_candidate_id.strip() or None,
                external_job_id=item.external_job_id.strip() or None,
                stage=item.stage,
                applied_at=item.applied_at or datetime.now(timezone.utc),
            )
            db.add(application)
            db.flush()
            db.add(
                HiringStageEvent(
                    organization_id=organization.id,
                    application_id=application.id,
                    actor_user_id=current_user.id,
                    to_stage=item.stage,
                    reason=f"Imported from {normalized_provider}",
                ),
            )
            created_applications += 1
        score, confidence, recommendation, rationale = _screen_application(job, candidate)
        application.ai_match_score = score
        application.ai_confidence = confidence
        application.ai_recommendation = recommendation
        application.ai_rationale_json = rationale

    integration.last_synced_at = datetime.now(timezone.utc)
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "ats_applications_imported",
        "integration",
        integration.id,
        {
            "provider": normalized_provider,
            "received": len(payload.applications),
            "applications_created": created_applications,
            "applications_updated": updated_applications,
            "skipped_inactive_jobs": skipped_inactive_jobs,
        },
    )
    db.commit()
    return {
        "provider": normalized_provider,
        "received": len(payload.applications),
        "candidates_created": created_candidates,
        "candidates_updated": updated_candidates,
        "jobs_created": created_jobs,
        "applications_created": created_applications,
        "applications_updated": updated_applications,
        "skipped_inactive_jobs": skipped_inactive_jobs,
        "synced_at": integration.last_synced_at,
    }


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
        "job": _serialize_job(job, db),
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
    if payload.stage == "rejected":
        raise HTTPException(status_code=422, detail="Use the rejection workflow to record a reason and candidate communication")
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
    if payload.stage == "hired":
        db.flush()
        job = _job_or_404(db, organization.id, application.job_id)
        hired_count = int(
            db.scalar(
                select(func.count(HiringApplication.id)).where(
                    HiringApplication.job_id == job.id,
                    HiringApplication.stage == "hired",
                ),
            ) or 0,
        )
        if hired_count >= job.headcount:
            job.status = "paused"
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


@router.post("/applications/{application_id}/reject")
def reject_application(
    application_id: int,
    payload: RejectionRequest,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "pipeline.manage")
    application = _application_or_404(db, organization.id, application_id)
    if application.status != "active":
        raise HTTPException(status_code=409, detail="Only an active application can be rejected")
    candidate = _candidate_or_404(db, organization.id, application.candidate_id)
    job = _job_or_404(db, organization.id, application.job_id)
    communication = _reject_application(
        db,
        organization=organization,
        application=application,
        candidate=candidate,
        job=job,
        actor=current_user,
        reason_code=payload.reason_code,
        notes=payload.notes.strip(),
        sender_mode=payload.sender_mode,
        subject=payload.subject,
        body=payload.body,
        should_send=payload.send_email,
    )
    db.commit()
    return {
        "id": application.id,
        "stage": application.stage,
        "status": application.status,
        "email_status": communication.status,
        "communication_id": communication.id,
    }


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


@router.get("/offers")
def list_offers(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "offers.view")
    rows = list(
        db.scalars(
            select(HiringOffer)
            .where(HiringOffer.organization_id == organization.id)
            .order_by(HiringOffer.updated_at.desc()),
        ).all(),
    )
    return [_serialize_offer(item) for item in rows]


@router.post("/offers", status_code=status.HTTP_201_CREATED)
def create_offer(
    payload: OfferCreate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "offers.manage")
    application = _application_or_404(db, organization.id, payload.application_id)
    if application.stage not in {"interview", "offer", "hired"} or (
        application.stage != "hired" and application.status != "active"
    ):
        raise HTTPException(status_code=409, detail="Offers can only be prepared for candidates in Interview, Offer, or Hired")
    if application.stage != "hired" and int(
        db.scalar(select(func.count(HiringScorecard.id)).where(HiringScorecard.application_id == application.id)) or 0,
    ) < 1:
        raise HTTPException(status_code=409, detail="Complete a structured interview scorecard before preparing an offer")
    existing = db.scalar(select(HiringOffer).where(HiringOffer.application_id == application.id))
    if existing:
        raise HTTPException(status_code=409, detail="An offer already exists for this application")
    candidate = _candidate_or_404(db, organization.id, application.candidate_id)
    job = _job_or_404(db, organization.id, application.job_id)
    totals = compensation_totals(
        base_compensation=payload.base_compensation,
        variable_compensation=payload.variable_compensation,
        benefits_value=payload.benefits_value,
        earnings=[item.model_dump() for item in payload.earnings],
        deductions=[item.model_dump() for item in payload.deductions],
    )
    total = totals["total_ctc"] or None
    offer = HiringOffer(
        organization_id=organization.id,
        application_id=application.id,
        job_id=job.id,
        candidate_id=candidate.id,
        created_by_user_id=current_user.id,
        offer_reference=f"OFR-{datetime.now(timezone.utc).strftime('%Y%m')}-{secrets.token_hex(4).upper()}",
        job_title_snapshot=job.title,
        candidate_name_snapshot=f"{candidate.first_name} {candidate.last_name}".strip(),
        candidate_email_snapshot=candidate.email,
        recruiter_email_snapshot=current_user.email,
        currency=payload.currency.strip().upper(),
        pay_frequency=payload.pay_frequency,
        base_compensation=payload.base_compensation,
        variable_compensation=payload.variable_compensation,
        benefits_value=payload.benefits_value,
        earnings_json=totals["earnings"],
        deductions_json=totals["deductions"],
        gross_cash_compensation=totals["gross_cash"],
        estimated_net_compensation=totals["estimated_net"],
        total_ctc=total,
        employment_type=payload.employment_type.strip(),
        work_location=payload.work_location.strip(),
        reporting_manager=payload.reporting_manager.strip(),
        probation_months=payload.probation_months,
        notice_period_days=payload.notice_period_days,
        start_date=payload.start_date,
        expires_at=payload.expires_at or datetime.now(timezone.utc) + timedelta(days=7),
        letter_body=payload.letter_body.strip() or (
            f"Following our discussions and selection process, {organization.name} is pleased to offer you "
            f"the position of {job.title}. We were impressed by the experience and perspective you demonstrated, "
            "and we look forward to the contribution you can make to our team."
        ),
        terms_text=payload.terms_text.strip() or (
            "This offer is subject to satisfactory pre-employment verification, your continuing eligibility to work, "
            "and the policies of the company. Your employment will be governed by applicable law and the company's "
            "code of conduct, confidentiality, information-security, intellectual-property, privacy, leave, and workplace policies."
        ),
        status="ready" if total else "draft",
        payroll_reviewed_by_user_id=current_user.id if total and "offers.compensation" in _membership_permissions(current_user, membership) else None,
    )
    db.add(offer)
    db.flush()
    _write_audit(db, organization.id, current_user.id, "offer_created", "offer", offer.id)
    db.commit()
    db.refresh(offer)
    return _serialize_offer(offer)


@router.patch("/offers/{offer_id}")
def update_offer(
    offer_id: int,
    payload: OfferUpdate,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    offer = db.scalar(select(HiringOffer).where(HiringOffer.id == offer_id, HiringOffer.organization_id == organization.id))
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    if offer.status not in {"draft", "ready"}:
        raise HTTPException(status_code=409, detail="A released offer can no longer be edited")
    values = payload.model_dump(exclude_unset=True)
    compensation_fields = {
        "currency",
        "pay_frequency",
        "base_compensation",
        "variable_compensation",
        "benefits_value",
        "earnings",
        "deductions",
    }
    content_fields = {
        "start_date",
        "expires_at",
        "letter_body",
        "terms_text",
        "employment_type",
        "work_location",
        "reporting_manager",
        "probation_months",
        "notice_period_days",
    }
    if compensation_fields & values.keys():
        _require_permission(current_user, membership, "offers.compensation")
    if content_fields & values.keys():
        _require_permission(current_user, membership, "offers.manage")
    for field, value in values.items():
        target = {"earnings": "earnings_json", "deductions": "deductions_json"}.get(field, field)
        if field in {"earnings", "deductions"}:
            value = [item.model_dump() if isinstance(item, PayrollLineItem) else item for item in value or []]
        setattr(offer, target, value.strip().upper() if field == "currency" and isinstance(value, str) else value)
    totals = compensation_totals(
        base_compensation=offer.base_compensation,
        variable_compensation=offer.variable_compensation,
        benefits_value=offer.benefits_value,
        earnings=offer.earnings_json,
        deductions=offer.deductions_json,
    )
    offer.earnings_json = totals["earnings"]
    offer.deductions_json = totals["deductions"]
    offer.gross_cash_compensation = totals["gross_cash"]
    offer.estimated_net_compensation = totals["estimated_net"]
    offer.total_ctc = totals["total_ctc"] or None
    if compensation_fields & values.keys():
        offer.payroll_reviewed_by_user_id = current_user.id
    offer.status = "ready" if offer.total_ctc and offer.letter_body.strip() and offer.terms_text.strip() else "draft"
    _write_audit(db, organization.id, current_user.id, "offer_updated", "offer", offer.id, {"fields": sorted(values)})
    db.commit()
    db.refresh(offer)
    return _serialize_offer(offer)


@router.post("/offers/{offer_id}/release")
def release_offer(
    offer_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "offers.release")
    offer = db.scalar(select(HiringOffer).where(HiringOffer.id == offer_id, HiringOffer.organization_id == organization.id))
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    if offer.status != "ready" or not offer.total_ctc or not offer.payroll_reviewed_by_user_id:
        raise HTTPException(status_code=409, detail="Compensation must be reviewed before the offer can be released")
    if _is_past(offer.expires_at):
        raise HTTPException(status_code=409, detail="Set a future offer expiry date")
    application = _application_or_404(db, organization.id, offer.application_id)
    token = secrets.token_urlsafe(32)
    offer.access_token_hash = hashlib.sha256(token.encode()).hexdigest()
    offer.status = "released"
    offer.released_at = datetime.now(timezone.utc)
    offer.released_document_html = _offer_document_html(offer, organization)
    offer.released_document_pdf = render_offer_pdf(
        offer,
        organization,
        company_logo_url=organization_logo_url(organization.settings_json),
    )
    offer.released_document_hash = hashlib.sha256(offer.released_document_pdf).hexdigest()
    if application.stage != "hired":
        previous_stage = application.stage
        application.stage = "offer"
        db.add(HiringStageEvent(
            organization_id=organization.id,
            application_id=application.id,
            actor_user_id=current_user.id,
            from_stage=previous_stage,
            to_stage="offer",
            reason=f"Offer {public_offer_reference(offer.offer_reference)} released",
        ))
    candidate_url = str(get_settings().candidate_app_base_url or "").strip().rstrip("/")
    if not candidate_url:
        raise HTTPException(status_code=503, detail="Candidate portal URL is not configured")
    decision_url = f"{candidate_url}/?offer_key={token}"
    body = (
        f"Dear {offer.candidate_name_snapshot},\n\n"
        f"We are delighted to share your formal offer to join {organization.name} as {offer.job_title_snapshot}.\n\n"
        "Your complete offer letter and compensation schedule are attached as a PDF. "
        "Please review the appointment terms, detailed annual and monthly compensation, benefits, deductions, and acceptance conditions carefully.\n\n"
        f"Review and respond securely: {decision_url}\n\n"
        f"Please respond by {offer.expires_at.strftime('%d %B %Y') if offer.expires_at else 'the acceptance date stated in your offer'}."
        "\n\nIf you have any questions, reply to this email and our team will be happy to help.\n\n"
        f"Warm regards,\nPeople Team\n{organization.name}"
    )
    try:
        email_html, inline_images = _candidate_message_email_content(
            organization.name,
            organization_logo_url(organization.settings_json),
            body,
        )
        delivery = send_email(
            offer.candidate_email_snapshot,
            f"Your offer from {organization.name}",
            body,
            html_body=email_html,
            inline_images=inline_images,
            attachments=[
                (
                    f"{offer.candidate_name_snapshot}-offer.pdf",
                    offer.released_document_pdf,
                    "application",
                    "pdf",
                ),
            ],
            reply_to=offer.recruiter_email_snapshot,
        )
    except Exception as exc:
        delivery = {"sent": False, "reason": str(exc)}
    _write_audit(db, organization.id, current_user.id, "offer_released", "offer", offer.id, {"email_sent": bool(delivery.get("sent"))})
    db.commit()
    return {**_serialize_offer(offer), "email_delivery": delivery}


@router.get("/offers/{offer_id}/document")
def get_offer_document(
    offer_id: int,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "offers.view")
    offer = db.scalar(select(HiringOffer).where(HiringOffer.id == offer_id, HiringOffer.organization_id == organization.id))
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    document = offer.signed_document_pdf or offer.released_document_pdf
    if not document:
        document = render_offer_pdf(
            offer,
            organization,
            company_logo_url=organization_logo_url(organization.settings_json),
            signed=offer.status == "accepted",
        )
    filename = re.sub(r"[^A-Za-z0-9._-]+", "-", offer.candidate_name_snapshot).strip("-") or "candidate"
    return Response(
        document,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}-offer.pdf"'},
    )


@router.get("/offers/public/{offer_key}/document.pdf")
def get_public_offer_document(offer_key: str, db: Session = Depends(get_db)):
    offer = _public_offer_by_key(db, offer_key)
    organization = db.get(Organization, offer.organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    document = offer.signed_document_pdf or offer.released_document_pdf
    if not document:
        document = render_offer_pdf(
            offer,
            organization,
            company_logo_url=organization_logo_url(organization.settings_json),
            signed=offer.status == "accepted",
        )
    return Response(
        document,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="employment-offer.pdf"'},
    )


def _public_offer_by_key(db: Session, offer_key: str) -> HiringOffer:
    token_hash = hashlib.sha256(offer_key.strip().encode()).hexdigest()
    offer = db.scalar(select(HiringOffer).where(HiringOffer.access_token_hash == token_hash))
    if not offer:
        raise HTTPException(status_code=404, detail="Offer link is invalid")
    return offer


@router.get("/offers/public/{offer_key}")
def get_public_offer(offer_key: str, db: Session = Depends(get_db)):
    offer = _public_offer_by_key(db, offer_key)
    organization = db.get(Organization, offer.organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    expired = _is_past(offer.expires_at)
    return {
        **_serialize_offer(offer),
        "company_name": organization.name,
        "company_logo_url": organization_logo_url(organization.settings_json),
        "document_html": offer.signed_document_html or offer.released_document_html,
        "can_respond": offer.status == "released" and not expired,
        "expired": expired,
    }


@router.post("/offers/public/{offer_key}/decision")
def decide_public_offer(
    offer_key: str,
    payload: OfferDecision,
    request: Request,
    db: Session = Depends(get_db),
):
    if not payload.consent:
        raise HTTPException(status_code=422, detail="Confirm the electronic-signature consent")
    offer = _public_offer_by_key(db, offer_key)
    if offer.status != "released":
        raise HTTPException(status_code=409, detail="This offer has already been answered")
    if _is_past(offer.expires_at):
        raise HTTPException(status_code=410, detail="This offer has expired")
    organization = db.get(Organization, offer.organization_id)
    application = db.get(HiringApplication, offer.application_id)
    if not organization or not application:
        raise HTTPException(status_code=404, detail="Offer record is incomplete")
    now = datetime.now(timezone.utc)
    offer.signature_name = payload.signature_name.strip()
    offer.signature_ip = (
        request.headers.get("x-vercel-forwarded-for")
        or request.headers.get("x-forwarded-for")
        or (request.client.host if request.client else "")
    ).split(",", 1)[0].strip()[:120]
    offer.signature_user_agent = request.headers.get("user-agent", "")[:500]
    if payload.accepted:
        offer.status = "accepted"
        offer.signed_at = now
        offer.signed_document_html = _offer_document_html(offer, organization, signed=True)
        offer.signed_document_pdf = render_offer_pdf(
            offer,
            organization,
            company_logo_url=organization_logo_url(organization.settings_json),
            signed=True,
        )
        offer.signed_document_hash = hashlib.sha256(offer.signed_document_pdf).hexdigest()
        subject = f"Signed employment offer | {offer.job_title_snapshot}"
        candidate_body = (
            f"Dear {offer.candidate_name_snapshot},\n\n"
            f"Thank you for accepting the offer to join {organization.name} as {offer.job_title_snapshot}. "
            f"Your electronically signed offer letter and compensation schedule are attached for your records.\n\n"
            f"Acceptance recorded: {now.strftime('%d %B %Y at %H:%M UTC')}\n"
            f"Document reference: {public_offer_reference(offer.offer_reference)}\n\n"
            f"We look forward to welcoming you.\n\nPeople Team\n{organization.name}"
        )
        recruiter_body = (
            f"{offer.candidate_name_snapshot} accepted the offer for {offer.job_title_snapshot} "
            f"on {now.strftime('%d %B %Y at %H:%M UTC')}.\n\n"
            "The signed offer and compensation schedule are attached for the organization's records."
        )
        for recipient in {offer.candidate_email_snapshot, offer.recruiter_email_snapshot}:
            try:
                body = candidate_body if recipient == offer.candidate_email_snapshot else recruiter_body
                email_html, inline_images = _candidate_message_email_content(
                    organization.name,
                    organization_logo_url(organization.settings_json),
                    body,
                )
                send_email(
                    recipient,
                    subject,
                    body,
                    html_body=email_html,
                    inline_images=inline_images,
                    attachments=[
                        (
                            f"{offer.candidate_name_snapshot}-signed-offer.pdf",
                            offer.signed_document_pdf,
                            "application",
                            "pdf",
                        ),
                    ],
                    reply_to=offer.recruiter_email_snapshot,
                )
            except Exception:
                pass
        action = "offer_accepted"
    else:
        offer.status = "declined"
        offer.declined_at = now
        application.stage = "withdrawn"
        application.status = "closed"
        application.human_decision = "offer_declined"
        db.add(HiringStageEvent(
            organization_id=organization.id,
            application_id=application.id,
            actor_user_id=None,
            from_stage="offer",
            to_stage="withdrawn",
            reason="Candidate declined the offer",
        ))
        action = "offer_declined"
    offer.access_token_hash = None
    _write_audit(db, organization.id, None, action, "offer", offer.id)
    db.commit()
    return {"status": offer.status, "signed_at": offer.signed_at}


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
    except jwt.InvalidTokenError as exc:
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
