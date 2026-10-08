// Supabase adapter (Stage B): the shared live database for everyone who has the Resource Tracker URL.
// Same interface as the local adapter: load / apply / subscribe / reset.
//
// • Browser-safe publishable (anon) key only — see src/rt/config.js, which refuses secret keys.
// • Writes: upsert / delete one row at a time; the database returns the stored row (with its own
//   updated_at), which replaces the optimistic copy.
// • Realtime: postgres_changes on the four rt_* tables. While this browser has a write in flight for a
//   row, echoes for that row are ignored (the write's own result is applied instead), so fast typing
//   never flickers back to an older value.
// • Every (re)subscribe triggers a full reload, so nothing is missed after a dropped connection.
export const TABLES = ['rt_disciplines', 'rt_people', 'rt_projects', 'rt_tasks'];
// Normalise values that can arrive as strings from REST or Realtime (numeric / bigint columns).
const NUM = ['hours_per_week', 'weekly_capacity_hours', 'sort_order', 'source_row'];
const norm = (row) => { if (!row) return row; const r = { ...row }; NUM.forEach((k) => { if (typeof r[k] === 'string') r[k] = r[k] === '' ? null : Number(r[k]); }); ['start_date', 'due_date', 'target_finish'].forEach((k) => { if (typeof r[k] === 'string' && r[k].length > 10) r[k] = r[k].slice(0, 10); }); return r; };

export function supabaseAdapter({ client }) {
  const inflight = new Map(); // row id → number of writes in flight
  const hold = (id, d) => { const n = (inflight.get(id) || 0) + d; if (n > 0) inflight.set(id, n); else inflight.delete(id); };
  return {
    name: 'supabase',
    label: 'Live — shared Supabase database',
    async load() {
      const res = await Promise.all(TABLES.map((t) => client.from(t).select('*')));
      const out = {};
      res.forEach(({ data, error }, i) => { if (error) throw new Error(`${TABLES[i]}: ${error.message}`); out[TABLES[i]] = data.map(norm); });
      return out;
    },
    async apply(op) {
      const id = op.kind === 'delete' ? op.id : op.row.id;
      hold(id, 1);
      try {
        if (op.kind === 'delete') {
          const { error } = await client.from(op.table).delete().eq('id', id);
          if (error) throw new Error(error.message);
          return null;
        }
        const { data, error } = await client.from(op.table).upsert(op.row).select().single();
        if (error) throw new Error(error.message);
        return norm(data);
      } finally { hold(id, -1); }
    },
    subscribe(cb, onStatus = () => {}) {
      const ch = client.channel(`rt-changes-${Math.random().toString(36).slice(2, 10)}`);
      TABLES.forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
        const id = p.new?.id || p.old?.id;
        if (inflight.has(id)) return; // our own write: its result is applied when it returns
        if (p.eventType === 'DELETE') cb({ table, kind: 'delete', id });
        else cb({ table, kind: 'upsert', row: norm(p.new) });
      }));
      ch.subscribe((status) => {
        onStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'offline' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'reconnecting' : 'connecting');
        if (status === 'SUBSCRIBED') cb({ kind: 'reset' }); // catch up on anything missed before/while disconnected
      });
      return () => client.removeChannel(ch);
    },
    async reset() { throw new Error('Reset is only available in the local preview.'); },
  };
}
