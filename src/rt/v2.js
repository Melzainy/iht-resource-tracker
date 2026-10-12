// Resource Tracker V1 (redesign) — pure helpers for the new screens: Overview, Planner Gantt,
// My Tasks and Check-in. No UI, no storage: everything is computed from the one store's `db`
// (rt_disciplines, rt_people, rt_projects, rt_tasks) and reuses the rules in model.js.
// Hours per week and weekly capacity stay in the database for later; V1 neither shows nor uses them.
import * as M from './model.js';
import { phaseByKey, PM_PHASES } from './pm-phases.js';

// ── Status keys used by the visual layer ────────────────────────────────────
export const ST_KEY = { 'Not Started': 'not', 'In Progress': 'doing', Waiting: 'waiting', Blocked: 'stuck', Done: 'done' };
export const stKey = (s) => ST_KEY[s] || 'none';
export const ST_HINT = { 'In Progress': 'Moving along', Waiting: 'On someone else or on information', Blocked: 'Can’t move until something changes', 'Not Started': 'Haven’t begun yet', Done: 'Finished' };
export const CHECKIN_ORDER = ['In Progress', 'Waiting', 'Blocked', 'Not Started', 'Done'];

// ── Planning data complete: Person + Project + Status + Start + Due ─────────
// Phase, Priority and Notes are optional and never make a task incomplete.
export function planningMissing(t) {
  const m = [];
  if (!t.person_id) m.push('person');
  if (!t.project_id) m.push('project');
  if (!t.status) m.push('status');
  if (!t.start_date) m.push('start date');
  if (!t.due_date) m.push('due date');
  return m;
}
export const isPlanningComplete = (t) => planningMissing(t).length === 0;
const live = (t) => t.active !== false;

// ── Overview ────────────────────────────────────────────────────────────────
export function overviewKpis(db, today) {
  const all = db.rt_tasks.filter(live);
  const open = all.filter(M.isActive);
  const complete = open.filter(isPlanningComplete).length;
  return {
    total: all.length,
    open: open.length,
    blocked: open.filter(M.isBlocked).length,
    late: open.filter((t) => M.isOverdue(t, today)).length,
    done: all.filter((t) => t.status === 'Done').length,
    complete,
    completePct: open.length ? Math.round((complete / open.length) * 100) : 100,
  };
}
export function projectHealth(tasks, today) {
  const open = tasks.filter(M.isActive);
  const bl = open.filter(M.isBlocked).length; const lt = open.filter((t) => M.isOverdue(t, today)).length;
  if (!tasks.length) return { key: 'none', icon: '–', label: 'No tasks yet', why: 'No tasks on this project yet' };
  if (bl) return { key: 'crit', icon: '!', label: 'Blocked', why: `${bl} blocked${lt ? `, ${lt} late` : ''}` };
  if (lt) return { key: 'warn', icon: '!', label: 'At risk', why: `${lt} late` };
  return { key: 'good', icon: '✓', label: 'On track', why: 'Nothing blocked or late' };
}
// The one task a manager should look at next on a project.
export function nextImportant(tasks, today) {
  const open = tasks.filter(M.isActive);
  const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999');
  const bl = open.filter(M.isBlocked).sort(byDue);
  if (bl.length) return { t: bl[0], why: 'Blocked' };
  const lt = open.filter((t) => M.isOverdue(t, today)).sort(byDue);
  if (lt.length) return { t: lt[0], why: `${M.overdueDays(lt[0], today)}d late` };
  const up = open.filter((t) => t.due_date && t.due_date >= today).sort(byDue);
  if (up.length) return { t: up[0], why: dueText(up[0], today).txt };
  return null;
}
export function projectCards(db, today) {
  return M.activeProjects(db).map((p) => {
    const tasks = db.rt_tasks.filter((t) => live(t) && t.project_id === p.id);
    const done = tasks.filter((t) => t.status === 'Done').length;
    const pi = p.phase_key && phaseByKey[p.phase_key] ? PM_PHASES.findIndex((x) => x.key === p.phase_key) : -1;
    return { p, tasks, done, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, health: projectHealth(tasks, today), phaseIndex: pi, next: nextImportant(tasks, today) };
  });
}
export const BUCKETS = [['done', 'Done'], ['doing', 'In progress'], ['waiting', 'Waiting'], ['stuck', 'Blocked'], ['not', 'Not started'], ['none', 'No status']];
export function statusMix(tasks) { const c = Object.fromEntries(BUCKETS.map(([k]) => [k, 0])); tasks.forEach((t) => { c[stKey(t.status)]++; }); return c; }
// Blocked first, then late (most late first).
export function needsAttention(db, today) {
  const open = db.rt_tasks.filter((t) => live(t) && M.isActive(t));
  const bl = open.filter(M.isBlocked);
  const lt = open.filter((t) => M.isOverdue(t, today) && !M.isBlocked(t)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  return [...bl, ...lt];
}

// ── Due text (My Tasks, Check-in, Needs Attention) ──────────────────────────
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dueText(t, today) {
  if (!t.due_date) return { txt: 'No due date', late: false };
  const diff = M.daysBetween(today, t.due_date);
  if (t.status !== 'Done' && diff < 0) return { txt: `${-diff} ${diff === -1 ? 'day' : 'days'} late`, late: true };
  if (diff === 0) return { txt: 'Due today', late: false };
  if (diff === 1) return { txt: 'Due tomorrow', late: false };
  if (diff < 7) return { txt: `Due ${DN[M.toD(t.due_date).getUTCDay()]}`, late: false };
  return { txt: `Due ${M.fmtD(t.due_date)}`, late: false };
}
export const fmtDay = (s) => `${DN[M.toD(s).getUTCDay()]} ${M.fmtD(s)}`;
const nextDow = (today, dow) => { const d = M.toD(today).getUTCDay(); return M.addDays(today, ((dow - d + 7) % 7) || 7); };
export function dueOptions(today) {
  const o = [['Today', today], ['Tomorrow', M.addDays(today, 1)]];
  const fri = M.toD(today).getUTCDay() === 5 ? today : nextDow(today, 5);
  if (fri > M.addDays(today, 1)) o.push(['This Friday', fri]);
  o.push(['Next Friday', M.addDays(fri, 7)]);
  o.push(['In 2 weeks', M.addDays(today, 14)]);
  const [y, m] = today.split('-').map(Number); const eom = M.iso(new Date(Date.UTC(y, m, 0, 12)));
  if (M.daysBetween(M.addDays(today, 14), eom) > 2) o.push([`End of ${M.fmtD(eom).split(' ')[1]}`, eom]);
  return o.map(([label, d]) => ({ label, d }));
}
export function startOptions(today) {
  return [['Today', today], ['Tomorrow', M.addDays(today, 1)], ['Next Monday', nextDow(today, 1)], ['In 2 weeks', M.addDays(today, 14)]].map(([label, d]) => ({ label, d }));
}

// ── My Tasks ────────────────────────────────────────────────────────────────
export function myTasks(db, personId, today) {
  const ts = db.rt_tasks.filter((t) => live(t) && t.person_id === personId);
  const open = ts.filter(M.isActive);
  const weekEnd = M.addDays(M.weekStart(today), 6);
  const groups = [
    ['Late', open.filter((t) => M.isOverdue(t, today))],
    ['This week', open.filter((t) => !M.isOverdue(t, today) && t.due_date && t.due_date <= weekEnd)],
    ['Coming up', open.filter((t) => !M.isOverdue(t, today) && t.due_date && t.due_date > weekEnd)],
    ['No due date yet', open.filter((t) => !t.due_date)],
    ['Done', ts.filter((t) => t.status === 'Done')],
  ].map(([g, l]) => [g, [...l].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))]).filter(([, l]) => l.length);
  const needs = open.filter((t) => !isPlanningComplete(t)).length;
  return { all: ts, open, groups, needs, upToDate: open.length - needs };
}

// ── Check-in: Status → (note if Blocked/Waiting) → Start (if missing) → Due (if missing) ──
// `status` is the value chosen in this check-in (or the task's own); `touched` keeps a step that
// was just answered in the list so it can be revisited.
export function checkinSteps(t, status = t.status, touched = {}) {
  const s = ['status'];
  if (status === 'Blocked' || status === 'Waiting') s.push('note');
  if (status !== 'Done') { if (!t.start_date || touched.start) s.push('start'); if (!t.due_date || touched.due) s.push('due'); }
  return s;
}
export const checkinQueue = (db, personId) => db.rt_tasks.filter((t) => live(t) && t.person_id === personId && M.isActive(t))
  .sort((a, b) => planningMissing(b).length - planningMissing(a).length || (a.due_date || '9999').localeCompare(b.due_date || '9999'));

// ── Planner: tree, filters and KPIs (no capacity analysis in V1) ────────────
export const PLANNER_KPIS = [['active', 'Active tasks', ''], ['overdue', 'Overdue', 'od'], ['blocked', 'Blocked', 'bl'], ['week', 'Due this week', 'wk']];
export const KPI_HELP = { active: 'Tasks that are not Done.', overdue: 'Due date before today and status not Done.', blocked: 'Status is Blocked.', week: 'Open tasks due Monday–Sunday this week.' };
export function kpiTest(k, t, today) {
  if (k === 'active') return M.isActive(t);
  if (k === 'overdue') return M.isOverdue(t, today);
  if (k === 'blocked') return M.isBlocked(t);
  if (k === 'week') return M.isDueThisWeek(t, today);
  return true;
}
// "Attention" in V1: blocked, overdue, due within 7 days, or live work with missing dates. Never hours-based.
export function attention(t, today) {
  const r = [];
  if (M.isBlocked(t)) r.push(['bad', 'Blocked']);
  if (M.isOverdue(t, today)) r.push(['od', `Overdue · ${M.overdueDays(t, today)}d`]);
  else if (M.isDueSoon(t, today)) { const n = M.daysBetween(today, t.due_date); r.push(['warn', n === 0 ? 'Due today' : `Due in ${n}d`]); }
  const liveWork = t.status === 'In Progress' || t.priority === 'Critical' || t.priority === 'High';
  if (liveWork && M.missingDates(t)) r.push(['warn', !t.start_date && !t.due_date ? 'Dates not defined' : !t.start_date ? 'Start not defined' : 'Due not defined']);
  return r;
}
export const plannerFiltering = (f) => !!(f.project || f.phase || f.status || f.priority || (f.q || '').trim() || f.kpi || f.attn);
function taskPasses(t, f, today, ctx) {
  if (f.project && t.project_id !== f.project) return false;
  if (f.phase && (f.phase === '-' ? !!t.phase_key : t.phase_key !== f.phase)) return false;
  if (f.status && (f.status === '-' ? !!t.status : t.status !== f.status)) return false;
  if (f.priority && (f.priority === '-' ? !!t.priority : t.priority !== f.priority)) return false;
  const q = (f.q || '').trim().toLowerCase();
  if (q && !`${t.title} ${ctx.project?.name || ''} ${ctx.person?.name || ''} ${t.notes || ''}`.toLowerCase().includes(q)) return false;
  if (f.kpi && !kpiTest(f.kpi, t, today)) return false;
  if (f.attn && !(M.isActive(t) && attention(t, today).length)) return false;
  return true;
}
// Discipline → Person → Tasks. Inactive people stay visible while they still have tasks (history).
export function plannerTree(db, today, f = {}) {
  const I = M.index(db); const filtering = plannerFiltering(f);
  return M.disciplinesOf(db).filter((d) => !f.disc || d.id === f.disc).map((d) => {
    const people = M.sortBy(db.rt_people.filter((p) => p.discipline_id === d.id && (p.active || db.rt_tasks.some((t) => t.person_id === p.id && live(t)))))
      .filter((p) => !f.person || p.id === f.person)
      .map((p) => {
        const all = M.sortBy(db.rt_tasks.filter((t) => t.person_id === p.id && live(t)));
        const tasks = all.filter((t) => taskPasses(t, f, today, { person: p, project: I.project[t.project_id] }));
        return !filtering || tasks.length ? { p, all, tasks } : null;
      }).filter(Boolean);
    return !filtering || people.length ? { d, people } : null;
  }).filter(Boolean);
}
// KPI counts follow the Discipline / Person / Project filters, not the KPI toggle itself.
export function plannerKpis(db, today, f = {}) {
  const c = Object.fromEntries(PLANNER_KPIS.map(([k]) => [k, 0]));
  plannerTree(db, today, { disc: f.disc, person: f.person, project: f.project }).forEach(({ people }) => people.forEach(({ tasks }) => tasks.forEach((t) => {
    PLANNER_KPIS.forEach(([k]) => { if (kpiTest(k, t, today)) c[k]++; });
  })));
  return c;
}

// ── Gantt geometry (percent of the visible range) and drag date maths ──────
export function ganttRange(today, off = 0, weeks = 8) {
  const r0 = M.addDays(M.weekStart(today), (off - 1) * 7);
  const span = weeks * 7; const r1 = M.addDays(r0, span);
  return { r0, r1, span, weeks: Array.from({ length: weeks }, (_, i) => M.addDays(r0, i * 7)) };
}
export const pctOf = (g, d) => Math.max(0, Math.min(100, (M.daysBetween(g.r0, d) / g.span) * 100));
// Move / resize by whole days. Missing dates stay missing (a due-only task moves its due date only).
export function dragDates(mode, t, delta) {
  const s = t.start_date; const d = t.due_date;
  if (mode === 'move') return { start_date: s ? M.addDays(s, delta) : null, due_date: d ? M.addDays(d, delta) : null };
  if (mode === 'start') { let ns = M.addDays(s, delta); if (d && ns > d) ns = d; return { start_date: ns, due_date: d }; }
  if (mode === 'end') { let nd = M.addDays(d, delta); if (s && nd < s) nd = s; return { start_date: s, due_date: nd }; }
  if (mode === 'due') return { start_date: s, due_date: M.addDays(d, delta) };
  return { start_date: s, due_date: d };
}
export const createRange = (a, b) => (a <= b ? { start_date: a, due_date: b } : { start_date: b, due_date: a });
// Summary rows draw the most urgent work on top.
const RANK = { done: 0, none: 1, not: 1, doing: 2, waiting: 3, stuck: 5 };
export const summaryOrder = (tasks, today) => tasks.filter((t) => t.start_date || t.due_date)
  .map((t) => ({ t, late: M.isOverdue(t, today), r: M.isOverdue(t, today) && !M.isBlocked(t) ? 4 : RANK[stKey(t.status)] }))
  .sort((a, b) => a.r - b.r);

// ── Project phase on rt_projects (needs the phase_key column; see supabase/migrations) ──
// Supabase returns every column, so the column exists when loaded rows carry the key.
export const projectPhaseSupported = (db, adapterName) => adapterName === 'local' || db.rt_projects.some((p) => Object.prototype.hasOwnProperty.call(p, 'phase_key'));
