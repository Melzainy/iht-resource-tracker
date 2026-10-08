# Resource Tracker — Supabase setup (Stage B)

This guide connects the standalone Resource Tracker to one shared Supabase database. Everyone who opens the Resource Tracker link then reads and edits the same records, and changes appear in every open browser within about a second.

The PM Workflow prototype is not touched. It does not use Supabase and keeps its own data.

---

## 1. Create the Supabase account and project (about 5 minutes)

1. **Go to** https://supabase.com and click **Start your project** (top right).
   - Sign in with **GitHub** or with **email**. If you sign in with GitHub, use the account that will later host the site.
2. **Create an organization** if asked:
   - **Name:** `Immersive Home Technologies`
   - **Type:** Company
   - **Plan:** Free (see the note on pausing below)
3. Click **New project** and fill in:

   | Field | Value |
   |---|---|
   | Organization | Immersive Home Technologies |
   | Project name | `iht-resource-tracker` |
   | Database password | Click **Generate a password**, then **copy it into your password manager**. I do not need it, and it must never be sent to anyone or put in code. |
   | Region | **East US (North Virginia)**. This is closest to the Michigan office and fine for the overseas team members. |
   | Security / Data API options | Leave the defaults. The Data API must stay enabled. |

4. Click **Create new project** and wait 1–2 minutes until the dashboard shows the project as healthy.

> **Free plan pausing:** Supabase pauses a Free project after 7 days of low activity. The data is kept, and you restore it with **Resume project** on the project page.
>
> Daily use during the management call is normally enough to prevent this. If the tracker becomes business-critical, upgrade the organization to **Pro** so it never pauses.

## 2. Create the tables (SQL Editor)

1. In the left sidebar, open **SQL Editor** (the `>_` icon).
2. Click **+ New query**.
3. Paste the whole content of **`supabase/rt_schema.sql`** and click **Run** (or press Ctrl + Enter). The result should be **"Success. No rows returned"**.
   - Notices such as *"relation … does not exist, skipping"* are normal.
4. The schema creates:
   - **4 tables:** `rt_disciplines`, `rt_people`, `rt_projects`, `rt_tasks`. The PM Workflow is not touched.
   - **Checks enforced by the database:**
     - Status and Priority must come from their fixed lists.
     - Hrs/Week must be blank or between 0 and 80. Blank means "Unestimated", never 0.
     - Due cannot be before Start.
     - `phase_key` must be one of the six permanent PM Workflow phase ids.
   - **Access for the browser key:**
     - Allowed: read, add and edit all four tables, and delete tasks.
     - A project can be deleted only if no task uses it; otherwise it is archived.
     - People and disciplines can never be deleted, only deactivated.
   - **Realtime** is switched on for the four tables.

## 3. Load the Excel data

1. Open **SQL Editor → + New query** again.
2. Paste **`supabase/rt_seed.sql`** and click **Run**.
3. This loads the v4 workbook import plus Amin, Team US and Abhishek:
   - 10 disciplines
   - 27 people
   - 4 projects
   - 46 tasks
4. The rows keep the same ids the local preview used. Running the seed a second time skips existing rows, so it never duplicates data and never overwrites live edits.
5. **Check it:** open a new query, paste **`supabase/rt_verify.sql`** and click **Run**. Expected result:

| disciplines | people | projects | tasks | missing start | missing due | missing hrs | realtime tables | rls enabled | policies |
|---|---|---|---|---|---|---|---|---|---|
| 10 | 27 | 4 | 46 | 38 | 32 | 46 | 4 | 4 | 14 |

> Edits made in the old local preview live only in that browser and are **not** copied to Supabase. The live database starts from the Excel import.

## 4. Copy the two values I need

1. In the left sidebar, open **Project Settings** (gear icon) → **API Keys**.
2. Copy the **Publishable key**. It starts with `sb_publishable_…`.
3. Open **Connect** (top of the project page), or **Project Settings → Data API**, and copy the **Project URL**. It looks like `https://abcdefghijklmnop.supabase.co`.

Send me only these two values: **Project URL** and **Publishable key**.

> **Never** copy or send the **Secret key** (`sb_secret_…`) or the legacy **service_role** key. They bypass every access rule. If one is ever pasted somewhere by mistake, use **Roll** next to it on the API Keys page to replace it.
>
> The publishable key is designed to be visible in a web page. It only allows what the database rules above allow.

## 5. Where the values go (I do this)

**Locally,** the values go in a file called `.env.local` in the project folder. It is listed in `.gitignore`, so it is never committed:

```
RT_BACKEND=supabase
RT_SUPABASE_URL=https://<project-ref>.supabase.co
RT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

- `npm run build` reads `.env.local` and writes a small `window.RT_CONFIG` block into `dist/index.html`.
- **The build stops** if the key is a secret key or a legacy `service_role` key, or if the URL is not a Supabase URL.
- **The app also refuses such a key at runtime** and shows a configuration error instead of loading.
- **Without `.env.local`**, the build is the local preview, as before.

**For GitHub Pages later** (not now), the same two values become repository **Actions variables**, not secrets, because they are public by design. The manual `workflow_dispatch` deploy stays as it is.

## 6. How live editing and Realtime work

- **Loading:** when the page opens, it loads the four tables from Supabase. The header shows **"Live — changes sync to everyone with this link"**.
- **Every edit** goes through the same store whatever screen it is made on: an inline Planner cell, a Projects or Team form, or the More details drawer.
  1. The change shows immediately in your browser.
  2. It is saved to Supabase. The header shows **Saving…**, then **All changes saved · hh:mm**.
  3. The database's stored row, including its own `updated_at`, replaces the local copy.
- **Realtime (Supabase `postgres_changes`)** sends every insert, update and delete on the four `rt_*` tables to every open browser. Planner, Timeline, rollups, KPIs, dropdowns and filters all recalculate from those same records.
- **Two people editing the same task** each save only the fields they changed, so edits to different fields of one task are both kept. If two people change the same field, the last save wins.
- **A field you are editing** keeps your typing; incoming changes to the other fields of that row still appear.
- **Connection lost:** the header turns red ("Connection lost — reconnecting…"). When it reconnects, the page reloads all records, so nothing changed in the meantime is missed.
  - Supabase also closes public Realtime connections after 24 hours; the page reconnects automatically.
- **Refused changes:** if the database refuses a change (for example a rule above), the error is shown and the screen is refreshed from the database.

## 7. Two-browser verification (after the values are in)

Open the Resource Tracker in two different browsers (for example Chrome and Edge), or on two computers. Then:

1. **A** adds a task under Mai. → **B** sees it.
2. **B** changes its Due date. → **A** updates.
3. **A** adds a project. → it appears in **B**'s Projects list, every Project dropdown and the filters.
4. **B** adds a person in Architecture. → it appears in **A**'s Planner, Timeline, Team and assignment list.
5. **A** moves that person to Team US. → **B** sees them move.
6. **B** enters Hrs/Week. → **A**'s workload percentages and Timeline bar update.
7. **A** sets the Phase. → the Phase filter in **B** finds the task.
8. **B** sets the status to Blocked. → **A**'s blocked counts update for Mai, Interior Design and the KPI.
9. **A** makes the task overdue. → **B** shows "Overdue · Nd" and the counts update.
10. **B** deactivates the test person. → **A** no longer offers them for new tasks, and their history stays.
11. **Reload both browsers.** Everything is still there.
12. **Clean up:** delete the test task (⋯ → Delete task), archive the test project and leave the test person deactivated.

## 8. Security, plainly

There is no login yet. Anyone who has the page link can read and edit the Resource Tracker; the publishable key is inside the page.

- **Limited to the tracker:** that access covers only these four tables. It is not access to anything else in Supabase, and not to the PM Workflow.
- **What to keep out of it:** do not put confidential client contact details, salaries or HR information in the tracker while it has no login.
- **Before sharing the link widely:** add Supabase Auth (company email sign-in) and change the policies to `authenticated` only. The tables do not need to change for this.
