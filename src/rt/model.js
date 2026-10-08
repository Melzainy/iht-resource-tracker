// Resource Tracker — pure model helpers (no UI, no storage). Standalone: imports nothing from the PM Workflow.

export const STATUSES = ['Not Started', 'In Progress', 'Waiting', 'Blocked', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const THRESHOLDS = { available: 70, near: 90, over: 100 };

// ── Dates & weeks (Monday-based, ISO week numbers) ──────────────────────────
export const toD = (s) => new Date(`${s}T12:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const weekStart = (s) => { const d = toD(s); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return iso(d); };
export function isoWeek(s) { const d = toD(s); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); }
export const weeksFrom = (start, n) => Array.from({ length: n }, (_, i) => addDays(weekStart(start), i * 7));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtD = (s, year = false) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]}${year ? ` ${y}` : ''}`; };
export const wkLabel = (wk) => `W${isoWeek(wk)}`;

// ── Derived lookups ─────────────────────────────────────────────────────────
export function index(db) {
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  return { disc: byId(db.rt_disciplines), person: byId(db.rt_people), project: byId(db.rt_projects), task: byId(db.rt_tasks) };
}
export const sortBy = (arr) => [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || a.title).localeCompare(String(b.name || b.title)));
export const disciplinesOf = (db, all = false) => sortBy(db.rt_disciplines.filter((d) => all || d.active));
export const peopleOf = (db, discId, all = false) => sortBy(db.rt_people.filter((p) => p.discipline_id === discId && (all || p.active)));
export const tasksOf = (db, personId) => [...db.rt_tasks.filter((t) => t.person_id === personId && t.active !== false)]
  .sort((a, b) => (a.due_date || a.start_date || '9999') .localeCompare(b.due_date || b.start_date || '9999') || (a.sort_order ?? 0) - (b.sort_order ?? 0));
export const activeProjects = (db) => sortBy(db.rt_projects.filter((p) => p.active));
// Assignment lists offer active people only (historic tasks keep their inactive person).
export const assignablePeople = (db) => disciplinesOf(db).flatMap((d) => peopleOf(db, d.id).map((p) => ({ ...p, discipline: d.name })));

// ── Dates on a task: which kind of timeline mark it gets ────────────────────
export function dateKind(t) {
  if (t.start_date && t.due_date) return 'bar';
  if (t.due_date) return 'due-only';
  if (t.start_date) return 'start-only';
  return 'none';
}

// ── Weekly load ─────────────────────────────────────────────────────────────
// A task adds its Hrs/Week to every week that intersects Start → Due (both needed).
// Done tasks no longer consume capacity. Missing Hrs/Week is "unestimated", never 0.
export const isOpen = (t) => t.active !== false && t.status !== 'Done';
export function taskWeeks(t, weeks) {
  if (!t.start_date || !t.due_date) return [];
  return weeks.filter((wk) => t.start_date <= addDays(wk, 6) && t.due_date >= wk);
}
export function personLoad(db, personId, weeks) {
  const p = db.rt_people.find((x) => x.id === personId);
  const cap = p?.weekly_capacity_hours ?? null;
  const tasks = db.rt_tasks.filter((t) => t.person_id === personId && isOpen(t));
  return weeks.map((wk) => {
    let h = 0; let unest = 0; const items = [];
    tasks.forEach((t) => {
      const inWeek = t.start_date && t.due_date ? taskWeeks(t, [wk]).length > 0 : relevantUndated(t, wk);
      if (!inWeek) return;
      if (t.hours_per_week == null) { unest++; items.push({ t, h: null }); } else if (t.start_date && t.due_date) { h += t.hours_per_week; items.push({ t, h: t.hours_per_week }); }
    });
    return { wk, h, cap, unest, items, ...statusOf(h, cap, unest) };
  });
}
// Tasks without a full date range: unestimated ones still count against the week of their known
// date (or every week if no date), so they can never make someone look free.
function relevantUndated(t, wk) {
  const d = t.due_date || t.start_date;
  if (!d) return true;
  if (t.due_date && !t.start_date) return t.due_date >= wk; // open until due
  return t.start_date <= addDays(wk, 6);                      // started, no due
}
export function statusOf(h, cap, unest = 0, T = THRESHOLDS) {
  const pct = cap ? Math.round((h / cap) * 100) : null;
  let key; let label;
  if (cap == null || cap === 0) { key = 'nocap'; label = 'Capacity not set'; }
  else if (pct > T.over) { key = 'over'; label = 'Over capacity'; }
  else if (unest > 0) { key = 'unest'; label = 'Workload incomplete'; }
  else if (pct >= T.near) { key = 'near'; label = 'Near capacity'; }
  else if (pct >= T.available) { key = 'bal'; label = 'Balanced'; }
  else { key = 'avail'; label = 'Available'; }
  return { pct, key, label };
}
export function disciplineLoad(db, discId, weeks) {
  const ppl = peopleOf(db, discId);
  return weeks.map((wk, i) => {
    let h = 0; let cap = 0; let unest = 0; let nocap = 0;
    ppl.forEach((p) => { const w = personLoad(db, p.id, [wk])[0]; h += w.h; unest += w.unest; if (p.weekly_capacity_hours) cap += p.weekly_capacity_hours; else nocap++; });
    return { wk, h, cap, unest, nocap, ...statusOf(h, cap || null, unest) };
  });
}
export const MARK = { avail: '○', bal: '●', near: '◆', over: '▲', unest: '?', nocap: '–' };

// ── Issues (always computed from rt_tasks; never stored) ────────────────────
export const isActive = (t) => t.active !== false && t.status !== 'Done';
export const isBlocked = (t) => isActive(t) && t.status === 'Blocked';
export const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 864e5);
export const isOverdue = (t, today) => isActive(t) && !!t.due_date && t.due_date < today;
export const overdueDays = (t, today) => (isOverdue(t, today) ? daysBetween(t.due_date, today) : 0);
export const isDueThisWeek = (t, today) => isActive(t) && !!t.due_date && t.due_date >= weekStart(today) && t.due_date <= addDays(weekStart(today), 6);
export const isDueSoon = (t, today, days = 7) => isActive(t) && !!t.due_date && t.due_date >= today && t.due_date <= addDays(today, days);
export const isUnestimated = (t) => isActive(t) && t.hours_per_week == null;
export const missingDates = (t) => isActive(t) && (!t.start_date || !t.due_date);
// "Needs attention" for the weekly management call.
export function attentionReasons(t, today) {
  const r = [];
  if (isOverdue(t, today)) r.push(`Overdue · ${overdueDays(t, today)}d`);
  if (isBlocked(t)) r.push('Blocked');
  if (isDueSoon(t, today)) r.push(`Due ${t.due_date === today ? 'today' : `in ${daysBetween(today, t.due_date)}d`}`);
  const live = t.status === 'In Progress' || t.priority === 'Critical' || t.priority === 'High';
  if (live && missingDates(t)) r.push(!t.start_date && !t.due_date ? 'Dates not defined' : !t.start_date ? 'Start not defined' : 'Due not defined');
  if (live && isUnestimated(t)) r.push('Unestimated');
  return r;
}
export function personStats(db, personId, today) {
  const ts = db.rt_tasks.filter((t) => t.person_id === personId && t.active !== false);
  const act = ts.filter(isActive);
  const om = overlapMap(act); const overlapping = act.filter((t) => (om[t.id] || []).length).length; const peak = peakConcurrent(act);
  const loads = personLoad(db, personId, weeksFrom(today, 4)); // this week + next 3 (management horizon)
  const wk = loads[0]; const overWk = loads.find((w) => w.key === 'over') || null;
  return { tasks: ts.length, active: act.length, overdue: act.filter((t) => isOverdue(t, today)).length, blocked: act.filter(isBlocked).length,
    unest: act.filter((t) => t.hours_per_week == null).length, dueThisWeek: act.filter((t) => isDueThisWeek(t, today)).length, week: wk, overWk, over: !!overWk, overlapping, peak, om };
}
export function disciplineStats(db, discId, today, all = false) {
  const ppl = db.rt_people.filter((p) => p.discipline_id === discId && (all || p.active || db.rt_tasks.some((t) => t.person_id === p.id)));
  const s = { people: ppl.filter((p) => p.active).length, active: 0, overdue: 0, blocked: 0, unest: 0, dueThisWeek: 0, overPeople: 0, overlapPeople: 0 };
  ppl.forEach((p) => { const x = personStats(db, p.id, today); s.active += x.active; s.overdue += x.overdue; s.blocked += x.blocked; s.unest += x.unest; s.dueThisWeek += x.dueThisWeek; if (x.over && p.active) s.overPeople++; if (x.peak >= 3 && p.active) s.overlapPeople++; });
  return s;
}

// ── Overlap (concurrency) — not an error by itself; distinct from over capacity ──
// Two active tasks overlap when both have Start and Due and their ranges share at least one day.
const dated = (t) => isActive(t) && t.start_date && t.due_date;
export function overlapMap(tasks) {
  const ts = tasks.filter(dated); const m = {};
  ts.forEach((a) => { m[a.id] = ts.filter((b) => b.id !== a.id && a.start_date <= b.due_date && b.start_date <= a.due_date).map((b) => b.id); });
  return m; // id → ids of other tasks it overlaps
}
// Peak number of dated active tasks running on the same day, and the days where ≥2 run.
export function concurrency(tasks, from, to) {
  const ts = tasks.filter(dated); const days = []; let peak = 0;
  for (let d = from; d < to; d = addDays(d, 1)) { const n = ts.filter((t) => t.start_date <= d && t.due_date >= d).length; days.push([d, n]); if (n > peak) peak = n; }
  return { peak, days };
}
export function peakConcurrent(tasks) {
  const ts = tasks.filter(dated); if (!ts.length) return 0;
  return Math.max(...ts.map((a) => ts.filter((b) => b.start_date <= a.start_date && b.due_date >= a.start_date).length));
}
