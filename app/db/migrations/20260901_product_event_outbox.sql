CREATE TABLE IF NOT EXISTS product_event_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(36) NOT NULL UNIQUE,
    event_type VARCHAR(120) NOT NULL,
    organization_id BIGINT,
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(120) NOT NULL,
    properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema_version INTEGER NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_error VARCHAR(160),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_product_event_outbox_pending
    ON product_event_outbox (published_at, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS ix_product_event_outbox_event_type
    ON product_event_outbox (event_type);
CREATE INDEX IF NOT EXISTS ix_product_event_outbox_organization
    ON product_event_outbox (organization_id);
