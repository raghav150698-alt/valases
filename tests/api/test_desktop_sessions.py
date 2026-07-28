import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from jose import jwt
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.desktop_sessions import start_issued_desktop_session
from app.api.routes.exams import ISSUED_TOKEN_ROLE, _session_token_digest
from app.core.config import Settings
from app.core.security import hash_password
from app.models.entities import (
    AssessmentIssue,
    AssessmentType,
    Base,
    Course,
    DesktopAppSession,
    Exam,
    ExamStatus,
    ProviderProfile,
    ProviderType,
    User,
    UserRole,
)
from app.services.desktop_session_broker import desktop_session_readiness


class DesktopSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.settings = Settings(
            _env_file=None,
            app_env="development",
            jwt_secret_key="desktop-session-test-secret-that-is-long-enough",
            enable_desktop_app_sessions=True,
            desktop_session_broker_mode="mock",
            desktop_session_gateway_origin="http://127.0.0.1:16080",
            desktop_app_assignments_json='{"accounting":"ledgebook"}',
            desktop_app_catalog_json=(
                '{"ledgebook":{"display_name":"LedgeBook",'
                '"provider_application_id":"ledgebook-remoteapp","enabled":true}}'
            ),
            desktop_license_attestations_json='{"ledgebook":{"approved":true,"reference":"test-license"}}',
        )
        issuer = User(
            email="provider@example.com",
            full_name="Provider",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(issuer)
        self.db.flush()
        provider = ProviderProfile(
            user_id=issuer.id,
            provider_type=ProviderType.BUSINESS,
            display_name="Example Company",
        )
        self.db.add(provider)
        self.db.flush()
        course = Course(provider_id=provider.id, title="Assessments", description="", category="assessment")
        self.db.add(course)
        self.db.flush()
        exam = Exam(
            course_id=course.id,
            title="LedgeBook assessment",
            assessment_type=AssessmentType.ACCOUNTING.value,
            duration_minutes=60,
            status=ExamStatus.PUBLISHED,
        )
        self.db.add(exam)
        self.db.flush()
        self.issuer = issuer
        self.exam = exam
        self.issue_one, self.token_one = self._issue("candidate-one@example.com", "Candidate One")
        self.issue_two, self.token_two = self._issue("candidate-two@example.com", "Candidate Two")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _issue(self, email: str, name: str) -> tuple[AssessmentIssue, str]:
        raw_session_token = f"session-token-{email}"
        issue = AssessmentIssue(
            exam_id=self.exam.id,
            issuer_user_id=self.issuer.id,
            candidate_name=name,
            candidate_email=email,
            candidate_password_hash=hash_password("temporary-password"),
            access_key=f"access-key-{email}-with-sufficient-entropy",
            access_expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            active_session_token=_session_token_digest(raw_session_token),
            active_session_started_at=datetime.now(timezone.utc),
            status="started",
        )
        self.db.add(issue)
        self.db.flush()
        token = jwt.encode(
            {
                "role": ISSUED_TOKEN_ROLE,
                "issue_id": issue.id,
                "session_token": raw_session_token,
                "exp": datetime.now(timezone.utc) + timedelta(hours=2),
            },
            self.settings.jwt_secret_key,
            algorithm=self.settings.jwt_algorithm,
        )
        return issue, token

    def test_concurrent_candidates_receive_isolated_sessions_and_reconnect_idempotently(self) -> None:
        with (
            patch("app.api.routes.desktop_sessions.get_settings", return_value=self.settings),
            patch("app.api.routes.exams.get_settings", return_value=self.settings),
        ):
            first = start_issued_desktop_session(f"Bearer {self.token_one}", self.db)
            first_reconnect = start_issued_desktop_session(f"Bearer {self.token_one}", self.db)
            second = start_issued_desktop_session(f"Bearer {self.token_two}", self.db)

        self.assertEqual(first["session_id"], first_reconnect["session_id"])
        self.assertNotEqual(first["session_id"], second["session_id"])
        self.assertEqual(first["app_key"], "ledgebook")
        sessions = list(self.db.scalars(select(DesktopAppSession).order_by(DesktopAppSession.issue_id)).all())
        self.assertEqual(len(sessions), 2)
        self.assertEqual({item.issue_id for item in sessions}, {self.issue_one.id, self.issue_two.id})
        self.assertEqual(len({item.workspace_key for item in sessions}), 2)
        self.assertEqual(sessions[0].candidate_email_snapshot, "candidate-one@example.com")
        self.assertEqual(sessions[1].candidate_email_snapshot, "candidate-two@example.com")

    def test_readiness_fails_closed_without_license_attestation(self) -> None:
        ready = desktop_session_readiness(self.settings)
        self.assertTrue(ready["ready"])
        unlicensed = self.settings.model_copy(update={"desktop_license_attestations_json": "{}"})
        blocked = desktop_session_readiness(unlicensed)
        self.assertFalse(blocked["ready"])
        self.assertFalse(blocked["apps"][0]["license_approved"])


if __name__ == "__main__":
    unittest.main()
