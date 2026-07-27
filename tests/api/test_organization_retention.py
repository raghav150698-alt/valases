import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models.entities import (
    AssessmentIssue,
    AssessmentSubmission,
    Base,
    HiringCandidate,
    Organization,
    OrganizationAuditEvent,
    User,
    UserRole,
)
from app.services.organization_retention import run_organization_retention


class OrganizationRetentionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.owner = User(
            email="owner@example.com",
            full_name="Owner",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        self.db.add(self.owner)
        self.db.flush()
        self.organization = Organization(
            name="Example",
            slug="example",
            created_by_user_id=self.owner.id,
            settings_json={"governance": {"candidate_retention_days": 365, "assessment_retention_days": 365}},
        )
        self.db.add(self.organization)
        self.db.flush()
        old = datetime.now(timezone.utc) - timedelta(days=500)
        self.candidate = HiringCandidate(
            organization_id=self.organization.id,
            first_name="Old",
            last_name="Candidate",
            email="old@example.com",
            resume_text="Sensitive resume",
            consent_status="granted",
            created_at=old,
        )
        self.issue = AssessmentIssue(
            exam_id=1,
            issuer_user_id=self.owner.id,
            candidate_name="Old Candidate",
            candidate_email="old@example.com",
            candidate_password_hash="hash",
            access_key="old-access",
            status="completed",
            issued_at=old,
        )
        self.db.add_all([self.candidate, self.issue])
        self.db.flush()
        self.submission = AssessmentSubmission(
            assessment_id=1,
            issue_id=self.issue.id,
            assessment_type="mcq",
            submitted_data_json={"answers": {"1": 2}},
            proctoring_events_json=[{"event": "visibility"}],
        )
        self.db.add(self.submission)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_preview_then_execute_anonymizes_expired_data(self) -> None:
        preview = run_organization_retention(
            self.db,
            organization=self.organization,
            owner_user_id=self.owner.id,
        )
        self.assertEqual(preview.hiring_candidates_eligible, 1)
        self.assertEqual(preview.assessment_issues_eligible, 1)
        self.assertEqual(self.candidate.email, "old@example.com")

        result = run_organization_retention(
            self.db,
            organization=self.organization,
            owner_user_id=self.owner.id,
            execute=True,
        )
        self.db.refresh(self.candidate)
        self.db.refresh(self.issue)
        self.db.refresh(self.submission)
        self.assertEqual(result.submissions_cleared, 1)
        self.assertTrue(self.candidate.email.endswith("@redacted.invalid"))
        self.assertEqual(self.candidate.resume_text, "")
        self.assertTrue(self.issue.candidate_email.endswith("@redacted.invalid"))
        self.assertEqual(self.submission.submitted_data_json, {})
        self.assertIsNotNone(
            self.db.scalar(
                select(OrganizationAuditEvent).where(
                    OrganizationAuditEvent.action == "retention_execution_completed",
                ),
            ),
        )

    def test_legal_hold_blocks_execution(self) -> None:
        self.organization.settings_json = {
            "governance": {
                "candidate_retention_days": 365,
                "assessment_retention_days": 365,
                "legal_hold_enabled": True,
            },
        }
        self.db.commit()
        result = run_organization_retention(
            self.db,
            organization=self.organization,
            owner_user_id=self.owner.id,
            execute=True,
        )
        self.assertTrue(result.blocked_by_legal_hold)
        self.assertEqual(self.candidate.email, "old@example.com")


if __name__ == "__main__":
    unittest.main()
