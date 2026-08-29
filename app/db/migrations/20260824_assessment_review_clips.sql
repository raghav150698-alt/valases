CREATE TABLE IF NOT EXISTS assessment_review_clips (
  id BIGSERIAL PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES assessment_issues(id),
  evidence_type VARCHAR(20) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  file_url VARCHAR(2000) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  duration_seconds FLOAT NOT NULL DEFAULT 6,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_assessment_review_clips_issue_id ON assessment_review_clips(issue_id);
