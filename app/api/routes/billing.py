from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.hiring import _organization_context, _require_permission, _write_audit
from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import (
    BillingOrder,
    BillingWebhookEvent,
    OrganizationBillingAccount,
    User,
    UserRole,
)
from app.services.billing_gateway import (
    BillingConfigurationError,
    BillingProviderError,
    billing_plan_catalog,
    cashfree_mode,
    cashfree_ready,
    create_cashfree_order,
    fetch_cashfree_order,
    verify_cashfree_webhook_signature,
)

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan_code: str = Field(min_length=2, max_length=40)
    billing_phone: str = Field(pattern=r"^\+?[0-9]{8,15}$")


def _account(db: Session, organization_id: int, email: str | None = None) -> OrganizationBillingAccount:
    account = db.scalar(
        select(OrganizationBillingAccount).where(OrganizationBillingAccount.organization_id == organization_id),
    )
    if account:
        return account
    account = OrganizationBillingAccount(
        organization_id=organization_id,
        billing_email=email,
        status="trialing",
        plan_code="trial",
    )
    db.add(account)
    db.flush()
    return account


def _serialize_account(account: OrganizationBillingAccount) -> dict:
    return {
        "plan_code": account.plan_code,
        "status": account.status,
        "currency": account.currency,
        "monthly_amount_minor": account.monthly_amount_minor,
        "billing_email": account.billing_email,
        "billing_phone": account.billing_phone,
        "current_period_start": account.current_period_start,
        "current_period_end": account.current_period_end,
        "last_paid_at": account.last_paid_at,
    }


def _serialize_order(order: BillingOrder) -> dict:
    return {
        "id": order.id,
        "plan_code": order.plan_code,
        "description": order.description,
        "amount_minor": order.amount_minor,
        "currency": order.currency,
        "status": order.status,
        "receipt_number": order.receipt_number,
        "paid_at": order.paid_at,
        "expires_at": order.expires_at,
        "created_at": order.created_at,
    }


def _return_url(order_id: str) -> str:
    settings = get_settings()
    configured = str(settings.billing_return_url or "").strip()
    base = configured or f"{str(settings.app_base_url).rstrip('/')}/assessment/"
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}billing_return={order_id}"


def _activate_paid_order(
    db: Session,
    order: BillingOrder,
    *,
    provider_payment_id: str | None,
    provider_status: str,
) -> bool:
    if order.status == "paid":
        return False
    if provider_status.upper() != "PAID":
        order.status = provider_status.strip().lower()[:30] or "pending"
        return False

    now = datetime.now(timezone.utc)
    account = _account(db, order.organization_id)
    period_start = now
    if account.status == "active" and account.current_period_end and account.current_period_end > now:
        period_start = account.current_period_end
    account.provider = order.provider
    account.plan_code = order.plan_code
    account.status = "active"
    account.currency = order.currency
    account.monthly_amount_minor = order.amount_minor
    account.current_period_start = period_start
    account.current_period_end = period_start + timedelta(days=30)
    account.last_paid_at = now
    order.status = "paid"
    order.provider_payment_id = provider_payment_id or order.provider_payment_id
    order.receipt_number = order.receipt_number or f"VAL-{now:%Y%m}-{order.id[-10:].upper()}"
    order.paid_at = now
    _write_audit(
        db,
        order.organization_id,
        order.created_by_user_id,
        "billing_payment_verified",
        "billing_order",
        None,
        {"order_id": order.id, "plan_code": order.plan_code, "amount_minor": order.amount_minor, "currency": order.currency},
    )
    return True


def _validate_provider_order(order: BillingOrder, payload: dict) -> None:
    try:
        provider_amount_minor = int(
            (Decimal(str(payload.get("order_amount") or "0")) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP),
        )
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=409, detail="Payment amount or currency does not match the billing order")
    provider_currency = str(payload.get("order_currency") or "").upper()
    if provider_amount_minor != order.amount_minor or provider_currency != order.currency:
        raise HTTPException(status_code=409, detail="Payment amount or currency does not match the billing order")


@router.get("/organization")
def organization_billing(
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "billing.manage")
    settings = get_settings()
    try:
        plans = [plan.public_dict() for plan in billing_plan_catalog(settings).values()]
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    account = _account(db, organization.id, current_user.email)
    orders = list(
        db.scalars(
            select(BillingOrder)
            .where(BillingOrder.organization_id == organization.id)
            .order_by(BillingOrder.created_at.desc())
            .limit(12),
        ).all(),
    )
    db.commit()
    return {
        "provider": "cashfree",
        "provider_ready": cashfree_ready(settings),
        "checkout_mode": cashfree_mode(settings),
        "account": _serialize_account(account),
        "plans": plans,
        "orders": [_serialize_order(order) for order in orders],
    }


@router.post("/checkout")
def create_checkout(
    payload: CheckoutRequest,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "billing.manage")
    settings = get_settings()
    if not cashfree_ready(settings):
        raise HTTPException(status_code=503, detail="Online billing is awaiting payment-provider activation")
    try:
        plan = billing_plan_catalog(settings)[payload.plan_code.strip().lower()]
    except KeyError as exc:
        raise HTTPException(status_code=422, detail="Choose a valid billing plan") from exc
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    order_id = f"val_{organization.id}_{uuid4().hex}"
    order = BillingOrder(
        id=order_id,
        organization_id=organization.id,
        created_by_user_id=current_user.id,
        plan_code=plan.code,
        description=f"{plan.name} monthly plan",
        amount_minor=plan.monthly_amount_minor,
        currency=plan.currency,
        status="creating",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(order)
    account = _account(db, organization.id, current_user.email)
    account.billing_email = current_user.email
    account.billing_phone = payload.billing_phone
    db.commit()

    try:
        provider_order = create_cashfree_order(
            settings,
            order_id=order.id,
            amount_minor=order.amount_minor,
            currency=order.currency,
            customer_id=f"org_{organization.id}",
            customer_name=organization.name,
            customer_email=current_user.email,
            customer_phone=payload.billing_phone,
            return_url=_return_url(order.id),
            notify_url=f"{str(settings.app_base_url).rstrip('/')}/billing/webhooks/cashfree",
            note=order.description,
        )
    except (BillingConfigurationError, BillingProviderError) as exc:
        order.status = "failed"
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    order.provider_order_id = str(provider_order.get("order_id") or order.id)
    order.payment_session_id = str(provider_order["payment_session_id"])
    order.status = "created"
    order.provider_payload_json = {
        "cf_order_id": str(provider_order.get("cf_order_id") or ""),
        "order_status": str(provider_order.get("order_status") or "ACTIVE"),
    }
    _write_audit(
        db,
        organization.id,
        current_user.id,
        "billing_checkout_created",
        "billing_order",
        None,
        {"order_id": order.id, "plan_code": order.plan_code, "amount_minor": order.amount_minor, "currency": order.currency},
    )
    db.commit()
    return {
        "order": _serialize_order(order),
        "payment_session_id": order.payment_session_id,
        "checkout_mode": cashfree_mode(settings),
    }


@router.post("/orders/{order_id}/verify")
def verify_order(
    order_id: str,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "billing.manage")
    order = db.scalar(
        select(BillingOrder).where(BillingOrder.id == order_id, BillingOrder.organization_id == organization.id),
    )
    if not order:
        raise HTTPException(status_code=404, detail="Billing order not found")
    if order.status == "paid":
        return {"order": _serialize_order(order), "account": _serialize_account(_account(db, organization.id))}
    try:
        provider_order = fetch_cashfree_order(get_settings(), order.id)
    except (BillingConfigurationError, BillingProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    _validate_provider_order(order, provider_order)
    _activate_paid_order(db, order, provider_payment_id=None, provider_status=str(provider_order.get("order_status") or "ACTIVE"))
    db.commit()
    return {"order": _serialize_order(order), "account": _serialize_account(_account(db, organization.id))}


@router.get("/orders/{order_id}/receipt")
def billing_receipt(
    order_id: str,
    organization_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "billing.manage")
    order = db.scalar(
        select(BillingOrder).where(BillingOrder.id == order_id, BillingOrder.organization_id == organization.id),
    )
    if not order:
        raise HTTPException(status_code=404, detail="Billing order not found")
    if order.status != "paid":
        raise HTTPException(status_code=409, detail="A receipt is available only after payment is verified")
    return {
        "receipt_number": order.receipt_number,
        "issued_at": order.paid_at,
        "customer": {"organization_name": organization.name, "billing_email": _account(db, organization.id).billing_email},
        "line_items": [
            {
                "description": order.description,
                "quantity": 1,
                "amount_minor": order.amount_minor,
                "currency": order.currency,
            },
        ],
        "total_minor": order.amount_minor,
        "currency": order.currency,
        "payment_provider": order.provider,
        "provider_payment_reference": order.provider_payment_id,
    }


@router.post("/webhooks/cashfree")
async def cashfree_webhook(
    request: Request,
    x_webhook_signature: str = Header(default=""),
    x_webhook_timestamp: str = Header(default=""),
    x_idempotency_key: str = Header(default=""),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    raw_body = await request.body()
    if not verify_cashfree_webhook_signature(settings, raw_body, x_webhook_timestamp, x_webhook_signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from exc

    payload_hash = hashlib.sha256(raw_body).hexdigest()
    event_key = (x_idempotency_key or f"{x_webhook_timestamp}:{payload_hash}")[:180]
    existing = db.scalar(select(BillingWebhookEvent).where(BillingWebhookEvent.event_key == event_key))
    if existing:
        return {"status": "accepted"}

    event_type = str(payload.get("type") or payload.get("event") or "unknown")[:100]
    event = BillingWebhookEvent(
        provider="cashfree",
        event_key=event_key,
        event_type=event_type,
        payload_sha256=payload_hash,
    )
    db.add(event)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"status": "accepted"}

    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    order_payload = data.get("order") if isinstance(data.get("order"), dict) else {}
    payment_payload = data.get("payment") if isinstance(data.get("payment"), dict) else {}
    order_id = str(order_payload.get("order_id") or payload.get("order_id") or "")
    order = db.get(BillingOrder, order_id) if order_id else None
    if not order:
        event.processing_status = "ignored"
        event.error_code = "unknown_order"
        event.processed_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "accepted"}

    try:
        _validate_provider_order(order, order_payload)
        payment_status = str(payment_payload.get("payment_status") or order_payload.get("order_status") or "")
        normalized_status = "PAID" if payment_status.upper() in {"SUCCESS", "PAID"} else payment_status
        _activate_paid_order(
            db,
            order,
            provider_payment_id=str(payment_payload.get("cf_payment_id") or "") or None,
            provider_status=normalized_status,
        )
        event.processing_status = "processed"
        event.processed_at = datetime.now(timezone.utc)
        db.commit()
    except HTTPException:
        event.processing_status = "rejected"
        event.error_code = "order_mismatch"
        event.processed_at = datetime.now(timezone.utc)
        db.commit()
        raise
    return {"status": "accepted"}
