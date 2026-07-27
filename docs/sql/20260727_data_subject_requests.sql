-- Valases data-subject request case management.
-- Apply once to each existing regional Supabase project.

CREATE TABLE IF NOT EXISTS data_subject_requests (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    provider_id INTEGER REFERENCES providers(id),
    request_reference VARCHAR(40) NOT NULL,
    request_type VARCHAR(30) NOT NULL,
    candidate_email VARCHAR(320) NOT NULL,
    requestor_name VARCHAR(200) NOT NULL DEFAULT '',
    status VARCHAR(40) NOT NULL DEFAULT 'received',
    identity_verified_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at TIMESTAMPTZ NOT NULL,
    assigned_to_user_id INTEGER REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    notes TEXT NOT NULL DEFAULT '',
    resolution_json JSON NOT NULL DEFAULT '{}'::json,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_data_subject_request UNIQUE (organization_id, request_reference)
);

CREATE INDEX IF NOT EXISTS ix_data_subject_requests_org_status
    ON data_subject_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS ix_data_subject_requests_due_at
    ON data_subject_requests (due_at);
CREATE INDEX IF NOT EXISTS ix_data_subject_requests_candidate_email
    ON data_subject_requests (candidate_email);
