import unittest
from unittest.mock import patch

from app.core.config import Settings
from app.services.launch_readiness import evaluate_launch_readiness


def _launch_settings(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "deployment_region": "mumbai",
        "auth_mode": "supabase",
        "database_url": "postgresql://user:password@db.example.com:6543/postgres",
        "jwt_secret_key": "a-unique-production-secret-that-is-long-enough",
        "supabase_url": "https://project.supabase.co",
        "supabase_publishable_key": "publishable-key",
        "supabase_secret_key": "server-secret",
        "candidate_app_base_url": "https://candidate.example.com",
        "cors_allow_origins": "https://candidate.example.com",
        "trusted_hosts": "recruiter.example.com,*.vercel.app",
        "object_storage_backend": "s3",
        "admin_emails": "admin@valases.com",
        "smtp_host": "smtp.example.com",
        "smtp_username": "mailer",
        "smtp_password": "app-password",
        "smtp_sender": "noreply@valases.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class LaunchReadinessTest(unittest.TestCase):
    @patch("app.db.init_db.verify_database_schema")
    def test_secure_release_passes_critical_gates(self, verify_schema) -> None:
        result = evaluate_launch_readiness(settings=_launch_settings())

        self.assertTrue(result["ready"])
        self.assertEqual(result["summary"]["failed"], 0)
        verify_schema.assert_called_once_with()

    def test_missing_email_and_admin_provisioning_fail_release(self) -> None:
        result = evaluate_launch_readiness(
            settings=_launch_settings(
                supabase_secret_key="",
                smtp_host="",
                smtp_username="",
                smtp_password="",
            ),
            check_database=False,
        )

        failed = {item["key"] for item in result["checks"] if item["status"] == "fail"}
        self.assertFalse(result["ready"])
        self.assertIn("supabase_admin_provisioning", failed)
        self.assertIn("candidate_email_delivery", failed)


if __name__ == "__main__":
    unittest.main()
