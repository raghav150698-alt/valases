begin;

alter table public.organization_memberships
  add column if not exists permissions_json jsonb not null default '[]'::jsonb;

create index if not exists ix_organization_memberships_role_status
  on public.organization_memberships (organization_id, role, status);

commit;
