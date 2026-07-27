from __future__ import annotations

import json
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import Session

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from app.core.security import hash_password
from app.db.session import engine
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


def main() -> int:
    if engine.dialect.name != "sqlite":
        print("Refusing to seed browser smoke data outside SQLite.", file=sys.stderr)
        return 2

    Base.metadata.create_all(engine)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    access_key = secrets.token_urlsafe(32)
    password = f"Smoke-{secrets.token_urlsafe(10)}"

    with Session(engine) as db:
        provider_user = User(
            email=f"browser-smoke-{run_id}@valases.test",
            full_name="Valases Browser Smoke",
            password_hash="disabled",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        db.add(provider_user)
        db.flush()
        provider = ProviderProfile(
            user_id=provider_user.id,
            provider_type=ProviderType.BUSINESS,
            display_name="Valases Browser Smoke",
        )
        db.add(provider)
        db.flush()
        course = Course(
            provider_id=provider.id,
            title="Browser smoke assessments",
            description="Disposable local browser verification data.",
            category="assessment",
        )
        db.add(course)
        db.flush()
        exam = Exam(
            course_id=course.id,
            title="Accounting Controls Review",
            assessment_type="mcq",
            instructions="Choose the strongest control for each scenario.",
            duration_minutes=20,
            questions_per_attempt=3,
            pass_score=70,
            status=ExamStatus.PUBLISHED,
        )
        db.add(exam)
        db.flush()

        prompts = (
            (
                "Which control best reduces the risk of unauthorized vendor payments?",
                "Independent approval of vendor master changes",
                "Monthly stationery inventory",
            ),
            (
                "What is the strongest evidence that a bank reconciliation was reviewed?",
                "Dated reviewer sign-off with resolved exceptions",
                "A spreadsheet saved in a shared folder",
            ),
            (
                "Which procedure best supports revenue cut-off at year end?",
                "Match dispatch records around year end to recorded invoices",
                "Compare annual revenue with the budget",
            ),
        )
        for prompt, correct_text, distractor_text in prompts:
            question = Question(
                exam_id=exam.id,
                question_text=prompt,
                question_type=QuestionType.MCQ_SINGLE,
                marks=10,
                competency_tag="accounting-controls",
            )
            db.add(question)
            db.flush()
            db.add_all(
                (
                    Option(question_id=question.id, option_text=correct_text, is_correct=True, position=1),
                    Option(question_id=question.id, option_text=distractor_text, is_correct=False, position=2),
                ),
            )

        issue = AssessmentIssue(
            exam_id=exam.id,
            issuer_user_id=provider_user.id,
            candidate_name="Browser Smoke Candidate",
            candidate_email=f"candidate-{run_id}@valases.test",
            candidate_password_hash=hash_password(password),
            access_key=access_key,
            access_expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
            status="issued",
        )
        db.add(issue)
        db.commit()

    print(
        json.dumps(
            {
                "issued_key": access_key,
                "password": password,
                "candidate_path": f"/candidate.html?issued_key={access_key}",
            },
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
