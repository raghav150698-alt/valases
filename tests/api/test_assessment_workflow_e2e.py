import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.exams import (
    IssuedCandidateLoginRequest,
    IssuedCandidateSubmitRequest,
    issued_candidate_get_assessment,
    issued_candidate_login_by_key,
    issued_candidate_submit,
)
from app.core.security import hash_password
from app.models.entities import (
    AssessmentIssue,
    Base,
    Course,
    Exam,
    ExamStatus,
    Option,
    ProviderProfile,
    ProviderType,
    Question,
    QuestionType,
    User,
    UserRole,
)


class AssessmentWorkflowE2ETest(unittest.TestCase):
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

    def test_current_issued_assessment_flow_hides_candidate_score(self) -> None:
        provider_user = User(
            email="provider@example.com",
            full_name="Provider",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(provider_user)
        self.db.flush()
        provider = ProviderProfile(
            user_id=provider_user.id,
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
            title="Accounting controls",
            assessment_type="mcq",
            duration_minutes=30,
            questions_per_attempt=1,
            pass_score=70,
            status=ExamStatus.PUBLISHED,
        )
        self.db.add(exam)
        self.db.flush()
        question = Question(
            exam_id=exam.id,
            question_text="Which control is strongest?",
            question_type=QuestionType.MCQ_SINGLE,
            marks=10,
        )
        self.db.add(question)
        self.db.flush()
        correct = Option(question_id=question.id, option_text="Independent reconciliation", is_correct=True, position=1)
        self.db.add(correct)
        self.db.flush()

        password = "temporary-candidate-password"
        issue = AssessmentIssue(
            exam_id=exam.id,
            issuer_user_id=provider_user.id,
            candidate_name="Candidate",
            candidate_email="candidate@example.com",
            candidate_password_hash=hash_password(password),
            access_key="issued-access-key-with-sufficient-entropy",
            access_expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            status="issued",
        )
        self.db.add(issue)
        self.db.commit()

        login = issued_candidate_login_by_key(
            issue.access_key,
            IssuedCandidateLoginRequest(password=password),
            self.db,
        )
        authorization = f"Bearer {login['token']}"
        paper = issued_candidate_get_assessment(authorization, self.db)
        self.assertNotIn("is_correct", paper["questions"][0]["options"][0])

        submitted = issued_candidate_submit(
            IssuedCandidateSubmitRequest(answers={str(question.id): [correct.id]}, time_taken_seconds=60),
            authorization,
            self.db,
        )
        self.assertEqual(submitted["status"], "submitted")
        self.assertNotIn("score", submitted)
        self.assertNotIn("passed", submitted)


if __name__ == "__main__":
    unittest.main()
