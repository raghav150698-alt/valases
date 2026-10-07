CREATE TABLE IF NOT EXISTS hiring_email_channels (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    purpose VARCHAR(60) NOT NULL,
    provider VARCHAR(30) NOT NULL DEFAULT 'smtp',
    status VARCHAR(30) NOT NULL DEFAULT 'not_configured',
    smtp_host VARCHAR(240) NOT NULL DEFAULT '',
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_username VARCHAR(320) NOT NULL DEFAULT '',
    smtp_password_encrypted TEXT NOT NULL DEFAULT '',
    sender VARCHAR(320) NOT NULL DEFAULT '',
    sender_name VARCHAR(200) NOT NULL DEFAULT '',
    reply_to VARCHAR(320) NOT NULL DEFAULT '',
    last_tested_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_hiring_email_channel_purpose UNIQUE (organization_id, purpose)
);
CREATE INDEX IF NOT EXISTS ix_hiring_email_channel_org ON hiring_email_channels(organization_id);
CREATE INDEX IF NOT EXISTS ix_hiring_email_channel_purpose ON hiring_email_channels(purpose);
