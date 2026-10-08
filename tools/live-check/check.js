// Resource Tracker — LIVE verification against the real Supabase project.
// Two completely independent connections ("browser A" and "browser B": separate Supabase clients,
// separate Realtime websockets, separate in-memory stores) run the app's OWN data layer
// (src/rt/store.js + adapters/supabase.js + model/hier rollups). A third fresh connection checks persistence.
// Touches only records it creates (names start with "ZZ Live Check"); cleans up at the end.
import { createClient } from '@supabase/supabase-js';
import { createStore } from '../../src/rt/store.js';
import { supabaseAdapter } from '../../src/rt/adapters/supabase.js';
import { keyProblem } from '../../src/rt/config.js';
import * as M from '../../src/rt/model.js';
import * as H from '../../src/rt/hier.js';

const CFG = window.RT_CONFIG || {};
const out = document.getElementById('out'); const sum = document.getElementById('sum');
const results = [];
const line = (ok, label, detail = '') => { results.push({ ok, label, detail }); const r = document.createElement('div'); r.className = ok ? 'ok' : 'bad'; r.textContent = `${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`; out.appendChild(r); };
const note = (t) => { const r = document.createElement('div'); r.className = 'note'; r.textContent = t; out.appendChild(r); };
const must = (r, what) => { if (!r || !r.ok) throw new Error(`${what} refused: ${r?.error || 'no result'}`); return r; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = performance.now(); for (;;) { try { if (fn()) return Math.round(performance.now() - t0); } catch (e) { /* retry */ } if (performance.now() - t0 > ms) return null; await sleep(40); } };
const client = () => createClient(CFG.supabaseUrl, CFG.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const connStore = async (c) => { const s = createStore(supabaseAdapter({ client: c })); await s.init(); await until(() => s.connection === 'live', 15000); return s; };
const today = new Date().toISOString().slice(0, 10); const add = (n) => M.addDays(today, n);
const lat = [];

async function run() {
  const problem = !CFG.supabaseUrl ? 'No Supabase URL configured' : keyProblem(CFG.supabasePublishableKey);
  if (problem) { line(false, 'Configuration', problem); return; }
  note(`Project: ${CFG.supabaseUrl} · publishable key ${CFG.supabasePublishableKey.slice(0, 18)}… · ${new Date().toLocaleString()}`);
  const cA = client(); const cB = client();
  let A; let B;
  try { [A, B] = await Promise.all([connStore(cA), connStore(cB)]); } catch (e) { line(false, 'Load from Supabase', e.message); return; }
  const n = (s) => ['rt_disciplines', 'rt_people', 'rt_projects', 'rt_tasks'].map((t) => s.db[t].length);
  const [d, p, j, t] = n(A);
  line(d >= 10 && p >= 27 && j >= 4 && t >= 46, '1. Existing data loads from Supabase', `${d} disciplines · ${p} people · ${j} projects · ${t} tasks (seed: 10 · 27 · 4 · 46)`);
  const seedIds = ['b97358db-a843-5b1b-b4c0-93700c537116']; // Company Management (Excel import id)
  line(seedIds.every((id) => A.db.rt_disciplines.some((x) => x.id === id)) && A.db.rt_tasks.filter((x) => x.source_row).length >= 46, '   Excel-import ids and rows present (not reseeded)', `${A.db.rt_tasks.filter((x) => x.source_row).length} tasks with an Excel source row`);
  line(A.connection === 'live' && B.connection === 'live', '   Realtime connected in both A and B', `A ${A.connection} · B ${B.connection}`);
  const D = (s, name) => s.db.rt_disciplines.find((x) => x.name === name);
  const stamp = Date.now().toString(36).toUpperCase();
  const PJ = `ZZ Live Check Project ${stamp}`; const PN = `ZZ Live Check Person ${stamp}`;
  const created = { tasks: [], project: null, person: null };
  try {
    // 7. project
    let r = A.saveProject({ name: PJ, status: 'Active' }); created.project = r.row?.id;
    let ms = await until(() => B.db.rt_projects.some((x) => x.id === created.project) && M.activeProjects(B.db).some((x) => x.name === PJ)); lat.push(ms);
    line(r.ok && ms !== null, '7. A adds a project → B has it (Planner project dropdowns + filters read this list)', ms !== null ? `${ms} ms` : 'not received');
    // 8. person
    r = A.savePerson({ name: PN, discipline_id: D(A, 'Architecture').id, role: 'Verification', weekly_capacity_hours: 40 }); created.person = r.row?.id;
    ms = await until(() => M.peopleOf(B.db, D(B, 'Architecture').id).some((x) => x.id === created.person) && M.assignablePeople(B.db).some((x) => x.id === created.person)); lat.push(ms);
    line(r.ok && ms !== null, '8. A adds a person in Architecture → B shows them under Architecture (Planner + Timeline use this tree)', ms !== null ? `${ms} ms` : 'not received');
    // 4. task
    r = A.saveTask({ person_id: created.person, project_id: created.project, title: 'ZZ live task 1', start_date: add(2), due_date: add(9), status: 'Not Started', priority: 'Medium' }); const t1 = r.row?.id; created.tasks.push(t1);
    ms = await until(() => B.db.rt_tasks.some((x) => x.id === t1)); lat.push(ms);
    line(r.ok && ms !== null, '4. A adds a task → B sees it via Realtime', ms !== null ? `${ms} ms` : 'not received');
    // 5. due edit in B
    const bt = () => B.db.rt_tasks.find((x) => x.id === t1); const at = () => A.db.rt_tasks.find((x) => x.id === t1);
    must(B.saveTask({ ...bt(), due_date: add(16) }), 'B due edit');
    ms = await until(() => at()?.due_date === add(16)); lat.push(ms);
    line(ms !== null, '5. B edits the Due date → A updates', ms !== null ? `${ms} ms` : `A has ${at()?.due_date}`);
    // 6. every field
    const fields = [['start_date', add(3)], ['phase_key', 'phase-coordinated-design'], ['status', 'In Progress'], ['priority', 'High'], ['notes', 'Live check note'], ['hours_per_week', 25]];
    for (const [k, v] of fields) {
      const [from, to] = k === 'phase_key' || k === 'hours_per_week' ? [B, A] : [A, B];
      const cur = from.db.rt_tasks.find((x) => x.id === t1); must(from.saveTask({ ...cur, [k]: v }), `${k} edit`);
      ms = await until(() => to.db.rt_tasks.find((x) => x.id === t1)?.[k] === v); lat.push(ms);
      line(ms !== null, `6. ${k} = ${v} propagates (${from === A ? 'A → B' : 'B → A'})`, ms !== null ? `${ms} ms` : `other side has ${to.db.rt_tasks.find((x) => x.id === t1)?.[k]}`);
    }
    // 11. rollups: overlap + over capacity (known hours), unestimated, blocked, overdue
    r = A.saveTask({ person_id: created.person, project_id: created.project, title: 'ZZ live task 2', start_date: add(4), due_date: add(12), hours_per_week: 20, status: 'In Progress' }); const t2 = r.row?.id; created.tasks.push(t2);
    ms = await until(() => { const s = M.personStats(B.db, created.person, today); return s.over && s.peak >= 2; }); lat.push(ms);
    const sB = M.personStats(B.db, created.person, today);
    line(ms !== null, '11. Overlap + Over Capacity recalculate in B (25 h + 20 h on overlapping dates, 40 h capacity)', `${H.overlapNote(sB)?.text} · peak ${sB.peak} concurrent`);
    r = A.saveTask({ person_id: created.person, project_id: created.project, title: 'ZZ live task 3 (no hours)', start_date: add(5), due_date: add(6), status: 'Blocked', notes: 'Live check blocker' }); const t3 = r.row?.id; created.tasks.push(t3);
    r = A.saveTask({ person_id: created.person, project_id: created.project, title: 'ZZ live task 4 (overdue)', due_date: add(-2), status: 'In Progress' }); const t4 = r.row?.id; created.tasks.push(t4);
    ms = await until(() => { const s = M.personStats(B.db, created.person, today); return s.blocked === 1 && s.overdue === 1 && s.unest === 2; }); lat.push(ms);
    const s2 = M.personStats(B.db, created.person, today); const dB = M.disciplineStats(B.db, D(B, 'Architecture').id, today);
    line(ms !== null && dB.blocked >= 1 && dB.overdue >= 1, '11. Blocked / overdue / unestimated roll up to person and discipline in B', `person: ${s2.blocked} blocked · ${s2.overdue} overdue (${M.overdueDays(B.db.rt_tasks.find((x) => x.id === t4), today)}d) · ${s2.unest} unestimated · Architecture: ${dB.blocked} blocked · ${dB.overdue} overdue`);
    // 13. phase filter
    const ph = H.buildTree(B.db, today, { phase: 'phase-coordinated-design' }).flatMap((x) => x.people.flatMap((y) => y.tasks.map((z) => z.id)));
    line(ph.includes(t1) && !ph.includes(t2), '13. Phase filter (permanent id phase-coordinated-design) finds the task in B', `${ph.length} task(s) in that phase`);
    // 12. focus data (what Person Focus renders)
    const om = M.overlapMap(B.db.rt_tasks.filter((x) => x.person_id === created.person && M.isActive(x)));
    line((om[t1] || []).includes(t2), '12. Person Focus data: overlapping tasks detected for the person', `task 1 overlaps ${om[t1]?.length || 0} task(s)`);
    // 9. move discipline
    must(A.savePerson({ ...A.db.rt_people.find((x) => x.id === created.person), discipline_id: D(A, 'Team US').id }), 'move person');
    ms = await until(() => M.peopleOf(B.db, D(B, 'Team US').id).some((x) => x.id === created.person) && !M.peopleOf(B.db, D(B, 'Architecture').id).some((x) => x.id === created.person)); lat.push(ms);
    line(ms !== null, '9. A moves the person to Team US → B shows them under Team US', ms !== null ? `${ms} ms` : 'not received');
    // 15. reconnect
    cB.realtime.disconnect(); await until(() => B.connection !== 'live', 8000);
    must(A.saveTask({ ...A.db.rt_tasks.find((x) => x.id === t1), notes: 'Changed while B was offline' }), 'offline edit');
    await sleep(1500);
    const missed = B.db.rt_tasks.find((x) => x.id === t1)?.notes !== 'Changed while B was offline';
    cB.realtime.connect();
    ms = await until(() => B.connection === 'live' && B.db.rt_tasks.find((x) => x.id === t1)?.notes === 'Changed while B was offline', 20000);
    line(missed && ms !== null, '15. B disconnects, A edits, B reconnects and catches up', ms !== null ? `B status back to live and up to date after ${ms} ms` : `B status ${B.connection}`);
    // 10. deactivate
    A.setPersonActive(created.person, false);
    ms = await until(() => !M.assignablePeople(B.db).some((x) => x.id === created.person) && B.db.rt_tasks.filter((x) => x.person_id === created.person).length === 4); lat.push(ms);
    line(ms !== null, '10. A deactivates the person → B: not assignable, historic tasks kept', ms !== null ? `${ms} ms · 4 tasks kept` : 'not received');
    // 14. persistence: brand-new connection
    await until(() => !A.saving && !B.saving, 8000); await sleep(400);
    const C = await connStore(client()); const ct = C.db.rt_tasks.find((x) => x.id === t1); const cp = C.db.rt_people.find((x) => x.id === created.person);
    const okP = ct && ct.start_date === add(3) && ct.due_date === add(16) && ct.phase_key === 'phase-coordinated-design' && ct.status === 'In Progress' && ct.priority === 'High' && ct.hours_per_week === 25 && ct.notes === 'Changed while B was offline' && cp && cp.active === false && cp.discipline_id === D(C, 'Team US').id;
    line(!!okP, '14. Fresh connection (= reload) reads every change from the database', ct ? `start ${ct.start_date} · due ${ct.due_date} · ${ct.hours_per_week} h · ${ct.status} · ${ct.priority} · ${ct.phase_key}` : 'task missing');
    // no-fallback
        line(!A.error && !B.error, '   No save errors in A or B', [A.error, B.error].filter(Boolean).join(' / '));
    const okLat = lat.filter((x) => x !== null);
    note(`Realtime propagation: median ${okLat.sort((a, b) => a - b)[Math.floor(okLat.length / 2)]} ms · max ${Math.max(...okLat)} ms over ${okLat.length} changes`);
  } catch (e) { line(false, 'Unexpected error', e.message); }
  finally {
    // cleanup: delete test tasks + project, keep the (inactive) person — people cannot be deleted with the publishable key by design
    for (const id of created.tasks.filter(Boolean)) A.deleteTask(id);
    await until(() => !A.saving, 8000); await sleep(500);
    if (created.project) A.deleteProject(created.project);
    if (created.person && A.db.rt_people.find((x) => x.id === created.person)?.active) A.setPersonActive(created.person, false);
    await until(() => !A.saving, 8000); await sleep(500);
    const C2 = await connStore(client());
    const left = C2.db.rt_tasks.filter((x) => created.tasks.includes(x.id)).length + C2.db.rt_projects.filter((x) => x.id === created.project).length;
    line(left === 0, 'Cleanup: test tasks and test project removed', `test person "${PN}" left inactive (hidden; people are deactivated, never deleted)`);
    const [d2, p2, j2, t2c] = n(C2); note(`After cleanup: ${d2} disciplines · ${p2} people (incl. inactive) · ${j2} projects · ${t2c} tasks`);
    const passed = results.filter((x) => x.ok).length;
    sum.textContent = `${passed}/${results.length} checks passed`; sum.className = passed === results.length ? 'ok' : 'bad';
    document.getElementById('copy').disabled = false;
  }
}
document.getElementById('copy').onclick = () => { navigator.clipboard.writeText([sum.textContent, ...[...out.children].map((x) => x.textContent)].join('\n')); document.getElementById('copy').textContent = 'Copied ✓'; };
document.getElementById('start').onclick = (e) => { e.target.disabled = true; run(); };
