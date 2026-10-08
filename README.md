# Immersive Homes — Resource Tracker (standalone / temporary)

A shared resource planner for the weekly management call. It uses one live Supabase database, and every change appears in all open browsers via Realtime.

**Live site:** https://melzainy.github.io/iht-resource-tracker/

## Screens

| Screen | Purpose |
|---|---|
| **Planner** | Enter and edit tasks inline (Discipline → Person → tasks), with a compact Gantt beside each row. |
| **Timeline** | Resource analysis on a large Gantt: overlaps, over capacity, Person Focus. |
| **Projects** | The project register. |
| **Team** | Disciplines, people and their weekly capacity. |

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
npm run check                      # model, rollups, store, phase ids, isolation (no network)
npm run build                      # reads .env.local; local preview if RT_BACKEND is not set
node scripts/build-live-check.mjs  # writes dist/resource-tracker-live-check.html (two-connection live test)
```

## Deploy

GitHub **Actions → Deploy Resource Tracker to GitHub Pages → Run workflow**. Deployment is manual only.
