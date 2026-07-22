import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.routes.exams import _session_token_digest, _session_token_matches
from app.api.routes.tools import CodingPreviewFile, CodingPreviewSyncRequest, CodingRunRequest, coding_preview_file, coding_preview_sync, coding_run
from app.core.config import Settings
from app.models.entities import ApprovalStatus, Base, User, UserApproval, UserRole
from app.services.account_rules import sync_existing_accounts
from app.services.proctoring_ai import _file_matches_sha256
from app.services.supabase_auth import verify_supabase_token


def _production_settings(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "auth_mode": "supabase",
        "database_url": "postgresql://user:password@db.example.com:5432/valases",
        "jwt_secret_key": "a-unique-production-secret-that-is-long-enough",
        "supabase_url": "https://project.supabase.co",
        "supabase_publishable_key": "publishable-key",
        "candidate_app_base_url": "https://candidate.example.com",
        "cors_allow_origins": "https://recruiter.example.com",
        "trusted_hosts": "recruiter.example.com,.vercel.app",
        "object_storage_backend": "s3",
        "admin_emails": "admin@valases.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class SecurityConfigurationTest(unittest.TestCase):
    def test_secure_production_baseline_passes(self) -> None:
        self.assertEqual(_production_settings().production_security_errors(), [])

    def test_insecure_production_defaults_fail_closed(self) -> None:
        settings = Settings(_env_file=None, app_env="production")
        errors = " | ".join(settings.production_security_errors())
        self.assertIn("AUTH_MODE", errors)
        self.assertIn("JWT_SECRET_KEY", errors)
        self.assertIn("TRUSTED_HOSTS", errors)
        self.assertIn("PostgreSQL", errors)

    def test_production_rejects_database_mutation_during_startup(self) -> None:
        errors = " | ".join(
            _production_settings(enable_startup_database_management=True).production_security_errors()
        )
        self.assertIn("ENABLE_STARTUP_DATABASE_MANAGEMENT", errors)

    def test_production_startup_only_verifies_the_database(self) -> None:
        from app.main import on_startup

        with (
            patch("app.main.settings", _production_settings()),
            patch("app.main.init_db") as init_mock,
            patch("app.main.verify_database_schema") as verify_mock,
        ):
            on_startup()

        verify_mock.assert_called_once_with()
        init_mock.assert_not_called()


class ProvisioningAndApprovalTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    @patch("app.api.deps.verify_supabase_token")
    @patch("app.api.deps.get_settings")
    def test_unknown_supabase_identity_is_not_auto_provisioned(self, settings_mock, verify_mock) -> None:
        settings_mock.return_value = _production_settings()
        verify_mock.return_value = {
            "uid": "unknown-user",
            "email": "unknown@example.com",
            "name": "Unknown User",
            "role": "provider",
        }

        with self.assertRaises(HTTPException) as raised:
            get_current_user("token", self.db, None, None, None, None)

        self.assertEqual(raised.exception.status_code, 403)
        self.assertIsNone(self.db.scalar(select(User).where(User.email == "unknown@example.com")))

    @patch("app.services.account_rules.get_settings")
    def test_startup_sync_preserves_rejected_approval(self, settings_mock) -> None:
        settings_mock.return_value = _production_settings()
        user = User(
            email="rejected@example.com",
            full_name="Rejected User",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.db.add(UserApproval(user_id=user.id, status=ApprovalStatus.REJECTED, rejection_reason="Policy"))
        self.db.commit()

        sync_existing_accounts(self.db, sync_firebase_claims=False)

        approval = self.db.scalar(select(UserApproval).where(UserApproval.user_id == user.id))
        self.assertEqual(approval.status, ApprovalStatus.REJECTED)
        self.assertEqual(approval.rejection_reason, "Policy")


class TokenAndExecutionBoundaryTest(unittest.TestCase):
    def test_candidate_session_tokens_are_stored_as_digests(self) -> None:
        raw = "candidate-session-token"
        stored = _session_token_digest(raw)
        self.assertNotIn(raw, stored)
        self.assertTrue(_session_token_matches(stored, raw))
        self.assertFalse(_session_token_matches(stored, "different"))

    @patch("app.api.routes.tools.get_settings")
    def test_server_code_execution_is_disabled_in_production(self, settings_mock) -> None:
        settings_mock.return_value = _production_settings()
        user = User(id=1, email="provider@example.com", full_name="Provider", password_hash="x", role=UserRole.PROVIDER)
        with self.assertRaises(HTTPException) as raised:
            coding_run(CodingRunRequest(language="python", code="print('hello')"), current_user=user)
        self.assertEqual(raised.exception.status_code, 503)

    def test_preview_content_is_served_in_an_opaque_sandbox(self) -> None:
        user = User(id=1, email="provider@example.com", full_name="Provider", password_hash="x", role=UserRole.PROVIDER)
        with tempfile.TemporaryDirectory() as root, patch("app.api.routes.tools.PREVIEW_ROOT", Path(root)):
            created = coding_preview_sync(
                CodingPreviewSyncRequest(files=[CodingPreviewFile(path="index.html", content="<script>1</script>")]),
                current_user=user,
            )
            response = coding_preview_file(created["session_id"], "index.html")
        csp = response.headers.get("content-security-policy", "")
        self.assertIn("sandbox", csp)
        self.assertNotIn("allow-same-origin", csp)
        self.assertEqual(response.headers.get("cache-control"), "no-store, max-age=0")

    def test_serialized_model_integrity_check_rejects_modified_content(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            artifact = Path(root) / "model.joblib"
            artifact.write_bytes(b"reviewed model")
            self.assertTrue(
                _file_matches_sha256(
                    artifact,
                    "c7636f6a1da63b79d0948d23c713c03c2b1ca4697d8a4bf902096766366d2332",
                )
            )
            artifact.write_bytes(b"modified model")
            self.assertFalse(
                _file_matches_sha256(
                    artifact,
                    "c7636f6a1da63b79d0948d23c713c03c2b1ca4697d8a4bf902096766366d2332",
                )
            )


class SupabaseClaimsTest(unittest.TestCase):
    @patch("app.services.supabase_auth.httpx.get")
    def test_user_metadata_cannot_grant_an_application_role(self, get_mock) -> None:
        response = Mock(status_code=200)
        response.json.return_value = {
            "id": "user-1",
            "email": "user@example.com",
            "user_metadata": {"role": "provider", "full_name": "User"},
            "app_metadata": {},
        }
        get_mock.return_value = response

        payload = verify_supabase_token("token", _production_settings())

        self.assertEqual(payload["role"], "")


if __name__ == "__main__":
    unittest.main()
