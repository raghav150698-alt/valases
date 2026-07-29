from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class LaunchCheck:
    key: str
    status: str
    message: str
    critical: bool = True


def _storage_configured(settings: Settings) -> bool:
    backend = settings.resolved_object_storage_backend
    if backend == "supabase":
        return all(
            (
                settings.supabase_url,
                settings.supabase_secret_key,
                settings.supabase_storage_bucket,
            ),
        )
    if backend == "s3":
        return all(
            (
                settings.aws_region,
                settings.aws_s3_bucket_name,
                settings.aws_access_key_id,
                settings.aws_secret_access_key,
            ),
        )
    if backend == "bunny":
        return all(
            (
                settings.bunny_storage_zone,
                settings.bunny_storage_access_key,
                settings.bunny_storage_endpoint,
            ),
        )
    if backend == "firebase":
        return bool(settings.firebase_storage_bucket and settings.firebase_project_id)
    return False


def evaluate_launch_readiness(
    *,
    settings: Settings | None = None,
    check_database: bool = True,
) -> dict:
    active_settings = settings or get_settings()
    checks: list[LaunchCheck] = []

    if active_settings.is_production:
        checks.append(LaunchCheck("environment", "pass", "Production mode is enabled."))
    else:
        checks.append(LaunchCheck("environment", "fail", "APP_ENV must be production for a launch release."))

    security_errors = active_settings.production_security_errors()
    checks.append(
        LaunchCheck(
            "production_security",
            "fail" if security_errors else "pass",
            "; ".join(security_errors) if security_errors else "Production security configuration passes.",
        ),
    )

    checks.append(
        LaunchCheck(
            "supabase_admin_provisioning",
            "pass" if str(active_settings.supabase_secret_key or "").strip() else "fail",
            (
                "Supabase server-side company provisioning is configured."
                if str(active_settings.supabase_secret_key or "").strip()
                else "SUPABASE_SECRET_KEY is required for administrator-created client accounts."
            ),
        ),
    )

    billing_enabled = str(active_settings.billing_provider or "").strip().lower() == "cashfree"
    billing_ready = billing_enabled and all(
        (
            str(active_settings.cashfree_app_id or "").strip(),
            str(active_settings.cashfree_secret_key or "").strip(),
        ),
    )
    checks.append(
        LaunchCheck(
            "billing_payments",
            "pass" if billing_ready else "warning",
            (
                "Cashfree checkout and signed payment verification are configured."
                if billing_ready
                else "Billing code is ready, but online checkout remains disabled until Cashfree production credentials are added."
            ),
            critical=False,
        ),
    )

    smtp_ready = all(
        (
            active_settings.smtp_host,
            active_settings.smtp_username,
            active_settings.smtp_password,
            active_settings.smtp_sender,
        ),
    )
    checks.append(
        LaunchCheck(
            "candidate_email_delivery",
            "pass" if smtp_ready else "fail",
            (
                "Candidate email delivery is configured."
                if smtp_ready
                else "SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_SENDER are required."
            ),
        ),
    )

    storage_ready = _storage_configured(active_settings)
    storage_required = bool(active_settings.enable_proctor_evidence_upload)
    checks.append(
        LaunchCheck(
            "private_object_storage",
            "pass" if storage_ready else ("fail" if storage_required else "warning"),
            (
                f"Private {active_settings.resolved_object_storage_backend} storage is configured."
                if storage_ready
                else (
                    "Private object storage is required while proctor evidence upload is enabled."
                    if storage_required
                    else "Private object storage is not configured; resume and proctor evidence uploads must remain disabled."
                )
            ),
            critical=storage_required,
        ),
    )

    if check_database:
        try:
            from app.db.init_db import verify_database_schema

            verify_database_schema()
            checks.append(LaunchCheck("database_schema", "pass", "Database connection and required schema are ready."))
        except Exception as exc:
            message = str(exc).lower()
            if "missing required tables" in message or "schema is not initialized" in message:
                reason = "Database is reachable but the required production schema is incomplete."
            elif "authentication failed" in message:
                reason = "Database authentication failed."
            elif "resolve host" in message or "name or service not known" in message:
                reason = "Database host resolution failed."
            else:
                reason = f"Database readiness failed with {type(exc).__name__}."
            checks.append(LaunchCheck("database_schema", "fail", reason))
    else:
        checks.append(
            LaunchCheck(
                "database_schema",
                "warning",
                "Database verification was skipped.",
                critical=False,
            ),
        )

    oauth_raw = str(active_settings.integration_oauth_config_json or "").strip()
    oauth_valid = False
    if oauth_raw:
        try:
            oauth_config = json.loads(oauth_raw)
            oauth_valid = isinstance(oauth_config, dict) and bool(oauth_config)
        except json.JSONDecodeError:
            oauth_valid = False
    oauth_encryption_ready = bool(str(active_settings.integration_token_encryption_key or "").strip())
    if oauth_raw and (not oauth_valid or not oauth_encryption_ready):
        integration_check = LaunchCheck(
            "external_integrations",
            "fail",
            "Integration OAuth configuration is invalid or INTEGRATION_TOKEN_ENCRYPTION_KEY is missing.",
        )
    elif oauth_valid and oauth_encryption_ready:
        integration_check = LaunchCheck(
            "external_integrations",
            "pass",
            "OAuth connectors and encrypted token storage are configured.",
        )
    else:
        integration_check = LaunchCheck(
            "external_integrations",
            "warning",
            "ATS, calendar, Teams, and voice connectors remain disabled until OAuth applications are configured.",
            critical=False,
        )

    checks.extend(
        (
            LaunchCheck(
                "database_tenant_rls",
                "pass" if active_settings.database_tenant_rls_enabled else "warning",
                (
                    "Request-bound database tenant context is enabled."
                    if active_settings.database_tenant_rls_enabled
                    else "Database tenant RLS is not enabled; keep application-level organization filters and complete the least-privilege database role rollout before enterprise launch."
                ),
                critical=False,
            ),
            LaunchCheck(
                "distributed_rate_limits",
                "warning" if active_settings.is_vercel else "pass",
                (
                    "The current limiter is process-local. Add a managed distributed rate-limit store before high-volume or adversarial traffic."
                    if active_settings.is_vercel
                    else "The current single-process rate limiter is active."
                ),
                critical=False,
            ),
            LaunchCheck(
                "enterprise_sso",
                "warning",
                "Customer SSO, MFA enforcement, and SCIM require provider configuration before enterprise rollout.",
                critical=False,
            ),
            integration_check,
            _desktop_application_check(active_settings),
            LaunchCheck(
                "backup_restore",
                "warning",
                "Supabase PITR, backup retention, and a completed restore drill require operator verification.",
                critical=False,
            ),
        ),
    )

    failures = [check for check in checks if check.critical and check.status == "fail"]
    warnings = [check for check in checks if check.status == "warning"]
    return {
        "ready": not failures,
        "summary": {
            "passed": sum(check.status == "pass" for check in checks),
            "failed": len(failures),
            "warnings": len(warnings),
        },
        "checks": [asdict(check) for check in checks],
    }


def _desktop_application_check(settings: Settings) -> LaunchCheck:
    from app.services.desktop_session_broker import desktop_session_readiness

    readiness = desktop_session_readiness(settings)
    if not settings.enable_desktop_app_sessions:
        return LaunchCheck(
            "desktop_assessment_apps",
            "warning",
            "Windows application sessions are disabled until the licensed host and broker are connected.",
            critical=False,
        )
    if readiness["ready"]:
        return LaunchCheck(
            "desktop_assessment_apps",
            "pass",
            "The session broker, secure gateway, application mappings, and license attestations are ready.",
        )
    incomplete_apps = [
        item["display_name"]
        for item in readiness["apps"]
        if not item["ready"]
    ]
    detail = ", ".join(incomplete_apps) if incomplete_apps else "session broker or secure gateway"
    return LaunchCheck(
        "desktop_assessment_apps",
        "fail",
        f"Desktop assessment configuration is incomplete for: {detail}.",
    )
