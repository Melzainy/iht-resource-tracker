// Local seed/demo adapter: the whole Resource Tracker datastore lives in this browser
// (localStorage), seeded from the Excel import. Other tabs of the same browser are kept in
// sync through BroadcastChannel, which mimics what Supabase Realtime will do across browsers.
import { LEGACY_PHASE_KEYS } from '../pm-phases.js';
const TABLES = ['rt_disciplines', 'rt_people', 'rt_projects', 'rt_tasks'];
const clone = (x) => JSON.parse(JSON.stringify(x));

export function localAdapter({ seed, key = 'rt-local-v1' }) {
  const empty = () => ({ rt_disciplines: [], rt_people: [], rt_projects: [], rt_tasks: [] });
  let chan = null;
  try { chan = new BroadcastChannel(key); } catch (e) { /* not available: single tab only */ }
  const read = () => { try { const raw = localStorage.getItem(key); if (raw) { const db = JSON.parse(raw); if (TABLES.every((t) => Array.isArray(db[t]))) return db; } } catch (e) { /* ignore */ } return null; };
  const write = (db) => { try { localStorage.setItem(key, JSON.stringify(db)); } catch (e) { /* storage unavailable: in-memory only */ } };
  let db = null;
  return {
    name: 'local',
    label: 'Local preview — data stays in this browser',
    async load() {
      db = read() || { ...empty(), ...clone(seed) };
      db.rt_tasks = db.rt_tasks.map((t) => (LEGACY_PHASE_KEYS[t.phase_key] ? { ...t, phase_key: LEGACY_PHASE_KEYS[t.phase_key] } : t)); // interim PH1…PH6 → permanent ids
      write(db); return clone(db);
    },
    async apply(op) { // op: { table, kind: 'upsert' | 'delete', row?, id? }
      db = applyOp(db, op); write(db);
      try { chan?.postMessage(op); } catch (e) { /* ignore */ }
    },
    subscribe(cb) {
      const onMsg = (e) => { db = applyOp(db, e.data); cb(e.data); };
      chan?.addEventListener('message', onMsg);
      return () => chan?.removeEventListener('message', onMsg);
    },
    async reset() { db = { ...empty(), ...clone(seed) }; write(db); try { chan?.postMessage({ kind: 'reset' }); } catch (e) { /* ignore */ } return clone(db); },
  };
}

export function applyOp(db, op) {
  if (!db || !op) return db;
  if (op.kind === 'reset') return db;
  const rows = db[op.table] || [];
  if (op.kind === 'delete') return { ...db, [op.table]: rows.filter((r) => r.id !== op.id) };
  const i = rows.findIndex((r) => r.id === op.row.id);
  const next = i < 0 ? [...rows, op.row] : rows.map((r, k) => (k === i ? { ...r, ...op.row } : r));
  return { ...db, [op.table]: next };
}
