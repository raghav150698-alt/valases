-- Valases organization tenant isolation.
--
-- Run only after the API uses a dedicated, non-owner PostgreSQL role.
-- The Supabase postgres owner and service roles can bypass RLS and are not
-- acceptable as the long-term application runtime role.

begin;

alter table organizations enable row level security;
alter table organization_memberships enable row level security;
alter table job_requisitions enable row level security;
alter table hiring_candidates enable row level security;
alter table hiring_applications enable row level security;
alter table hiring_stage_events enable row level security;
alter table hiring_interviews enable row level security;
alter table hiring_scorecards enable row level security;
alter table hiring_compliance_checks enable row level security;
alter table hiring_integrations enable row level security;
alter table organization_audit_events enable row level security;
alter table data_subject_requests enable row level security;

drop policy if exists valases_tenant_isolation on organizations;
create policy valases_tenant_isolation on organizations
  using (id = nullif(current_setting('app.current_organization_id', true), '')::integer)
  with check (id = nullif(current_setting('app.current_organization_id', true), '')::integer);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organization_memberships',
    'job_requisitions',
    'hiring_candidates',
    'hiring_applications',
    'hiring_stage_events',
    'hiring_interviews',
    'hiring_scorecards',
    'hiring_compliance_checks',
    'hiring_integrations',
    'organization_audit_events',
    'data_subject_requests'
  ]
  loop
    execute format('drop policy if exists valases_tenant_isolation on %I', table_name);
    execute format(
      'create policy valases_tenant_isolation on %I using (organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::integer) with check (organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::integer)',
      table_name
    );
  end loop;
end
$$;

commit;
