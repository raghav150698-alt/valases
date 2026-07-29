-- Valases hiring lifecycle, candidate communications, and offer management.
-- Apply through the Supabase SQL editor in every regional project.

CREATE TABLE IF NOT EXISTS hiring_communications (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    application_id INTEGER REFERENCES hiring_applications(id),
    job_id INTEGER REFERENCES job_requisitions(id),
    candidate_id INTEGER NOT NULL REFERENCES hiring_candidates(id),
    actor_user_id INTEGER REFERENCES users(id),
    communication_type VARCHAR(60) NOT NULL,
    template_key VARCHAR(80) NOT NULL DEFAULT '',
    sender_mode VARCHAR(30) NOT NULL DEFAULT 'company',
    recipient_email VARCHAR(320) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body_text TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    provider_error VARCHAR(500),
    metadata_json JSON NOT NULL DEFAULT '{}'::json,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hiring_offers (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    application_id INTEGER NOT NULL UNIQUE REFERENCES hiring_applications(id),
    job_id INTEGER NOT NULL REFERENCES job_requisitions(id),
    candidate_id INTEGER NOT NULL REFERENCES hiring_candidates(id),
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    payroll_reviewed_by_user_id INTEGER REFERENCES users(id),
    offer_reference VARCHAR(80) NOT NULL UNIQUE,
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    job_title_snapshot VARCHAR(240) NOT NULL,
    candidate_name_snapshot VARCHAR(240) NOT NULL,
    candidate_email_snapshot VARCHAR(320) NOT NULL,
    recruiter_email_snapshot VARCHAR(320) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'INR',
    pay_frequency VARCHAR(30) NOT NULL DEFAULT 'annual',
    base_compensation FLOAT,
    variable_compensation FLOAT NOT NULL DEFAULT 0,
    benefits_value FLOAT NOT NULL DEFAULT 0,
    total_ctc FLOAT,
    start_date TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    letter_body TEXT NOT NULL DEFAULT '',
    terms_text TEXT NOT NULL DEFAULT '',
    released_document_html TEXT NOT NULL DEFAULT '',
    signed_document_html TEXT NOT NULL DEFAULT '',
    released_document_hash VARCHAR(64),
    signed_document_hash VARCHAR(64),
    access_token_hash VARCHAR(64) UNIQUE,
    signature_name VARCHAR(240),
    signature_ip VARCHAR(120),
    signature_user_agent VARCHAR(500),
    released_at TIMESTAMPTZ,
    signed_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS released_document_hash VARCHAR(64);
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS signed_document_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS ix_hiring_communications_org_status
    ON hiring_communications(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_hiring_communications_candidate
    ON hiring_communications(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_hiring_offers_org_status
    ON hiring_offers(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_hiring_offers_candidate
    ON hiring_offers(candidate_id, updated_at DESC);
