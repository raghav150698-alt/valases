import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.api.routes.hiring import (
    ApplicationCreate,
    CandidateCreate,
    JobCloseVacanciesRequest,
    JobCreate,
    OfferCreate,
    OfferDecision,
    RejectionRequest,
    close_job_vacancies,
    create_application,
    create_candidate,
    create_job,
    create_offer,
    decide_public_offer,
    hiring_workspace,
    reject_application,
    release_offer,
)
from app.core.config import Settings
from app.models.entities import (
    Base,
    HiringApplication,
    HiringInterview,
    HiringOffer,
    HiringScorecard,
    JobRequisition,
    User,
    UserRole,
)


class HiringLifecycleOffersTest(unittest.TestCase):
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
            full_name="Asha Recruiter",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        self.db.add(self.recruiter)
        self.db.commit()
        self.organization_id = hiring_workspace(None, self.db, self.recruiter)["organization"]["id"]

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _job_and_candidate(self, code: str = "FIN-301"):
        job = create_job(
            JobCreate(job_code=code, title="Senior Accountant", headcount=1, skills=["GAAP"]),
            self.organization_id,
            self.db,
            self.recruiter,
        )
        candidate = create_candidate(
            CandidateCreate(first_name="Jordan", last_name="Lee", email=f"{code.lower()}@example.com", skills=["GAAP"], consent_obtained=True),
            self.organization_id,
            self.db,
            self.recruiter,
        )
        return job, candidate

    def test_candidate_can_apply_to_multiple_roles_but_not_duplicate_active_role(self) -> None:
        job, candidate = self._job_and_candidate()
        first = create_application(ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]), self.organization_id, self.db, self.recruiter)
        with self.assertRaises(HTTPException) as duplicate:
            create_application(ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]), self.organization_id, self.db, self.recruiter)
        self.assertEqual(duplicate.exception.status_code, 409)

        second_job = create_job(
            JobCreate(job_code="FIN-302", title="Financial Analyst"),
            self.organization_id,
            self.db,
            self.recruiter,
        )
        second = create_application(ApplicationCreate(job_id=second_job["id"], candidate_id=candidate["id"]), self.organization_id, self.db, self.recruiter)
        self.assertNotEqual(first["id"], second["id"])

        rejected = reject_application(
            first["id"],
            RejectionRequest(reason_code="skills_not_met", send_email=False),
            self.organization_id,
            self.db,
            self.recruiter,
        )
        self.assertEqual(rejected["stage"], "rejected")
        reactivated = create_application(ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]), self.organization_id, self.db, self.recruiter)
        self.assertEqual(reactivated["id"], first["id"])
        self.assertEqual(reactivated["status"], "active")

    def test_closing_fulfilled_vacancies_pauses_job_and_drafts_bulk_messages(self) -> None:
        job, first_candidate = self._job_and_candidate("OPS-401")
        second_candidate = create_candidate(
            CandidateCreate(first_name="Casey", email="casey@example.com"),
            self.organization_id,
            self.db,
            self.recruiter,
        )
        create_application(ApplicationCreate(job_id=job["id"], candidate_id=first_candidate["id"]), self.organization_id, self.db, self.recruiter)
        create_application(ApplicationCreate(job_id=job["id"], candidate_id=second_candidate["id"]), self.organization_id, self.db, self.recruiter)

        result = close_job_vacancies(
            job["id"],
            JobCloseVacanciesRequest(send_email=False),
            self.organization_id,
            self.db,
            self.recruiter,
        )

        self.assertEqual(result["applications_closed"], 2)
        self.assertEqual(result["drafts_created"], 2)
        self.assertEqual(self.db.get(JobRequisition, job["id"]).status, "paused")

    def test_offer_release_and_candidate_signature_retains_signed_copy(self) -> None:
        job, candidate = self._job_and_candidate("ACC-501")
        application_result = create_application(ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]), self.organization_id, self.db, self.recruiter)
        application = self.db.get(HiringApplication, application_result["id"])
        application.stage = "interview"
        interview = HiringInterview(organization_id=self.organization_id, application_id=application.id, status="ended")
        self.db.add(interview)
        self.db.flush()
        self.db.add(HiringScorecard(
            organization_id=self.organization_id,
            interview_id=interview.id,
            application_id=application.id,
            reviewer_user_id=self.recruiter.id,
            recommendation="yes",
            overall_score=4.2,
            evidence="Strong role-relevant accounting evidence.",
        ))
        self.db.commit()

        offer_data = create_offer(
            OfferCreate(
                application_id=application.id,
                base_compensation=900000,
                variable_compensation=100000,
                expires_at=datetime.now(timezone.utc) + timedelta(days=5),
            ),
            self.organization_id,
            self.db,
            self.recruiter,
        )
        settings = Settings(_env_file=None, candidate_app_base_url="https://candidate.example.com", auth_mode="dummy")
        with (
            patch("app.api.routes.hiring.get_settings", return_value=settings),
            patch("app.api.routes.hiring.send_email", return_value={"sent": True}),
            patch("app.api.routes.hiring.secrets.token_urlsafe", return_value="candidate-offer-token"),
        ):
            released = release_offer(offer_data["id"], self.organization_id, self.db, self.recruiter)
        self.assertEqual(released["status"], "released")

        request = Request({"type": "http", "method": "POST", "path": "/", "headers": [(b"user-agent", b"test")], "client": ("127.0.0.1", 1000)})
        with patch("app.api.routes.hiring.send_email", return_value={"sent": True}):
            accepted = decide_public_offer(
                "candidate-offer-token",
                OfferDecision(signature_name="Jordan Lee", accepted=True, consent=True),
                request,
                self.db,
            )
        self.assertEqual(accepted["status"], "accepted")
        offer = self.db.get(HiringOffer, offer_data["id"])
        self.assertIn("Accepted electronically by Jordan Lee", offer.signed_document_html)
        self.assertEqual(len(offer.released_document_hash), 64)
        self.assertEqual(len(offer.signed_document_hash), 64)
        self.assertIsNone(offer.access_token_hash)


if __name__ == "__main__":
    unittest.main()
