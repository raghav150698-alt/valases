-- Run once in every regional Supabase project before deploying ATS imports.
-- These nullable IDs make connector retries idempotent without changing manual applications.

alter table public.hiring_applications
  add column if not exists external_application_id varchar(240),
  add column if not exists external_candidate_id varchar(240),
  add column if not exists external_job_id varchar(240);

create index if not exists ix_hiring_applications_external_candidate
  on public.hiring_applications (organization_id, source, external_candidate_id);

create index if not exists ix_hiring_applications_external_job
  on public.hiring_applications (organization_id, source, external_job_id);

create unique index if not exists uq_org_source_external_application
  on public.hiring_applications (organization_id, source, external_application_id)
  where external_application_id is not null;
