import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.admin import (
    AdminCompanyCreate,
    DataSubjectRequestAction,
    DataSubjectRequestCreate,
    DataSubjectRequestExecute,
    GovernanceSettingsUpdate,
    SsoOperationUpdate,
    _create_company_account,
    admin_workspace_sso_connections,
    admin_workspace_governance,
    admin_workspace_create_data_request,
    admin_workspace_execute_data_request,
    admin_workspace_update_data_request,
    admin_workspace_update_governance,
    admin_workspace_update_sso,
)
from app.models.entities import (
    AuditLog,
    Base,
    HiringCandidate,
    Organization,
    OrganizationAuditEvent,
    OrganizationMembership,
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
        Base.metadata.create_all(self.engine)
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
    def test_sso_provisioning_is_managed_by_platform_admin(self, ensure_user) -> None:
        ensure_user.return_value = {"configured": True, "created": True, "user_id": "auth-sso-owner"}
        company = _create_company_account(
            business_name="SAML Customer",
            email_address="owner@saml-customer.com",
            password="A-secure-password-2026",
            account_name=None,
            db=self.db,
            current_user=self.admin,
        )
        provider = self.db.get(ProviderProfile, company["provider_id"])
        organization = self.db.get(Organization, company["organization_id"])
        organization.settings_json = {
            **dict(organization.settings_json or {}),
            "sso": {
                "provider": "microsoft_entra",
                "domains": ["saml-customer.com"],
                "idp_metadata_url": "https://login.example.com/saml/metadata",
                "initial_admin_email": "owner@saml-customer.com",
                "connection_status": "ready_for_registration",
            },
        }
        self.db.commit()

        listed = admin_workspace_sso_connections(db=self.db, current_user=self.admin)
        record = next(item for item in listed["items"] if item["provider_id"] == provider.id)
        self.assertEqual(record["organization_name"], "SAML Customer")
        self.assertIn("service_provider", record)

        with self.assertRaises(HTTPException) as missing_connection:
            admin_workspace_update_sso(
                provider.id,
                SsoOperationUpdate(connection_status="registered"),
                db=self.db,
                current_user=self.admin,
            )
        self.assertEqual(missing_connection.exception.status_code, 422)

        updated = admin_workspace_update_sso(
            provider.id,
            SsoOperationUpdate(
                connection_status="registered",
                connection_id="sso-connection-123",
                operator_notes="Registered in the regional identity project.",
            ),
            db=self.db,
            current_user=self.admin,
        )
        self.assertEqual(updated["connection_status"], "registered")
        self.assertEqual(updated["connection_id"], "sso-connection-123")

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
        organization = self.db.get(Organization, result["organization_id"])
        membership = self.db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization.id,
                OrganizationMembership.user_id == owner.id,
            ),
        )
        self.assertIsNotNone(organization)
        self.assertEqual(membership.role, "owner")

        with self.assertRaises(HTTPException) as invalid_hold:
            admin_workspace_update_governance(
                provider.id,
                GovernanceSettingsUpdate(legal_hold_enabled=True, legal_hold_reason="short"),
                db=self.db,
                current_user=self.admin,
            )
        self.assertEqual(invalid_hold.exception.status_code, 422)
        governance = admin_workspace_update_governance(
            provider.id,
            GovernanceSettingsUpdate(
                candidate_retention_days=540,
                assessment_retention_days=270,
                proctor_retention_days=21,
                audit_retention_days=730,
                legal_hold_enabled=True,
                legal_hold_reason="Active employment dispute preservation requirement",
            ),
            db=self.db,
            current_user=self.admin,
        )
        self.assertTrue(governance["legal_hold_enabled"])
        self.assertEqual(governance["candidate_retention_days"], 540)
        preview = admin_workspace_governance(
            provider.id,
            db=self.db,
            current_user=self.admin,
        )
        self.assertTrue(preview["retention_preview"]["execution_blocked"])
        event = self.db.scalar(
            select(OrganizationAuditEvent).where(
                OrganizationAuditEvent.organization_id == organization.id,
                OrganizationAuditEvent.action == "governance_settings_updated",
            ),
        )
        self.assertIsNotNone(event)

    @patch("app.api.routes.admin.ensure_supabase_user")
    def test_data_subject_export_requires_verification_and_approval(self, ensure_user) -> None:
        ensure_user.return_value = {"configured": True, "created": True, "user_id": "auth-user-2"}
        company = _create_company_account(
            business_name="Privacy Test",
            email_address="privacy-owner@example.com",
            password="A-secure-password-2026",
            account_name=None,
            db=self.db,
            current_user=self.admin,
        )
        candidate = HiringCandidate(
            organization_id=company["organization_id"],
            first_name="Casey",
            last_name="Jones",
            email="casey@example.com",
            consent_status="granted",
        )
        self.db.add(candidate)
        self.db.commit()
        item = admin_workspace_create_data_request(
            DataSubjectRequestCreate(
                provider_id=company["provider_id"],
                request_type="export",
                candidate_email="casey@example.com",
                requestor_name="Casey Jones",
            ),
            db=self.db,
            current_user=self.admin,
        )
        with self.assertRaises(HTTPException) as premature:
            admin_workspace_update_data_request(
                item["id"],
                DataSubjectRequestAction(action="approve", reason="Approved before identity verification"),
                db=self.db,
                current_user=self.admin,
            )
        self.assertEqual(premature.exception.status_code, 409)
        admin_workspace_update_data_request(
            item["id"],
            DataSubjectRequestAction(action="verify_identity", reason="Identity verified through documented process"),
            db=self.db,
            current_user=self.admin,
        )
        approved = admin_workspace_update_data_request(
            item["id"],
            DataSubjectRequestAction(action="approve", reason="Approved for a scoped personal data export"),
            db=self.db,
            current_user=self.admin,
        )
        result = admin_workspace_execute_data_request(
            item["id"],
            DataSubjectRequestExecute(confirmation=approved["request_reference"]),
            db=self.db,
            current_user=self.admin,
        )
        self.assertEqual(result["request"]["status"], "completed")
        self.assertEqual(result["export"]["candidate_profile"][0]["email"], "casey@example.com")

        deletion = admin_workspace_create_data_request(
            DataSubjectRequestCreate(
                provider_id=company["provider_id"],
                request_type="delete",
                candidate_email="casey@example.com",
                requestor_name="Casey Jones",
            ),
            db=self.db,
            current_user=self.admin,
        )
        admin_workspace_update_data_request(
            deletion["id"],
            DataSubjectRequestAction(action="verify_identity", reason="Identity verified through documented process"),
            db=self.db,
            current_user=self.admin,
        )
        approved_deletion = admin_workspace_update_data_request(
            deletion["id"],
            DataSubjectRequestAction(action="approve", reason="Deletion approved after scope and obligations review"),
            db=self.db,
            current_user=self.admin,
        )
        organization = self.db.get(Organization, company["organization_id"])
        organization.settings_json = {"governance": {"legal_hold_enabled": True}}
        self.db.commit()
        with self.assertRaises(HTTPException) as held:
            admin_workspace_execute_data_request(
                deletion["id"],
                DataSubjectRequestExecute(confirmation=approved_deletion["request_reference"]),
                db=self.db,
                current_user=self.admin,
            )
        self.assertEqual(held.exception.status_code, 409)
        organization.settings_json = {"governance": {"legal_hold_enabled": False}}
        self.db.commit()
        deleted = admin_workspace_execute_data_request(
            deletion["id"],
            DataSubjectRequestExecute(confirmation=approved_deletion["request_reference"]),
            db=self.db,
            current_user=self.admin,
        )
        self.db.refresh(candidate)
        self.assertEqual(deleted["request"]["status"], "completed")
        self.assertTrue(candidate.email.endswith("@redacted.invalid"))


if __name__ == "__main__":
    unittest.main()
