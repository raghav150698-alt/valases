-- Detailed offer payroll schedules and immutable PDF copies.
-- Apply through the Supabase SQL editor in every regional project.

ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS earnings_json JSON NOT NULL DEFAULT '[]'::json;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS deductions_json JSON NOT NULL DEFAULT '[]'::json;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS gross_cash_compensation FLOAT;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS estimated_net_compensation FLOAT;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS employment_type VARCHAR(80) NOT NULL DEFAULT 'Full-time';
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS work_location VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS reporting_manager VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS probation_months INTEGER NOT NULL DEFAULT 6;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS notice_period_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS released_document_pdf BYTEA;
ALTER TABLE hiring_offers ADD COLUMN IF NOT EXISTS signed_document_pdf BYTEA;
