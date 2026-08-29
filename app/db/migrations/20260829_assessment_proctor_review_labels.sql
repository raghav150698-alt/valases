CREATE TABLE IF NOT EXISTS assessment_proctor_review_labels (
  id BIGSERIAL PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES assessment_issues(id),
  submission_id INTEGER NULL REFERENCES assessment_submissions(id),
  evidence_clip_id INTEGER NULL REFERENCES assessment_review_clips(id),
  event_key VARCHAR(180) NOT NULL,
  source_event_index INTEGER NULL,
  event_type VARCHAR(120) NOT NULL,
  reviewer_label VARCHAR(30) NOT NULL,
  model_disposition VARCHAR(40) NULL,
  model_confidence FLOAT NULL,
  reviewer_notes TEXT NULL,
  reviewed_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_assessment_proctor_review_label_event UNIQUE (issue_id, event_key)
);

CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_issue_id ON assessment_proctor_review_labels(issue_id);
CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_submission_id ON assessment_proctor_review_labels(submission_id);
CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_evidence_clip_id ON assessment_proctor_review_labels(evidence_clip_id);
CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_event_type ON assessment_proctor_review_labels(event_type);
CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_reviewer_label ON assessment_proctor_review_labels(reviewer_label);
CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_model_disposition ON assessment_proctor_review_labels(model_disposition);
CREATE INDEX IF NOT EXISTS ix_assessment_proctor_review_labels_reviewed_by_user_id ON assessment_proctor_review_labels(reviewed_by_user_id);
