CREATE TABLE IF NOT EXISTS hiring_automation_deliveries (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    automation_key VARCHAR(240) NOT NULL UNIQUE,
    automation_type VARCHAR(80) NOT NULL,
    application_id INTEGER NULL REFERENCES hiring_applications(id),
    interview_id INTEGER NULL REFERENCES hiring_interviews(id),
    assessment_issue_id INTEGER NULL,
    recipient_email VARCHAR(320) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    provider_error VARCHAR(500) NOT NULL DEFAULT '',
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_hiring_automation_delivery_org ON hiring_automation_deliveries(organization_id);
CREATE INDEX IF NOT EXISTS ix_hiring_automation_delivery_type ON hiring_automation_deliveries(automation_type);
CREATE INDEX IF NOT EXISTS ix_hiring_automation_delivery_application ON hiring_automation_deliveries(application_id);
