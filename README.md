# Immersive Homes — Resource Tracker (standalone / temporary)

A shared resource planner for the weekly management call. It uses one live Supabase database, and every change appears in all open browsers via Realtime.

**Live site:** https://melzainy.github.io/iht-resource-tracker/

## Screens

V1 redesign (branch `redesign/resource-tracker-v2`). Visual reference: the approved `ih-resource-tracker-prototype.html`.

| Screen | Purpose |
|---|---|
| **Overview** | Blocked · Late · Done · Planning data complete; project cards (health, progress, current phase, next important task); Needs attention. |
| **Planner** | Discipline → Person → Task table with an integrated Gantt. Inline editing; drag bars to move, drag ends to change Start / Due, drag across an empty timeline to set dates. |
| **Settings** | Projects & phases (archive / restore, current phase) · People (disciplines, people, deactivate / reactivate). |
| **My tasks** | Choose your name (a view preference, not a login) to see your open tasks and what's missing; guided **Check-in** for Status, Start and Due. |

**Planning data complete** = Person + Project + Status + Start + Due. Phase, Priority and Notes are optional.

**Hours and capacity are not part of V1.** `rt_tasks.hours_per_week` and `rt_people.weekly_capacity_hours` stay in the database untouched for later, but the V1 screens neither show nor use them (editing a task or person keeps any stored value).

## Data

- **Database:** a Supabase project, using only the `rt_disciplines`, `rt_people`, `rt_projects` and `rt_tasks` tables.
  - Schema, initial data and checks: `supabase/`. Click-by-click setup: `docs/supabase-setup.md`.
- **Initial data:** imported from `Immersive_Homes_Resource_Planner_v4.xlsx` by `scripts/rt_import.py`.
- **Phase:** `rt_tasks.phase_key` stores one of the six permanent PM Workflow phase ids. See `src/rt/pm-phases.js`.
- **Separation:** there is no connection to the PM Workflow application.

## Keys and access

- The browser uses only the Supabase **publishable** key.
  - It is set via the repository **Variables** `RT_BACKEND`, `RT_SUPABASE_URL` and `RT_SUPABASE_PUBLISHABLE_KEY`, or a git-ignored `.env.local` for local builds.
  - The build and the app both refuse secret or service_role keys.
- **No login yet.** Anyone with the link can read and edit. The database rules allow people and disciplines to be deactivated but never deleted, and projects that tasks use can only be archived.
- **No fallback.** If the database cannot be reached, the page shows a connection error. It never falls back to local data.

## Commands

```
npm ci
npm run check                      # model, rollups, store, phase ids, V1 logic, isolation (no network)
npm run test:ui -- <url>           # browser test of the V1 screens on a local-preview build (Playwright)
npm run test:live -- <url>         # two browsers, one shared database (Supabase stand-in, see tools/supabase-standin)
npm run build                      # reads .env.local; local preview if RT_BACKEND is not set
node scripts/build-live-check.mjs  # writes dist/resource-tracker-live-check.html (two-connection live test)
```

## Deploy

GitHub **Actions → Deploy Resource Tracker to GitHub Pages → Run workflow**. Deployment is manual only.
