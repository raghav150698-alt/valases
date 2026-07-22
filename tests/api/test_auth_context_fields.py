import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.auth import me_context
from app.core.config import Settings
from app.models.entities import ApprovalStatus, Base, User, UserApproval, UserRole


class AuthContextFieldsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        user = User(
            email="ctx.user.001@example.com",
            phone_number="+919876543210",
            full_name="Context User",
            password_hash="firebase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.db.add(UserApproval(user_id=user.id, status=ApprovalStatus.APPROVED))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    @patch("app.api.routes.auth._safe_sync_claims")
    @patch("app.api.routes.auth.verify_supabase_token")
    @patch("app.api.routes.auth.get_settings")
    def test_me_context_returns_provisioned_account_fields(self, settings_mock, verify_mock, _sync_mock) -> None:
        settings_mock.return_value = Settings(
            _env_file=None,
            auth_mode="supabase",
            supabase_url="https://project.supabase.co",
            supabase_publishable_key="publishable-key",
            allow_self_service_signup=False,
        )
        verify_mock.return_value = {
            "uid": "ctx-user-001",
            "email": "ctx.user.001@example.com",
            "phone_number": "+919876543210",
            "name": "Context User",
            "role": "provider",
        }

        payload = me_context(token="token", db=self.db)

        self.assertEqual(payload["full_name"], "Context User")
        self.assertEqual(payload["phone_number"], "+919876543210")
        self.assertEqual(payload["approval_status"], ApprovalStatus.APPROVED)


if __name__ == "__main__":
    unittest.main()
