from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import Settings


class BillingConfigurationError(RuntimeError):
    pass


class BillingProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class BillingPlan:
    code: str
    name: str
    monthly_amount_minor: int
    currency: str
    description: str

    def public_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "name": self.name,
            "monthly_amount_minor": self.monthly_amount_minor,
            "currency": self.currency,
            "description": self.description,
        }


def billing_plan_catalog(settings: Settings) -> dict[str, BillingPlan]:
    try:
        raw = json.loads(str(settings.billing_plan_catalog_json or "{}"))
    except json.JSONDecodeError as exc:
        raise BillingConfigurationError("Billing plan catalog is not valid JSON") from exc
    if not isinstance(raw, dict):
        raise BillingConfigurationError("Billing plan catalog must be a JSON object")

    plans: dict[str, BillingPlan] = {}
    for code, value in raw.items():
        if not isinstance(value, dict):
            continue
        normalized_code = str(code).strip().lower()
        currency = str(value.get("currency") or "INR").strip().upper()
        amount_minor = int(value.get("monthly_amount_minor") or 0)
        if not normalized_code or amount_minor < 100 or len(currency) not in {3, 4}:
            continue
        plans[normalized_code] = BillingPlan(
            code=normalized_code,
            name=str(value.get("name") or normalized_code.replace("_", " ").title()).strip()[:80],
            monthly_amount_minor=amount_minor,
            currency=currency,
            description=str(value.get("description") or "").strip()[:240],
        )
    if not plans:
        raise BillingConfigurationError("Billing plan catalog does not contain a valid paid plan")
    return plans


def cashfree_ready(settings: Settings) -> bool:
    return (
        str(settings.billing_provider or "").strip().lower() == "cashfree"
        and bool(str(settings.cashfree_app_id or "").strip())
        and bool(str(settings.cashfree_secret_key or "").strip())
    )


def cashfree_mode(settings: Settings) -> str:
    return "production" if str(settings.cashfree_environment or "").strip().lower() == "production" else "sandbox"


def _cashfree_base_url(settings: Settings) -> str:
    return "https://api.cashfree.com/pg" if cashfree_mode(settings) == "production" else "https://sandbox.cashfree.com/pg"


def _headers(settings: Settings, *, idempotency_key: str | None = None) -> dict[str, str]:
    if not cashfree_ready(settings):
        raise BillingConfigurationError("Cashfree billing is not configured")
    headers = {
        "Content-Type": "application/json",
        "x-api-version": str(settings.cashfree_api_version or "2025-01-01"),
        "x-client-id": str(settings.cashfree_app_id).strip(),
        "x-client-secret": str(settings.cashfree_secret_key).strip(),
    }
    if idempotency_key:
        headers["x-idempotency-key"] = idempotency_key
    return headers


def create_cashfree_order(
    settings: Settings,
    *,
    order_id: str,
    amount_minor: int,
    currency: str,
    customer_id: str,
    customer_name: str,
    customer_email: str,
    customer_phone: str,
    return_url: str,
    notify_url: str,
    note: str,
) -> dict[str, Any]:
    payload = {
        "order_id": order_id,
        "order_amount": round(amount_minor / 100, 2),
        "order_currency": currency,
        "customer_details": {
            "customer_id": customer_id,
            "customer_name": customer_name,
            "customer_email": customer_email,
            "customer_phone": customer_phone,
        },
        "order_meta": {"return_url": return_url, "notify_url": notify_url},
        "order_note": note,
        "order_tags": {"valases_order_id": order_id},
    }
    try:
        response = httpx.post(
            f"{_cashfree_base_url(settings)}/orders",
            headers=_headers(settings, idempotency_key=order_id),
            json=payload,
            timeout=20,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise BillingProviderError("The payment provider could not create this checkout") from exc
    if not result.get("payment_session_id") or str(result.get("order_id") or "") != order_id:
        raise BillingProviderError("The payment provider returned an incomplete checkout")
    return result


def fetch_cashfree_order(settings: Settings, order_id: str) -> dict[str, Any]:
    try:
        response = httpx.get(
            f"{_cashfree_base_url(settings)}/orders/{order_id}",
            headers=_headers(settings),
            timeout=20,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise BillingProviderError("The payment provider could not verify this order") from exc
    if str(result.get("order_id") or "") != order_id:
        raise BillingProviderError("The payment provider returned the wrong order")
    return result


def verify_cashfree_webhook_signature(settings: Settings, raw_body: bytes, timestamp: str, signature: str) -> bool:
    secret = str(settings.cashfree_secret_key or "").strip()
    if not secret or not timestamp or not signature:
        return False
    try:
        timestamp_ms = int(timestamp)
    except ValueError:
        return False
    if abs((time.time() * 1000) - timestamp_ms) > 300_000:
        return False
    signed_payload = timestamp.encode("utf-8") + raw_body
    expected = base64.b64encode(hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).digest()).decode("ascii")
    return hmac.compare_digest(expected, signature.strip())
