from datetime import datetime, timedelta, timezone
import csv
import io
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.entities import (
    AuditLog,
    BannedIdentity,
    ApprovalStatus,
    AssessmentIssue,
    AssessmentSubmission,
    Certificate,
    ComplaintItem,
    Course,
    CourseComment,
    DataSubjectRequest,
    Enrollment,
    Exam,
    ExamStatus,
    HiringCandidate,
    HiringApplication,
    ModerationStatus,
    Organization,
    OrganizationAuditEvent,
    OrganizationMembership,
    ProviderDocument,
    ProviderBillingAccount,
    ProviderProfile,
    ProviderType,
    ReportItem,
    Result,
    User,
    UserIdentityVerification,
    UserApproval,
    UserRole,
)
from app.schemas import (
    AdminApprovalRequest,
    AnalyticsOut,
    ComplaintCreate,
    DocumentReviewRequest,
    ModerationUpdateRequest,
    ReportCreate,
)
from app.services.notifications import send_email
from app.services.account_rules import sync_existing_accounts
from app.services.organization_branding import normalize_organization_logo
from app.services.supabase_auth import ensure_supabase_user
from app.core.config import get_settings

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminUserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    company_name: str = Field(min_length=2, max_length=200)
    temporary_password: str | None = Field(default=None, min_length=12, max_length=128)


class AdminCompanyCreate(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    logo_data_url: str = Field(default="", max_length=800000)


class BillingAccountUpdate(BaseModel):
    plan_code: str = Field(default="trial", max_length=40)
    status: str = Field(default="trialing", max_length=30)
    currency: str = Field(default="USD", max_length=8)
    monthly_price: float = Field(default=0, ge=0)
    included_assessments: int = Field(default=25, ge=0)
    overage_price: float = Field(default=0, ge=0)
    billing_email: EmailStr | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)


class GovernanceSettingsUpdate(BaseModel):
    candidate_retention_days: int = Field(default=730, ge=30, le=3650)
    assessment_retention_days: int = Field(default=365, ge=30, le=3650)
    proctor_retention_days: int = Field(default=30, ge=1, le=365)
    audit_retention_days: int = Field(default=730, ge=365, le=3650)
    legal_hold_enabled: bool = False
    legal_hold_reason: str = Field(default="", max_length=2000)


class SsoOperationUpdate(BaseModel):
    connection_status: Literal["not_configured", "registration_pending", "registered", "verified", "error"]
    connection_id: str = Field(default="", max_length=240)
    operator_notes: str = Field(default="", max_length=5000)
    last_error: str = Field(default="", max_length=5000)


class DataSubjectRequestCreate(BaseModel):
    provider_id: int = Field(gt=0)
    request_type: Literal["access", "export", "delete"]
    candidate_email: EmailStr
    requestor_name: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=5000)


class DataSubjectRequestAction(BaseModel):
    action: Literal["verify_identity", "start_review", "approve", "reject", "hold", "resume"]
    reason: str = Field(min_length=10, max_length=5000)


class DataSubjectRequestExecute(BaseModel):
    confirmation: str = Field(min_length=6, max_length=80)


_DEFAULT_GOVERNANCE_SETTINGS = {
    "candidate_retention_days": 730,
    "assessment_retention_days": 365,
    "proctor_retention_days": 30,
    "audit_retention_days": 730,
    "legal_hold_enabled": False,
    "legal_hold_reason": "",
}


def _audit(db: Session, actor_user_id: int | None, action: str, target_type: str, target_id: int | None, details: dict):
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details_json=details,
        ),
    )


def _organization_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")[:100] or "organization"


def _organization_for_owner(db: Session, owner: User) -> Organization | None:
    return db.scalar(
        select(Organization)
        .join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id)
        .where(
            OrganizationMembership.user_id == owner.id,
            OrganizationMembership.status == "active",
            Organization.status == "active",
        )
        .order_by(Organization.id.asc()),
    )


def _ensure_company_organization(
    db: Session,
    *,
    provider: ProviderProfile,
    owner: User,
    actor_user_id: int | None,
) -> Organization:
    existing = _organization_for_owner(db, owner)
    if existing:
        return existing
    base_slug = _organization_slug(provider.display_name or owner.full_name or owner.email.split("@", 1)[0])
    slug = base_slug
    suffix = 2
    while db.scalar(select(Organization.id).where(Organization.slug == slug)):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    organization = Organization(
        name=(provider.display_name or owner.full_name).strip(),
        slug=slug,
        created_by_user_id=actor_user_id or owner.id,
        settings_json={"governance": dict(_DEFAULT_GOVERNANCE_SETTINGS)},
    )
    db.add(organization)
    db.flush()
    db.add(OrganizationMembership(organization_id=organization.id, user_id=owner.id, role="owner"))
    db.add(
        OrganizationAuditEvent(
            organization_id=organization.id,
            actor_user_id=actor_user_id,
            action="organization_provisioned",
            target_type="organization",
            target_id=organization.id,
            details_json={"provider_id": provider.id, "owner_user_id": owner.id},
        ),
    )
    return organization


def _governance_payload(organization: Organization) -> dict:
    settings = dict(organization.settings_json or {})
    governance = {**_DEFAULT_GOVERNANCE_SETTINGS, **dict(settings.get("governance") or {})}
    return {"organization_id": organization.id, "organization_name": organization.name, **governance}


def _sso_operation_payload(provider: ProviderProfile, organization: Organization) -> dict:
    sso = dict((organization.settings_json or {}).get("sso") or {})
    settings = get_settings()
    supabase_url = str(settings.supabase_url or "").strip().rstrip("/")
    metadata_url = f"{supabase_url}/auth/v1/sso/saml/metadata" if supabase_url.startswith("https://") else ""
    return {
        "provider_id": provider.id,
        "organization_id": organization.id,
        "organization_name": organization.name,
        "region": settings.deployment_region,
        "provider": str(sso.get("provider") or ""),
        "domains": list(sso.get("domains") or []),
        "idp_metadata_url": str(sso.get("idp_metadata_url") or ""),
        "initial_admin_email": str(sso.get("initial_admin_email") or ""),
        "enabled": bool(sso.get("enabled")),
        "enforce_for_members": bool(sso.get("enforce_for_members")),
        "connection_status": str(sso.get("connection_status") or "not_configured"),
        "connection_id": str(sso.get("connection_id") or ""),
        "operator_notes": str(sso.get("operator_notes") or ""),
        "last_error": str(sso.get("last_error") or ""),
        "registered_at": sso.get("registered_at"),
        "verified_at": sso.get("verified_at"),
        "verified_by_email": sso.get("verified_by_email"),
        "service_provider": {
            "entity_id": metadata_url,
            "metadata_url": metadata_url,
            "acs_url": f"{supabase_url}/auth/v1/sso/saml/acs" if supabase_url.startswith("https://") else "",
            "name_id_format": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "required_email_claim": "email",
        },
    }


def _data_subject_request_payload(item: DataSubjectRequest, organization_name: str) -> dict:
    return {
        "id": item.id,
        "organization_id": item.organization_id,
        "organization_name": organization_name,
        "provider_id": item.provider_id,
        "request_reference": item.request_reference,
        "request_type": item.request_type,
        "candidate_email": item.candidate_email,
        "requestor_name": item.requestor_name,
        "status": item.status,
        "identity_verified_at": item.identity_verified_at,
        "received_at": item.received_at,
        "due_at": item.due_at,
        "completed_at": item.completed_at,
        "notes": item.notes,
        "resolution": item.resolution_json or {},
    }


def _safe_send_email(to_email: str, subject: str, body: str) -> dict:
    try:
        return send_email(to_email, subject, body)
    except Exception as exc:
        return {"sent": False, "reason": str(exc)}


def _billing_payload(account: ProviderBillingAccount | None, provider: ProviderProfile) -> dict:
    return {
        "provider_id": provider.id,
        "plan_code": account.plan_code if account else "trial",
        "status": account.status if account else "trialing",
        "currency": account.currency if account else "USD",
        "monthly_price": float(account.monthly_price or 0) if account else 0.0,
        "included_assessments": int(account.included_assessments or 0) if account else 25,
        "overage_price": float(account.overage_price or 0) if account else 0.0,
        "billing_email": account.billing_email if account else None,
        "current_period_start": account.current_period_start if account else None,
        "current_period_end": account.current_period_end if account else None,
        "notes": account.notes if account else None,
    }


def _create_company_account(
    *,
    business_name: str,
    email_address: str,
    password: str,
    account_name: str | None,
    db: Session,
    current_user: User,
    logo_data_url: str = "",
) -> dict:
    email = email_address.strip().lower()
    company_name = business_name.strip()
    owner_name = (account_name or company_name).strip()
    if db.scalar(select(User.id).where(func.lower(func.trim(User.email)) == email)):
        raise HTTPException(status_code=409, detail="A user with this email already exists.")
    try:
        auth_result = ensure_supabase_user(
            email=email,
            password=password,
            full_name=owner_name,
            role=UserRole.PROVIDER.value,
            settings=get_settings(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Supabase user provisioning failed: {exc}") from exc
    if not auth_result.get("configured"):
        raise HTTPException(
            status_code=503,
            detail="Supabase company provisioning is not configured. Add SUPABASE_SECRET_KEY to the backend environment.",
        )
    if auth_result.get("existing"):
        raise HTTPException(
            status_code=409,
            detail="This email already has a Supabase account. Use a different email or recover the existing account.",
        )

    user = User(
        email=email,
        full_name=owner_name,
        # Supabase is the credential authority. Do not retain a second reusable
        # password verifier in the application database.
        password_hash="supabase",
        role=UserRole.PROVIDER,
        is_active=True,
        account_state="active",
    )
    db.add(user)
    db.flush()
    provider = ProviderProfile(
        user_id=user.id,
        provider_type=ProviderType.BUSINESS,
        display_name=company_name,
        description="Valases recruiter organization",
        approval_status=ApprovalStatus.APPROVED,
        reviewed_by_admin_id=current_user.id,
        reviewed_at=datetime.now(timezone.utc),
    )
    db.add(provider)
    db.add(UserApproval(
        user_id=user.id,
        status=ApprovalStatus.APPROVED,
        reviewed_by_admin_id=current_user.id,
        reviewed_at=datetime.now(timezone.utc),
    ))
    db.flush()
    db.add(ProviderBillingAccount(
        provider_id=provider.id,
        plan_code="trial",
        status="trialing",
        billing_email=email,
        current_period_start=datetime.now(timezone.utc),
        current_period_end=datetime.now(timezone.utc) + timedelta(days=14),
    ))
    organization = _ensure_company_organization(
        db,
        provider=provider,
        owner=user,
        actor_user_id=current_user.id,
    )
    logo = normalize_organization_logo(logo_data_url)
    if logo:
        organization_settings = dict(organization.settings_json or {})
        organization_settings["branding"] = {
            **dict(organization_settings.get("branding") or {}),
            "logo_data_url": logo,
        }
        organization.settings_json = organization_settings
    _audit(
        db,
        current_user.id,
        "company_created",
        "provider",
        provider.id,
        {"email": email, "company": company_name, "owner_user_id": user.id},
    )
    db.commit()
    return {
        "user_id": user.id,
        "provider_id": provider.id,
        "organization_id": organization.id,
        "business_name": company_name,
        "email": email,
        "supabase": auth_result,
    }


@router.get("/workspace/overview")
def admin_workspace_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    since = datetime.now(timezone.utc) - timedelta(days=30)
    provider_users = int(db.scalar(select(func.count(User.id)).where(User.role == UserRole.PROVIDER)) or 0)
    active_users = int(db.scalar(select(func.count(User.id)).where(User.role == UserRole.PROVIDER, User.is_active.is_(True))) or 0)
    companies = int(db.scalar(select(func.count(ProviderProfile.id))) or 0)
    issued_total = int(db.scalar(select(func.count(AssessmentIssue.id))) or 0)
    issued_30d = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.issued_at >= since)) or 0)
    completed_total = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.status.in_(["completed", "review_pending", "reviewed"]))) or 0)
    pending_review = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.status == "review_pending")) or 0)
    unique_candidates = int(db.scalar(select(func.count(func.distinct(AssessmentIssue.candidate_email)))) or 0)
    monthly_revenue = float(
        db.scalar(
            select(func.coalesce(func.sum(ProviderBillingAccount.monthly_price), 0)).where(
                ProviderBillingAccount.status.in_(["active", "trialing"]),
            ),
        )
        or 0
    )
    completion_rate = round((completed_total / issued_total) * 100.0, 1) if issued_total else 0.0
    return {
        "companies": companies,
        "provider_users": provider_users,
        "active_users": active_users,
        "issued_total": issued_total,
        "issued_30d": issued_30d,
        "completed_total": completed_total,
        "pending_review": pending_review,
        "unique_candidates": unique_candidates,
        "completion_rate": completion_rate,
        "monthly_recurring_revenue": monthly_revenue,
        "currency": "USD",
    }


@router.get("/workspace/companies")
def admin_workspace_companies(
    q: str = Query(default="", max_length=120),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    needle = q.strip().lower()
    rows = db.execute(
        select(ProviderProfile, User)
        .join(User, User.id == ProviderProfile.user_id)
        .order_by(ProviderProfile.created_at.desc()),
    ).all()
    items = []
    for provider, owner in rows:
        if needle and needle not in f"{provider.display_name} {owner.full_name} {owner.email}".lower():
            continue
        issued_count = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.issuer_user_id == owner.id)) or 0)
        completed_count = int(
            db.scalar(
                select(func.count(AssessmentIssue.id)).where(
                    AssessmentIssue.issuer_user_id == owner.id,
                    AssessmentIssue.status.in_(["completed", "review_pending", "reviewed"]),
                ),
            )
            or 0
        )
        billing = db.scalar(select(ProviderBillingAccount).where(ProviderBillingAccount.provider_id == provider.id))
        organization = _organization_for_owner(db, owner)
        items.append({
            "provider_id": provider.id,
            "organization_id": organization.id if organization else None,
            "company_name": provider.display_name,
            "owner_user_id": owner.id,
            "owner_name": owner.full_name,
            "owner_email": owner.email,
            "account_state": owner.account_state or "active",
            "is_active": bool(owner.is_active),
            "approval_status": provider.approval_status.value if hasattr(provider.approval_status, "value") else str(provider.approval_status),
            "issued_count": issued_count,
            "completed_count": completed_count,
            "created_at": provider.created_at,
            "billing": _billing_payload(billing, provider),
        })
    return {"items": items, "total": len(items)}


@router.get("/workspace/sso-connections")
def admin_workspace_sso_connections(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    rows = db.execute(
        select(ProviderProfile, User)
        .join(User, User.id == ProviderProfile.user_id)
        .order_by(ProviderProfile.created_at.desc()),
    ).all()
    items = []
    for provider, owner in rows:
        organization = _organization_for_owner(db, owner)
        if organization:
            items.append(_sso_operation_payload(provider, organization))
    return {"items": items, "total": len(items)}


@router.put("/workspace/companies/{provider_id}/sso")
def admin_workspace_update_sso(
    provider_id: int,
    payload: SsoOperationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    provider = db.get(ProviderProfile, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Company not found")
    owner = db.get(User, provider.user_id)
    organization = _organization_for_owner(db, owner) if owner else None
    if not organization:
        raise HTTPException(status_code=409, detail="Company organization is not provisioned. Run the organization backfill command.")
    settings_json = dict(organization.settings_json or {})
    sso = dict(settings_json.get("sso") or {})
    connection_id = payload.connection_id.strip()
    operator_notes = payload.operator_notes.strip()
    last_error = payload.last_error.strip()
    if payload.connection_status in {"registration_pending", "registered"} and not sso.get("idp_metadata_url"):
        raise HTTPException(status_code=409, detail="The customer must submit identity-provider metadata before registration")
    if payload.connection_status == "registered" and not connection_id:
        raise HTTPException(status_code=422, detail="Record the Supabase SSO connection ID before marking registration complete")
    if payload.connection_status == "error" and not last_error:
        raise HTTPException(status_code=422, detail="Record the provisioning error before marking the connection as failed")
    if payload.connection_status == "verified" and sso.get("connection_status") != "verified":
        raise HTTPException(status_code=409, detail="Only a successful customer SAML login can verify the connection")
    sso.update({
        "connection_status": payload.connection_status,
        "connection_id": connection_id,
        "operator_notes": operator_notes,
        "last_error": last_error if payload.connection_status == "error" else "",
        "registered_at": (
            sso.get("registered_at") or datetime.now(timezone.utc).isoformat()
            if payload.connection_status in {"registered", "verified"}
            else sso.get("registered_at")
        ),
        "registered_by_user_id": current_user.id,
        "operator_updated_at": datetime.now(timezone.utc).isoformat(),
    })
    settings_json["sso"] = sso
    organization.settings_json = settings_json
    db.add(
        OrganizationAuditEvent(
            organization_id=organization.id,
            actor_user_id=current_user.id,
            action="sso_operator_status_updated",
            target_type="organization",
            target_id=organization.id,
            details_json={
                "provider_id": provider.id,
                "connection_status": payload.connection_status,
                "connection_id_recorded": bool(connection_id),
            },
        ),
    )
    db.commit()
    return _sso_operation_payload(provider, organization)


@router.get("/workspace/companies/{provider_id}/governance")
def admin_workspace_governance(
    provider_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    provider = db.get(ProviderProfile, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Company not found")
    owner = db.get(User, provider.user_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Company owner not found")
    organization = _organization_for_owner(db, owner)
    if not organization:
        raise HTTPException(status_code=409, detail="Company organization is not provisioned. Run the organization backfill command.")
    payload = _governance_payload(organization)
    now = datetime.now(timezone.utc)
    candidate_cutoff = now - timedelta(days=payload["candidate_retention_days"])
    assessment_cutoff = now - timedelta(days=payload["assessment_retention_days"])
    payload["retention_preview"] = {
        "hiring_candidates_eligible": int(
            db.scalar(
                select(func.count(HiringCandidate.id)).where(
                    HiringCandidate.organization_id == organization.id,
                    HiringCandidate.created_at < candidate_cutoff,
                ),
            )
            or 0
        ),
        "assessment_issues_eligible": int(
            db.scalar(
                select(func.count(AssessmentIssue.id)).where(
                    AssessmentIssue.issuer_user_id == owner.id,
                    AssessmentIssue.issued_at < assessment_cutoff,
                ),
            )
            or 0
        ),
        "candidate_cutoff": candidate_cutoff,
        "assessment_cutoff": assessment_cutoff,
        "execution_blocked": bool(payload["legal_hold_enabled"]),
    }
    return payload


@router.put("/workspace/companies/{provider_id}/governance")
def admin_workspace_update_governance(
    provider_id: int,
    payload: GovernanceSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    provider = db.get(ProviderProfile, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Company not found")
    owner = db.get(User, provider.user_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Company owner not found")
    organization = _organization_for_owner(db, owner)
    if not organization:
        raise HTTPException(status_code=409, detail="Company organization is not provisioned. Run the organization backfill command.")
    governance = payload.model_dump()
    governance["legal_hold_reason"] = governance["legal_hold_reason"].strip()
    if governance["legal_hold_enabled"] and len(governance["legal_hold_reason"]) < 10:
        raise HTTPException(status_code=422, detail="A legal hold requires a reason of at least 10 characters")
    settings = dict(organization.settings_json or {})
    settings["governance"] = governance
    organization.settings_json = settings
    db.add(
        OrganizationAuditEvent(
            organization_id=organization.id,
            actor_user_id=current_user.id,
            action="governance_settings_updated",
            target_type="organization",
            target_id=organization.id,
            details_json={
                "retention_days": {key: value for key, value in governance.items() if key.endswith("_days")},
                "legal_hold_enabled": governance["legal_hold_enabled"],
                "legal_hold_reason": governance["legal_hold_reason"],
            },
        ),
    )
    _audit(
        db,
        current_user.id,
        "governance_settings_updated",
        "organization",
        organization.id,
        {"provider_id": provider.id, "legal_hold_enabled": governance["legal_hold_enabled"]},
    )
    db.commit()
    db.refresh(organization)
    return _governance_payload(organization)


@router.get("/workspace/audit-events")
def admin_workspace_audit_events(
    provider_id: int | None = Query(default=None, gt=0),
    action: str = Query(default="", max_length=120),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    query = select(OrganizationAuditEvent, Organization).join(Organization, Organization.id == OrganizationAuditEvent.organization_id)
    if provider_id:
        provider = db.get(ProviderProfile, provider_id)
        owner = db.get(User, provider.user_id) if provider else None
        organization = _organization_for_owner(db, owner) if owner else None
        if not organization:
            raise HTTPException(status_code=404, detail="Company organization not found")
        query = query.where(OrganizationAuditEvent.organization_id == organization.id)
    if action.strip():
        query = query.where(func.lower(OrganizationAuditEvent.action).like(f"%{action.strip().lower()}%"))
    rows = db.execute(query.order_by(OrganizationAuditEvent.created_at.desc()).limit(limit)).all()
    return {
        "items": [
            {
                "id": event.id,
                "organization_id": organization.id,
                "organization_name": organization.name,
                "actor_user_id": event.actor_user_id,
                "action": event.action,
                "target_type": event.target_type,
                "target_id": event.target_id,
                "details": event.details_json or {},
                "created_at": event.created_at,
            }
            for event, organization in rows
        ],
    }


@router.get("/workspace/data-requests")
def admin_workspace_data_requests(
    provider_id: int | None = Query(default=None, gt=0),
    request_status: str = Query(default="", max_length=40),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    query = select(DataSubjectRequest, Organization).join(Organization, Organization.id == DataSubjectRequest.organization_id)
    if provider_id:
        query = query.where(DataSubjectRequest.provider_id == provider_id)
    if request_status.strip():
        query = query.where(DataSubjectRequest.status == request_status.strip())
    rows = db.execute(query.order_by(DataSubjectRequest.due_at.asc(), DataSubjectRequest.id.desc())).all()
    return {"items": [_data_subject_request_payload(item, organization.name) for item, organization in rows]}


@router.post("/workspace/data-requests", status_code=201)
def admin_workspace_create_data_request(
    payload: DataSubjectRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    provider = db.get(ProviderProfile, payload.provider_id)
    owner = db.get(User, provider.user_id) if provider else None
    organization = _organization_for_owner(db, owner) if owner else None
    if not provider or not owner or not organization:
        raise HTTPException(status_code=404, detail="Company organization not found")
    now = datetime.now(timezone.utc)
    item = DataSubjectRequest(
        organization_id=organization.id,
        provider_id=provider.id,
        request_reference=f"DSR-{now:%Y%m%d}-{secrets.token_hex(4).upper()}",
        request_type=payload.request_type,
        candidate_email=str(payload.candidate_email).strip().lower(),
        requestor_name=payload.requestor_name.strip(),
        received_at=now,
        due_at=now + timedelta(days=30),
        notes=payload.notes.strip(),
        created_by_user_id=current_user.id,
    )
    db.add(item)
    db.flush()
    db.add(
        OrganizationAuditEvent(
            organization_id=organization.id,
            actor_user_id=current_user.id,
            action="data_subject_request_received",
            target_type="data_subject_request",
            target_id=item.id,
            details_json={"request_reference": item.request_reference, "request_type": item.request_type},
        ),
    )
    db.commit()
    db.refresh(item)
    return _data_subject_request_payload(item, organization.name)


@router.patch("/workspace/data-requests/{request_id}")
def admin_workspace_update_data_request(
    request_id: int,
    payload: DataSubjectRequestAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    item = db.get(DataSubjectRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="Data request not found")
    organization = db.get(Organization, item.organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    if item.status in {"completed", "rejected"}:
        raise HTTPException(status_code=409, detail="Completed or rejected requests cannot be changed")
    now = datetime.now(timezone.utc)
    if payload.action == "verify_identity":
        item.identity_verified_at = now
        item.status = "identity_verified"
    elif payload.action == "start_review":
        if not item.identity_verified_at:
            raise HTTPException(status_code=409, detail="Identity must be verified before review")
        item.status = "in_review"
    elif payload.action == "approve":
        if not item.identity_verified_at:
            raise HTTPException(status_code=409, detail="Identity must be verified before approval")
        item.status = "approved"
    elif payload.action == "reject":
        item.status = "rejected"
        item.completed_at = now
    elif payload.action == "hold":
        item.status = "on_hold"
    elif payload.action == "resume":
        if item.status != "on_hold":
            raise HTTPException(status_code=409, detail="Only an on-hold request can be resumed")
        item.status = "in_review" if item.identity_verified_at else "received"
    item.notes = "\n".join(part for part in [item.notes.strip(), f"{now.isoformat()} | {payload.action}: {payload.reason.strip()}"] if part)
    item.assigned_to_user_id = current_user.id
    db.add(
        OrganizationAuditEvent(
            organization_id=item.organization_id,
            actor_user_id=current_user.id,
            action=f"data_subject_request_{payload.action}",
            target_type="data_subject_request",
            target_id=item.id,
            details_json={"request_reference": item.request_reference, "status": item.status, "reason": payload.reason.strip()},
        ),
    )
    db.commit()
    db.refresh(item)
    return _data_subject_request_payload(item, organization.name)


@router.post("/workspace/data-requests/{request_id}/execute")
def admin_workspace_execute_data_request(
    request_id: int,
    payload: DataSubjectRequestExecute,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    item = db.get(DataSubjectRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="Data request not found")
    if item.status != "approved":
        raise HTTPException(status_code=409, detail="The request must be identity-verified and approved before execution")
    if payload.confirmation.strip() != item.request_reference:
        raise HTTPException(status_code=422, detail="Confirmation must exactly match the request reference")
    organization = db.get(Organization, item.organization_id)
    provider = db.get(ProviderProfile, item.provider_id) if item.provider_id else None
    owner = db.get(User, provider.user_id) if provider else None
    if not organization or not owner:
        raise HTTPException(status_code=404, detail="Request organization is unavailable")
    governance = _governance_payload(organization)
    if governance["legal_hold_enabled"]:
        raise HTTPException(status_code=409, detail="Execution is blocked by the organization-wide legal hold")
    email = item.candidate_email.strip().lower()
    candidates = list(
        db.scalars(
            select(HiringCandidate).where(
                HiringCandidate.organization_id == organization.id,
                func.lower(HiringCandidate.email) == email,
            ),
        ).all(),
    )
    candidate_ids = [candidate.id for candidate in candidates]
    applications = list(
        db.scalars(select(HiringApplication).where(HiringApplication.candidate_id.in_(candidate_ids))).all(),
    ) if candidate_ids else []
    issues = list(
        db.scalars(
            select(AssessmentIssue).where(
                AssessmentIssue.issuer_user_id == owner.id,
                func.lower(AssessmentIssue.candidate_email) == email,
            ),
        ).all(),
    )
    if item.request_type in {"access", "export"}:
        package = {
            "request_reference": item.request_reference,
            "candidate_profile": [
                {
                    "id": candidate.id,
                    "name": f"{candidate.first_name} {candidate.last_name}".strip(),
                    "email": candidate.email,
                    "phone_number": candidate.phone_number,
                    "headline": candidate.headline,
                    "location": candidate.location,
                    "skills": candidate.skills_json or [],
                    "experience_years": candidate.experience_years,
                    "consent_status": candidate.consent_status,
                    "created_at": candidate.created_at,
                }
                for candidate in candidates
            ],
            "applications": [{"id": app.id, "job_id": app.job_id, "stage": app.stage, "status": app.status, "applied_at": app.applied_at} for app in applications],
            "assessments": [{"id": issue.id, "exam_id": issue.exam_id, "status": issue.status, "issued_at": issue.issued_at, "completed_at": issue.completed_at} for issue in issues],
        }
        resolution = {"operation": "export", "candidate_records": len(candidates), "applications": len(applications), "assessments": len(issues)}
    else:
        if any(app.status == "active" for app in applications):
            raise HTTPException(status_code=409, detail="Close or withdraw active applications before deletion")
        if any(issue.status in {"issued", "started"} for issue in issues):
            raise HTTPException(status_code=409, detail="Revoke active assessment invitations before deletion")
        cleared_submissions = 0
        for candidate in candidates:
            candidate.first_name = "Deleted"
            candidate.last_name = "Candidate"
            candidate.email = f"deleted+candidate-{candidate.id}@redacted.invalid"
            candidate.phone_number = None
            candidate.headline = ""
            candidate.location = ""
            candidate.resume_text = ""
            candidate.resume_url = None
            candidate.skills_json = []
            candidate.experience_years = None
            candidate.consent_status = "deleted"
            candidate.consented_at = None
        for issue in issues:
            issue.candidate_name = "Deleted candidate"
            issue.candidate_email = f"deleted+assessment-{issue.id}@redacted.invalid"
            issue.candidate_password_hash = "data-request-deleted"
            issue.active_session_token = None
            issue.active_session_started_at = None
            issue.access_expires_at = datetime.now(timezone.utc)
            issue.result_json = {"data_subject_request": item.request_reference}
            submissions = list(db.scalars(select(AssessmentSubmission).where(AssessmentSubmission.issue_id == issue.id)).all())
            for submission in submissions:
                submission.submitted_data_json = {}
                submission.proctoring_events_json = []
                submission.status = "data_subject_deleted"
                cleared_submissions += 1
        resolution = {"operation": "delete", "candidate_records": len(candidates), "assessments": len(issues), "submissions_cleared": cleared_submissions}
        package = None
        item.candidate_email = f"deleted+request-{item.id}@redacted.invalid"
        item.requestor_name = ""
        item.notes = ""
    item.status = "completed"
    item.completed_at = datetime.now(timezone.utc)
    item.resolution_json = resolution
    db.add(
        OrganizationAuditEvent(
            organization_id=organization.id,
            actor_user_id=current_user.id,
            action="data_subject_request_completed",
            target_type="data_subject_request",
            target_id=item.id,
            details_json={"request_reference": item.request_reference, **resolution},
        ),
    )
    db.commit()
    return {"request": _data_subject_request_payload(item, organization.name), "export": package}


@router.post("/workspace/companies", status_code=201)
def admin_workspace_create_company(
    payload: AdminCompanyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    return _create_company_account(
        business_name=payload.business_name,
        email_address=str(payload.email),
        password=payload.password,
        account_name=None,
        db=db,
        current_user=current_user,
        logo_data_url=payload.logo_data_url,
    )


@router.get("/workspace/users")
def admin_workspace_users(
    q: str = Query(default="", max_length=120),
    state: str = Query(default="all", max_length=30),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    query = select(User).where(User.role.in_([UserRole.PROVIDER, UserRole.ADMIN])).order_by(User.created_at.desc())
    users = db.scalars(query).all()
    needle = q.strip().lower()
    items = []
    for user in users:
        provider = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user.id))
        account_state = str(user.account_state or "active")
        if state != "all" and account_state != state:
            continue
        if needle and needle not in f"{user.full_name} {user.email} {provider.display_name if provider else ''}".lower():
            continue
        issued_count = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.issuer_user_id == user.id)) or 0)
        items.append({
            "user_id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role.value,
            "company_name": provider.display_name if provider else "Valases",
            "provider_id": provider.id if provider else None,
            "is_active": bool(user.is_active),
            "account_state": account_state,
            "issued_count": issued_count,
            "created_at": user.created_at,
        })
    return {"items": items, "total": len(items)}


@router.post("/workspace/users", status_code=201)
def admin_workspace_create_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    temporary_password = payload.temporary_password or secrets.token_urlsafe(12)
    result = _create_company_account(
        business_name=payload.company_name,
        email_address=str(payload.email),
        password=temporary_password,
        account_name=payload.full_name,
        db=db,
        current_user=current_user,
    )
    return {
        **result,
        "temporary_password": temporary_password,
    }


@router.get("/workspace/usage")
def admin_workspace_usage(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    del current_user
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.execute(select(ProviderProfile, User).join(User, User.id == ProviderProfile.user_id)).all()
    items = []
    for provider, owner in rows:
        issued = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.issuer_user_id == owner.id, AssessmentIssue.issued_at >= since)) or 0)
        completed = int(db.scalar(select(func.count(AssessmentIssue.id)).where(AssessmentIssue.issuer_user_id == owner.id, AssessmentIssue.completed_at >= since)) or 0)
        candidates = int(db.scalar(select(func.count(func.distinct(AssessmentIssue.candidate_email))).where(AssessmentIssue.issuer_user_id == owner.id, AssessmentIssue.issued_at >= since)) or 0)
        submissions = int(
            db.scalar(
                select(func.count(AssessmentSubmission.id))
                .join(AssessmentIssue, AssessmentIssue.id == AssessmentSubmission.issue_id)
                .where(AssessmentIssue.issuer_user_id == owner.id, AssessmentSubmission.submitted_at >= since),
            )
            or 0
        )
        items.append({
            "provider_id": provider.id,
            "company_name": provider.display_name,
            "owner_email": owner.email,
            "issued": issued,
            "completed": completed,
            "submissions": submissions,
            "unique_candidates": candidates,
            "completion_rate": round((completed / issued) * 100.0, 1) if issued else 0.0,
        })
    items.sort(key=lambda item: item["issued"], reverse=True)
    return {"days": days, "items": items}


@router.put("/workspace/companies/{provider_id}/billing")
def admin_workspace_update_billing(
    provider_id: int,
    payload: BillingAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    provider = db.get(ProviderProfile, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Company not found.")
    account = db.scalar(select(ProviderBillingAccount).where(ProviderBillingAccount.provider_id == provider.id))
    if not account:
        account = ProviderBillingAccount(provider_id=provider.id)
    for key, value in payload.model_dump().items():
        setattr(account, key, value)
    db.add(account)
    _audit(db, current_user.id, "billing_account_updated", "provider", provider.id, payload.model_dump(mode="json"))
    db.commit()
    db.refresh(account)
    return _billing_payload(account, provider)


@router.post("/accounts/sync-rules")
def sync_account_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    summary = sync_existing_accounts(
        db,
        apply_legacy_student_approval_rollback=False,
        sync_firebase_claims=True,
    )
    _audit(
        db,
        current_user.id,
        "sync_account_rules",
        "user",
        None,
        summary,
    )
    db.commit()
    return summary


@router.get("/providers/pending")
def pending_providers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    providers = db.scalars(select(ProviderProfile).where(ProviderProfile.approval_status == ApprovalStatus.PENDING)).all()
    return list(providers)


@router.get("/analytics", response_model=AnalyticsOut)
def analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    onboarded_providers = db.scalar(
        select(func.count(ProviderProfile.id)).where(ProviderProfile.approval_status == ApprovalStatus.APPROVED),
    ) or 0
    approved_students = db.scalar(
        select(func.count(User.id))
        .join(UserApproval, UserApproval.user_id == User.id, isouter=True)
        .where(User.role == UserRole.STUDENT)
        .where((UserApproval.status == ApprovalStatus.APPROVED) | (UserApproval.id.is_(None))),
    ) or 0
    enrolled_courses = db.scalar(select(func.count(Enrollment.id))) or 0
    issued_certificates = db.scalar(select(func.count(Certificate.id))) or 0
    total_results = db.scalar(select(func.count(Result.id))) or 0
    passed_results = db.scalar(select(func.count(Result.id)).where(Result.passed.is_(True))) or 0
    pass_percentage = round((passed_results / total_results) * 100, 2) if total_results > 0 else 0.0
    return AnalyticsOut(
        onboarded_providers=onboarded_providers,
        approved_students=approved_students,
        enrolled_courses=enrolled_courses,
        issued_certificates=issued_certificates,
        pass_percentage=pass_percentage,
    )


@router.post("/providers/{provider_id}/decision")
def provider_decision(
    provider_id: int,
    payload: AdminApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    provider = db.get(ProviderProfile, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider.approval_status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    provider.rejection_reason = None if payload.approve else payload.rejection_reason
    provider.reviewed_by_admin_id = current_user.id
    provider.reviewed_at = datetime.now(timezone.utc)
    user_approval = db.scalar(select(UserApproval).where(UserApproval.user_id == provider.user_id))
    if not user_approval:
        user_approval = UserApproval(user_id=provider.user_id)
        db.add(user_approval)
    user_approval.status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    user_approval.rejection_reason = None if payload.approve else payload.rejection_reason
    user_approval.reviewed_by_admin_id = current_user.id
    user_approval.reviewed_at = datetime.now(timezone.utc)
    _audit(
        db,
        current_user.id,
        "provider_decision_legacy",
        "provider",
        provider_id,
        {"approved": payload.approve, "reason": payload.rejection_reason},
    )
    db.commit()
    return {"provider_id": provider_id, "status": provider.approval_status}


@router.get("/documents/pending")
def pending_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    docs = db.scalars(select(ProviderDocument).where(ProviderDocument.status == ApprovalStatus.PENDING)).all()
    return list(docs)


@router.post("/documents/{document_id}/review")
def review_document(
    document_id: int,
    payload: DocumentReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    doc = db.get(ProviderDocument, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = payload.status
    doc.review_note = payload.review_note
    db.commit()
    return {"document_id": doc.id, "status": doc.status}


@router.get("/approvals/summary")
def approvals_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    pending_students = db.scalar(
        select(func.count(UserApproval.id))
        .join(User, User.id == UserApproval.user_id)
        .where(and_(User.role == UserRole.STUDENT, UserApproval.status == ApprovalStatus.PENDING)),
    ) or 0
    pending_providers = db.scalar(
        select(func.count(UserApproval.id))
        .join(User, User.id == UserApproval.user_id)
        .where(and_(User.role == UserRole.PROVIDER, UserApproval.status == ApprovalStatus.PENDING)),
    ) or 0
    return {"pending_students": pending_students, "pending_providers": pending_providers}


@router.get("/workspace-badges")
def workspace_badges(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    pending_students = db.scalar(
        select(func.count(UserApproval.id))
        .join(User, User.id == UserApproval.user_id)
        .where(and_(User.role == UserRole.STUDENT, UserApproval.status == ApprovalStatus.PENDING)),
    ) or 0
    pending_providers = db.scalar(
        select(func.count(UserApproval.id))
        .join(User, User.id == UserApproval.user_id)
        .where(and_(User.role == UserRole.PROVIDER, UserApproval.status == ApprovalStatus.PENDING)),
    ) or 0
    open_reports = db.scalar(
        select(func.count(ReportItem.id)).where(ReportItem.status.in_([ModerationStatus.OPEN, ModerationStatus.IN_REVIEW])),
    ) or 0
    open_complaints = db.scalar(
        select(func.count(ComplaintItem.id)).where(ComplaintItem.status.in_([ModerationStatus.OPEN, ModerationStatus.IN_REVIEW])),
    ) or 0
    return {
        "pending_approvals": pending_students + pending_providers,
        "pending_students": pending_students,
        "pending_providers": pending_providers,
        "open_reports": open_reports,
        "open_complaints": open_complaints,
        "open_moderation": open_reports + open_complaints,
    }


def _normalize_phone(value: str | None) -> str | None:
    raw = "".join(ch for ch in str(value or "").strip() if ch.isdigit() or ch == "+")
    return raw or None


@router.get("/users")
def admin_users_list(
    role: str = Query(default="students"),
    q: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    role_key = str(role or "students").strip().lower()
    if role_key not in {"students", "providers"}:
        raise HTTPException(status_code=400, detail="role must be students or providers")
    target_role = UserRole.STUDENT if role_key == "students" else UserRole.PROVIDER
    rows = db.scalars(select(User).where(User.role == target_role).order_by(User.created_at.desc())).all()
    needle = str(q or "").strip().lower()
    items = []
    for u in rows:
        ap = db.scalar(select(UserApproval).where(UserApproval.user_id == u.id))
        idv = db.scalar(select(UserIdentityVerification).where(UserIdentityVerification.user_id == u.id))
        provider = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == u.id)) if u.role == UserRole.PROVIDER else None
        item = {
            "user_id": u.id,
            "email": u.email,
            "phone_number": u.phone_number,
            "full_name": u.full_name,
            "role": u.role.value,
            "is_active": bool(u.is_active),
            "account_state": str(u.account_state or "active"),
            "approval_status": (ap.status.value if ap else ApprovalStatus.APPROVED.value),
            "created_at": u.created_at,
            "verification": (
                {
                    "id_type": idv.id_type,
                    "id_number": idv.id_number,
                    "country_code": idv.country_code,
                    "status": idv.status.value if idv.status else None,
                } if idv else None
            ),
            "provider_profile": (
                {
                    "provider_id": provider.id,
                    "display_name": provider.display_name,
                    "provider_type": provider.provider_type.value if provider.provider_type else None,
                    "business_registration_type": provider.business_registration_type,
                    "business_registration_number": provider.business_registration_number,
                    "business_registration_country": provider.business_registration_country,
                } if provider else None
            ),
        }
        if needle:
            blob = " ".join(
                [
                    str(item.get("email") or ""),
                    str(item.get("full_name") or ""),
                    str(item.get("phone_number") or ""),
                    str((item.get("provider_profile") or {}).get("display_name") or ""),
                    str((item.get("verification") or {}).get("id_number") or ""),
                ],
            ).lower()
            if needle not in blob:
                continue
        items.append(item)
    return {"items": items, "total": len(items), "role": role_key}


def _sync_user_approval_state(
    db: Session,
    *,
    user: User,
    reviewer_id: int,
    state: str,
    reason: str | None = None,
) -> None:
    approval = db.scalar(select(UserApproval).where(UserApproval.user_id == user.id))
    if not approval:
        approval = UserApproval(user_id=user.id)
        db.add(approval)
    if state in {"active", "frozen"}:
        approval.status = ApprovalStatus.APPROVED
        approval.rejection_reason = None
    else:
        approval.status = ApprovalStatus.REJECTED
        approval.rejection_reason = reason or state
    approval.reviewed_by_admin_id = reviewer_id
    approval.reviewed_at = datetime.now(timezone.utc)


def _ban_user_identities(
    db: Session,
    *,
    user: User,
    reason: str | None,
    actor_user_id: int,
) -> None:
    identity = db.scalar(select(UserIdentityVerification).where(UserIdentityVerification.user_id == user.id))
    email = str(user.email or "").strip().lower() or None
    phone = _normalize_phone(user.phone_number)
    existing_rows = db.scalars(select(BannedIdentity).where(BannedIdentity.source_user_id == user.id)).all()
    if existing_rows:
        for row in existing_rows:
            row.reason = reason or row.reason
        return
    db.add(
        BannedIdentity(
            email=email,
            phone_number=phone,
            id_type=(identity.id_type if identity else None),
            id_number=(identity.id_number if identity else None),
            country_code=(identity.country_code if identity else None),
            source_user_id=user.id,
            reason=reason or "Account banned by admin",
        ),
    )
    _audit(
        db,
        actor_user_id,
        "user_identity_banned",
        "user",
        user.id,
        {
            "email": email,
            "phone_number": phone,
            "id_type": identity.id_type if identity else None,
            "id_number": identity.id_number if identity else None,
            "country_code": identity.country_code if identity else None,
            "reason": reason or "Account banned by admin",
        },
    )


@router.post("/users/{user_id}/state")
def admin_update_user_state(
    user_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    user = db.get(User, int(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="Admin accounts cannot be updated here")
    action = str(payload.get("action") or "").strip().lower()
    reason = str(payload.get("reason") or "").strip() or None
    if action not in {"active", "freeze", "ban", "delete"}:
        raise HTTPException(status_code=400, detail="action must be active, freeze, ban, or delete")

    if action == "active":
        user.is_active = True
        user.account_state = "active"
        _sync_user_approval_state(db, user=user, reviewer_id=current_user.id, state="active")
    elif action == "freeze":
        user.is_active = False
        user.account_state = "frozen"
        _sync_user_approval_state(db, user=user, reviewer_id=current_user.id, state="frozen", reason=reason)
    elif action == "ban":
        user.is_active = False
        user.account_state = "banned"
        _sync_user_approval_state(db, user=user, reviewer_id=current_user.id, state="banned", reason=reason)
        _ban_user_identities(db, user=user, reason=reason, actor_user_id=current_user.id)
    else:  # delete
        user.is_active = False
        user.account_state = "deleted"
        tomb = f"deleted+{user.id}@deleted.local"
        user.email = tomb
        user.phone_number = None
        user.full_name = f"Deleted User {user.id}"
        _sync_user_approval_state(db, user=user, reviewer_id=current_user.id, state="deleted", reason=reason)
        db.execute(delete(ProviderProfile).where(ProviderProfile.user_id == user.id))

    _audit(
        db,
        current_user.id,
        "user_state_updated",
        "user",
        user.id,
        {"action": action, "reason": reason},
    )
    db.commit()
    return {"ok": True, "user_id": user.id, "account_state": user.account_state, "is_active": user.is_active}


@router.get("/approvals/students")
def pending_student_approvals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    base_query = (
        select(User, UserApproval)
        .join(UserApproval, UserApproval.user_id == User.id)
        .where(and_(User.role == UserRole.STUDENT, UserApproval.status == ApprovalStatus.PENDING))
    )
    total = db.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    rows = db.execute(base_query.offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    for user, approval in rows:
        identity = db.scalar(select(UserIdentityVerification).where(UserIdentityVerification.user_id == user.id))
        items.append(
            {
                "user_id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "approval_status": approval.status,
                "created_at": approval.created_at,
                "verification": (
                    {
                        "id_type": identity.id_type,
                        "id_number": identity.id_number,
                        "country_code": identity.country_code,
                        "status": identity.status,
                        "document_url": identity.document_url,
                    }
                    if identity
                    else None
                ),
            },
        )
    return {"items": items, "page": page, "page_size": page_size, "total": total}


@router.get("/approvals/providers")
def pending_provider_approvals(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    base_query = (
        select(User, ProviderProfile, UserApproval)
        .join(ProviderProfile, ProviderProfile.user_id == User.id, isouter=True)
        .join(UserApproval, UserApproval.user_id == User.id)
        .where(and_(User.role == UserRole.PROVIDER, UserApproval.status == ApprovalStatus.PENDING))
    )
    total = db.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    rows = db.execute(base_query.offset((page - 1) * page_size).limit(page_size)).all()
    data = []
    for user, profile, approval in rows:
        docs = list(db.scalars(select(ProviderDocument).where(ProviderDocument.provider_id == profile.id)).all()) if profile else []
        identity = db.scalar(select(UserIdentityVerification).where(UserIdentityVerification.user_id == user.id))
        data.append(
            {
                "user_id": user.id,
                "provider_id": profile.id if profile else None,
                "email": user.email,
                "full_name": user.full_name,
                "provider_type": profile.provider_type if profile else "not_submitted",
                "display_name": profile.display_name if profile else user.full_name,
                "approval_status": approval.status,
                "profile_created": profile is not None,
                "identity_verification": (
                    {
                        "id_type": identity.id_type,
                        "id_number": identity.id_number,
                        "country_code": identity.country_code,
                        "status": identity.status,
                        "document_url": identity.document_url,
                    }
                    if identity
                    else None
                ),
                "business_registration_type": profile.business_registration_type if profile else None,
                "business_registration_number": profile.business_registration_number if profile else None,
                "business_registration_country": profile.business_registration_country if profile else None,
                "documents": [
                    {
                        "id": d.id,
                        "document_type": d.document_type,
                        "file_url": d.file_url,
                        "status": d.status,
                    }
                    for d in docs
                ],
            },
        )
    return {"items": data, "page": page, "page_size": page_size, "total": total}


@router.post("/approvals/providers/users/{user_id}/decision")
def provider_user_approval_decision(
    user_id: int,
    payload: AdminApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    user = db.get(User, user_id)
    if not user or user.role != UserRole.PROVIDER:
        raise HTTPException(status_code=404, detail="Provider user not found")

    approval = db.scalar(select(UserApproval).where(UserApproval.user_id == user_id))
    if not approval:
        approval = UserApproval(user_id=user_id)
        db.add(approval)
    approval.status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    approval.rejection_reason = None if payload.approve else payload.rejection_reason
    approval.reviewed_by_admin_id = current_user.id
    approval.reviewed_at = datetime.now(timezone.utc)

    profile = db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    if not profile and payload.approve:
        profile = ProviderProfile(
            user_id=user_id,
            provider_type=ProviderType.INDIVIDUAL,
            display_name=user.full_name,
            description="",
            approval_status=ApprovalStatus.APPROVED,
            rejection_reason=None,
            reviewed_by_admin_id=current_user.id,
            reviewed_at=datetime.now(timezone.utc),
        )
        db.add(profile)
    elif profile:
        profile.approval_status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
        profile.rejection_reason = None if payload.approve else payload.rejection_reason
        profile.reviewed_by_admin_id = current_user.id
        profile.reviewed_at = datetime.now(timezone.utc)

    _audit(
        db,
        current_user.id,
        "provider_user_approval_decision",
        "user",
        user.id,
        {"approved": payload.approve, "reason": payload.rejection_reason},
    )
    email_result = _safe_send_email(
        user.email,
        "Valases Provider Approval Update",
        "Your provider profile was approved."
        if payload.approve
        else f"Your provider profile was rejected. Reason: {payload.rejection_reason or 'Not specified'}",
    )
    db.commit()
    return {"user_id": user.id, "status": approval.status, "profile_created": profile is not None, "email": email_result}


@router.post("/approvals/students/{user_id}/decision")
def student_approval_decision(
    user_id: int,
    payload: AdminApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    user = db.get(User, user_id)
    if not user or user.role != UserRole.STUDENT:
        raise HTTPException(status_code=404, detail="Student not found")
    approval = db.scalar(select(UserApproval).where(UserApproval.user_id == user_id))
    if not approval:
        approval = UserApproval(user_id=user_id)
        db.add(approval)
    approval.status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    approval.rejection_reason = None if payload.approve else payload.rejection_reason
    approval.reviewed_by_admin_id = current_user.id
    approval.reviewed_at = datetime.now(timezone.utc)
    _audit(
        db,
        current_user.id,
        "student_approval_decision",
        "user",
        user.id,
        {"approved": payload.approve, "reason": payload.rejection_reason},
    )
    email_result = _safe_send_email(
        user.email,
        "Valases Profile Approval Update",
        "Your profile was approved." if payload.approve else f"Your profile was rejected. Reason: {payload.rejection_reason or 'Not specified'}",
    )
    db.commit()
    return {"user_id": user.id, "status": approval.status, "email": email_result}


@router.post("/approvals/providers/{provider_id}/decision")
def provider_approval_decision(
    provider_id: int,
    payload: AdminApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    provider = db.get(ProviderProfile, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider.approval_status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    provider.rejection_reason = None if payload.approve else payload.rejection_reason
    provider.reviewed_by_admin_id = current_user.id
    provider.reviewed_at = datetime.now(timezone.utc)
    approval = db.scalar(select(UserApproval).where(UserApproval.user_id == provider.user_id))
    if not approval:
        approval = UserApproval(user_id=provider.user_id)
        db.add(approval)
    approval.status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    approval.rejection_reason = None if payload.approve else payload.rejection_reason
    approval.reviewed_by_admin_id = current_user.id
    approval.reviewed_at = datetime.now(timezone.utc)
    user = db.get(User, provider.user_id)
    _audit(
        db,
        current_user.id,
        "provider_approval_decision",
        "provider",
        provider.id,
        {"approved": payload.approve, "reason": payload.rejection_reason},
    )
    email_result = (
        _safe_send_email(
            user.email,
            "Valases Provider Approval Update",
            "Your provider profile was approved."
            if payload.approve
            else f"Your provider profile was rejected. Reason: {payload.rejection_reason or 'Not specified'}",
        )
        if user
        else {"sent": False, "reason": "User not found"}
    )
    db.commit()
    return {"provider_id": provider.id, "status": approval.status, "email": email_result}


@router.get("/exams/review")
def exams_for_review(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    exams = db.scalars(select(Exam).where(Exam.status.in_([ExamStatus.IN_REVIEW, ExamStatus.REJECTED]))).all()
    return list(exams)


@router.post("/exams/{exam_id}/certification-approval")
def approve_exam_for_certification(
    exam_id: int,
    payload: AdminApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    exam.admin_certification_approved = payload.approve
    exam.status = ExamStatus.PUBLISHED if payload.approve else ExamStatus.REJECTED
    db.commit()
    return {"exam_id": exam.id, "admin_certification_approved": exam.admin_certification_approved, "status": exam.status}


@router.post("/reports")
def submit_report(
    payload: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.PROVIDER, UserRole.ADMIN, allow_unapproved=True)),
):
    item = ReportItem(
        reporter_user_id=current_user.id,
        report_type=payload.report_type,
        details=payload.details,
        target_type=payload.target_type,
        target_id=payload.target_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/complaints")
def submit_complaint(
    payload: ComplaintCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.STUDENT, UserRole.PROVIDER, UserRole.ADMIN, allow_unapproved=True)),
):
    item = ComplaintItem(
        complainant_user_id=current_user.id,
        complaint_type=payload.complaint_type,
        details=payload.details,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/reports")
def list_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = None,
    search: str | None = None,
):
    query = select(ReportItem, User).join(User, User.id == ReportItem.reporter_user_id, isouter=True)
    if status:
        query = query.where(ReportItem.status == status)
    if search:
        like = f"%{search}%"
        query = query.where((ReportItem.details.ilike(like)) | (User.full_name.ilike(like)) | (User.email.ilike(like)))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(ReportItem.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for it, reporter in rows:
        counts[it.report_type] = counts.get(it.report_type, 0) + 1
        key = it.status.value if hasattr(it.status, "value") else str(it.status)
        status_counts[key] = status_counts.get(key, 0) + 1
        items.append(
            {
                "id": it.id,
                "report_type": it.report_type,
                "details": it.details,
                "target_type": it.target_type,
                "target_id": it.target_id,
                "status": key,
                "created_at": it.created_at,
                "reporter_user_id": it.reporter_user_id,
                "reporter_name": reporter.full_name if reporter else None,
                "reporter_email": reporter.email if reporter else None,
            },
        )
    return {"count": len(items), "by_type": counts, "by_status": status_counts, "items": items, "page": page, "page_size": page_size, "total": total}


@router.get("/complaints")
def list_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = None,
    search: str | None = None,
):
    query = select(ComplaintItem, User).join(User, User.id == ComplaintItem.complainant_user_id, isouter=True)
    if status:
        query = query.where(ComplaintItem.status == status)
    if search:
        like = f"%{search}%"
        query = query.where((ComplaintItem.details.ilike(like)) | (User.full_name.ilike(like)) | (User.email.ilike(like)))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(ComplaintItem.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    items = []
    counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for it, complainant in rows:
        counts[it.complaint_type] = counts.get(it.complaint_type, 0) + 1
        key = it.status.value if hasattr(it.status, "value") else str(it.status)
        status_counts[key] = status_counts.get(key, 0) + 1
        items.append(
            {
                "id": it.id,
                "complaint_type": it.complaint_type,
                "details": it.details,
                "status": key,
                "created_at": it.created_at,
                "complainant_user_id": it.complainant_user_id,
                "complainant_name": complainant.full_name if complainant else None,
                "complainant_email": complainant.email if complainant else None,
            },
        )
    return {"count": len(items), "by_type": counts, "by_status": status_counts, "items": items, "page": page, "page_size": page_size, "total": total}


@router.get("/provider-complaints")
def list_provider_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
    status: str | None = None,
    search: str | None = None,
):
    query = (
        select(CourseComment, Course, User)
        .join(Course, Course.id == CourseComment.course_id)
        .join(User, User.id == CourseComment.student_id, isouter=True)
    )
    if status:
        query = query.where(CourseComment.provider_status == str(status).strip().lower())
    if search:
        like = f"%{str(search).strip()}%"
        query = query.where(
            (CourseComment.message.ilike(like))
            | (Course.title.ilike(like))
            | (User.full_name.ilike(like))
            | (User.email.ilike(like)),
        )
    rows = db.execute(query.order_by(CourseComment.created_at.desc())).all()
    out = []
    for comment, course, student in rows:
        out.append(
            {
                "comment_id": comment.id,
                "course_id": course.id,
                "course_title": course.title,
                "student_id": comment.student_id,
                "student_name": student.full_name if student else None,
                "student_email": student.email if student else None,
                "message": comment.message,
                "provider_status": comment.provider_status or "new",
                "provider_reply": comment.provider_reply,
                "provider_seen_at": comment.provider_seen_at,
                "created_at": comment.created_at,
                "replied_at": comment.replied_at,
            },
        )
    return {"count": len(out), "items": out}


@router.post("/reports/{report_id}/status")
def update_report_status(
    report_id: int,
    payload: ModerationUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    report = db.get(ReportItem, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    previous = report.status
    report.status = payload.status
    _audit(
        db,
        current_user.id,
        "report_status_update",
        "report",
        report.id,
        {"previous": previous, "new": payload.status},
    )
    db.commit()
    return {"report_id": report.id, "status": report.status}


@router.post("/complaints/{complaint_id}/status")
def update_complaint_status(
    complaint_id: int,
    payload: ModerationUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    complaint = db.get(ComplaintItem, complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    previous = complaint.status
    complaint.status = payload.status
    _audit(
        db,
        current_user.id,
        "complaint_status_update",
        "complaint",
        complaint.id,
        {"previous": previous, "new": payload.status},
    )
    db.commit()
    return {"complaint_id": complaint.id, "status": complaint.status}


@router.get("/reports/export.csv")
def export_reports_csv(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    rows = db.execute(
        select(ReportItem, User).join(User, User.id == ReportItem.reporter_user_id, isouter=True).order_by(ReportItem.created_at.desc()),
    ).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "status", "details", "reporter_name", "reporter_email", "created_at"])
    for report, user in rows:
        writer.writerow([report.id, report.report_type, report.status, report.details, user.full_name if user else "", user.email if user else "", report.created_at])
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=reports.csv"})


@router.get("/complaints/export.csv")
def export_complaints_csv(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    rows = db.execute(
        select(ComplaintItem, User).join(User, User.id == ComplaintItem.complainant_user_id, isouter=True).order_by(ComplaintItem.created_at.desc()),
    ).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "status", "details", "complainant_name", "complainant_email", "created_at"])
    for complaint, user in rows:
        writer.writerow([complaint.id, complaint.complaint_type, complaint.status, complaint.details, user.full_name if user else "", user.email if user else "", complaint.created_at])
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=complaints.csv"})


@router.get("/approvals/export.csv")
def export_approvals_csv(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    rows = db.execute(
        select(User, UserApproval)
        .join(UserApproval, UserApproval.user_id == User.id)
        .where(UserApproval.status == ApprovalStatus.PENDING)
        .order_by(UserApproval.created_at.desc()),
    ).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["user_id", "full_name", "email", "role", "status", "created_at"])
    for user, approval in rows:
        writer.writerow([user.id, user.full_name, user.email, user.role, approval.status, approval.created_at])
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=pending_approvals.csv"})


@router.get("/billing-payments")
def billing_payments_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    return {
        "status": "placeholder",
        "message": "Billing & payments module is reserved for next phase.",
    }


@router.get("/audit-logs")
def audit_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = list(db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all())
    return {"items": rows, "page": page, "page_size": page_size, "total": total}
    DataSubjectRequest,
