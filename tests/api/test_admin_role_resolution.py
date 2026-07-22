import unittest

from app.models.entities import UserRole
from app.services.account_rules import is_configured_admin_email, resolve_identity_role


class AdminRoleResolutionTest(unittest.TestCase):
    def test_configured_admin_email_overrides_provider_claim(self) -> None:
        role = resolve_identity_role(
            email=" Admin@Valases.com ",
            role_claim="provider",
            admin_emails={"admin@valases.com"},
        )

        self.assertEqual(role, UserRole.ADMIN)

    def test_unlisted_email_cannot_claim_admin_role(self) -> None:
        role = resolve_identity_role(
            email="recruiter@example.com",
            role_claim="admin",
            admin_emails={"admin@valases.com"},
            default_role=UserRole.PROVIDER,
        )

        self.assertEqual(role, UserRole.PROVIDER)

    def test_admin_email_matching_is_normalized(self) -> None:
        self.assertTrue(
            is_configured_admin_email(
                " ADMIN@VALASES.COM ",
                {"admin@valases.com"},
            ),
        )


if __name__ == "__main__":
    unittest.main()
