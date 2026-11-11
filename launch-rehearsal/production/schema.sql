create table if not exists public.valases_launch_event (
 event_key text primary key check (event_key = 'tests-launch-20261111'),
 launched_at timestamptz
);
alter table public.valases_launch_event enable row level security;
revoke all on public.valases_launch_event from public, anon, authenticated;
grant select on public.valases_launch_event to anon, authenticated;
grant update (launched_at) on public.valases_launch_event to authenticated;
drop policy if exists launch_public_read on public.valases_launch_event;
create policy launch_public_read on public.valases_launch_event for select to anon, authenticated using (true);
drop policy if exists launch_owner_update on public.valases_launch_event;
create policy launch_owner_update on public.valases_launch_event for update to authenticated
 using ((select auth.uid()) = '$OWNER_ID$'::uuid and launched_at is null)
 with check ((select auth.uid()) = '$OWNER_ID$'::uuid and launched_at is not null);
insert into public.valases_launch_event(event_key) values ('tests-launch-20261111') on conflict do nothing;

create or replace function public.enforce_valases_launch_once() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if old.launched_at is not null or new.event_key is distinct from old.event_key then
   raise exception 'Launch is permanent and cannot be repeated' using errcode='42501';
 end if;
 new.launched_at := clock_timestamp();
 return new;
end; $$;
revoke all on function public.enforce_valases_launch_once() from public, anon, authenticated;
drop trigger if exists valases_launch_once_guard on public.valases_launch_event;
create trigger valases_launch_once_guard before update on public.valases_launch_event
for each row execute function public.enforce_valases_launch_once();

create or replace function public.launch_valases_once() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result timestamptz;
begin
 if (select auth.uid()) is distinct from '$OWNER_ID$'::uuid then
   raise exception 'Only the internal launch owner can launch' using errcode='42501';
 end if;
 update public.valases_launch_event set launched_at=clock_timestamp()
 where event_key='tests-launch-20261111' and launched_at is null returning launched_at into result;
 if result is null then select launched_at into result from public.valases_launch_event where event_key='tests-launch-20261111'; end if;
 return jsonb_build_object('id','tests-launch-20261111','launchedAt',result);
end; $$;
revoke all on function public.launch_valases_once() from public, anon;
grant execute on function public.launch_valases_once() to authenticated;
notify pgrst, 'reload schema';
