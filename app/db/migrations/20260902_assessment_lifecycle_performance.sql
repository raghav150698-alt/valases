-- Composite indexes for the candidate assessment hot path.
-- Safe to apply repeatedly on PostgreSQL.
CREATE INDEX IF NOT EXISTS ix_assessment_submissions_issue_id_id
    ON assessment_submissions (issue_id, id);

CREATE INDEX IF NOT EXISTS ix_assessment_review_clips_issue_id_created_at
    ON assessment_review_clips (issue_id, created_at);
