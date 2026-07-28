from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from app.core.config import Settings, get_settings


SUPPORTED_DESKTOP_APPS = {"excel", "quickbooks", "drake_tax"}


class DesktopSessionBrokerError(RuntimeError):
    pass


def _json_object(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def desktop_app_assignments(settings: Settings | None = None) -> dict[str, str]:
    active = settings or get_settings()
    return {
        str(assessment_type).strip().lower(): str(app_key).strip().lower()
        for assessment_type, app_key in _json_object(active.desktop_app_assignments_json).items()
        if str(app_key).strip().lower() in SUPPORTED_DESKTOP_APPS
    }


def desktop_app_catalog(settings: Settings | None = None) -> dict[str, dict[str, Any]]:
    active = settings or get_settings()
    raw = _json_object(active.desktop_app_catalog_json)
    return {
        str(key).strip().lower(): dict(value)
        for key, value in raw.items()
        if str(key).strip().lower() in SUPPORTED_DESKTOP_APPS and isinstance(value, dict)
    }


def desktop_license_attestations(settings: Settings | None = None) -> dict[str, dict[str, Any]]:
    active = settings or get_settings()
    raw = _json_object(active.desktop_license_attestations_json)
    normalized: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        app_key = str(key).strip().lower()
        if app_key not in SUPPORTED_DESKTOP_APPS:
            continue
        normalized[app_key] = dict(value) if isinstance(value, dict) else {"approved": bool(value)}
    return normalized


def desktop_app_spec(assessment_type: str, settings: Settings | None = None) -> dict[str, Any] | None:
    active = settings or get_settings()
    app_key = desktop_app_assignments(active).get(str(assessment_type or "").strip().lower())
    if not app_key:
        return None
    catalog = desktop_app_catalog(active)
    spec = catalog.get(app_key) or {}
    attestation = desktop_license_attestations(active).get(app_key) or {}
    configured = bool(
        active.enable_desktop_app_sessions
        and spec.get("enabled")
        and str(spec.get("provider_application_id") or "").strip()
        and attestation.get("approved") is True
    )
    return {
        "app_key": app_key,
        "display_name": str(spec.get("display_name") or app_key.replace("_", " ").title()),
        "provider_application_id": str(spec.get("provider_application_id") or ""),
        "configured": configured,
        "license_approved": attestation.get("approved") is True,
    }


def desktop_session_readiness(settings: Settings | None = None) -> dict[str, Any]:
    active = settings or get_settings()
    catalog = desktop_app_catalog(active)
    attestations = desktop_license_attestations(active)
    apps = []
    for assessment_type, app_key in desktop_app_assignments(active).items():
        spec = catalog.get(app_key) or {}
        attestation = attestations.get(app_key) or {}
        apps.append(
            {
                "assessment_type": assessment_type,
                "app_key": app_key,
                "display_name": str(spec.get("display_name") or app_key.replace("_", " ").title()),
                "application_configured": bool(spec.get("enabled") and spec.get("provider_application_id")),
                "license_approved": attestation.get("approved") is True,
                "license_reference": str(attestation.get("reference") or ""),
            },
        )
    mode = str(active.desktop_session_broker_mode or "disabled").strip().lower()
    broker_ready = mode in {"mock", "http"}
    if active.is_production:
        broker_ready = (
            mode == "http"
            and str(active.desktop_session_broker_url or "").startswith("https://")
            and len(str(active.desktop_session_broker_token or "").strip()) >= 32
            and str(active.desktop_session_gateway_origin or "").startswith("https://")
        )
    return {
        "enabled": bool(active.enable_desktop_app_sessions),
        "broker_mode": mode,
        "broker_ready": broker_ready,
        "gateway_origin_configured": bool(active.desktop_session_gateway_origin),
        "apps": apps,
        "ready": bool(
            active.enable_desktop_app_sessions
            and broker_ready
            and apps
            and all(item["application_configured"] and item["license_approved"] for item in apps)
        ),
    }


def candidate_reference(issue_id: int, candidate_email: str, settings: Settings | None = None) -> str:
    active = settings or get_settings()
    payload = f"{int(issue_id)}:{str(candidate_email or '').strip().lower()}".encode()
    digest = hmac.new(active.jwt_secret_key.encode(), payload, hashlib.sha256).hexdigest()
    return f"candidate-{digest[:32]}"


def _gateway_origin(url: str) -> str:
    parsed = urlsplit(str(url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def validate_launch_url(url: str, settings: Settings | None = None) -> str:
    active = settings or get_settings()
    launch_url = str(url or "").strip()
    expected_origin = _gateway_origin(active.desktop_session_gateway_origin)
    if not launch_url or not expected_origin or _gateway_origin(launch_url) != expected_origin:
        raise DesktopSessionBrokerError("The broker returned a launch URL outside the configured gateway origin")
    return launch_url


class DesktopSessionBroker:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.mode = str(self.settings.desktop_session_broker_mode or "disabled").strip().lower()

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if self.mode != "http":
            raise DesktopSessionBrokerError("The Windows session broker is not configured")
        base_url = str(self.settings.desktop_session_broker_url or "").strip().rstrip("/")
        if not base_url.startswith("https://") and self.settings.is_production:
            raise DesktopSessionBrokerError("The Windows session broker must use HTTPS")
        try:
            response = httpx.request(
                method,
                f"{base_url}{path}",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self.settings.desktop_session_broker_token}",
                    "Accept": "application/json",
                },
                timeout=max(3, min(60, int(self.settings.desktop_session_broker_timeout_seconds))),
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise DesktopSessionBrokerError(f"Windows session broker request failed: {type(exc).__name__}") from exc
        if not isinstance(result, dict):
            raise DesktopSessionBrokerError("The Windows session broker returned an invalid response")
        return result

    def start(
        self,
        *,
        session_id: str,
        issue_id: int,
        candidate_ref: str,
        app_key: str,
        provider_application_id: str,
        workspace_key: str,
        duration_seconds: int,
    ) -> dict[str, Any]:
        if self.mode == "mock" and not self.settings.is_production:
            gateway = str(self.settings.desktop_session_gateway_origin or "http://127.0.0.1:16080").rstrip("/")
            return {
                "provider_session_id": f"mock-{session_id}",
                "host_id": "local-desktop-tools",
                "status": "active",
                "launch_url": f"{gateway}/vnc.html?autoconnect=1&resize=remote&path=websockify",
            }
        result = self._request(
            "POST",
            "/v1/sessions",
            {
                "client_session_id": session_id,
                "assessment_issue_id": issue_id,
                "candidate_ref": candidate_ref,
                "app_key": app_key,
                "provider_application_id": provider_application_id,
                "workspace_key": workspace_key,
                "duration_seconds": duration_seconds,
                "isolation": "windows_user_session",
                "allowed_application_only": True,
            },
        )
        result["launch_url"] = validate_launch_url(str(result.get("launch_url") or ""), self.settings)
        return result

    def heartbeat(self, provider_session_id: str) -> dict[str, Any]:
        if self.mode == "mock" and not self.settings.is_production:
            return {"status": "active"}
        provider_id = quote(str(provider_session_id or ""), safe="")
        if not provider_id:
            raise DesktopSessionBrokerError("The Windows session has no broker identifier")
        return self._request("POST", f"/v1/sessions/{provider_id}/heartbeat", {})

    def launch(self, provider_session_id: str) -> dict[str, Any]:
        if self.mode == "mock" and not self.settings.is_production:
            gateway = str(self.settings.desktop_session_gateway_origin or "http://127.0.0.1:16080").rstrip("/")
            return {"status": "active", "launch_url": f"{gateway}/vnc.html?autoconnect=1&resize=remote&path=websockify"}
        provider_id = quote(str(provider_session_id or ""), safe="")
        if not provider_id:
            raise DesktopSessionBrokerError("The Windows session has no broker identifier")
        result = self._request("POST", f"/v1/sessions/{provider_id}/launch", {})
        result["launch_url"] = validate_launch_url(str(result.get("launch_url") or ""), self.settings)
        return result

    def finalize(self, provider_session_id: str, reason: str) -> dict[str, Any]:
        if self.mode == "mock" and not self.settings.is_production:
            return {"status": "completed", "artifacts": []}
        provider_id = quote(str(provider_session_id or ""), safe="")
        if not provider_id:
            raise DesktopSessionBrokerError("The Windows session has no broker identifier")
        return self._request(
            "POST",
            f"/v1/sessions/{provider_id}/finalize",
            {"reason": str(reason or "assessment_submitted")[:120]},
        )


def parse_broker_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
