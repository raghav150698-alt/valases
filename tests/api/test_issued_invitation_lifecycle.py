import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.api.routes.exams import (
    IssuedAssessmentRevokeRequest,
    IssuedCandidateLoginRequest,
    resend_issued_assessment_invitation,
    revoke_issued_assessment_invitation,
    issued_candidate_login_by_key,
)
from app.core.config import Settings
from app.core.security import hash_password
from app.models.entities import AssessmentIssue, Base, Course, Exam, ExamStatus, ProviderProfile, ProviderType, User, UserRole


class IssuedInvitationLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(
            email="provider@example.com",
            full_name="Provider",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(self.user)
        self.db.flush()
        provider = ProviderProfile(
            user_id=self.user.id,
            provider_type=ProviderType.BUSINESS,
            display_name="Example Company",
        )
        self.db.add(provider)
        self.db.flush()
        course = Course(provider_id=provider.id, title="Assessments", description="", category="assessment")
        self.db.add(course)
        self.db.flush()
        exam = Exam(course_id=course.id, title="Controls", status=ExamStatus.PUBLISHED)
        self.db.add(exam)
        self.db.flush()
        self.password = "temporary-candidate-password"
        self.issue = AssessmentIssue(
            exam_id=exam.id,
            issuer_user_id=self.user.id,
            candidate_name="Candidate",
            candidate_email="candidate@example.com",
            candidate_password_hash=hash_password(self.password),
            access_key="issued-access-key-with-sufficient-entropy",
            access_expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            status="issued",
        )
        self.db.add(self.issue)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_revoke_invalidates_access_and_resend_rotates_credentials(self) -> None:
        revoked = revoke_issued_assessment_invitation(
            self.issue.id,
            IssuedAssessmentRevokeRequest(reason="Candidate email was incorrect"),
            self.db,
            self.user,
        )
        self.assertEqual(revoked["status"], "revoked")
        with self.assertRaises(HTTPException) as revoked_login:
            issued_candidate_login_by_key(
                self.issue.access_key,
                IssuedCandidateLoginRequest(password=self.password),
                self.db,
            )
        self.assertEqual(revoked_login.exception.status_code, 410)

        request = Request(
            {
                "type": "http",
                "method": "POST",
                "scheme": "https",
                "path": f"/exams/issued/{self.issue.id}/resend",
                "headers": [(b"host", b"recruiter.example.com")],
                "query_string": b"",
                "server": ("recruiter.example.com", 443),
            },
        )
        settings = Settings(
            _env_file=None,
            candidate_app_base_url="https://candidate.example.com",
            auth_mode="dummy",
        )
        with (
            patch("app.api.routes.exams.get_settings", return_value=settings),
            patch(
                "app.api.routes.exams._safe_send_assessment_issue_email",
                return_value={"sent": True},
            ),
        ):
            resent = resend_issued_assessment_invitation(
                self.issue.id,
                request,
                self.db,
                self.user,
            )

        self.assertEqual(resent["status"], "issued")
        self.assertNotEqual(resent["temporary_password"], self.password)
        self.assertTrue(resent["email_delivery"]["sent"])
        login = issued_candidate_login_by_key(
            self.issue.access_key,
            IssuedCandidateLoginRequest(password=resent["temporary_password"]),
            self.db,
        )
        self.assertIn("token", login)


if __name__ == "__main__":
    unittest.main()
