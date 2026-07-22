import unittest
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.admin import AdminCompanyCreate, _create_company_account
from app.models.entities import (
    AuditLog,
    Base,
    ProviderBillingAccount,
    ProviderProfile,
    User,
    UserApproval,
    UserRole,
)


class AdminCompanyCreationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(
            self.engine,
            tables=[
                User.__table__,
                ProviderProfile.__table__,
                UserApproval.__table__,
                ProviderBillingAccount.__table__,
                AuditLog.__table__,
            ],
        )
        self.db = Session(self.engine)
        self.admin = User(
            email="admin@valases.com",
            full_name="Valases Administrator",
            password_hash="test",
            role=UserRole.ADMIN,
            is_active=True,
            account_state="active",
        )
        self.db.add(self.admin)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_password_is_required_and_has_a_minimum_length(self) -> None:
        with self.assertRaises(ValidationError):
            AdminCompanyCreate(
                business_name="Example Company",
                email="owner@example.com",
                password="short",
            )

    @patch("app.api.routes.admin.ensure_supabase_user")
    def test_company_creation_provisions_login_and_workspace(self, ensure_user) -> None:
        ensure_user.return_value = {"configured": True, "created": True, "user_id": "auth-user-1"}

        result = _create_company_account(
            business_name="Example Company",
            email_address="Owner@Example.com",
            password="A-secure-password-2026",
            account_name=None,
            db=self.db,
            current_user=self.admin,
        )

        owner = self.db.scalar(select(User).where(User.email == "owner@example.com"))
        provider = self.db.scalar(select(ProviderProfile).where(ProviderProfile.user_id == owner.id)) if owner else None
        self.assertIsNotNone(owner)
        self.assertEqual(owner.role, UserRole.PROVIDER)
        self.assertIsNotNone(provider)
        self.assertEqual(provider.display_name, "Example Company")
        self.assertEqual(result["business_name"], "Example Company")
        self.assertNotIn("password", result)


if __name__ == "__main__":
    unittest.main()
