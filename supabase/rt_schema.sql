-- ═══════════════════════════════════════════════════════════════════════════
-- Resource Tracker (standalone / temporary) — Supabase schema, Stage B
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- • Own rt_* namespace only. No foreign keys to, no reads of, and no writes to any PM Workflow table.
-- • No login yet: the browser uses the publishable (anon) key. Row Level Security is ON and the
--   policies below allow the anon role to read/add/edit — that is "shared by link", NOT security.
--   Never put the secret / service_role key in the browser.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.rt_disciplines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        text not null default 'discipline' check (kind in ('discipline','management')),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.rt_people (
  id                    uuid primary key default gen_random_uuid(),
  discipline_id         uuid not null references public.rt_disciplines(id),
  name                  text not null unique,
  role                  text,
  weekly_capacity_hours numeric(5,1) check (weekly_capacity_hours is null or weekly_capacity_hours between 0 and 80),
  sort_order            integer not null default 0,
  active                boolean not null default true,      -- deactivate, never delete (tasks keep their person)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.rt_projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  status          text,
  project_manager text,
  start_date      date,
  target_finish   date,
  notes           text,
  active          boolean not null default true,            -- archive = active false
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (target_finish is null or start_date is null or target_finish >= start_date)
);

create table if not exists public.rt_tasks (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.rt_people(id),
  project_id     uuid not null references public.rt_projects(id),   -- a project with tasks can never be deleted
  title          text not null,
  phase_key      text check (phase_key is null or phase_key in (
                   -- PERMANENT PM Workflow phase ids (src/seed.js STRUCTURE[].id). Classification only, no sync.
                   'phase-conceptual-design-contract',
                   'phase-design-development-freeze',
                   'phase-coordinated-design',
                   'phase-permit-documentation',
                   'phase-construction-docs-manufacturing-readiness',
                   'phase-site-manufacturing-construction')),
  start_date     date,                                              -- null = "Start not defined"
  due_date       date,                                              -- null = "Due not defined"
  hours_per_week numeric(5,1) check (hours_per_week is null or hours_per_week between 0 and 80), -- null = Unestimated, never 0
  status         text check (status is null or status in ('Not Started','In Progress','Waiting','Blocked','Done')),
  priority       text check (priority is null or priority in ('Low','Medium','High','Critical')),
  notes          text,
  sort_order     bigint not null default 0,
  active         boolean not null default true,
  source_row     integer,                                           -- Excel row it came from (null for new tasks)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index if not exists rt_people_discipline_idx on public.rt_people(discipline_id);
create index if not exists rt_tasks_person_idx      on public.rt_tasks(person_id);
create index if not exists rt_tasks_project_idx     on public.rt_tasks(project_id);

-- updated_at is set by the database on every change
create or replace function public.rt_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['rt_disciplines','rt_people','rt_projects','rt_tasks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.rt_touch()', t || '_touch', t);
  end loop; end $$;

-- ── Access (temporary no-login mode) ───────────────────────────────────────
-- anon may: read all four tables; add/edit all four; delete tasks; delete projects that no task uses
-- (the foreign key blocks deleting a referenced project). People and disciplines are never deleted —
-- they are deactivated (active = false).
revoke all on public.rt_disciplines, public.rt_people, public.rt_projects, public.rt_tasks from anon, authenticated;
grant select, insert, update on public.rt_disciplines, public.rt_people, public.rt_projects, public.rt_tasks to anon, authenticated;
grant delete on public.rt_tasks, public.rt_projects to anon, authenticated;

alter table public.rt_disciplines enable row level security;
alter table public.rt_people      enable row level security;
alter table public.rt_projects    enable row level security;
alter table public.rt_tasks       enable row level security;
do $$ declare t text; begin
  foreach t in array array['rt_disciplines','rt_people','rt_projects','rt_tasks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);     -- earlier draft name
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true)', t || '_update', t);
  end loop;
  foreach t in array array['rt_projects','rt_tasks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to anon, authenticated using (true)', t || '_delete', t);
  end loop; end $$;

-- ── Realtime: every insert / update / delete is pushed to all open browsers ─
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['rt_disciplines','rt_people','rt_projects','rt_tasks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop; end $$;
