-- Valases enterprise hiring workspace.
-- Apply once through the Supabase SQL editor or a controlled migration job.
-- This migration intentionally contains no row-level security policies because
-- the API currently uses a server-side database role. Add RLS only together
-- with a tenant-aware, least-privilege database connection strategy.

CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    legal_name VARCHAR(240),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    plan_code VARCHAR(40) NOT NULL DEFAULT 'trial',
    settings_json JSON NOT NULL DEFAULT '{}'::json,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role VARCHAR(40) NOT NULL DEFAULT 'recruiter',
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_member UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS job_requisitions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    hiring_manager_user_id INTEGER REFERENCES users(id),
    job_code VARCHAR(60) NOT NULL,
    title VARCHAR(240) NOT NULL,
    department VARCHAR(160) NOT NULL DEFAULT 'General',
    location VARCHAR(180) NOT NULL DEFAULT 'Remote',
    employment_type VARCHAR(50) NOT NULL DEFAULT 'full_time',
    work_arrangement VARCHAR(40) NOT NULL DEFAULT 'hybrid',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    description TEXT NOT NULL DEFAULT '',
    responsibilities_json JSON NOT NULL DEFAULT '[]'::json,
    requirements_json JSON NOT NULL DEFAULT '[]'::json,
    skills_json JSON NOT NULL DEFAULT '[]'::json,
    assessment_template_id INTEGER REFERENCES assessment_templates(id),
    headcount INTEGER NOT NULL DEFAULT 1,
    target_start_date TIMESTAMPTZ,
    compensation_min FLOAT,
    compensation_max FLOAT,
    compensation_currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_job_code UNIQUE (organization_id, job_code),
    CONSTRAINT ck_job_compensation_range CHECK (compensation_min IS NULL OR compensation_max IS NULL OR compensation_min <= compensation_max)
);

CREATE TABLE IF NOT EXISTS hiring_candidates (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    first_name VARCHAR(120) NOT NULL,
    last_name VARCHAR(120) NOT NULL DEFAULT '',
    email VARCHAR(320) NOT NULL,
    phone_number VARCHAR(40),
    headline VARCHAR(300) NOT NULL DEFAULT '',
    location VARCHAR(180) NOT NULL DEFAULT '',
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    resume_text TEXT NOT NULL DEFAULT '',
    resume_url VARCHAR(1000),
    skills_json JSON NOT NULL DEFAULT '[]'::json,
    experience_years FLOAT,
    consent_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    consented_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_candidate_email UNIQUE (organization_id, email)
);

CREATE TABLE IF NOT EXISTS hiring_applications (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    job_id INTEGER NOT NULL REFERENCES job_requisitions(id),
    candidate_id INTEGER NOT NULL REFERENCES hiring_candidates(id),
    owner_user_id INTEGER REFERENCES users(id),
    stage VARCHAR(50) NOT NULL DEFAULT 'applied',
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    ai_match_score FLOAT,
    ai_confidence FLOAT,
    ai_recommendation VARCHAR(60),
    ai_rationale_json JSON NOT NULL DEFAULT '{}'::json,
    human_decision VARCHAR(60),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_job_candidate_application UNIQUE (job_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS hiring_stage_events (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    application_id INTEGER NOT NULL REFERENCES hiring_applications(id),
    actor_user_id INTEGER REFERENCES users(id),
    from_stage VARCHAR(50),
    to_stage VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hiring_interviews (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    application_id INTEGER NOT NULL REFERENCES hiring_applications(id),
    scheduled_by_user_id INTEGER REFERENCES users(id),
    interview_type VARCHAR(80) NOT NULL DEFAULT 'structured',
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    scheduled_at TIMESTAMPTZ,
    duration_minutes INTEGER NOT NULL DEFAULT 45,
    meeting_url VARCHAR(1000),
    interviewers_json JSON NOT NULL DEFAULT '[]'::json,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_interview_duration CHECK (duration_minutes BETWEEN 15 AND 480)
);

CREATE TABLE IF NOT EXISTS hiring_scorecards (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    interview_id INTEGER NOT NULL REFERENCES hiring_interviews(id),
    application_id INTEGER NOT NULL REFERENCES hiring_applications(id),
    reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
    recommendation VARCHAR(60) NOT NULL DEFAULT 'pending',
    overall_score FLOAT,
    competencies_json JSON NOT NULL DEFAULT '{}'::json,
    evidence TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_interview_scorecard_reviewer UNIQUE (interview_id, reviewer_user_id),
    CONSTRAINT ck_scorecard_score CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 5)
);

CREATE TABLE IF NOT EXISTS hiring_compliance_checks (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    application_id INTEGER NOT NULL REFERENCES hiring_applications(id),
    check_type VARCHAR(80) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    details_json JSON NOT NULL DEFAULT '{}'::json,
    reviewed_by_user_id INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_application_compliance_check UNIQUE (application_id, check_type)
);

CREATE TABLE IF NOT EXISTS hiring_integrations (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    provider VARCHAR(80) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'not_connected',
    config_json JSON NOT NULL DEFAULT '{}'::json,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_hiring_integration UNIQUE (organization_id, provider)
);

CREATE TABLE IF NOT EXISTS organization_audit_events (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    actor_user_id INTEGER REFERENCES users(id),
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(80) NOT NULL,
    target_id INTEGER,
    details_json JSON NOT NULL DEFAULT '{}'::json,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS ix_organization_memberships_org_user ON organization_memberships(organization_id, user_id);
CREATE INDEX IF NOT EXISTS ix_job_requisitions_org_status ON job_requisitions(organization_id, status);
CREATE INDEX IF NOT EXISTS ix_hiring_candidates_org_email ON hiring_candidates(organization_id, email);
CREATE INDEX IF NOT EXISTS ix_hiring_applications_org_stage ON hiring_applications(organization_id, stage);
CREATE INDEX IF NOT EXISTS ix_hiring_interviews_org_schedule ON hiring_interviews(organization_id, scheduled_at);
CREATE INDEX IF NOT EXISTS ix_organization_audit_events_org_created ON organization_audit_events(organization_id, created_at DESC);
