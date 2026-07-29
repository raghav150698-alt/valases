import unittest

from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.hiring import (
    ApplicationCreate,
    AtsApplicationBatch,
    AtsApplicationImport,
    CandidateCreate,
    CurrentUserProfileUpdate,
    IntegrationUpdate,
    MembershipCreate,
    OrganizationProfileUpdate,
    SsoConfigurationUpdate,
    InterviewCreate,
    JobCreate,
    ScorecardCreate,
    StageUpdate,
    create_application,
    create_candidate,
    create_interview,
    create_job,
    configure_integration,
    add_member,
    get_application_detail,
    hiring_workspace,
    list_candidates,
    list_applications,
    list_integrations,
    get_sso_configuration,
    import_ats_applications,
    run_compliance_checks,
    screen_application,
    submit_scorecard,
    update_application_stage,
    update_current_user_profile,
    update_organization_profile,
    update_sso_configuration,
)
from app.api.routes.exams import (
    AssessmentReviewFinalizeRequest,
    IssueAssessmentRequest,
    finalize_issued_assessment_review,
    issue_assessment_to_candidate,
)
from app.models.entities import (
    ApprovalStatus,
    AssessmentIssue,
    AssessmentSubmission,
    Base,
    Course,
    Exam,
    ExamStatus,
    HiringApplication,
    HiringIntegration,
    Organization,
    OrganizationMembership,
    ProviderProfile,
    ProviderType,
    User,
    UserRole,
)


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

    def test_owner_can_update_company_profile_and_logo(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        self.assertEqual(workspace["organization"]["logo_url"], "/assets/brand/valases-logo.png")
        self.assertNotIn("sso.manage", workspace["permissions"])
        self.assertNotIn("sso.manage", workspace["permission_catalog"])

        logo = "data:image/png;base64,iVBORw0KGgo="
        updated = update_organization_profile(
            OrganizationProfileUpdate(name="Example Hiring Company", logo_data_url=logo),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )

        self.assertEqual(updated["name"], "Example Hiring Company")
        self.assertEqual(updated["logo_url"], logo)
        refreshed = hiring_workspace(organization_id=organization_id, db=self.db, current_user=self.recruiter)
        self.assertEqual(refreshed["organization"]["name"], "Example Hiring Company")
        self.assertEqual(refreshed["organization"]["logo_url"], logo)

        with self.assertRaises(HTTPException) as invalid_logo:
            update_organization_profile(
                OrganizationProfileUpdate(name="Example Hiring Company", logo_data_url="data:image/png;base64,SGVsbG8="),
                organization_id=organization_id,
                db=self.db,
                current_user=self.recruiter,
            )
        self.assertEqual(invalid_logo.exception.status_code, 422)

    def test_connected_ats_import_is_idempotent_and_preserves_recruiter_stage(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        integration = HiringIntegration(
            organization_id=organization_id,
            provider="greenhouse",
            status="connected",
            config_json={"external_account_name": "Example Greenhouse"},
        )
        self.db.add(integration)
        self.db.commit()
        batch = AtsApplicationBatch(
            applications=[
                AtsApplicationImport(
                    external_application_id="gh-app-1001",
                    external_candidate_id="gh-candidate-501",
                    external_job_id="gh-job-71",
                    job_code="FIN-ATS-1",
                    job_title="Senior Accountant",
                    candidate_email="ats.candidate@example.com",
                    candidate_first_name="Asha",
                    candidate_last_name="Rao",
                    candidate_skills=["US GAAP", "Excel"],
                ),
            ],
        )

        first = import_ats_applications(
            "greenhouse",
            batch,
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(first["applications_created"], 1)
        application = self.db.scalar(
            select(HiringApplication).where(HiringApplication.external_application_id == "gh-app-1001"),
        )
        self.assertEqual(application.stage, "applied")
        self.assertIsNotNone(application.ai_match_score)
        imported_rows = list_applications(
            organization_id=organization_id,
            job_id=None,
            stage=None,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(len(imported_rows), 1)
        self.assertIn("top_choice_score", imported_rows[0]["ranking"])
        self.assertIn("resume_match_score", imported_rows[0]["ranking"])
        application.stage = "screening"
        self.db.commit()

        second = import_ats_applications(
            "greenhouse",
            batch,
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(second["applications_created"], 0)
        self.assertEqual(second["applications_updated"], 1)
        self.db.refresh(application)
        self.assertEqual(application.stage, "screening")

    def test_member_can_update_and_remove_their_profile_photo(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        self.assertEqual(workspace["current_user"]["avatar_url"], "")

        avatar = "data:image/png;base64,iVBORw0KGgo="
        updated = update_current_user_profile(
            CurrentUserProfileUpdate(full_name="Riya Sharma", avatar_data_url=avatar),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(updated["full_name"], "Riya Sharma")
        self.assertEqual(updated["avatar_url"], avatar)

        refreshed = hiring_workspace(organization_id=organization_id, db=self.db, current_user=self.recruiter)
        self.assertEqual(refreshed["current_user"]["full_name"], "Riya Sharma")
        self.assertEqual(refreshed["current_user"]["avatar_url"], avatar)

        removed = update_current_user_profile(
            CurrentUserProfileUpdate(full_name="Riya Sharma", remove_avatar=True),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(removed["avatar_url"], "")

    def test_recruiting_workflow_remains_organization_scoped_and_human_reviewed(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        self.assertEqual(self.db.info.get("organization_id"), organization_id)
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
        self.assertEqual(job["status"], "open")
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
        self.assertEqual(application["stage"], "screening")
        screening = screen_application(application["id"], organization_id=organization_id, db=self.db, current_user=self.recruiter)
        self.assertTrue(screening["human_review_required"])
        self.assertNotEqual(screening["recommendation"], "reject")
        with self.assertRaises(HTTPException) as missing_scorecard:
            update_application_stage(
                application["id"],
                StageUpdate(stage="offer", reason="Advance based on the available role evidence"),
                organization_id=organization_id,
                db=self.db,
                current_user=self.recruiter,
            )
        self.assertEqual(missing_scorecard.exception.status_code, 409)
        with self.assertRaises(HTTPException) as missing_rationale:
            update_application_stage(
                application["id"],
                StageUpdate(stage="rejected", reason="No"),
                organization_id=organization_id,
                db=self.db,
                current_user=self.recruiter,
            )
        self.assertEqual(missing_rationale.exception.status_code, 422)

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
        detail = get_application_detail(
            application["id"],
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(detail["evidence_summary"]["status"], "ready_for_human_decision")
        self.assertTrue(detail["evidence_summary"]["human_review_required"])
        self.assertEqual(detail["evidence_summary"]["scorecard_count"], 1)
        self.assertEqual(len(detail["scorecards"]), 1)
        offered = update_application_stage(
            application["id"],
            StageUpdate(stage="offer", reason="Structured interview and compliance evidence support an offer"),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(offered["stage"], "offer")
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
        catalog = list_integrations(organization_id=organization_id, db=self.db, current_user=self.recruiter)
        providers = {item["provider"] for item in catalog}
        self.assertTrue({"greenhouse", "google_calendar", "outlook_calendar", "microsoft_teams", "twilio_voice"}.issubset(providers))
        with self.assertRaises(HTTPException) as unverified_connection:
            configure_integration(
                IntegrationUpdate(
                    provider="google_calendar",
                    status="connected",
                    external_account_name="Recruiting calendar",
                    sync_scope=["availability"],
                ),
                organization_id=organization_id,
                db=self.db,
                current_user=self.recruiter,
            )
        self.assertEqual(unverified_connection.exception.status_code, 409)

    def test_organization_roles_enforce_member_and_custom_access(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        custom_user = User(
            email="manager@example.com",
            full_name="Hiring Manager",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        recruiter_user = User(
            email="team-recruiter@example.com",
            full_name="Team Recruiter",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        self.db.add_all([custom_user, recruiter_user])
        self.db.commit()

        custom = add_member(
            MembershipCreate(
                email=custom_user.email,
                role="custom",
                permissions=["assessments.view", "assessments.manage", "assessment_results.view", "interviews.view", "interviews.manage"],
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertIn("assessment_results.view", custom["permissions"])
        add_member(
            MembershipCreate(email=recruiter_user.email, role="recruiter"),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )

        custom_workspace = hiring_workspace(organization_id=organization_id, db=self.db, current_user=custom_user)
        self.assertIn("assessments.manage", custom_workspace["permissions"])
        self.assertNotIn("jobs.manage", custom_workspace["permissions"])
        with self.assertRaises(HTTPException) as custom_job_denied:
            create_job(
                JobCreate(job_code="DENIED-1", title="Restricted role"),
                organization_id=organization_id,
                db=self.db,
                current_user=custom_user,
            )
        self.assertEqual(custom_job_denied.exception.status_code, 403)
        with self.assertRaises(HTTPException) as recruiter_member_denied:
            add_member(
                MembershipCreate(email="another@example.com", role="recruiter"),
                organization_id=organization_id,
                db=self.db,
                current_user=recruiter_user,
            )
        self.assertEqual(recruiter_member_denied.exception.status_code, 403)
        membership = self.db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == recruiter_user.id,
            ),
        )
        self.assertEqual(membership.role, "recruiter")

    def test_sso_only_member_is_pre_authorized_without_password_invitation(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        configured = update_sso_configuration(
            SsoConfigurationUpdate(
                provider="wso2",
                domains=["edutripindia.com"],
                idp_metadata_url="https://idp.edutripindia.com/saml/metadata",
                initial_admin_email="founders@edutripindia.com",
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(configured["connection_status"], "ready_for_registration")

        result = add_member(
            MembershipCreate(
                email="founders@edutripindia.com",
                full_name="Edutrip Founder",
                role="org_admin",
                authentication="sso_only",
            ),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )

        self.assertFalse(result["invitation_sent"])
        self.assertEqual(result["status"], "pending_sso")
        pending_user = self.db.scalar(select(User).where(User.email == "founders@edutripindia.com"))
        self.assertEqual(pending_user.password_hash, "sso_pending")
        sso = get_sso_configuration(
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        self.assertEqual(sso["provider"], "wso2")
        self.assertEqual(sso["initial_admin_email"], "founders@edutripindia.com")
        self.assertNotIn("service_provider", sso)

    def test_passing_linked_assessment_advances_candidate_to_interview(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        job = create_job(
            JobCreate(job_code="OPS-201", title="Operations Analyst", skills=["Excel"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        candidate = create_candidate(
            CandidateCreate(first_name="Jordan", email="jordan@example.com", skills=["Excel"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        application_result = create_application(
            ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        application = self.db.get(HiringApplication, application_result["id"])
        application.stage = "assessment"
        exam = Exam(course_id=1, title="Operations assessment", total_marks=100, pass_score=70)
        self.db.add(exam)
        self.db.flush()
        issue = AssessmentIssue(
            exam_id=exam.id,
            issuer_user_id=self.recruiter.id,
            hiring_application_id=application.id,
            candidate_name="Jordan",
            candidate_email="jordan@example.com",
            candidate_password_hash="test",
            access_key="linked-assessment-test",
            status="review_pending",
        )
        self.db.add(issue)
        self.db.flush()
        self.db.add(
            AssessmentSubmission(
                assessment_id=exam.id,
                issue_id=issue.id,
                assessment_type="mcq",
                status="review_pending",
            ),
        )
        self.db.commit()

        result = finalize_issued_assessment_review(
            issue.id,
            AssessmentReviewFinalizeRequest(
                score_pct=84,
                reviewer_notes="Checkpoint evidence supports the finalized passing score.",
            ),
            db=self.db,
            current_user=self.recruiter,
        )

        self.assertTrue(result["passed"])
        self.assertEqual(result["application_stage"], "interview")
        self.db.refresh(application)
        self.assertEqual(application.stage, "interview")

    def test_assessment_issue_requires_and_advances_screening_application(self) -> None:
        workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        organization_id = workspace["organization"]["id"]
        job = create_job(
            JobCreate(job_code="FIN-202", title="Bookkeeper", skills=["reconciliation"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        candidate = create_candidate(
            CandidateCreate(first_name="Sam", email="sam@example.com", skills=["reconciliation"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        application_result = create_application(
            ApplicationCreate(job_id=job["id"], candidate_id=candidate["id"]),
            organization_id=organization_id,
            db=self.db,
            current_user=self.recruiter,
        )
        profile = ProviderProfile(
            user_id=self.recruiter.id,
            provider_type=ProviderType.INDIVIDUAL,
            display_name="Recruiter",
            approval_status=ApprovalStatus.APPROVED,
        )
        self.db.add(profile)
        self.db.flush()
        course = Course(
            provider_id=profile.id,
            title="Assessments",
            description="Assessment container",
            category="assessment",
        )
        self.db.add(course)
        self.db.flush()
        exam = Exam(
            course_id=course.id,
            title="Bookkeeping assessment",
            status=ExamStatus.PUBLISHED,
            pass_score=70,
        )
        self.db.add(exam)
        self.db.commit()
        request = Request({"type": "http", "scheme": "https", "server": ("app.example.com", 443), "headers": [(b"host", b"app.example.com")]})

        issued = issue_assessment_to_candidate(
            exam.id,
            IssueAssessmentRequest(
                application_id=application_result["id"],
                candidate_name="Sam",
                candidate_email="sam@example.com",
            ),
            request=request,
            db=self.db,
            current_user=self.recruiter,
        )

        self.assertEqual(issued["application_id"], application_result["id"])
        application = self.db.get(HiringApplication, application_result["id"])
        self.assertEqual(application.stage, "assessment")
        issue = self.db.get(AssessmentIssue, issued["issued_id"])
        self.assertEqual(issue.hiring_application_id, application.id)

    def test_recruiter_cannot_read_another_organization_candidates(self) -> None:
        first_workspace = hiring_workspace(organization_id=None, db=self.db, current_user=self.recruiter)
        create_candidate(
            CandidateCreate(
                first_name="Private",
                last_name="Candidate",
                email="private@example.com",
                consent_obtained=True,
            ),
            organization_id=first_workspace["organization"]["id"],
            db=self.db,
            current_user=self.recruiter,
        )
        outsider = User(
            email="outsider@example.com",
            full_name="Outside Recruiter",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
            account_state="active",
        )
        self.db.add(outsider)
        self.db.commit()
        hiring_workspace(organization_id=None, db=self.db, current_user=outsider)

        with self.assertRaises(HTTPException) as denied:
            list_candidates(
                organization_id=first_workspace["organization"]["id"],
                search=None,
                db=self.db,
                current_user=outsider,
            )

        self.assertEqual(denied.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
