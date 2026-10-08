// LOCAL TEST STAND-IN for Supabase (REST + Realtime), used only because this sandbox cannot reach
// supabase.co. Real PostgreSQL 16 underneath, every request runs as role `anon` (so the real grants,
// RLS policies and constraints from supabase/rt_schema.sql apply). Speaks the PostgREST subset and
// the Realtime (Phoenix vsn 2.0.0) protocol that @supabase/supabase-js uses.
import http from 'node:http';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const PORT = +process.env.PORT || 54321;
const KEY = process.env.KEY || 'sb_publishable_LOCALTEST';
const pool = new pg.Pool({ host: 'localhost', port: 54329, user: 'postgres', database: 'rt', max: 8 });
const TABLES = ['rt_disciplines', 'rt_people', 'rt_projects', 'rt_tasks'];
const log = (...a) => process.env.QUIET || console.log(new Date().toISOString().slice(11, 23), ...a);

// columns per table (for realtime payloads + upsert)
const COLS = {};
for (const t of TABLES) {
  const r = await pool.query(`select column_name as name, udt_name as type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t]);
  COLS[t] = r.rows;
}
// change feed: test-only NOTIFY trigger (stands in for Supabase's WAL-based realtime)
await pool.query(`
create or replace function public.emu_notify() returns trigger language plpgsql as $$ begin
  perform pg_notify('emu_changes', json_build_object('table', TG_TABLE_NAME, 'type', TG_OP,
    'record', case when TG_OP = 'DELETE' then null else row_to_json(NEW) end,
    'old_record', case when TG_OP = 'INSERT' then null else json_build_object('id', OLD.id) end,
    'commit_timestamp', now())::text);
  return null; end $$;`);
for (const t of TABLES) await pool.query(`drop trigger if exists emu_${t} on public.${t}; create trigger emu_${t} after insert or update or delete on public.${t} for each row execute function public.emu_notify();`);

const asAnon = async (fn) => { const c = await pool.connect(); try { await c.query('begin'); await c.query('set local role anon'); const r = await fn(c); await c.query('commit'); return r; } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); } };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'apikey,authorization,content-type,prefer,accept,x-client-info,accept-profile,content-profile,x-supabase-api-version', 'access-control-expose-headers': 'content-range' };
const send = (res, code, body) => { res.writeHead(code, { ...CORS, 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const pgErr = (res, e) => { const code = e.code === '42501' ? 403 : ['23505', '23503'].includes(e.code) ? 409 : 400; log('REST error', e.code, e.message); send(res, code, { code: e.code, message: e.message, details: e.detail || null, hint: null }); };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (!m) return send(res, 404, { message: 'not found' });
  if (req.headers.apikey !== KEY) return send(res, 401, { message: 'Invalid API key' });
  const t = m[1]; if (!TABLES.includes(t)) return send(res, 404, { message: `relation "${t}" does not exist` });
  const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
  let body = ''; for await (const ch of req) body += ch;
  try {
    if (req.method === 'GET') {
      const r = await asAnon((c) => c.query(`select coalesce(json_agg(row_to_json(x)), '[]') as j from public.${t} x`));
      log('GET', t, r.rows[0].j.length); return send(res, 200, r.rows[0].j);
    }
    if (req.method === 'POST') { // upsert (Prefer: resolution=merge-duplicates)
      const rows = [].concat(JSON.parse(body));
      const out = await asAnon(async (c) => { const acc = []; for (const row of rows) {
        const cols = Object.keys(row).filter((k) => COLS[t].some((x) => x.name === k));
        const q = `insert into public.${t} (${cols.join(',')}) select ${cols.join(',')} from json_populate_record(null::public.${t}, $1)
          on conflict (id) do update set ${cols.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ')} returning row_to_json(public.${t}.*) as j`;
        acc.push((await c.query(q, [JSON.stringify(row)])).rows[0].j); } return acc; });
      log('UPSERT', t, rows.map((r) => r.id.slice(0, 8)).join(','));
      return send(res, 201, single ? out[0] : out);
    }
    if (req.method === 'DELETE') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      await asAnon((c) => c.query(`delete from public.${t} where id = $1`, [id]));
      log('DELETE', t, id.slice(0, 8)); return send(res, 204);
    }
    send(res, 405, { message: 'method not allowed' });
  } catch (e) { pgErr(res, e); }
});

// ── Realtime (Phoenix channels, vsn 2.0.0 JSON array frames) ─────────────────
const wss = new WebSocketServer({ noServer: true });
const subs = new Set(); // { ws, topic, joinRef, bindings: [{ id, event, schema, table }] }
let nextId = 1000;
server.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/realtime/v1/websocket' || u.searchParams.get('apikey') !== KEY) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws));
});
wss.on('connection', (ws) => {
  log('WS connect');
  const out = (f) => { if (ws.readyState === 1) ws.send(JSON.stringify(f)); };
  ws.on('message', (raw) => {
    let f; try { f = JSON.parse(raw.toString()); } catch (e) { return; }
    const [joinRef, ref, topic, event, payload] = f;
    if (topic === 'phoenix' && event === 'heartbeat') return out([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]);
    if (event === 'phx_join') {
      const bindings = (payload?.config?.postgres_changes || []).map((b) => ({ ...b, id: nextId++ }));
      subs.add({ ws, topic, joinRef, bindings });
      log('JOIN', topic, bindings.map((b) => `${b.table}:${b.event}`).join(' '));
      out([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } }]);
      out([joinRef, null, topic, 'system', { status: 'ok', message: 'Subscribed to PostgreSQL', extension: 'postgres_changes', channel: topic.replace(/^realtime:/, '') }]);
      return;
    }
    if (event === 'phx_leave') { for (const s of subs) if (s.ws === ws && s.topic === topic) subs.delete(s); return out([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]); }
    if (event === 'access_token') return; // no auth in this mode
    out([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);
  });
  ws.on('close', () => { for (const s of subs) if (s.ws === ws) subs.delete(s); log('WS close'); });
});
const listener = await pool.connect();
await listener.query('listen emu_changes');
listener.on('notification', (n) => {
  const d = JSON.parse(n.payload);
  for (const s of subs) {
    const ids = s.bindings.filter((b) => (b.table === d.table || b.table === '*') && (b.event === '*' || b.event === d.type)).map((b) => b.id);
    if (!ids.length) continue;
    s.ws.readyState === 1 && s.ws.send(JSON.stringify([null, null, s.topic, 'postgres_changes', { ids, data: { schema: 'public', table: d.table, commit_timestamp: d.commit_timestamp, type: d.type, record: d.record, old_record: d.old_record, columns: COLS[d.table], errors: null } }]));
  }
  log('CHANGE', d.table, d.type, '→', [...subs].filter((s) => s.bindings.some((b) => b.table === d.table)).length, 'subscribers');
});
server.listen(PORT, () => console.log(`Supabase stand-in on http://localhost:${PORT} (key ${KEY})`));
