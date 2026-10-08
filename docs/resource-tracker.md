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
