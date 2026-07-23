import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.hiring import (
    ApplicationCreate,
    CandidateCreate,
    IntegrationUpdate,
    InterviewCreate,
    JobCreate,
    ScorecardCreate,
    StageUpdate,
    create_application,
    create_candidate,
    create_interview,
    create_job,
    configure_integration,
    hiring_workspace,
    run_compliance_checks,
    screen_application,
    submit_scorecard,
    update_application_stage,
)
from app.models.entities import Base, User, UserRole


class HiringWorkspaceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.recruiter = User(
            email="recruiter@example.com",
            full_name="Recruiter",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        self.db.add(self.recruiter)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_recruiting_workflow_remains_organization_scoped_and_human_reviewed(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        job = create_job(
            JobCreate(
                job_code="FIN-101",
                title="Senior Accountant",
                skills=["GAAP", "Excel", "reconciliations"],
                requirements=["5 years of accounting experience"],
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        candidate = create_candidate(
            CandidateCreate(
                first_name="Avery",
                last_name="Ng",
                email="avery@example.com",
                skills=["GAAP", "Excel"],
                experience_years=6,
                resume_text="Experienced accountant working with GAAP, Excel and month-end reconciliations.",
                consent_obtained=True,
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        application = create_application(
            ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        screening = screen_application(application["id"], organization_id=organization_id, db=self.db, current_user=self.recruiter)
        self.assertTrue(screening["human_review_required"])
        self.assertNotEqual(screening["recommendation"], "reject")

        moved = update_application_stage(
            application["id"],
            StageUpdate(stage="interview", reason="Relevant finance experience"),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(moved["stage"], "interview")
        interview = create_interview(
            InterviewCreate(application_id=application["id"], interview_type="structured"),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        scorecard = submit_scorecard(
            interview["id"],
            ScorecardCreate(
                recommendation="yes",
                overall_score=4.0,
                competencies={"Technical accounting": 4.0},
                evidence="Explained reconciliation controls with concrete examples.",
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(scorecard["recommendation"], "yes")
        compliance = run_compliance_checks(application["id"], organization_id=organization_id, db=self.db, current_user=self.recruiter)
        statuses = {item["check_type"]: item["status"] for item in compliance["checks"]}
        self.assertEqual(statuses["candidate_consent"], "passed")
        self.assertEqual(statuses["structured_evidence"], "passed")
        integration = configure_integration(
            IntegrationUpdate(
                provider="greenhouse",
                status="ready_to_connect",
                external_account_name="Valases recruiting",
                sync_scope=["candidates", "jobs"],
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(integration["status"], "ready_to_connect")
        self.assertNotIn("token", integration["config"])


if __name__ == "__main__":
    unittest.main()
