  begin;
  
  alter table public.assessment_issues
      add column if not exists hiring_application_id integer;
  
  do $$
  begin
      if not exists (
          select 1
          from pg_constraint
          where conname = 'assessment_issues_hiring_application_id_fkey'
      ) then
          alter table public.assessment_issues
              add constraint assessment_issues_hiring_application_id_fkey
              foreign key (hiring_application_id)
              references public.hiring_applications(id)
              on delete set null;
      end if;
  end
  $$;
  
  create index if not exists ix_assessment_issues_hiring_application_id
      on public.assessment_issues (hiring_application_id);
  
  commit;
