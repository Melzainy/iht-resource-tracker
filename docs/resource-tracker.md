# Resource Tracker (standalone / temporary)

A small company planning tool inside the prototype website. It is **not** part of the PM Workflow and shares no data with it.

- Entry: **Resource Tracker** button in the header (or `#/tracker`).
- Screens: Timeline (default) · Tasks · Projects · Team.
- Datastore: `rt_disciplines`, `rt_people`, `rt_projects`, `rt_tasks`. All screens read one store (`src/rt/store.js`).
- Data layer: `src/rt/adapters/local.js` (local preview, seeded from the Excel import, synced across tabs of the same browser) or `src/rt/adapters/supabase.js` (Stage B, Realtime).

## Files

| File | Purpose |
|---|---|
| `scripts/rt_import.py` | Deterministic Excel → seed import (`python3 scripts/rt_import.py <workbook.xlsx>`) |
| `src/rt/seed.json` | Imported seed |
| `docs/rt-import-report.md` | Import report |
| `src/rt/model.js` | Weeks, load and status rules |
| `src/rt/store.js` | The single store and its validated actions |
| `src/rt/RT.jsx` | Screens |
| `supabase/rt_schema.sql` | Draft schema, temporary no-auth policies and Realtime (not applied) |
| `scripts/rt-check.mjs` | Checks (also run by `npm run check`) |

## Rules

- **Weekly load:** a task adds its Hrs / Week to every week that intersects Start → Due. Done tasks don't count.
- **Missing Hrs / Week = unestimated:** never 0. Any unestimated open task marks that week "Workload incomplete" unless the person is already over capacity.
- **Status thresholds:** Available < 70% · Balanced 70–89% · Near capacity 90–100% · Over capacity > 100%.
- **Inactive people:** they leave assignment lists, but their tasks stay visible.
- **Projects:** a project with tasks can only be archived, never deleted.

## Revision 2 (v4 workbook)

- Re-imported from `Immersive_Homes_Resource_Planner_v4.xlsx`. The only data change from v3 is row 8: Mansour's "Radiant floor detail and nested Revit family" is now Waiting / High.
- **Issues are computed, never stored** (`src/rt/model.js`, `src/rt/hier.js`). Overdue means `due_date < today` and status is not Done. Blocked means status = Blocked. Rollups run Task → Person → Discipline → Company.
- **Timeline** is a Gantt. It has a KPI strip (each card toggles a filter), an All | Needs Attention switch, and 4/8/12 weeks with Today / Previous / Next. It shows a Today line and current-week highlight, and an overdue extension that runs from Due to Today. Blocked tasks get a hatched bar and the text "⚠ BLOCKED". Hovering a task shows its details; clicking opens the edit panel.
- **Tasks** opens on the Hierarchy view (Discipline → Person → Tasks); a Table view is available. Filters narrow the hierarchy rather than flattening it. Each person has "+ Add Task for <person>".
- The local preview data key is now `rt-local-v2`, so browsers that opened the earlier preview load the new import.

## Revision 3 — Planner (one screen)

- Navigation is now **Planner | Projects | Team**. Planner replaces the separate Tasks and Timeline screens and keeps all their functions: hierarchy, KPI strip, All | Needs Attention, filters, Expand/Collapse All, 4/8/12 weeks with Today/Previous/Next, and the Gantt rules.
- Each task is one **inline-editable row** (Project, Task, Start, Due, Hrs/Wk, Status, Priority, Notes) lined up with its Gantt marks. Lists save when you choose a value. Text, dates and hours save on Enter or when you leave the cell. Esc reverts the cell, or cancels a new blank row. The Gantt redraws while you edit dates; workload and rollups update on save.
- **+ Add Task** under a person adds a blank row with the Project field focused. The row is saved as soon as it has a project and a task name.
- Rows keep workbook / entry order (`sort_order`), so they never jump while you edit.
- The ⋯ menu on a row offers **More details**, which opens the old drawer (optional), and **Delete task**, which asks for confirmation.
- Below 1180 px of grid width the Priority and Notes columns are hidden; they remain available through More details. Below 860 px the left columns stop being sticky and the whole grid scrolls inside its own box.

## Revision 4 — Planner + Timeline, calendar picker, Phase, overlaps

- Navigation is now **Planner | Timeline | Projects | Team**. Planner and Timeline share the same filters, Needs Attention mode, range and period.
- **Planner** is for editing. Start and Due open a compact calendar: one click picks a date, with previous/next month, Today, Clear and a box for typing a date. Choosing a date saves it immediately and the bar moves at once.
- **Timeline** is for analysis, using the same visual language as the PM Workflow Master Timeline: month and week header, faint grid, current-week band, Today line, floating bars, and summary bars on discipline and person rows.
  - "Only" expands a single discipline.
  - "⤢ Focus" opens Person Focus: weekly load (known hours / capacity, OVER CAPACITY), concurrency bands, and lanes grouped into Scheduled / One date / No dates / Done. "← Back to <discipline>" returns to the tree.
- **Phase**: `rt_tasks.phase_key` holds the PM Workflow phase id (`PH1`…`PH6`) and is nullable. Imported tasks are "Not assigned"; phases are never guessed. The list is read from the PM template by `src/rt/pm-phases.js`, the only file that touches PM code, and only to read the phase list. Phase is classification metadata only; nothing is synchronised yet. There is a Phase filter on Planner and Timeline. Bars are not coloured by phase.
- **Overlap vs capacity**: two active tasks overlap when their Start→Due ranges share a day. Overlap alone is not an error.
  - **Over capacity** is when known hours in a week exceed capacity. It is evaluated for this week and the next 3.
  - When the overlapping tasks have no hours, the person shows "capacity cannot be fully evaluated" rather than an invented figure.
  - Needs Attention includes tasks running alongside 2 or more others.
- Supabase draft schema: added `rt_tasks.phase_key text` (nullable).

## Revision 5 — V1 redesign (branch `redesign/resource-tracker-v2`)

- **Visual and UX** follow the approved prototype (`ih-resource-tracker-prototype.html`): Gantari type, olive palette, light / dark mode with a switch (saved per browser; first visit follows the system), responsive down to phone width. The prototype banner (sample data / Example hours / Reset) is not in production; live save / connection status is a small indicator in the top bar, and save errors still show prominently.
- **Data is unchanged.** Every screen reads the one store (`src/rt/store.js`) and saves through its validated actions → Supabase adapter → Realtime. The prototype's localStorage datastore was not copied; only view preferences (theme, chosen name, view, Gantt range) live in the browser. UUID relationships, null-for-missing, permanent `phase_key` ids, overdue / blocked rules, archive and deactivate behaviour are the existing ones.
- **Navigation:** Overview · Planner · Settings, plus My tasks. The Timeline, Projects and Team screens are folded into Overview, Planner and Settings. Capacity / over-capacity / overlap analysis is not shown in V1 (`model.js` keeps it for later).
- **Planner:** KPI strip (Active · Overdue · Blocked · Due this week, click to filter), discipline chips, All / Attention, search, Filters panel, 4 / 8 / 12 weeks, Details (all fields), Expand / Collapse all, "Add task for…". People start collapsed. Summary rows draw every task in its status colour with overdue boxes and a ⚠ label. Gantt drag saves through `store.saveTask`; a due-only task stays due-only (Start is never invented). The existing calendar picker is unchanged (`src/rt/DatePick.jsx`).
- **Attention (V1):** blocked, overdue, due within 7 days, or live work (In Progress / High / Critical) with missing dates. Never hours-based.
- **Check-in:** Status → blocker / waiting note → Start (if missing) → Due (if missing).
- **No hours or capacity in V1:** Hrs/Wk, Unestimated and weekly capacity are not shown anywhere (Planner, My tasks, task quick-edit, Check-in, Settings → People). The columns `rt_tasks.hours_per_week` and `rt_people.weekly_capacity_hours` are kept, not migrated, and carried through unchanged when a task or person is edited.
- **Project phase:** Settings shows each project's current phase (permanent id) and Overview cards show it. It needs `supabase/migrations/2026-10-12_rt_projects_phase_key.sql`; until that runs the column is never sent and the field shows as needing the database update.
- **Pure logic** for the new screens is in `src/rt/v2.js` and covered by `npm run check`.
