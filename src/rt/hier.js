// Resource Tracker — hierarchy, filters, KPIs and rollups shared by the Planner and Timeline
// screens. Pure functions over the one datastore (no UI state, no copies of the data).
import * as M from './model.js';

export const KPIS = [
  ['active', 'Active Tasks'], ['overdue', 'Overdue'], ['blocked', 'Blocked'],
  ['week', 'Due This Week'], ['over', 'Over Capacity · Next 4 Weeks', 'people'], ['unest', 'Unestimated'],
];
export const KPI_HELP = {
  active: 'Tasks that are not Done.',
  overdue: 'Due date before today and status not Done.',
  blocked: 'Status = Blocked.',
  week: 'Active tasks due Monday–Sunday of the current week.',
  over: 'People whose known Hrs/Week exceed their weekly capacity in any week from this week through the next 3 weeks (4 weeks). Tasks without Hrs/Week are not counted, so this can understate load.',
  unest: 'Active tasks with no Hrs/Week entered.',
};
// Task-level filters (they hide people/disciplines without matching tasks).
export const taskFiltering = (f) => !!(f.project || f.phase || f.status || f.priority || f.q || f.kpi || f.mode === 'attention');
// Meaningful overlap for Needs Attention: the task runs alongside 2+ other active tasks.
export const heavyOverlap = (t, om) => (om?.[t.id]?.length || 0) >= 2;

function taskPass(t, f, today, ctx) {
  if (f.project && t.project_id !== f.project) return false;
  if (f.phase && (f.phase === '-' ? !!t.phase_key : t.phase_key !== f.phase)) return false;
  if (f.status && (f.status === '-' ? !!t.status : t.status !== f.status)) return false;
  if (f.priority && (f.priority === '-' ? !!t.priority : t.priority !== f.priority)) return false;
  if (f.q) { const hay = `${t.title} ${ctx.project?.name || ''} ${ctx.person?.name || ''} ${t.notes || ''}`.toLowerCase(); if (!hay.includes(f.q.trim().toLowerCase())) return false; }
  if (f.kpi === 'active' && !M.isActive(t)) return false;
  if (f.kpi === 'overdue' && !M.isOverdue(t, today)) return false;
  if (f.kpi === 'blocked' && !M.isBlocked(t)) return false;
  if (f.kpi === 'week' && !M.isDueThisWeek(t, today)) return false;
  if (f.kpi === 'unest' && !M.isUnestimated(t)) return false;
  if (f.kpi === 'over' && !(ctx.over && M.isActive(t))) return false;
  if (f.mode === 'attention' && !(M.attentionReasons(t, today).length || (ctx.over && M.isActive(t)) || heavyOverlap(t, ctx.om))) return false;
  return true;
}

// Discipline → Person → Tasks, filtered but never flattened.
export function buildTree(db, today, f = {}) {
  const I = M.index(db);
  const filtering = taskFiltering(f);
  return M.disciplinesOf(db).filter((d) => !f.disc || d.id === f.disc).map((d) => {
    const people = M.sortBy(db.rt_people.filter((p) => p.discipline_id === d.id && (p.active || db.rt_tasks.some((t) => t.person_id === p.id && t.active !== false))))
      .filter((p) => !f.person || p.id === f.person)
      .map((p) => {
        const stats = M.personStats(db, p.id, today);
        const all = M.sortBy(db.rt_tasks.filter((t) => t.person_id === p.id && t.active !== false)); // workbook / entry order: rows never jump while editing
        const tasks = all.filter((t) => taskPass(t, f, today, { person: p, project: I.project[t.project_id], over: stats.over, om: stats.om }));
        const show = !filtering || tasks.length > 0 || ((f.kpi === 'over' || f.mode === 'attention') && stats.over && !f.project && !f.phase && !f.q && !f.status && !f.priority);
        return show ? { p, stats, tasks, total: all.length } : null;
      }).filter(Boolean);
    const show = filtering ? people.length > 0 : true;
    return show ? { d, stats: M.disciplineStats(db, d.id, today), people } : null;
  }).filter(Boolean);
}

// KPI counts respect the Discipline / Person / Project filters (not the KPI toggle itself).
export function kpiCounts(db, today, f = {}) {
  const tree = buildTree(db, today, { disc: f.disc, person: f.person, project: f.project });
  const c = { active: 0, overdue: 0, blocked: 0, week: 0, over: 0, unest: 0 };
  tree.forEach(({ people }) => people.forEach(({ p, stats, tasks }) => {
    tasks.forEach((t) => { if (M.isActive(t)) c.active++; if (M.isOverdue(t, today)) c.overdue++; if (M.isBlocked(t)) c.blocked++; if (M.isDueThisWeek(t, today)) c.week++; if (M.isUnestimated(t)) c.unest++; });
    if (p.active && stats.over) c.over++;
  }));
  return c;
}

// Text helpers used by both screens.
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function personHeadline(s) {
  const w = s.week;
  const hrs = `${Math.round(w.h * 10) / 10} / ${w.cap} h`;
  if (s.overWk) { const o = s.overWk; return { key: 'over', text: `⚠ Over capacity ${M.wkLabel(o.wk)} · ${Math.round(o.h * 10) / 10} / ${o.cap} h` }; }
  if (w.key === 'nocap') return { key: 'nocap', text: 'Capacity not set' };
  if (s.unest > 0) return { key: 'unest', text: w.h ? `Workload incomplete · ${hrs} estimated` : 'Workload incomplete' };
  return { key: w.key, text: `${hrs} · ${w.pct}% · ${w.label}` };
}
export function personLine(s) {
  return `${plural(s.active, 'active task')}${s.unest ? ` · ${s.unest} unestimated` : ''}`;
}
export function disciplineIssues(s) {
  const out = [];
  if (s.blocked) out.push(['bad', `${s.blocked} blocked`]);
  if (s.overdue) out.push(['bad', `${s.overdue} overdue`]);
  if (s.overPeople) out.push(['bad', `${plural(s.overPeople, 'person', 'people')} over capacity`]);
  if (s.overlapPeople) out.push(['warn', `${plural(s.overlapPeople, 'person', 'people')} with 3+ concurrent tasks`]);
  if (s.unest) out.push(['warn', `${s.unest} unestimated`]);
  return out;
}
export const dateRange = (t) => (!t.start_date && !t.due_date ? 'Dates not defined'
  : `${t.start_date ? M.fmtD(t.start_date) : 'Start not defined'} → ${t.due_date ? M.fmtD(t.due_date) : 'Due not defined'}`);

// Overlap vs capacity message for a person (overlap alone is not an error).
export function overlapNote(s) {
  const w = s.week;
  if (s.overWk) { const o = s.overWk; return { key: 'over', text: `⚠ Over capacity ${M.wkLabel(o.wk)} · ${Math.round(o.h * 10) / 10} / ${o.cap} h` }; }
  if (s.peak >= 2 && s.unest > 0) return { key: 'unest', text: `${s.peak} concurrent tasks · capacity cannot be fully evaluated — ${s.unest} unestimated` };
  if (s.peak >= 2) return { key: 'ov', text: `${s.peak} concurrent tasks` };
  return null;
}
