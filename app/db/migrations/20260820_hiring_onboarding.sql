CREATE TABLE IF NOT EXISTS hiring_onboarding (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    application_id INTEGER NOT NULL UNIQUE REFERENCES hiring_applications(id),
    status VARCHAR(30) NOT NULL DEFAULT 'not_started',
    manager_user_id INTEGER NULL REFERENCES users(id),
    manager_name VARCHAR(240) NOT NULL DEFAULT '',
    start_date TIMESTAMP NULL,
    checklist_json JSON NOT NULL DEFAULT '[]',
    documents_json JSON NOT NULL DEFAULT '[]',
    access_requests_json JSON NOT NULL DEFAULT '[]',
    first_day_plan TEXT NOT NULL DEFAULT '',
    welcome_email_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_hiring_onboarding_organization_id ON hiring_onboarding(organization_id);
CREATE INDEX IF NOT EXISTS ix_hiring_onboarding_status ON hiring_onboarding(status);
