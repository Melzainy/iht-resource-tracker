// Resource Tracker checks (standalone module): import fidelity, load rules, single-store
// behaviour and isolation from the PM Workflow.   node scripts/rt-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import * as M from '../src/rt/model.js';
import * as H from '../src/rt/hier.js';
import { PM_PHASES } from '../src/rt/pm-phases.js';
const STRUCTURE = PM_PHASES.map((p) => ({ id: p.key, title: p.label })); // snapshot of the PM template
import { createStore } from '../src/rt/store.js';
import { localAdapter } from '../src/rt/adapters/local.js';

const seed = JSON.parse(readFileSync(new URL('../src/rt/seed.json', import.meta.url)));
let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('✓', msg); } else { fail++; console.log('✗', msg); } };
const store = createStore(localAdapter({ seed, key: 'rt-check' }));
await store.init();
const db = () => store.db;
const P = (name) => db().rt_people.find((p) => p.name === name);
const D = (name) => db().rt_disciplines.find((d) => d.name === name);
const J = (name) => db().rt_projects.find((p) => p.name === name);

// Import fidelity
ok(db().rt_tasks.length === 46 && db().rt_projects.length === 4 && db().rt_people.length === 27, `seed: ${db().rt_tasks.length} tasks, ${db().rt_projects.length} projects, ${db().rt_people.length} people, ${db().rt_disciplines.length} disciplines`);
ok(['Mai', 'Anees', 'Ali', 'Kiran'].every((n) => M.tasksOf(db(), P(n).id).length > 0), 'Mai, Anees, Ali and Kiran have their Excel tasks');
ok(['Reeds lake', 'Cushman', 'Morgan', 'Milner'].every((n) => J(n)), 'Projects Reeds lake, Cushman, Morgan, Milner imported (names as entered)');
ok(db().rt_tasks.every((t) => t.hours_per_week === null), 'Missing Hrs/Week stays null (never 0)');
ok(db().rt_tasks.filter((t) => !t.start_date).length === 38 && db().rt_tasks.filter((t) => !t.due_date).length === 32, 'Missing Start / Due stay null (38 / 32)');
const mai = M.tasksOf(db(), P('Mai').id);
ok(mai.find((t) => t.title === 'Full Design Lock' && J('Morgan').id === t.project_id)?.notes?.startsWith('Selctions Materials'), 'Notes preserved exactly as typed');
ok(mai.filter((t) => M.dateKind(t) === 'due-only').length === 3, 'Mai has 3 due-only tasks (shown as due markers)');
ok(D('Team US') && ['Dwight', 'David W', 'JD', 'Angel', 'Mark Kemp', 'Karen'].every((n) => P(n)?.discipline_id === D('Team US').id), 'Team US: Dwight, David W, JD, Angel, Mark Kemp, Karen');
ok(P('Abhishek')?.discipline_id === D('BIM Heroes').id, 'Abhishek in BIM Heroes');
ok(P('Amin')?.discipline_id === D('Company Management').id && P('Amin').role === 'Company Manager' && M.disciplinesOf(db())[0].name === 'Company Management', 'Amin, Company Manager, in Company Management (top)');
ok(D('Manufacturing') && M.peopleOf(db(), D('Manufacturing').id).length === 0, 'Manufacturing kept as an empty discipline');
ok(new Set(db().rt_people.map((p) => p.name.toLowerCase())).size === db().rt_people.length && new Set(db().rt_projects.map((p) => p.name.toLowerCase())).size === db().rt_projects.length, 'No duplicate people or projects');


// Issues: overdue, blocked, rollups, KPIs (today fixed at 8 Oct 2026)
const TODAY = '2026-10-08';
ok(db().rt_tasks.filter((t) => !t.status).length === 31 && db().rt_tasks.filter((t) => !t.priority).length === 30, 'Missing Status / Priority stay null (31 / 30)');
const mans = M.tasksOf(db(), P('Mansour').id)[0];
ok(mans.status === 'Waiting' && mans.priority === 'High', 'v4 workbook: Mansour "Radiant floor detail…" is Waiting / High');
const od = db().rt_tasks.filter((t) => M.isOverdue(t, TODAY));
ok(od.length === 3 && od.every((t) => t.due_date < TODAY && t.status !== 'Done'), `Overdue = due < today and not Done (${od.length}: ${od.map((t) => `${M.overdueDays(t, TODAY)}d`).join(', ')})`);
ok(!M.isOverdue({ ...od[0], status: 'Done' }, TODAY) && M.overdueDays({ due_date: '2026-10-04', status: 'In Progress' }, TODAY) === 4, 'Done is never overdue; due 4 Oct → "Overdue · 4d" on 8 Oct');
ok(db().rt_tasks.filter(M.isBlocked).length === 3 && db().rt_tasks.filter(M.isBlocked).every((t) => t.person_id === P('Kiran').id), 'Blocked = status Blocked (3, all Kiran)');
const ks = M.personStats(db(), P('Kiran').id, TODAY); const ms = M.disciplineStats(db(), D('MEP').id, TODAY);
ok(ks.blocked === 3 && ks.active === 13 && ks.unest === 13 && ms.blocked === 3 && ms.people === 1, 'Rollup Task → Person → Discipline (Kiran / MEP: 13 active, 3 blocked, 13 unestimated)');
const cs = M.disciplineStats(db(), D('Civil').id, TODAY); ok(cs.overdue === 2 && cs.people === 2, 'Civil rollup: 2 people, 2 overdue (Anees)');
const kc = H.kpiCounts(db(), TODAY, {}); ok(kc.overdue === 3 && kc.blocked === 3 && kc.unest === kc.active, `Company KPIs from rt_tasks: ${JSON.stringify(kc)}`);
ok(H.kpiCounts(db(), TODAY, { project: J('Milner').id }).blocked === 1, 'KPIs combine with the Project filter (Milner: 1 blocked)');
const tree = H.buildTree(db(), TODAY, { kpi: 'blocked' }); ok(tree.length === 1 && tree[0].people.length === 1 && tree[0].people[0].tasks.length === 3, 'Blocked filter keeps the hierarchy: MEP → Kiran → 3 tasks');
const att = H.buildTree(db(), TODAY, { mode: 'attention' }).flatMap((d) => d.people.map((x) => x.p.name)); ok(att.includes('Kiran') && att.includes('Anees') && att.includes('Mai'), `Needs Attention people: ${att.join(', ')}`);
ok(H.personHeadline(M.personStats(db(), P('Mai').id, TODAY)).text === 'Workload incomplete' && H.personLine(M.personStats(db(), P('Mai').id, TODAY)) === '5 active tasks · 5 unestimated', 'Mai: "Workload incomplete — 5 active tasks · 5 unestimated" (not Available)');


// Phase (future PM Workflow classification) and overlap
const PERMANENT = ['phase-conceptual-design-contract', 'phase-design-development-freeze', 'phase-coordinated-design', 'phase-permit-documentation', 'phase-construction-docs-manufacturing-readiness', 'phase-site-manufacturing-construction'];
ok(PM_PHASES.length === 6 && PM_PHASES.map((p) => p.key).join() === PERMANENT.join() && PM_PHASES.every((p, i) => p.label === STRUCTURE[i].title), 'Phase references use the permanent template ids (not position/number/name)');
const schemaSql = readFileSync(new URL('../supabase/rt_schema.sql', import.meta.url), 'utf8');
ok(PERMANENT.every((k) => schemaSql.includes(`'${k}'`)), 'Database check constraint lists exactly the permanent phase ids');
ok(db().rt_tasks.every((t) => t.phase_key === null), 'Imported tasks: phase_key null ("Not assigned"), never guessed');
const kt = M.tasksOf(db(), P('Kiran').id).find((t) => t.start_date);
ok(store.saveTask({ ...kt, phase_key: 'phase-coordinated-design' }).ok && db().rt_tasks.find((t) => t.id === kt.id).phase_key === 'phase-coordinated-design' && !store.saveTask({ ...kt, phase_key: 'Coordinated Design' }).ok && !store.saveTask({ ...kt, phase_key: 'PH3' }).ok, 'phase_key stores the permanent id; names and positional keys are rejected');
ok(H.buildTree(db(), TODAY, { phase: 'phase-coordinated-design' }).flatMap((d) => d.people.flatMap((x) => x.tasks)).length === 1 && H.buildTree(db(), TODAY, { phase: '-' }).flatMap((d) => d.people.flatMap((x) => x.tasks)).length === 45, 'Phase filter: Coordinated Design → 1 task · Not assigned → 45');
store.saveTask({ ...db().rt_tasks.find((t) => t.id === kt.id), phase_key: null });
const om = M.overlapMap([{ id: 'a', start_date: '2026-10-05', due_date: '2026-10-16', status: 'In Progress' }, { id: 'b', start_date: '2026-10-12', due_date: '2026-10-20' }, { id: 'c', start_date: '2026-10-21', due_date: '2026-10-30' }, { id: 'd', start_date: '2026-10-14', due_date: '2026-10-14', status: 'Done' }]);
ok(om.a.join() === 'b' && om.b.join() === 'a' && om.c.length === 0 && !om.d, 'Overlap = shared days between active dated tasks (Done ignored)');
const ks2 = M.personStats(db(), P('Kiran').id, TODAY);
ok(ks2.peak === 2 && !ks2.over && /capacity cannot be fully evaluated/.test(H.overlapNote(ks2).text), `Kiran: peak ${ks2.peak} concurrent, unestimated → "${H.overlapNote(ks2).text}"`);
const clash = M.tasksOf(db(), P('Kiran').id).find((t) => t.title === 'Clash Detection'); const cb = M.tasksOf(db(), P('Kiran').id).find((t) => t.start_date === '2026-10-15');
store.saveTask({ ...clash, hours_per_week: 25 }); store.saveTask({ ...cb, hours_per_week: 20 });
const ks3 = M.personStats(db(), P('Kiran').id, TODAY);
ok(ks3.over && M.wkLabel(ks3.overWk.wk) === 'W42' && ks3.overWk.h === 45 && /Over capacity W42 · 45 \/ 40 h/.test(H.overlapNote(ks3).text), 'Known hours 25 + 20 in W42 → Over capacity W42 · 45 / 40 h');
store.saveTask({ ...clash, hours_per_week: null }); store.saveTask({ ...cb, hours_per_week: null });

// Load rules
const wks = M.weeksFrom('2026-10-05', 4);
const probe = { id: 'x', person_id: 'p', start_date: '2026-10-05', due_date: '2026-10-23', hours_per_week: 15, status: 'In Progress', active: true };
ok(M.taskWeeks(probe, wks).map(M.wkLabel).join(',') === 'W41,W42,W43', 'Task 5–23 Oct at 15 h/wk counts in W41, W42, W43');
const maiW = M.personLoad(db(), P('Mai').id, [M.weekStart('2026-10-12')])[0];
ok(maiW.key === 'unest' && maiW.label === 'Workload incomplete' && maiW.unest > 0, `Mai W42: ${maiW.h}/${maiW.cap} h + ${maiW.unest} unestimated → "${maiW.label}" (not "Available")`);
ok(M.statusOf(32, 40).label === 'Balanced' && M.statusOf(44, 40).label === 'Over capacity' && M.statusOf(36, 40).label === 'Near capacity' && M.statusOf(20, 40).label === 'Available', 'Thresholds: <70 Available · 70–89 Balanced · 90–100 Near · >100 Over');

// One store: add / edit / move / deactivate
const w42 = M.weekStart('2026-10-12');
let r = store.saveTask({ person_id: P('Mai').id, project_id: J('Cushman').id, title: 'Test task', start_date: '2026-10-12', due_date: '2026-10-16', hours_per_week: 10, status: 'Not Started', priority: 'Low' });
const tid = r.row.id;
ok(r.ok && M.tasksOf(db(), P('Mai').id).some((t) => t.id === tid) && M.personLoad(db(), P('Mai').id, [w42])[0].h === 10, 'Add task to Mai → visible under Mai, adds 10 h in W42');
store.saveTask({ ...db().rt_tasks.find((t) => t.id === tid), start_date: '2026-10-19', due_date: '2026-10-30' });
ok(M.personLoad(db(), P('Mai').id, [w42])[0].h === 0 && M.personLoad(db(), P('Mai').id, [M.weekStart('2026-10-26')])[0].h === 10, 'Edit dates → load moves to W43–W44');
store.saveTask({ ...db().rt_tasks.find((t) => t.id === tid), hours_per_week: 30 });
ok(M.personLoad(db(), P('Mai').id, [M.weekStart('2026-10-26')])[0].pct === 75, 'Change Hrs/Week to 30 → Mai W44 75%');
ok(!store.saveTask({ ...db().rt_tasks.find((t) => t.id === tid), start_date: '2026-11-10', due_date: '2026-11-01' }).ok, 'Due before Start is rejected');
r = store.saveProject({ name: 'New Project A', status: 'Active' });
ok(r.ok && M.activeProjects(db()).some((p) => p.name === 'New Project A'), 'New project → immediately in the project list used by Add Task and filters');
ok(!store.saveProject({ name: 'new project a' }).ok, 'Duplicate project name rejected');
r = store.savePerson({ name: 'Test Architect', discipline_id: D('Architecture').id, role: 'Architect', weekly_capacity_hours: 40 });
const np = r.row.id;
ok(M.peopleOf(db(), D('Architecture').id).some((p) => p.id === np), 'New person appears under Architecture');
store.saveTask({ person_id: np, project_id: J('Morgan').id, title: 'Historic task', start_date: '2026-10-05', due_date: '2026-10-09', hours_per_week: 8 });
store.savePerson({ ...db().rt_people.find((p) => p.id === np), discipline_id: D('Team US').id });
ok(M.peopleOf(db(), D('Team US').id).some((p) => p.id === np) && !M.peopleOf(db(), D('Architecture').id).some((p) => p.id === np), 'Moved to Team US → hierarchy follows');
store.setPersonActive(np, false);
ok(!M.assignablePeople(db()).some((p) => p.id === np) && db().rt_tasks.some((t) => t.person_id === np), 'Deactivated → gone from assignment list, historic task kept');
ok(!store.saveTask({ person_id: np, project_id: J('Morgan').id, title: 'New work' }).ok, 'New task for an inactive person is refused');
ok(!store.deleteProject(J('Morgan').id).ok && store.setProjectActive(J('Morgan').id, false).ok && db().rt_tasks.some((t) => t.project_id === J('Morgan').id), 'Project with tasks: delete refused, archive keeps tasks');
store.setProjectActive(J('Morgan').id, true);
ok(!store.setDisciplineActive(D('Architecture').id, false).ok, 'Discipline with active people cannot be deactivated');
const before = M.disciplinesOf(db()).map((d) => d.name).join('|'); store.moveDiscipline(D('Team US').id, -1);
ok(M.disciplinesOf(db()).map((d) => d.name).join('|') !== before, 'Discipline reorder');
ok(store.deleteTask(tid).ok && !db().rt_tasks.some((t) => t.id === tid), 'Delete task');

// Isolation from the PM Workflow
const rtFiles = readdirSync(new URL('../src/rt/', import.meta.url), { recursive: true }).filter((f) => /\.(js|jsx)$/.test(f));
const src = (f) => readFileSync(new URL(`../src/rt/${f}`, import.meta.url), 'utf8');
const rtDir = new URL('../src/rt/', import.meta.url).pathname;
const leaks = rtFiles.filter((f) => f !== 'pm-phases.js' && [...src(f).matchAll(/from '(\.[^']+)'/g)].some(([, rel]) => !new URL(rel, new URL(`../src/rt/${f}`, import.meta.url)).pathname.startsWith(rtDir)));
ok(!/^import /m.test(src('pm-phases.js')), 'pm-phases.js is a self-contained snapshot (no imports)');
ok(!leaks.length, `Other Resource Tracker modules import nothing from the PM Workflow (${rtFiles.length} files checked)`);
const tables = Object.keys(seed).filter((k) => k.startsWith('rt_'));
ok(tables.join(',') === 'rt_disciplines,rt_people,rt_projects,rt_tasks', `Own namespace: ${tables.join(', ')}`);

console.log(`\nResource Tracker checks: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0); // BroadcastChannel would otherwise keep Node alive
