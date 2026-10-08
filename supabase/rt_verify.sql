-- Resource Tracker — verification. Run in Supabase → SQL Editor after schema + seed.
-- Expected on a fresh seed: disciplines 10 · people 27 · projects 4 · tasks 46 ·
-- realtime tables 4 · RLS on 4 · policies 14 · tasks missing start 38 / due 32 / hrs 46.
select
  (select count(*) from public.rt_disciplines)                       as disciplines,
  (select count(*) from public.rt_people)                            as people,
  (select count(*) from public.rt_projects)                          as projects,
  (select count(*) from public.rt_tasks)                             as tasks,
  (select count(*) from public.rt_tasks where start_date is null)    as tasks_missing_start,
  (select count(*) from public.rt_tasks where due_date is null)      as tasks_missing_due,
  (select count(*) from public.rt_tasks where hours_per_week is null) as tasks_missing_hrs,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'rt\_%') as realtime_tables,
  (select count(*) from pg_class where relname in ('rt_disciplines','rt_people','rt_projects','rt_tasks') and relrowsecurity) as rls_enabled,
  (select count(*) from pg_policies where tablename like 'rt\_%')    as policies;
