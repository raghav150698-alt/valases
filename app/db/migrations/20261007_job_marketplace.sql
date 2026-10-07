-- Apply explicitly before enabling the Valases Jobs bridge in production.
CREATE TABLE IF NOT EXISTS job_marketplace_publications (
    job_id INTEGER PRIMARY KEY REFERENCES job_requisitions(id),
    published BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    minimum_experience_years DOUBLE PRECISION CHECK (minimum_experience_years BETWEEN 0 AND 80),
    updated_by_user_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_job_marketplace_publications_published
    ON job_marketplace_publications(published);

