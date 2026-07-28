-- Run once in each regional Supabase project before enabling desktop sessions.
-- These tables are server-only. Do not grant browser roles direct access.

BEGIN;

CREATE TABLE IF NOT EXISTS desktop_app_sessions (
    id VARCHAR(36) PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES assessment_issues(id) ON DELETE CASCADE,
    active_key VARCHAR(80) UNIQUE,
    app_key VARCHAR(80) NOT NULL,
    broker_provider VARCHAR(40) NOT NULL DEFAULT 'http',
    provider_session_id VARCHAR(200),
    host_id VARCHAR(200),
    workspace_key VARCHAR(180) NOT NULL UNIQUE,
    candidate_name_snapshot VARCHAR(200) NOT NULL,
    candidate_email_snapshot VARCHAR(320) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'provisioning',
    status_detail VARCHAR(500),
    lease_expires_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_desktop_app_sessions_issue_id ON desktop_app_sessions(issue_id);
CREATE INDEX IF NOT EXISTS ix_desktop_app_sessions_app_key ON desktop_app_sessions(app_key);
CREATE INDEX IF NOT EXISTS ix_desktop_app_sessions_status ON desktop_app_sessions(status);
CREATE INDEX IF NOT EXISTS ix_desktop_app_sessions_provider_session_id ON desktop_app_sessions(provider_session_id);
CREATE INDEX IF NOT EXISTS ix_desktop_app_sessions_lease_expires_at ON desktop_app_sessions(lease_expires_at);

CREATE TABLE IF NOT EXISTS desktop_session_artifacts (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL REFERENCES desktop_app_sessions(id) ON DELETE CASCADE,
    artifact_key VARCHAR(160) NOT NULL,
    artifact_type VARCHAR(80) NOT NULL DEFAULT 'working_file',
    storage_uri VARCHAR(2000) NOT NULL,
    sha256 VARCHAR(64),
    size_bytes BIGINT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_desktop_session_artifact UNIQUE(session_id, artifact_key),
    CONSTRAINT ck_desktop_artifact_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_desktop_artifact_size CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS ix_desktop_session_artifacts_session_id ON desktop_session_artifacts(session_id);
CREATE INDEX IF NOT EXISTS ix_desktop_session_artifacts_type ON desktop_session_artifacts(artifact_type);

REVOKE ALL ON desktop_app_sessions FROM anon, authenticated;
REVOKE ALL ON desktop_session_artifacts FROM anon, authenticated;

COMMIT;
