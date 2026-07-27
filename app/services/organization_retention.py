from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    AssessmentIssue,
    AssessmentSubmission,
    HiringApplication,
    HiringCandidate,
    Organization,
    OrganizationAuditEvent,
)


@dataclass(frozen=True)
class OrganizationRetentionResult:
    organization_id: int
    mode: str
    blocked_by_legal_hold: bool
    hiring_candidates_eligible: int
    assessment_issues_eligible: int
    hiring_candidates_anonymized: int = 0
    assessment_issues_anonymized: int = 0
    submissions_cleared: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def _governance(organization: Organization) -> dict:
    return {
        "candidate_retention_days": 730,
        "assessment_retention_days": 365,
        "legal_hold_enabled": False,
        **dict((organization.settings_json or {}).get("governance") or {}),
    }


def run_organization_retention(
    db: Session,
    *,
    organization: Organization,
    owner_user_id: int,
    execute: bool = False,
    actor_user_id: int | None = None,
) -> OrganizationRetentionResult:
    policy = _governance(organization)
    now = datetime.now(timezone.utc)
    candidate_cutoff = now - timedelta(days=int(policy["candidate_retention_days"]))
    assessment_cutoff = now - timedelta(days=int(policy["assessment_retention_days"]))
    active_application_candidates = select(HiringApplication.candidate_id).where(
        HiringApplication.organization_id == organization.id,
        HiringApplication.status == "active",
    )
    candidate_rows = list(
        db.scalars(
            select(HiringCandidate).where(
                HiringCandidate.organization_id == organization.id,
                HiringCandidate.created_at < candidate_cutoff,
                HiringCandidate.id.not_in(active_application_candidates),
                HiringCandidate.consent_status != "deleted",
            ),
        ).all(),
    )
    terminal_statuses = {"completed", "review_pending", "reviewed", "revoked", "expired"}
    issue_rows = list(
        db.scalars(
            select(AssessmentIssue).where(
                AssessmentIssue.issuer_user_id == owner_user_id,
                AssessmentIssue.issued_at < assessment_cutoff,
                AssessmentIssue.status.in_(terminal_statuses),
                AssessmentIssue.candidate_email.not_like("%@redacted.invalid"),
            ),
        ).all(),
    )
    blocked = bool(policy.get("legal_hold_enabled"))
    result = OrganizationRetentionResult(
        organization_id=organization.id,
        mode="execute" if execute else "preview",
        blocked_by_legal_hold=blocked,
        hiring_candidates_eligible=len(candidate_rows),
        assessment_issues_eligible=len(issue_rows),
    )
    if not execute or blocked:
        return result

    submissions_cleared = 0
    for candidate in candidate_rows:
        candidate.first_name = "Deleted"
        candidate.last_name = "Candidate"
        candidate.email = f"deleted+candidate-{candidate.id}@redacted.invalid"
        candidate.phone_number = None
        candidate.headline = ""
        candidate.location = ""
        candidate.resume_text = ""
        candidate.resume_url = None
        candidate.skills_json = []
        candidate.experience_years = None
        candidate.consent_status = "deleted"
        candidate.consented_at = None
    for issue in issue_rows:
        issue.candidate_name = "Deleted candidate"
        issue.candidate_email = f"deleted+assessment-{issue.id}@redacted.invalid"
        issue.candidate_password_hash = "retention-deleted"
        issue.active_session_token = None
        issue.active_session_started_at = None
        issue.access_expires_at = now
        issue.result_json = {"retention_anonymized_at": now.isoformat()}
        submissions = list(db.scalars(select(AssessmentSubmission).where(AssessmentSubmission.issue_id == issue.id)).all())
        for submission in submissions:
            submission.submitted_data_json = {}
            submission.proctoring_events_json = []
            submission.status = "retention_anonymized"
            submissions_cleared += 1
    db.add(
        OrganizationAuditEvent(
            organization_id=organization.id,
            actor_user_id=actor_user_id,
            action="retention_execution_completed",
            target_type="organization",
            target_id=organization.id,
            details_json={
                "hiring_candidates_anonymized": len(candidate_rows),
                "assessment_issues_anonymized": len(issue_rows),
                "submissions_cleared": submissions_cleared,
            },
        ),
    )
    db.commit()
    return OrganizationRetentionResult(
        organization_id=organization.id,
        mode="execute",
        blocked_by_legal_hold=False,
        hiring_candidates_eligible=len(candidate_rows),
        assessment_issues_eligible=len(issue_rows),
        hiring_candidates_anonymized=len(candidate_rows),
        assessment_issues_anonymized=len(issue_rows),
        submissions_cleared=submissions_cleared,
    )
