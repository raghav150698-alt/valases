from datetime import datetime, timezone
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.entities import (
    AuditLog,
    BannedIdentity,
    ApprovalStatus,
    Certificate,
    ComplaintItem,
    Course,
    CourseComment,
    Enrollment,
    Exam,
    ExamStatus,
    ModerationStatus,
    ProviderDocument,
    ProviderProfile,
    UserIdentityVerification,
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

router = APIRouter(prefix="/admin", tags=["admin"])


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


def _safe_send_email(to_email: str, subject: str, body: str) -> dict:
    try:
        return send_email(to_email, subject, body)
    except Exception as exc:
        return {"sent": False, "reason": str(exc)}


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
        "Classagon Provider Approval Update",
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
        "Classagon Profile Approval Update",
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
            "Classagon Provider Approval Update",
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
