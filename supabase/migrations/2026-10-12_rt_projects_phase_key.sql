-- ═══════════════════════════════════════════════════════════════════════════
-- Resource Tracker V1 redesign — current project phase on rt_projects.
-- NOT APPLIED. Review, then run once in Supabase → SQL Editor. Safe to re-run.
--
-- • Adds one nullable column. No existing row or value is changed; every project starts as
--   "Phase not set" until someone chooses a phase in Settings → Projects & phases.
-- • Stores the PERMANENT PM Workflow phase id (same list as rt_tasks.phase_key), never a name.
-- • Existing grants, RLS policies and the Realtime publication already cover the whole table.
-- • Until this runs, the app works normally and shows project phase as "not set" (it never sends
--   the column), so the redesign can be deployed before or after this migration.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.rt_projects add column if not exists phase_key text;

alter table public.rt_projects drop constraint if exists rt_projects_phase_key_check;
alter table public.rt_projects add constraint rt_projects_phase_key_check check (phase_key is null or phase_key in (
  'phase-conceptual-design-contract',
  'phase-design-development-freeze',
  'phase-coordinated-design',
  'phase-permit-documentation',
  'phase-construction-docs-manufacturing-readiness',
  'phase-site-manufacturing-construction'));

comment on column public.rt_projects.phase_key is 'Current PM Workflow phase (permanent id, nullable). Display only; no sync with the PM Workflow.';

-- Check: should list the new column with no values set yet.
select count(*) as projects, count(phase_key) as projects_with_phase from public.rt_projects;
