ALTER TABLE hiring_interviews ADD COLUMN IF NOT EXISTS calendar_provider VARCHAR(80);
ALTER TABLE hiring_interviews ADD COLUMN IF NOT EXISTS calendar_event_id VARCHAR(500);
ALTER TABLE hiring_interviews ADD COLUMN IF NOT EXISTS calendar_event_url VARCHAR(1000);
ALTER TABLE hiring_interviews ADD COLUMN IF NOT EXISTS calendar_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_connected';
ALTER TABLE hiring_interviews ADD COLUMN IF NOT EXISTS calendar_sync_error VARCHAR(500) NOT NULL DEFAULT '';