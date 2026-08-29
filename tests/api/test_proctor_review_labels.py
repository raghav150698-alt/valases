import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes.exams import (
    AssessmentProctorReviewLabelRequest,
    review_issued_assessment_attempt,
    save_issued_proctor_review_label,
)
from app.models.entities import (
    AssessmentIssue,
    AssessmentProctorReviewLabel,
    AssessmentSubmission,
    Base,
    Course,
    Exam,
    ExamStatus,
    ProviderProfile,
    ProviderType,
    User,
    UserRole,
)
from ml.proctoring.scripts import manage_proctor_review_labels


class ProctorReviewLabelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.provider_user = User(email="reviewer@example.com", full_name="Reviewer", password_hash="x", role=UserRole.PROVIDER, is_active=True)
        self.db.add(self.provider_user)
        self.db.flush()
        provider = ProviderProfile(user_id=self.provider_user.id, provider_type=ProviderType.BUSINESS, display_name="Example")
        self.db.add(provider)
        self.db.flush()
        course = Course(provider_id=provider.id, title="Assessments", description="", category="assessment")
        self.db.add(course)
        self.db.flush()
        exam = Exam(course_id=course.id, title="Pilot", status=ExamStatus.PUBLISHED)
        self.db.add(exam)
        self.db.flush()
        self.issue = AssessmentIssue(
            exam_id=exam.id,
            issuer_user_id=self.provider_user.id,
            candidate_name="Candidate",
            candidate_email="candidate@example.com",
            candidate_password_hash="x",
            access_key="review-label-test-key",
            status="review_pending",
        )
        self.db.add(self.issue)
        self.db.flush()
        self.submission = AssessmentSubmission(
            assessment_id=exam.id,
            issue_id=self.issue.id,
            assessment_type="mcq",
            submitted_data_json={},
            status="review_pending",
            proctoring_events_json=[
                {
                    "event_type": "mobile_phone_detected",
                    "severity": "warning",
                    "details": {"policy_disposition": "review", "policy_confidence": 0.76},
                    "recorded_at": "2026-08-29T10:00:00+00:00",
                }
            ],
        )
        self.db.add(self.submission)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_recruiter_can_label_detected_and_missed_events(self) -> None:
        review = review_issued_assessment_attempt(self.issue.id, self.db, self.provider_user)
        event_key = review["submission"]["proctoring_events"][0]["review_key"]
        saved = save_issued_proctor_review_label(
            self.issue.id,
            AssessmentProctorReviewLabelRequest(
                event_key=event_key,
                event_type="mobile_phone_detected",
                reviewer_label="false_positive",
            ),
            self.db,
            self.provider_user,
        )
        self.assertEqual(saved["reviewer_label"], "false_positive")

        # Saving a new verdict for the same event updates rather than duplicates it.
        updated = save_issued_proctor_review_label(
            self.issue.id,
            AssessmentProctorReviewLabelRequest(
                event_key=event_key,
                event_type="untrusted_client_value",
                reviewer_label="confirmed",
            ),
            self.db,
            self.provider_user,
        )
        self.assertEqual(saved["id"], updated["id"])
        self.assertEqual(self.db.query(AssessmentProctorReviewLabel).count(), 1)

        missed = save_issued_proctor_review_label(
            self.issue.id,
            AssessmentProctorReviewLabelRequest(
                event_type="multiple_faces_sustained",
                reviewer_label="missed_detection",
                reviewer_notes="A second person was visible in the retained clip.",
            ),
            self.db,
            self.provider_user,
        )
        self.assertTrue(missed["event_key"].startswith("missed:"))

        refreshed = review_issued_assessment_attempt(self.issue.id, self.db, self.provider_user)
        self.assertEqual(refreshed["proctor_review_label_summary"]["confirmed"], 1)
        self.assertEqual(refreshed["proctor_review_label_summary"]["missed_detection"], 1)
        self.assertNotIn("proctor_review_labels", refreshed["submission"])

    def test_export_and_purge_removes_raw_labels_and_keeps_receipt(self) -> None:
        review = review_issued_assessment_attempt(self.issue.id, self.db, self.provider_user)
        event_key = review["submission"]["proctoring_events"][0]["review_key"]
        save_issued_proctor_review_label(
            self.issue.id,
            AssessmentProctorReviewLabelRequest(
                event_key=event_key,
                event_type="mobile_phone_detected",
                reviewer_label="false_positive",
            ),
            self.db,
            self.provider_user,
        )
        isolated_sessions = sessionmaker(bind=self.engine)
        with TemporaryDirectory() as temporary_dir, patch.object(manage_proctor_review_labels, "SessionLocal", isolated_sessions):
            output_dir = Path(temporary_dir) / "batch"
            manage_proctor_review_labels.export_labels(output_dir)
            exported = (output_dir / "review_labels.jsonl").read_text(encoding="utf-8")
            self.assertIn('"reviewer_label": "false_positive"', exported)
            self.assertNotIn("candidate@example.com", exported)
            manage_proctor_review_labels.purge_labels(
                output_dir / "manifest.json",
                manage_proctor_review_labels.CONFIRMATION,
            )
            self.db.expire_all()
            self.assertEqual(self.db.query(AssessmentProctorReviewLabel).count(), 0)
            self.assertFalse((output_dir / "review_labels.jsonl").exists())
            self.assertTrue((output_dir / "purge_receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
