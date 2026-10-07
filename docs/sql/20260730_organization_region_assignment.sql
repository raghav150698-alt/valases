-- Durable region metadata for operator provisioning and future self-service.
-- Apply through the Supabase SQL editor in every regional project.
-- Existing rows remain nullable so each regional operator can backfill them
-- with that deployment's DEPLOYMENT_REGION after reviewing the organization list.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_region VARCHAR(30);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS region_assignment_source VARCHAR(40) NOT NULL DEFAULT 'operator';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS region_locked BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS ix_organizations_data_region ON organizations (data_region);

-- After validating the regional project, run one of these explicitly:
-- UPDATE organizations SET data_region = 'tokyo' WHERE data_region IS NULL;
-- UPDATE organizations SET data_region = 'mumbai' WHERE data_region IS NULL;
