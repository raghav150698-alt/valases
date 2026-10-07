CREATE TABLE outreach_leads (
  id SERIAL PRIMARY KEY, company VARCHAR(240) NOT NULL, website VARCHAR(500) NOT NULL DEFAULT '',
  contact_name VARCHAR(200) NOT NULL DEFAULT '', contact_title VARCHAR(200) NOT NULL DEFAULT '',
  email VARCHAR(320) NOT NULL UNIQUE, campaign VARCHAR(40) NOT NULL, evidence TEXT NOT NULL,
  source_url VARCHAR(1000) NOT NULL, personalization_json JSON NOT NULL DEFAULT '{}',
  status VARCHAR(30) NOT NULL DEFAULT 'research', last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_outreach_leads_status ON outreach_leads(status);
CREATE TABLE outreach_emails (
  id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES outreach_leads(id), sequence_number INTEGER NOT NULL,
  subject VARCHAR(300) NOT NULL, html_body TEXT NOT NULL, text_body TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued', scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_outreach_email_sequence UNIQUE (lead_id, sequence_number)
);
CREATE TABLE outreach_inbound_messages (
  id SERIAL PRIMARY KEY, provider_message_id VARCHAR(320) UNIQUE,
  from_email VARCHAR(320) NOT NULL, subject VARCHAR(300) NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  classification VARCHAR(40) NOT NULL DEFAULT 'unknown', reply_draft TEXT NOT NULL DEFAULT '',
  needs_owner BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
