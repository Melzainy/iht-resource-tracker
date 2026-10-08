// Resource Tracker store: ONE datastore for every Resource Tracker screen.
// Screens read `db` and call the actions below; nothing keeps its own copy of people,
// projects or disciplines. The adapter decides where the data lives (local seed now,
// Supabase in Stage B). Completely separate from the PM Workflow store.
import { applyOp } from './adapters/local.js';
import { phaseByKey } from './pm-phases.js';

const now = () => new Date().toISOString();
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const clean = (v) => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s; };
const numOrNull = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };

export function createStore(adapter) {
  let db = null; let listeners = new Set(); let error = null;
  let saving = 0; let savedAt = null; let conn = adapter.name === 'local' ? 'local' : 'connecting';
  const emit = () => listeners.forEach((f) => f());
  // Reload (initial catch-up and after every reconnect). Changes that arrive DURING the reload, and
  // this browser's own saves still in flight, are re-applied on top of the fresh snapshot so nothing
  // is lost to the race between "snapshot taken" and "snapshot applied".
  let reloading = 0; let during = []; const inflight = new Set();
  const reload = async () => {
    reloading++;
    try { const fresh = await adapter.load(); db = fresh; during.forEach((op) => { db = applyOp(db, op); }); inflight.forEach((op) => { db = applyOp(db, op); }); }
    catch (e) { error = `Could not reload: ${e.message}`; }
    finally { reloading--; if (!reloading) during = []; emit(); }
  };
  const incoming = (op) => { if (reloading) during.push(op); db = applyOp(db, op); emit(); };
  // Optimistic: the change shows immediately everywhere in this browser; the adapter then stores it.
  // The stored row (with the database's updated_at) replaces the optimistic copy. On failure the
  // error is shown and the data is reloaded from the source of truth.
  const commit = async (ops) => {
    ops.forEach((op) => { db = applyOp(db, op); inflight.add(op); });
    saving++; error = null; emit();
    try {
      for (const op of ops) { const stored = await adapter.apply(op); inflight.delete(op); if (stored && op.kind === 'upsert') { db = applyOp(db, { table: op.table, kind: 'upsert', row: stored }); if (reloading) during.push({ table: op.table, kind: 'upsert', row: stored }); } }
      savedAt = new Date();
    } catch (e) { error = e.message; ops.forEach((op) => inflight.delete(op)); await reload(); }
    finally { saving--; emit(); }
  };
  const ok = (extra = {}) => ({ ok: true, ...extra });
  const fail = (msg) => ({ ok: false, error: msg });
  const find = (table, id) => db[table].find((r) => r.id === id);

  const api = {
    adapter,
    get db() { return db; },
    get error() { return error; },
    get saving() { return saving > 0; },
    get savedAt() { return savedAt; },
    get connection() { return conn; },
    async init() {
      db = await adapter.load();
      adapter.subscribe((op) => { if (op.kind === 'reset') { reload(); return; } incoming(op); }, (st) => { conn = st; emit(); });
      emit(); return db;
    },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    async reset() { db = await adapter.reset(); emit(); },

    // ── Tasks ───────────────────────────────────────────────────────────────
    saveTask(input) {
      const prev = input.id ? find('rt_tasks', input.id) : null;
      const title = clean(input.title); const start = clean(input.start_date); const due = clean(input.due_date);
      const hrs = numOrNull(input.hours_per_week);
      if (!input.person_id || !find('rt_people', input.person_id)) return fail('Choose a person.');
      const person = find('rt_people', input.person_id);
      if (!person.active && (!prev || prev.person_id !== person.id)) return fail(`${person.name} is inactive and cannot take new assignments.`);
      if (!input.project_id || !find('rt_projects', input.project_id)) return fail('Choose a project.');
      const proj = find('rt_projects', input.project_id);
      if (!proj.active && (!prev || prev.project_id !== proj.id)) return fail(`${proj.name} is archived.`);
      if (!title) return fail('Enter a task name.');
      if (start && due && due < start) return fail('Due date is before the start date.');
      if (Number.isNaN(hrs) || (hrs != null && (hrs < 0 || hrs > 80))) return fail('Hrs / Week must be blank or between 0 and 80.');
      const phase = clean(input.phase_key);
      if (phase && !phaseByKey[phase]) return fail('Unknown phase.');
      const row = { ...(prev || { id: newId(), created_at: now(), active: true, sort_order: Date.now() }), person_id: input.person_id, project_id: input.project_id, title,
        start_date: start, due_date: due, hours_per_week: hrs, status: clean(input.status), priority: clean(input.priority), notes: clean(input.notes), phase_key: phase, updated_at: now() };
      commit([{ table: 'rt_tasks', kind: 'upsert', row }]);
      return ok({ row });
    },
    deleteTask(id) { if (!find('rt_tasks', id)) return fail('Task not found.'); commit([{ table: 'rt_tasks', kind: 'delete', id }]); return ok(); },

    // ── Projects ────────────────────────────────────────────────────────────
    saveProject(input) {
      const prev = input.id ? find('rt_projects', input.id) : null;
      const name = clean(input.name);
      if (!name) return fail('Enter a project name.');
      if (db.rt_projects.some((p) => p.id !== input.id && p.name.toLowerCase() === name.toLowerCase())) return fail(`A project called "${name}" already exists.`);
      const s = clean(input.start_date); const f = clean(input.target_finish);
      if (s && f && f < s) return fail('Target finish is before the start.');
      const row = { ...(prev || { id: newId(), created_at: now(), active: true }), name, status: clean(input.status), project_manager: clean(input.project_manager), start_date: s, target_finish: f, notes: clean(input.notes), updated_at: now() };
      commit([{ table: 'rt_projects', kind: 'upsert', row }]);
      return ok({ row });
    },
    setProjectActive(id, active) { const p = find('rt_projects', id); commit([{ table: 'rt_projects', kind: 'upsert', row: { ...p, active, updated_at: now() } }]); return ok(); },
    deleteProject(id) {
      const n = db.rt_tasks.filter((t) => t.project_id === id).length;
      if (n) return fail(`${n} task${n > 1 ? 's reference' : ' references'} this project. Archive it instead.`);
      commit([{ table: 'rt_projects', kind: 'delete', id }]); return ok();
    },

    // ── People ──────────────────────────────────────────────────────────────
    savePerson(input) {
      const prev = input.id ? find('rt_people', input.id) : null;
      const name = clean(input.name); const cap = numOrNull(input.weekly_capacity_hours);
      if (!name) return fail('Enter a name.');
      if (db.rt_people.some((p) => p.id !== input.id && p.name.toLowerCase() === name.toLowerCase())) return fail(`${name} is already in the team.`);
      if (!input.discipline_id || !find('rt_disciplines', input.discipline_id)) return fail('Choose a discipline.');
      if (Number.isNaN(cap) || (cap != null && (cap < 0 || cap > 80))) return fail('Weekly capacity must be blank or between 0 and 80 h.');
      const moved = prev && prev.discipline_id !== input.discipline_id;
      const sort = moved || !prev ? Math.max(0, ...db.rt_people.filter((p) => p.discipline_id === input.discipline_id).map((p) => p.sort_order || 0)) + 10 : prev.sort_order;
      const row = { ...(prev || { id: newId(), created_at: now() }), name, discipline_id: input.discipline_id, role: clean(input.role), weekly_capacity_hours: cap,
        active: input.active ?? prev?.active ?? true, sort_order: sort, updated_at: now() };
      commit([{ table: 'rt_people', kind: 'upsert', row }]);
      return ok({ row });
    },
    setPersonActive(id, active) { const p = find('rt_people', id); commit([{ table: 'rt_people', kind: 'upsert', row: { ...p, active, updated_at: now() } }]); return ok(); },

    // ── Disciplines ─────────────────────────────────────────────────────────
    saveDiscipline(input) {
      const prev = input.id ? find('rt_disciplines', input.id) : null;
      const name = clean(input.name);
      if (!name) return fail('Enter a discipline name.');
      if (db.rt_disciplines.some((d) => d.id !== input.id && d.name.toLowerCase() === name.toLowerCase())) return fail(`"${name}" already exists.`);
      const row = { ...(prev || { id: newId(), created_at: now(), active: true, kind: 'discipline', sort_order: Math.max(0, ...db.rt_disciplines.map((d) => d.sort_order || 0)) + 10 }), name, updated_at: now() };
      commit([{ table: 'rt_disciplines', kind: 'upsert', row }]);
      return ok({ row });
    },
    moveDiscipline(id, dir) {
      const list = [...db.rt_disciplines].filter((d) => d.active).sort((a, b) => a.sort_order - b.sort_order);
      const i = list.findIndex((d) => d.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return fail('Already at the edge.');
      const a = list[i]; const b = list[j];
      commit([{ table: 'rt_disciplines', kind: 'upsert', row: { ...a, sort_order: b.sort_order, updated_at: now() } }, { table: 'rt_disciplines', kind: 'upsert', row: { ...b, sort_order: a.sort_order, updated_at: now() } }]);
      return ok();
    },
    setDisciplineActive(id, active) {
      const d = find('rt_disciplines', id);
      if (!active) { const n = db.rt_people.filter((p) => p.discipline_id === id && p.active).length; if (n) return fail(`Move or deactivate the ${n} active ${n > 1 ? 'people' : 'person'} in ${d.name} first.`); }
      commit([{ table: 'rt_disciplines', kind: 'upsert', row: { ...d, active, updated_at: now() } }]); return ok();
    },
  };
  return api;
}

// React binding: every screen re-renders from the same store.
export function useStore(store) {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => store.subscribe(force), [store]);
  return store;
}
