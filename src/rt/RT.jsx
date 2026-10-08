// Resource Tracker — standalone, temporary company module.
// Shares only the website shell with the PM Workflow prototype. It never reads or writes the
// PM Workflow store: its own datastore (rt_disciplines, rt_people, rt_projects, rt_tasks) sits
// behind an adapter (local seed now, Supabase in Stage B).
import * as M from './model.js';
import * as H from './hier.js';
import { createStore, useStore } from './store.js';
import { localAdapter } from './adapters/local.js';
import { supabaseAdapter } from './adapters/supabase.js';
import { RT_CONFIG, keyProblem } from './config.js';
import { createClient } from '@supabase/supabase-js';
import seed from './seed.json';
import { PM_PHASES, phaseLabel } from './pm-phases.js';

const { useState, useEffect, useMemo, useRef } = React;
let STORE = null;
let CONFIG_ERROR = null;
function getStore() {
  if (STORE) return STORE;
  if (RT_CONFIG.backend === 'supabase') {
    CONFIG_ERROR = !RT_CONFIG.supabaseUrl ? 'No Supabase project URL configured.' : keyProblem(RT_CONFIG.supabasePublishableKey);
    if (!CONFIG_ERROR) {
      const client = createClient(RT_CONFIG.supabaseUrl, RT_CONFIG.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 20 } } });
      STORE = createStore(supabaseAdapter({ client }));
      return STORE;
    }
  }
  STORE = createStore(localAdapter({ seed, key: 'rt-local-v2' }));
  return STORE;
}
// Live connection / save status for the header.
function SyncStatus({ store }) {
  if (store.adapter.name === 'local') return <span className="rt-src">{store.adapter.label}</span>;
  const c = store.connection;
  const conn = c === 'live' ? ['ok', 'Live — changes sync to everyone with this link'] : c === 'connecting' ? ['wait', 'Connecting to the shared database…'] : ['bad', 'Connection lost — reconnecting… (edits may not reach others yet)'];
  const save = store.error ? ['bad', `Last change not saved: ${store.error}`] : store.saving ? ['wait', 'Saving…'] : store.savedAt ? ['ok', `All changes saved · ${store.savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`] : null;
  return <span className="rt-sync" role="status" aria-live="polite"><span className={`rt-sync-c ${conn[0]}`}><i aria-hidden="true" />{conn[1]}</span>{save && <span className={`rt-sync-s ${save[0]}`}>{save[1]}</span>}</span>;
}
const todayISO = () => (typeof window !== 'undefined' && window.RT_TODAY) || new Date().toISOString().slice(0, 10);
const uiKey = 'rt-ui-v2';
const loadUi = () => { try { return JSON.parse(localStorage.getItem(uiKey)) || {}; } catch (e) { return {}; } };
const saveUi = (u) => { try { localStorage.setItem(uiKey, JSON.stringify({ ...loadUi(), ...u })); } catch (e) { /* ignore */ } };

export function ResourceTracker() {
  const store = useStore(getStore());
  const [ready, setReady] = useState(!!store.db);
  const [tab, setTab] = useState('planner');
  // View state shared by Planner and Timeline (filters, Needs Attention, range, period).
  const [vs, setVsRaw] = useState(() => { const u = loadUi(); return { f: { disc: '', person: '', project: '', phase: '', status: '', priority: '', q: '', kpi: '' }, mode: u.mode || 'all', range: u.range || 8, offset: 0 }; });
  const setVs = (p) => setVsRaw((x) => { const n = { ...x, ...p }; saveUi({ range: n.range, mode: n.mode }); return n; });
  const setF = (p) => setVsRaw((x) => ({ ...x, f: { ...x.f, ...p } }));
  const [panel, setPanel] = useState(null); // { kind: 'task'|'project'|'person'|'discipline', row }
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  useEffect(() => { if (!store.db) store.init().then(() => setReady(true)).catch((e) => setLoadErr(e.message)); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.bad ? 6000 : 2500); return () => clearTimeout(t); }, [toast]);
  if (CONFIG_ERROR) return <div className="rt"><p className="note bad">Resource Tracker live database is not configured correctly: {CONFIG_ERROR} Showing nothing rather than risk mixing data.</p></div>;
  if (loadErr) return <div className="rt"><p className="note bad">Could not load the shared Resource Tracker database: {loadErr}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div>;
  if (!ready || !store.db) return <div className="rt"><p className="muted">Loading Resource Tracker…</p></div>;
  const db = store.db;
  const say = (r, okText) => { if (r.ok) { setToast({ text: okText }); return true; } setToast({ text: r.error, bad: true }); return false; };
  const ctx = { store, db, setPanel, say, setConfirm, vs, setVs, setF };
  return (
    <div className="rt">
      <div className="rt-head">
        <div><div className="rt-kicker">Company · Resource Tracker <span className="rt-badge">Standalone / Temporary</span></div>
          <h1>Resource Tracker</h1>
          <p className="muted small">Planner = enter and edit work inline. Timeline = analyse resources, overlaps and conflicts on a large Gantt. Issues roll up from tasks to people, disciplines and the company. Separate from the PM Workflow: its own people, projects and tasks.</p><SyncStatus store={store} /></div>
        {store.adapter.name === 'local' && <button className="linkish small rt-reset" onClick={() => setConfirm({ title: 'Reset the preview data?', text: 'All changes made in this browser are discarded and the Excel import is loaded again.', label: 'Reset', action: () => store.reset().then(() => setToast({ text: 'Preview data reset to the Excel import' })) })}>Reset preview data</button>}
        <nav className="rt-tabs" aria-label="Resource Tracker">
          {[['planner', 'Planner'], ['timeline', 'Timeline'], ['projects', 'Projects'], ['team', 'Team']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
      </div>
      {store.error && <p className="note bad small" role="alert">Last change could not be saved: {store.error} — the screen was refreshed from the {store.adapter.name === 'local' ? 'saved' : 'shared'} data.</p>}
      {tab === 'planner' && <Planner {...ctx} />}
      {tab === 'timeline' && <ResourceTimeline {...ctx} />}
      {tab === 'projects' && <Projects {...ctx} />}
      {tab === 'team' && <Team {...ctx} />}
      {panel?.kind === 'task' && <TaskPanel {...ctx} row={panel.row} close={() => setPanel(null)} />}
      {panel?.kind === 'project' && <ProjectPanel {...ctx} row={panel.row} close={() => setPanel(null)} />}
      {panel?.kind === 'person' && <PersonPanel {...ctx} row={panel.row} close={() => setPanel(null)} />}
      {panel?.kind === 'discipline' && <DisciplinePanel {...ctx} row={panel.row} close={() => setPanel(null)} />}
      {confirm && <Confirm {...confirm} close={() => setConfirm(null)} />}
      {toast && <div className={`toast ${toast.bad ? 'bad' : 'ok'}`} role="status" onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────
const stKey = (s) => (s || 'none').replace(/\s/g, '').toLowerCase();
const Status = ({ s }) => (s ? <span className={`rt-st st-${stKey(s)}`}>{s === 'Blocked' ? '⚠︎ ' : ''}{s}</span> : <span className="rt-st st-none">No status</span>);
const fmtH = (h) => (Math.round(h * 10) / 10).toString();
const hrsText = (t) => (t.hours_per_week == null ? 'Unestimated' : `${fmtH(t.hours_per_week)} h/wk`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function Drawer({ title, close, children, footer }) {
  const ref = useRef(null);
  useEffect(() => { const f = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', f); ref.current?.querySelector('input,select,textarea')?.focus(); return () => window.removeEventListener('keydown', f); }, []);
  return <><div className="rt-scrim" onClick={close} /><aside className="rt-drawer" role="dialog" aria-label={title} ref={ref}>
    <header><h2>{title}</h2><button className="linkish" aria-label="Close" onClick={close}>✕</button></header>
    <div className="rt-drawer-b">{children}</div><footer>{footer}</footer></aside></>;
}
function Confirm({ title, text, action, label = 'Delete', close }) {
  return <div className="rt-modal" role="alertdialog" aria-label={title}><div className="rt-modal-b"><h2>{title}</h2><p>{text}</p>
    <div className="row"><button className="btn danger" onClick={() => { action(); close(); }}>{label}</button><button className="btn" onClick={close}>Cancel</button></div></div></div>;
}
// Expand/collapse state. Collapsed by default; while a task filter is on, matches open automatically.
const OPEN_CACHE = {}; // expand state per view, survives switching tabs
function useOpen(filtering, resetKey, name) {
  const [open, setOpenRaw] = useState(() => (OPEN_CACHE[name]?.key === resetKey ? OPEN_CACHE[name].open : {}));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setOpenRaw({}); }, [resetKey]);
  useEffect(() => { if (name) OPEN_CACHE[name] = { key: resetKey, open }; }, [open, resetKey]);
  const setOpen = setOpenRaw;
  const isOpen = (id) => (id in open ? open[id] : filtering);
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !(id in o ? o[id] : filtering) }));
  const setOne = (id, v) => setOpen((o) => ({ ...o, [id]: v }));
  const setAll = (tree, v) => setOpen(Object.fromEntries(tree.flatMap(({ d, people }) => [[d.id, v], ...people.map(({ p }) => [p.id, v])])));
  const only = (tree, did) => setOpen((o) => ({ ...o, ...Object.fromEntries(tree.map(({ d }) => [d.id, d.id === did])) }));
  return { isOpen, toggle, setAll, setOne, only };
}
const Chev = ({ open }) => <span className="rt-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>;
function DiscRollup({ s }) {
  const iss = H.disciplineIssues(s);
  return <span className="rt-roll"><span className="rt-roll-a">{H.plural(s.people, 'person', 'people')} · {H.plural(s.active, 'active task')}</span>
    <span className="rt-roll-b">{iss.length ? <>{iss.some(([k]) => k === 'bad') && <i aria-hidden="true">⚠︎ </i>}{iss.map(([k, txt], i) => <span key={i} className={k}>{i ? ' · ' : ''}{txt}</span>)}</> : <span className="ok">No issues</span>}</span></span>;
}
function PersonHead({ s }) { const h = H.personHeadline(s); return <span className={`rt-ph ${h.key}`}>{h.text}</span>; }
function PersonIssues({ s }) {
  const bad = [s.blocked && `${s.blocked} blocked`, s.overdue && `${s.overdue} overdue`].filter(Boolean);
  return <span className="rt-proll">{H.personLine(s)}{bad.length ? <span className="rt-pbad"> · ⚠︎ {bad.join(' · ')}</span> : null}{s.peak >= 2 ? <span className="rt-pov"> · {s.peak} concurrent</span> : null}</span>;
}
// Hover details for a task: fields + computed overdue / overlap / weekly impact.
function TaskTip({ db, t, today, pos }) {
  const I = M.index(db); const p = I.person[t.person_id]; const pr = I.project[t.project_id];
  const od = M.overdueDays(t, today); const reasons = [];
  if (od) reasons.push(`${od} day${od === 1 ? '' : 's'} overdue`);
  if (M.isBlocked(t)) reasons.push('Blocked');
  if (M.dateKind(t) === 'due-only') reasons.push('Start not defined'); else if (M.dateKind(t) === 'start-only') reasons.push('Due not defined'); else if (M.dateKind(t) === 'none') reasons.push('Dates not defined');
  if (!od && M.isActive(t) && t.due_date && t.due_date >= today) { const n = M.daysBetween(today, t.due_date); reasons.push(n === 0 ? 'Due today' : `Due in ${n}d`); }
  const mine = db.rt_tasks.filter((x) => x.person_id === t.person_id && x.active !== false).map((x) => (x.id === t.id ? t : x));
  const ov = (M.overlapMap(mine)[t.id] || []).map((id) => mine.find((x) => x.id === id)).filter(Boolean);
  let impact = null;
  if (t.start_date && t.due_date && M.isActive(t)) {
    const n = Math.min(26, Math.ceil((M.daysBetween(M.weekStart(t.start_date), t.due_date) + 1) / 7));
    const loads = M.personLoad({ ...db, rt_tasks: mine }, t.person_id, M.weeksFrom(t.start_date, n));
    const span = `${M.wkLabel(loads[0].wk)}${loads.length > 1 ? `–${M.wkLabel(loads[loads.length - 1].wk)}` : ''}`;
    if (t.hours_per_week == null) impact = `${span}: hours not estimated — weekly impact unknown`;
    else { const peak = loads.reduce((a, w) => (w.h > a.h ? w : a), loads[0]); impact = `${span}: +${fmtH(t.hours_per_week)} h/wk · busiest ${M.wkLabel(peak.wk)} ${fmtH(peak.h)}${peak.cap ? ` / ${peak.cap} h (${peak.pct}%${peak.key === 'over' ? ', over capacity' : ''})` : ' h'}`; }
  }
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200; const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.min(pos.x + 14, vw - 340); const top = pos.y + 16 + 330 > vh ? Math.max(8, pos.y - 340) : pos.y + 16;
  return <div className="rt-tip" role="tooltip" style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
    <div className="rt-tip-p">{pr?.name || 'No project'}</div><div className="rt-tip-t">{t.title || 'New task'}</div>
    <dl><dt>Phase</dt><dd className={t.phase_key ? '' : 'muted'}>{phaseLabel(t.phase_key)}</dd><dt>Person</dt><dd>{p?.name || '—'}</dd>
      <dt>Start</dt><dd>{t.start_date ? M.fmtD(t.start_date, true) : 'not defined'}</dd><dt>Due</dt><dd>{t.due_date ? M.fmtD(t.due_date, true) : 'not defined'}</dd>
      <dt>Hrs/Week</dt><dd>{hrsText(t)}</dd><dt>Status</dt><dd>{t.status || 'not set'}</dd><dt>Priority</dt><dd>{t.priority || 'not set'}</dd></dl>
    {t.notes && <div className={`rt-tip-n ${M.isBlocked(t) ? 'bl' : ''}`}>{t.notes}</div>}
    {reasons.length > 0 && <div className="rt-tip-c">{reasons.join(' · ')}</div>}
    {ov.length > 0 && <div className="rt-tip-o">Overlaps {H.plural(ov.length, 'task')}: {ov.slice(0, 3).map((x) => `${I.project[x.project_id]?.name || '—'} — ${x.title}`).join('; ')}{ov.length > 3 ? '…' : ''}</div>}
    {impact && <div className="rt-tip-i">{impact}</div>}
  </div>;
}
function useTip() {
  const [tip, setTip] = useState(null);
  const tipFor = (t) => ({ onMouseEnter: (e) => setTip({ t, x: e.clientX, y: e.clientY }), onMouseMove: (e) => setTip({ t, x: e.clientX, y: e.clientY }), onMouseLeave: () => setTip(null) });
  return [tip, setTip, tipFor];
}
// Width of an element that may be unmounted/remounted (e.g. Timeline ↔ Focus); re-observes on change.
function useWidth() {
  const [w, setW] = useState(0); const ro = useRef(null);
  const ref = React.useCallback((el) => {
    ro.current?.disconnect(); ro.current = null;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver !== 'undefined') { ro.current = new ResizeObserver(() => { if (el.isConnected && el.clientWidth) setW(el.clientWidth); }); ro.current.observe(el); }
  }, []);
  return [ref, w];
}

// ── Gantt (shared visual language with the PM Workflow Master Timeline) ─────
// Continuous date axis: month row + week row, faint week lines, month lines, current-week band,
// Today line, floating bars. Used by the Planner (compact) and the Timeline (large).
function geometry(vs, avail, minCol) {
  const today = todayISO();
  const weeks = M.weeksFrom(M.addDays(M.weekStart(today), (vs.offset - 1) * 7), vs.range);
  const start = weeks[0]; const end = M.addDays(weeks[weeks.length - 1], 7);
  const colW = Math.max(minCol, avail ? Math.floor(avail / vs.range) : minCol);
  const W = colW * weeks.length; const dayW = colW / 7;
  const x = (d) => ((M.toD(d) - M.toD(start)) / 864e5) * dayW;
  const curWk = M.weekStart(today);
  const todayX = today >= start && today < end ? x(today) + dayW / 2 : null;
  const months = [{ d: start, x: 0 }];
  for (let d = `${start.slice(0, 8)}01`; d < end; ) { const [y, m] = d.split('-').map(Number); d = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`; if (d < end) months.push({ d, x: x(d) }); }
  months.forEach((m, i) => { m.w = (months[i + 1]?.x ?? W) - m.x; const [y, mo] = m.d.split('-').map(Number); m.label = m.w > 110 ? `${MONTHS[mo - 1]} ${y}` : m.w > 40 ? MONTHS[mo - 1].slice(0, 3) : ''; });
  return { today, weeks, start, end, colW, W, dayW, x, curWk, todayX, months };
}
function GHeader({ g }) {
  return <>
    <div className="rg-months">{g.months.map((m) => <span key={m.d} className="rg-m" style={{ left: m.x, width: m.w }}>{m.label}</span>)}</div>
    <div className="rg-weeks">{g.weeks.map((wk) => <span key={wk} className={`rg-w ${wk === g.curWk ? 'cur' : ''}`} style={{ left: g.x(wk), width: g.colW }}><b>{M.wkLabel(wk)}</b>{g.colW >= 64 && <i>{M.fmtD(wk)}</i>}</span>)}</div>
    {g.todayX != null && <span className="rg-today-h" style={{ left: g.todayX }}>Today {M.fmtD(g.today)}</span>}
  </>;
}
function GBg({ g }) {
  const cw = g.weeks.indexOf(g.curWk);
  return <>
    {cw >= 0 && <span className="rg-cur" style={{ left: g.x(g.curWk), width: g.colW }} />}
    {g.weeks.slice(1).map((wk) => <span key={wk} className="rg-wl" style={{ left: g.x(wk) }} />)}
    {g.months.slice(1).map((m) => <span key={m.d} className="rg-ml" style={{ left: m.x }} />)}
    {g.todayX != null && <span className="rg-today" style={{ left: g.todayX }} />}
  </>;
}
// Summary bar (like PM phase rows): union of the scheduled ranges of active tasks.
function Coverage({ tasks, g, cls = '' }) {
  const r = tasks.filter((t) => M.isActive(t) && t.start_date && t.due_date).map((t) => [t.start_date, t.due_date]).sort((a, b) => a[0].localeCompare(b[0]));
  const segs = []; r.forEach(([a, b]) => { const l = segs[segs.length - 1]; if (l && a <= M.addDays(l[1], 1)) { if (b > l[1]) l[1] = b; } else segs.push([a, b]); });
  return segs.map(([a, b]) => { const x0 = Math.max(0, g.x(a)); const x1 = Math.min(g.W, g.x(M.addDays(b, 1))); return x1 > x0 ? <span key={a} className={`rg-cov ${cls}`} style={{ left: x0, width: x1 - x0 }} title={`Scheduled work ${M.fmtD(a)} – ${M.fmtD(b)}`} /> : null; });
}
// Weekly load marks on a person row — subtle text, no cell boxes.
function LoadMarks({ db, pid, g }) {
  return M.personLoad(db, pid, g.weeks).map((w) => {
    if (!w.h && !w.unest) return null;
    const txt = w.cap ? `${w.pct}%` : `${fmtH(w.h)} h`;
    return <span key={w.wk} className={`rg-load ${w.key}`} style={{ left: g.x(w.wk), width: g.colW }} title={`${M.wkLabel(w.wk)}: ${fmtH(w.h)} of ${w.cap ?? '—'} h · ${w.label}${w.unest ? ` · ${w.unest} unestimated task(s) not counted` : ''}`}>
      {w.h ? <>{w.key === 'over' && '▲ '}{txt}</> : null}{w.unest ? <em>{w.h ? ' +' : ''}{w.unest}?</em> : null}</span>;
  });
}
function ganttMarks(t, g, compact = false) {
  const { x, W, dayW, start, end, today, todayX } = g;
  const kind = M.dateKind(t); const od = M.overdueDays(t, today); const sk = stKey(t.status);
  const cx = (v) => Math.max(0, Math.min(W, v));
  const inR = (d) => d >= start && d < end;
  const els = [];
  const label = (a, b, text, cls = '') => { if (!text) return; if (b + 150 < W) els.push(<span key="lbl" className={`rg-lbl ${cls}`} style={{ left: b + 6 }}>{text}</span>); else if (a > 150) els.push(<span key="lbl" className={`rg-lbl r ${cls}`} style={{ right: W - a + 6 }}>{text}</span>); };
  const overdue = (dueEndX) => {
    if (!od) return null;
    const a = cx(dueEndX); const b = todayX != null ? todayX : (today >= end ? W : 0);
    if (b > a + 1) els.push(<span key="ovx" className="rg-ovx" style={{ left: a, width: b - a }} />);
    if (kind === 'bar' && dueEndX >= 0 && dueEndX <= W) els.push(<span key="ovd" className="rg-ovd" style={{ left: dueEndX - 1 }} />);
    els.push(<span key="ovb" className="rg-ovb" style={{ left: Math.min(W - 92, Math.max(b, a) + 6) }}>Overdue · {od}d</span>);
    return true;
  };
  const bl = t.status === 'Blocked';
  const text = compact ? (bl ? '⚠︎ BLOCKED' : '') : `${bl ? '⚠︎ BLOCKED · ' : t.status === 'Done' ? '✓ Done · ' : ''}${hrsText(t)}`;
  if (kind === 'bar') {
    const a = x(t.start_date); const b = x(M.addDays(t.due_date, 1));
    if (b <= 0 && !od) els.push(<span key="e" className="rg-edge left">◂ ended {M.fmtD(t.due_date)}</span>);
    else if (a >= W) els.push(<span key="e" className="rg-edge right">starts {M.fmtD(t.start_date)} ▸</span>);
    else {
      if (b > 0) { els.push(<span key="bar" className={`rg-bar b-${sk} ${od ? 'is-od' : ''} ${t.hours_per_week == null ? 'unest' : ''}`} style={{ left: cx(a), width: Math.max(6, cx(b) - cx(a)) }} />); if (!od) label(cx(a), cx(b), text, bl ? 'bl' : ''); }
      else els.push(<span key="e" className="rg-edge left od">◂ due {M.fmtD(t.due_date)}</span>);
      overdue(b);
    }
  } else if (kind === 'due-only') {
    const dx = x(t.due_date) + dayW / 2;
    if (inR(t.due_date)) { els.push(<span key="mk" className={`rg-ms ${od ? 'od' : ''}`} style={{ left: dx }} title="Start not defined">◆</span>); if (!od) label(dx - 6, dx + 6, compact ? '' : `Start not defined · due ${M.fmtD(t.due_date)}`); }
    else if (!od) els.push(<span key="e" className={`rg-edge ${t.due_date < start ? 'left' : 'right'}`}>{t.due_date < start ? `◂ due ${M.fmtD(t.due_date)} · Start not defined` : `Start not defined · due ${M.fmtD(t.due_date)} ▸`}</span>);
    else els.push(<span key="e" className="rg-edge left od">◂ due {M.fmtD(t.due_date)}</span>);
    overdue(x(M.addDays(t.due_date, 1)));
  } else if (kind === 'start-only') {
    const sx = x(t.start_date);
    if (inR(t.start_date)) { els.push(<span key="tail" className="rg-tail" style={{ left: sx, width: W - sx }} />); els.push(<span key="mk" className="rg-st" style={{ left: sx }} title="Due not defined">▶</span>); label(sx, sx + 8, compact ? '' : `Due not defined · from ${M.fmtD(t.start_date)}`); }
    else els.push(<span key="e" className={`rg-edge ${t.start_date < start ? 'left' : 'right'}`}>{t.start_date < start ? `◂ started ${M.fmtD(t.start_date)} · Due not defined` : `starts ${M.fmtD(t.start_date)} ▸ · Due not defined`}</span>);
  } else els.push(<span key="n" className="rg-nodate">Dates not defined</span>);
  return els;
}

// ── Shared toolbar pieces (Planner and Timeline share the same filters) ─────
function KpiStrip({ db, vs, setF }) {
  const kc = H.kpiCounts(db, todayISO(), vs.f);
  return <div className="rt-kpis compact" role="group" aria-label="Key figures — click to filter">
    {H.KPIS.map(([k, label, unit]) => <button key={k} title={H.KPI_HELP[k]} className={`rt-kpi k-${k} ${vs.f.kpi === k ? 'on' : ''} ${kc[k] ? '' : 'zero'}`} aria-pressed={vs.f.kpi === k} onClick={() => setF({ kpi: vs.f.kpi === k ? '' : k })}>
      <b>{kc[k]}</b><span>{label}{unit ? <em> ({unit})</em> : null}</span></button>)}
  </div>;
}
function RangeBar({ vs, setVs, g }) {
  const step = vs.range / 2;
  return <>
    <div className="seg" role="group" aria-label="Show"><button className={vs.mode === 'all' ? 'on' : ''} aria-pressed={vs.mode === 'all'} onClick={() => setVs({ mode: 'all' })}>All</button><button className={vs.mode === 'attention' ? 'on' : ''} aria-pressed={vs.mode === 'attention'} onClick={() => setVs({ mode: 'attention' })}>Needs Attention</button></div>
    <div className="seg" role="group" aria-label="Range">{[4, 8, 12].map((n) => <button key={n} className={vs.range === n ? 'on' : ''} aria-pressed={vs.range === n} onClick={() => setVs({ range: n })}>{n} Weeks</button>)}</div>
    <div className="seg" role="group" aria-label="Period"><button onClick={() => setVs({ offset: vs.offset - step })} aria-label="Previous">‹ Previous</button><button className={vs.offset === 0 ? 'on' : ''} onClick={() => setVs({ offset: 0 })}>Today</button><button onClick={() => setVs({ offset: vs.offset + step })} aria-label="Next">Next ›</button></div>
    <span className="rt-period">{M.wkLabel(g.start)}–{M.wkLabel(g.weeks[g.weeks.length - 1])} · {M.fmtD(g.start)} – {M.fmtD(M.addDays(g.end, -1), true)}</span>
  </>;
}
const EMPTY_F = { disc: '', person: '', project: '', phase: '', status: '', priority: '', q: '', kpi: '' };
function FilterBar({ db, vs, setF, setVs }) {
  const f = vs.f;
  const F = (k) => (e) => setF({ [k]: e.target.value, ...(k === 'disc' ? { person: '' } : {}) });
  const people = M.sortBy(db.rt_people.filter((p) => (!f.disc || p.discipline_id === f.disc)));
  const active = [f.disc && 'discipline', f.person && 'person', f.project && 'project', f.phase && 'phase', f.status && 'status', f.priority && 'priority', f.q && 'search', f.kpi && 'KPI', vs.mode === 'attention' && 'Needs Attention'].filter(Boolean);
  return <div className="rt-toolbar rt-filters">
    <label className="rt-filter rt-search">Search<input id="rt-q" value={f.q} onChange={F('q')} placeholder="Project, task, person or note" /></label>
    <label className="rt-filter">Discipline<select id="rt-f-disc" value={f.disc} onChange={F('disc')}><option value="">All</option>{M.disciplinesOf(db).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="rt-filter">Person<select id="rt-f-person2" value={f.person} onChange={F('person')}><option value="">All</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inactive)'}</option>)}</select></label>
    <label className="rt-filter">Project<select id="rt-f-project2" value={f.project} onChange={F('project')}><option value="">All</option>{M.sortBy(db.rt_projects).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (archived)'}</option>)}</select></label>
    <label className="rt-filter">Phase<select id="rt-f-phase" value={f.phase} onChange={F('phase')}><option value="">All</option><option value="-">Not assigned</option>{PM_PHASES.map((p) => <option key={p.key} value={p.key}>{p.no} {p.label}</option>)}</select></label>
    <label className="rt-filter">Status<select id="rt-f-status2" value={f.status} onChange={F('status')}><option value="">All</option>{M.STATUSES.map((s) => <option key={s}>{s}</option>)}<option value="-">Not set</option></select></label>
    <label className="rt-filter">Priority<select id="rt-f-priority2" value={f.priority} onChange={F('priority')}><option value="">All</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}<option value="-">Not set</option></select></label>
    {active.length > 0 && <button className="linkish small rt-clear" onClick={() => { setVs({ f: EMPTY_F, mode: 'all' }); }}>Clear filters ({active.join(', ')})</button>}
  </div>;
}

// ── Compact calendar picker (Start / Due) ───────────────────────────────────
const parseTyped = (s, ref) => {
  const v = s.trim(); if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/); if (m) { const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : ref.slice(0, 4); return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = v.match(/^(\d{1,2})\s*([A-Za-z]{3,})\.?\s*(\d{4})?$/); if (m) { const mo = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3))); if (mo >= 0) return `${m[3] || ref.slice(0, 4)}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
const validISO = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && M.iso(M.toD(s)) === s;
function DatePick({ value, onPick, label, className = '', children }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('');
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null); const pop = useRef(null);
  const place = () => { const r = btn.current?.getBoundingClientRect(); if (!r) return; const h = 292; const w = 232; let top = r.bottom + 3; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 3); setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) }); };
  const show = () => { const base = value || todayISO(); setView(base.slice(0, 7)); setTyped(''); setBad(false); place(); setOpen(true); };
  useEffect(() => {
    if (!open) return undefined;
    const out = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    const re = () => place(); const key = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', out); window.addEventListener('scroll', re, true); window.addEventListener('resize', re); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', out); window.removeEventListener('scroll', re, true); window.removeEventListener('resize', re); document.removeEventListener('keydown', key); };
  }, [open]);
  const choose = (v) => { setOpen(false); onPick(v); btn.current?.focus(); };
  const vw = view || (value || todayISO()).slice(0, 7);
  const [vy, vm] = vw.split('-').map(Number);
  const first = `${vw}-01`; const lead = open ? (M.toD(first).getUTCDay() + 6) % 7 : 0;
  const cells = open ? Array.from({ length: 42 }, (_, i) => M.addDays(first, i - lead)) : [];
  const shift = (n) => { const d = new Date(Date.UTC(vy, vm - 1 + n, 1)); setView(M.iso(d).slice(0, 7)); };
  const today = todayISO();
  return <>
    <button type="button" ref={btn} className={`rt-in rt-dbtn ${className} ${open ? 'open' : ''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} title={label} onClick={() => (open ? setOpen(false) : show())}
      onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); show(); } }}>{children}</button>
    {open && pos && <div ref={pop} className="rt-cal" role="dialog" aria-label={`${label} — choose a date`} style={{ top: pos.top, left: pos.left }}>
      <div className="rt-cal-h"><button type="button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button><b>{MONTHS[vm - 1]} {vy}</b><button type="button" aria-label="Next month" onClick={() => shift(1)}>›</button></div>
      <div className="rt-cal-g" role="grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="dow">{d}</span>)}
        {cells.map((d) => <button type="button" key={d} role="gridcell" aria-label={M.fmtD(d, true)} aria-selected={d === value} className={`${d.slice(0, 7) === vw ? '' : 'out'} ${d === value ? 'sel' : ''} ${d === today ? 'tod' : ''}`} onClick={() => choose(d)}>{+d.slice(8)}</button>)}</div>
      <div className="rt-cal-f">
        <input className={`rt-cal-in ${bad ? 'bad' : ''}`} aria-label="Type a date" placeholder="Type e.g. 12 Oct" value={typed} onChange={(e) => { setTyped(e.target.value); setBad(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = parseTyped(typed, value || today); if (v === '' || validISO(v)) choose(v || null); else setBad(true); } }} />
        <button type="button" onClick={() => choose(today)}>Today</button>
        <button type="button" className="clr" onClick={() => choose(null)} disabled={!value}>Clear</button>
      </div>
    </div>}
  </>;
}

// ── Planner: Discipline → Person → editable task rows + compact Gantt ───────
// Rows and bars are two views of the same rt_tasks record. Lists and dates save as soon as they
// are chosen; text and hours save on Enter or when you leave the cell.
const COLS_WIDE = [['project', 'Project', 100], ['title', 'Task', 176], ['phase', 'Phase', 118], ['start', 'Start', 66], ['due', 'Due', 82], ['hrs', 'Hrs/Wk', 54], ['status', 'Status', 98], ['priority', 'Priority', 74], ['notes', 'Notes', 116], ['menu', '', 46]];
const COLS_NARROW = COLS_WIDE.filter(([k]) => k !== 'priority' && k !== 'notes');
const INDENT = 44; const GAP = 4;
const fromT = (t) => ({ project_id: t.project_id || '', title: t.title || '', phase_key: t.phase_key || '', start_date: t.start_date || '', due_date: t.due_date || '', hours_per_week: t.hours_per_week == null ? '' : String(t.hours_per_week), status: t.status || '', priority: t.priority || '', notes: t.notes || '' });
const valOf = (f) => ({ ...f, phase_key: f.phase_key || null, start_date: f.start_date || null, due_date: f.due_date || null, hours_per_week: f.hours_per_week === '' ? null : +f.hours_per_week, status: f.status || null, priority: f.priority || null, notes: f.notes || null });

function Planner({ store, db, setPanel, say, setConfirm, vs, setVs, setF }) {
  const today = todayISO();
  const [tip, , tipFor] = useTip();
  const [drafts, setDrafts] = useState({}); // personId → [{ key, id? }] rows added in this session
  const filt = { ...vs.f, mode: vs.mode };
  const filtering = H.taskFiltering(filt);
  const tree = H.buildTree(db, today, filt);
  const O = useOpen(filtering, JSON.stringify(filt), 'planner');
  const I = M.index(db);
  const [gridRef, gw] = useWidth();
  const cols = !gw || gw >= 1240 ? COLS_WIDE : COLS_NARROW;
  const tpl = cols.map((c) => `${c[2]}px`).join(' ');
  const L = INDENT + cols.reduce((s, c) => s + c[2], 0) + GAP * (cols.length - 1) + 10;
  const sticky = !gw || gw >= 860;
  const g = { ...geometry(vs, gw && sticky ? gw - L - 2 : 0, vs.range === 4 ? 96 : vs.range === 8 ? 48 : 34), L };
  const addTask = (p) => { O.setOne(p.discipline_id, true); O.setOne(p.id, true); setDrafts((d) => ({ ...d, [p.id]: [...(d[p.id] || []), { key: `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }] })); };
  const onCreated = (pid, key, id) => setDrafts((d) => ({ ...d, [pid]: d[pid].map((r) => (r.key === key ? { ...r, id } : r)) }));
  const onCancel = (pid, key) => setDrafts((d) => ({ ...d, [pid]: d[pid].filter((r) => r.key !== key) }));
  const ctx = { store, db, say, setConfirm, setPanel };
  const row = (cls, left, right) => <div className={`rt-row ${cls}`} style={{ width: L + g.W }}>{left}<div className="rt-r rg-track" style={{ width: g.W }}><GBg g={g} />{right}</div></div>;
  return (
    <div className="rt-planner">
      <KpiStrip db={db} vs={vs} setF={setF} />
      <div className="rt-toolbar">
        <RangeBar vs={vs} setVs={setVs} g={g} />
        <span className="grow" />
        <button className="btn sm" onClick={() => O.setAll(tree, true)}>Expand All</button>
        <button className="btn sm" onClick={() => O.setAll(tree, false)}>Collapse All</button>
        <select className="btn primary sm rt-addsel" aria-label="Add task for a person" value="" onChange={(e) => { const p = I.person[e.target.value]; if (p) addTask(p); }}>
          <option value="">+ Add Task for…</option>
          {M.disciplinesOf(db).map((d) => { const ps = M.peopleOf(db, d.id); return ps.length ? <optgroup key={d.id} label={d.name}>{ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null; })}
        </select>
      </div>
      <FilterBar db={db} vs={vs} setF={setF} setVs={setVs} />
      <div className={`rt-grid rt-pgrid rg ${sticky ? '' : 'nosticky'}`} ref={gridRef} role="treegrid" aria-label="Resource planner" style={{ '--l': `${L}px` }}>
        <div className="rt-row rt-hdr rg-hdr" style={{ width: L + g.W }}>
          <div className="rt-l rt-cells rt-hcols" style={{ gridTemplateColumns: tpl, columnGap: GAP, paddingLeft: INDENT }}>{cols.map(([k, l]) => <span key={k} className={`c-${k}`}>{l}</span>)}</div>
          <div className="rt-r rg-hr" style={{ width: g.W }}><GHeader g={g} /></div>
        </div>
        {!tree.length && row('', <div className="rt-l muted small">Nothing matches these filters.</div>)}
        {tree.map(({ d, stats, people: ppl }) => {
          const dOpen = O.isOpen(d.id);
          return (
            <div key={d.id} className={`rt-disc ${d.kind === 'management' ? 'mgmt' : ''} ${dOpen ? 'open' : ''}`} data-name={d.name}>
              {row('rt-drow', <div className="rt-l"><button className="rt-dhead" aria-expanded={dOpen} aria-label={`${dOpen ? 'Collapse' : 'Expand'} ${d.name}`} onClick={() => O.toggle(d.id)}><Chev open={dOpen} />
                <span className="rt-dtext"><span className="rt-dname">{d.name}</span><DiscRollup s={stats} /></span></button></div>)}
              {dOpen && !ppl.length && row('rt-empty', <div className="rt-l">No people yet</div>)}
              {dOpen && ppl.map(({ p, stats: ps, tasks }) => {
                const pOpen = O.isOpen(p.id);
                const mine = drafts[p.id] || [];
                const pinned = new Set(mine.filter((r) => r.id).map((r) => r.id));
                const lines = [...tasks.filter((t) => !pinned.has(t.id)).map((t) => ({ key: t.id, t })),
                  ...mine.map((r) => (r.id ? (I.task[r.id] && (!filtering || tasks.some((t) => t.id === r.id)) ? { key: r.key, t: I.task[r.id], r } : null) : { key: r.key, t: { person_id: p.id, project_id: vs.f.project || '', phase_key: vs.f.phase && vs.f.phase !== '-' ? vs.f.phase : '' }, r })).filter(Boolean)];
                return (
                  <div key={p.id} className={`rt-person ${p.active ? '' : 'inactive'}`} data-name={p.name}>
                    {row('rt-prow', <div className="rt-l"><button className="rt-phead" aria-expanded={pOpen} aria-label={`${pOpen ? 'Collapse' : 'Expand'} ${p.name}`} onClick={() => O.toggle(p.id)}><Chev open={pOpen} />
                      <span className="rt-dtext"><span className="rt-pname">{p.name}{!p.active && <span className="muted"> (inactive)</span>}<PersonHead s={ps} /></span><PersonIssues s={ps} /></span></button></div>,
                      <LoadMarks db={db} pid={p.id} g={g} />)}
                    {pOpen && <>
                      {lines.map(({ key, t, r }) => <TaskLine key={key} ctx={ctx} t={t} personId={p.id} cols={cols} tpl={tpl} g={g} tipFor={tipFor} why={vs.mode === 'attention'} om={ps.om} autoFocus={!!r && !r.id}
                        onCreated={(id) => onCreated(p.id, key, id)} onCancel={() => onCancel(p.id, key)} />)}
                      {p.active ? row('rt-add', <div className="rt-l"><button className="linkish rt-addbtn" onClick={() => addTask(p)}>+ Add Task</button>{!lines.length && <span className="muted small"> · no tasks yet</span>}</div>)
                        : !lines.length && row('rt-add', <div className="rt-l muted small">No tasks</div>)}
                    </>}
                  </div>);
              })}
            </div>);
        })}
      </div>
      <Legend extra="Edit any cell: lists and dates save when chosen; text and hours save on Enter or when you leave the cell. Esc cancels." />
      {tip && <TaskTip db={db} t={tip.t} today={today} pos={tip} />}
    </div>
  );
}
const Legend = ({ extra }) => <div className="rt-legend" aria-label="Legend">
  <span><i className="lg b-inprogress" /> In Progress</span><span><i className="lg b-notstarted" /> Not Started / not set</span><span><i className="lg b-waiting" /> Waiting</span>
  <span><i className="lg b-blocked" /> ⚠︎ Blocked</span><span><i className="lg b-done" /> Done</span><span><i className="lg ovx" /> Overdue (Due → Today)</span>
  <span><i className="lg-due">◆</i> Due only · Start not defined</span><span><i className="lg-start">▶</i> Start only · Due not defined</span><span><i className="lg-today" /> Today</span>
  <span>Load: % of weekly capacity · <b>▲</b> over capacity · <b>?</b> tasks without Hrs/Wk</span>
  {extra && <span className="muted">{extra}</span>}
</div>;

function TaskLine({ ctx, t, personId, cols, tpl, g, tipFor, why, om, autoFocus, onCreated, onCancel }) {
  const { store, db, say, setConfirm, setPanel } = ctx;
  const isNew = !t.id;
  const [f, setF] = useState(() => fromT(t));
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(0);
  const [menu, setMenu] = useState(false);
  const ref = useRef(null); const skip = useRef(false);
  // Remote / stored changes: take the new value for every field this row hasn't changed locally;
  // a field being edited keeps the user's text (it is saved when they leave it).
  const base = useRef(fromT(t));
  useEffect(() => {
    const prev = base.current; const next = fromT(t); base.current = next;
    setF((cur) => Object.fromEntries(Object.keys(next).map((k) => [k, cur[k] === prev[k] ? next[k] : cur[k]])));
  }, [t.id, t.updated_at, t.due_date, t.start_date, t.hours_per_week, t.status, t.priority, t.phase_key, t.project_id, t.title, t.notes]);
  useEffect(() => { if (!saved) return undefined; const tm = setTimeout(() => setSaved(0), 1600); return () => clearTimeout(tm); }, [saved]);
  useEffect(() => { if (!menu) return undefined; const h = (e) => { if (!ref.current?.querySelector('.c-menu')?.contains(e.target)) setMenu(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [menu]);
  const commit = (nf = f, explicit = false) => {
    if (isNew) {
      if (!nf.project_id || !nf.title.trim()) { if (explicit) setErr('Choose a project and enter a task name.'); return false; }
      const r = store.saveTask({ ...nf, person_id: personId });
      if (!r.ok) { setErr(r.error); say(r); return false; }
      setErr(null); setSaved(Date.now()); onCreated(r.row.id); return true;
    }
    if (JSON.stringify(nf) === JSON.stringify(fromT(t))) { setErr(null); return true; }
    // Only send the fields changed here, on top of the latest stored row (keeps others' edits).
    const changed = Object.fromEntries(Object.keys(nf).filter((k) => nf[k] !== base.current[k]).map((k) => [k, nf[k]]));
    if (!Object.keys(changed).length) { setErr(null); return true; }
    const r = store.saveTask({ ...t, ...fromT(t), ...changed, id: t.id });
    if (!r.ok) { setErr(r.error); say(r); return false; }
    setErr(null); setSaved(Date.now()); return true;
  };
  const blank = !f.project_id && !f.title && !f.start_date && !f.due_date && !f.hours_per_week && !f.notes;
  const upd = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (k) => (e) => { const nf = { ...f, [k]: e.target.value }; setF(nf); commit(nf); };
  const pickDate = (k) => (v) => { const nf = { ...f, [k]: v || '' }; setF(nf); if (!commit(nf) && isNew) { /* kept as draft until project + task are set */ } };
  const keys = (k) => (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(f, true); }
    else if (e.key === 'Escape') { e.preventDefault(); skip.current = true; if (isNew && blank) { onCancel(); return; } setF({ ...f, [k]: fromT(t)[k] }); setErr(null); e.target.blur(); }
  };
  const leave = () => { if (skip.current) { skip.current = false; return; } commit(); };
  const dt = { ...t, ...valOf(f), active: t.active ?? true };
  const od = M.overdueDays(dt, g.today); const bl = dt.status === 'Blocked';
  const projects = M.activeProjects(db); const curProj = t.project_id && db.rt_projects.find((p) => p.id === t.project_id && !p.active);
  const reasons = why ? [...M.attentionReasons(dt, g.today).filter((r) => !/^Overdue|^Blocked/.test(r)), ...(H.heavyOverlap(dt, om) ? [`Overlaps ${om[dt.id].length} tasks`] : [])] : [];
  const cells = {
    project: <select className={`rt-in ${f.project_id ? '' : 'empty'}`} aria-label="Project" autoFocus={autoFocus} value={f.project_id} onChange={pick('project_id')} onKeyDown={keys('project_id')}>
      <option value="">Choose project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}{curProj && <option value={curProj.id}>{curProj.name} (archived)</option>}</select>,
    title: <input className="rt-in rt-title" aria-label="Task" value={f.title} placeholder={isNew ? 'Task description…' : ''} title={reasons.length ? `Needs attention: ${reasons.join(' · ')}` : f.title} onChange={upd('title')} onBlur={leave} onKeyDown={keys('title')} />,
    phase: <select className={`rt-in rt-phsel ${f.phase_key ? '' : 'empty'}`} aria-label="Phase" value={f.phase_key} title={phaseLabel(f.phase_key)} onChange={pick('phase_key')} onKeyDown={keys('phase_key')}>
      <option value="">Not assigned</option>{PM_PHASES.map((p) => <option key={p.key} value={p.key}>{p.no} {p.label}</option>)}</select>,
    start: <DatePick label="Start" value={f.start_date} onPick={pickDate('start_date')} className={f.start_date ? '' : 'empty'}>{f.start_date ? M.fmtD(f.start_date) : '—'}</DatePick>,
    due: <DatePick label="Due" value={f.due_date} onPick={pickDate('due_date')} className={`${f.due_date ? '' : 'empty'} ${od ? 'od' : ''}`}>
      {f.due_date ? <>{M.fmtD(f.due_date)}{od > 0 && <span className="rt-odtag">Overdue · {od}d</span>}</> : '—'}</DatePick>,
    hrs: <input className={`rt-in rt-hrsin ${f.hours_per_week === '' ? 'empty' : ''}`} aria-label="Hrs per week" inputMode="decimal" placeholder="Unest." title={f.hours_per_week === '' ? 'Unestimated' : `${f.hours_per_week} h per week`} value={f.hours_per_week} onChange={upd('hours_per_week')} onBlur={leave} onKeyDown={keys('hours_per_week')} />,
    status: <select className={`rt-in rt-stsel st-${stKey(f.status)}`} aria-label="Status" value={f.status} onChange={pick('status')} onKeyDown={keys('status')}><option value="">— status —</option>{M.STATUSES.map((s) => <option key={s} value={s}>{s === 'Blocked' ? '⚠ Blocked' : s}</option>)}</select>,
    priority: <select className={`rt-in rt-prsel pr-${(f.priority || 'none').toLowerCase()}`} aria-label="Priority" value={f.priority} onChange={pick('priority')} onKeyDown={keys('priority')}><option value="">—</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s}>{s}</option>)}</select>,
    notes: <input className={`rt-in rt-notes ${bl && f.notes ? 'bl' : ''}`} aria-label="Notes" value={f.notes} placeholder={bl ? 'Blocker reason…' : ''} title={f.notes} onChange={upd('notes')} onBlur={leave} onKeyDown={keys('notes')} />,
    menu: isNew ? <span className="rt-dacts2"><button className="rt-ok" aria-label="Save task" title="Save (Enter)" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(f, true)}>✓</button><button className="rt-x" aria-label="Cancel new task" title="Cancel (Esc)" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>×</button></span>
      : <span className="rt-dacts2">{err ? <span className="rt-errdot" title={err}>!</span> : saved ? <span className="rt-saved" title="Saved">✓</span> : null}
        <button className="rt-more" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
        {menu && <div className="rt-menu" role="menu"><button role="menuitem" onClick={() => { setMenu(false); setPanel({ kind: 'task', row: t }); }}>More details</button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(false); setConfirm({ title: 'Delete this task?', text: `"${t.title}" will be removed from the Resource Tracker for everyone. This cannot be undone.`, action: () => say(store.deleteTask(t.id), 'Task deleted') }); }}>Delete task</button></div>}</span>,
  };
  return (
    <div ref={ref} className={`rt-row rt-trow rt-erow ${isNew ? 'draft' : ''} ${bl ? 'is-bl' : ''} ${od ? 'is-od' : ''} ${dt.status === 'Done' ? 'is-done' : ''} ${err ? 'has-err' : ''} ${menu ? 'menu-open' : ''}`} style={{ width: g.L + g.W }} data-title={t.title || ''} role="row">
      <div className="rt-l rt-cells" style={{ gridTemplateColumns: tpl, columnGap: GAP, paddingLeft: INDENT }}>{cols.map(([k]) => <div key={k} className={`rt-c c-${k}`}>{cells[k]}</div>)}
        {err && <div className="rt-rowerr" role="alert">{err}</div>}
        {!err && reasons.length > 0 && <div className="rt-why2">Needs attention: {reasons.join(' · ')}</div>}</div>
      <div className="rt-r rt-track rg-track" style={{ width: g.W }} onClick={() => ref.current?.querySelector('.c-title input')?.focus()} {...(dt.title ? tipFor(dt) : {})}>
        <GBg g={g} />{isNew && blank ? <span className="rg-nodate">New task — choose a project, describe it, set dates</span> : ganttMarks(dt, g, true)}</div>
    </div>
  );
}

// ── Timeline: large Gantt for resource analysis (read-only rows) ────────────
function ResourceTimeline({ db, setPanel, vs, setVs, setF }) {
  const today = todayISO();
  const [focus, setFocus] = useState(null); // person id in Focus mode
  const [tip, setTip, tipFor] = useTip();
  const filt = { ...vs.f, mode: vs.mode };
  const filtering = H.taskFiltering(filt);
  const tree = H.buildTree(db, today, filt);
  const O = useOpen(filtering, JSON.stringify(filt), 'timeline');
  const I = M.index(db);
  const [gridRef, gw] = useWidth();
  const L = gw && gw < 900 ? 250 : 340;
  const g = { ...geometry(vs, gw ? gw - L - 2 : 0, vs.range === 4 ? 140 : vs.range === 8 ? 76 : 56), L };
  const open = (t) => { setTip(null); setPanel({ kind: 'task', row: t }); };
  const row = (cls, left, right, extra = {}) => <div className={`rt-row ${cls}`} style={{ width: L + g.W }} {...extra}>{left}<div className="rt-r rg-track" style={{ width: g.W }}><GBg g={g} />{right}</div></div>;
  const fp = focus && I.person[focus];
  if (fp) return <PersonFocus db={db} p={fp} vs={vs} setVs={setVs} setPanel={setPanel} back={() => { O.setOne(fp.discipline_id, true); O.setOne(fp.id, true); setFocus(null); }} />;
  return (
    <div className="rt-timeline2">
      <KpiStrip db={db} vs={vs} setF={setF} />
      <div className="rt-toolbar">
        <RangeBar vs={vs} setVs={setVs} g={g} />
        <span className="grow" />
        <button className="btn sm" onClick={() => O.setAll(tree, true)}>Expand All</button>
        <button className="btn sm" onClick={() => O.setAll(tree, false)}>Collapse All</button>
      </div>
      <FilterBar db={db} vs={vs} setF={setF} setVs={setVs} />
      <div className="rt-grid rg rg-big" ref={gridRef} role="treegrid" aria-label="Resource timeline" style={{ '--l': `${L}px` }}>
        <div className="rt-row rt-hdr rg-hdr" style={{ width: L + g.W }}>
          <div className="rt-l rg-hl">Discipline / person / task</div>
          <div className="rt-r rg-hr" style={{ width: g.W }}><GHeader g={g} /></div>
        </div>
        {!tree.length && row('', <div className="rt-l muted small">Nothing matches these filters.</div>)}
        {tree.map(({ d, stats, people: ppl }) => {
          const dOpen = O.isOpen(d.id);
          return (
            <div key={d.id} className={`rt-disc ${d.kind === 'management' ? 'mgmt' : ''} ${dOpen ? 'open' : ''}`} data-name={d.name}>
              {row('rt-drow tl2-d', <div className="rt-l"><button className="rt-dhead" aria-expanded={dOpen} aria-label={`${dOpen ? 'Collapse' : 'Expand'} ${d.name}`} onClick={() => O.toggle(d.id)}><Chev open={dOpen} />
                <span className="rt-dtext"><span className="rt-dname">{d.name}</span><DiscRollup s={stats} /></span></button>
                {ppl.length > 0 && <button className="rt-only" title={`Expand only ${d.name}`} aria-label={`Expand only ${d.name}`} onClick={() => O.only(tree, d.id)}>Only</button>}</div>,
                <Coverage tasks={ppl.flatMap((x) => x.tasks)} g={g} cls="d" />)}
              {dOpen && !ppl.length && row('rt-empty', <div className="rt-l">No people yet</div>)}
              {dOpen && ppl.map(({ p, stats: ps, tasks }) => {
                const pOpen = O.isOpen(p.id); const note = H.overlapNote(ps);
                return (
                  <div key={p.id} className={`rt-person ${p.active ? '' : 'inactive'}`} data-name={p.name}>
                    {row('rt-prow tl2-p', <div className="rt-l"><button className="rt-phead" aria-expanded={pOpen} aria-label={`${pOpen ? 'Collapse' : 'Expand'} ${p.name}`} onClick={() => O.toggle(p.id)}><Chev open={pOpen} />
                      <span className="rt-dtext"><span className="rt-pname">{p.name}{!p.active && <span className="muted"> (inactive)</span>}</span>
                        <span className="rt-proll">{H.plural(ps.active, 'task')}{(ps.blocked || ps.overdue) ? <span className="rt-pbad"> · ⚠︎ {[ps.blocked && `${ps.blocked} blocked`, ps.overdue && `${ps.overdue} overdue`].filter(Boolean).join(' · ')}</span> : null}</span>
                        {note && <span className={`rt-ovn ${note.key}`}>{note.text}</span>}</span></button>
                      <button className="rt-focus" aria-label={`Focus ${p.name}`} title={`Focus on ${p.name}'s schedule`} onClick={() => { setTip(null); setFocus(p.id); }}>⤢ Focus</button></div>,
                      <><Coverage tasks={tasks} g={g} cls="p" /><LoadMarks db={db} pid={p.id} g={g} /></>)}
                    {pOpen && tasks.map((t) => {
                      const od = M.overdueDays(t, today); const bl = M.isBlocked(t); const pr = I.project[t.project_id];
                      return row(`rt-trow tl2-t ${bl ? 'is-bl' : ''} ${od ? 'is-od' : ''} ${t.status === 'Done' ? 'is-done' : ''}`,
                        <div className="rt-l"><button className="tl2-name" onClick={() => open(t)} {...tipFor(t)}><span className="tl2-proj">{pr?.name || '—'}</span><span className="tl2-sep"> — </span><span className="tl2-title">{t.title}</span></button>
                          <span className="tl2-flags">{od > 0 && <span className="rt-flag od sm">{od}d</span>}{bl && <span className="rt-flag bl sm">⚠︎</span>}{t.phase_key && <span className="tl2-ph" title={phaseLabel(t.phase_key)}>{PM_PHASES.find((x) => x.key === t.phase_key)?.no}</span>}</span></div>,
                        ganttMarks(t, g), { key: t.id, 'data-title': t.title, onClick: (e) => { if (e.target.closest('.rg-track')) open(t); }, ...tipForTrack(tipFor, t) });
                    })}
                    {pOpen && !tasks.length && row('rt-trow tl2-t none', <div className="rt-l muted small">{filtering ? 'No matching tasks' : 'No tasks'}</div>)}
                  </div>);
              })}
            </div>);
        })}
      </div>
      <Legend extra="Hover a bar for details · click to open it · ⤢ Focus shows one person across all projects." />
      {tip && <TaskTip db={db} t={tip.t} today={today} pos={tip} />}
    </div>
  );
}
const tipForTrack = (tipFor, t) => { const h = tipFor(t); return { onMouseMove: (e) => (e.target.closest('.rg-track') ? h.onMouseMove(e) : h.onMouseLeave()), onMouseLeave: h.onMouseLeave }; };

// Person Focus: one person, all projects, concurrency + weekly load across the range.
function PersonFocus({ db, p, vs, setVs, setPanel, back }) {
  const today = todayISO();
  const [tip, setTip, tipFor] = useTip();
  const I = M.index(db);
  const [gridRef, gw] = useWidth();
  const L = gw && gw < 900 ? 230 : 300;
  const g = { ...geometry(vs, gw ? gw - L - 2 : 0, vs.range === 4 ? 150 : vs.range === 8 ? 80 : 60), L };
  const disc = I.disc[p.discipline_id];
  const ps = M.personStats(db, p.id, today);
  const all = db.rt_tasks.filter((t) => t.person_id === p.id && t.active !== false);
  const act = all.filter(M.isActive);
  const order = (t) => (t.start_date || t.due_date || '9999');
  const dated = act.filter((t) => t.start_date && t.due_date).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.due_date.localeCompare(b.due_date));
  const partial = act.filter((t) => !(t.start_date && t.due_date) && (t.start_date || t.due_date)).sort((a, b) => order(a).localeCompare(order(b)));
  const none = act.filter((t) => !t.start_date && !t.due_date);
  const done = all.filter((t) => t.status === 'Done');
  const om = M.overlapMap(act);
  // Weekly summary from dated tasks only (undated work is listed, not placed on the calendar).
  const weekly = g.weeks.map((wk) => {
    const ts = dated.filter((t) => t.start_date <= M.addDays(wk, 6) && t.due_date >= wk);
    const known = ts.filter((t) => t.hours_per_week != null); const h = known.reduce((s, t) => s + t.hours_per_week, 0);
    const unest = ts.length - known.length; const cap = p.weekly_capacity_hours;
    return { wk, n: ts.length, h, kn: known.length, unest, cap, over: !!cap && h > cap, pct: cap ? Math.round((h / cap) * 100) : null };
  });
  // Concurrency bands (days with 2+ dated tasks running).
  const conc = M.concurrency(dated, g.start, g.end).days; const bands = [];
  conc.forEach(([d, n]) => { const last = bands[bands.length - 1]; if (n >= 2 && last && last.n === n && M.addDays(last.to, 1) === d) last.to = d; else if (n >= 2) bands.push({ from: d, to: d, n }); });
  const note = H.overlapNote(ps);
  const open = (t) => { setTip(null); setPanel({ kind: 'task', row: t }); };
  const lane = (t) => {
    const pr = I.project[t.project_id]; const od = M.overdueDays(t, today); const bl = M.isBlocked(t); const ov = om[t.id]?.length || 0;
    return <div key={t.id} className={`rt-row rt-trow pf-t ${bl ? 'is-bl' : ''} ${od ? 'is-od' : ''} ${ov ? 'has-ov' : ''}`} style={{ width: L + g.W }} data-title={t.title}>
      <div className="rt-l"><button className="pf-name" onClick={() => open(t)} {...tipFor(t)}><span className="tl2-proj">{pr?.name || '—'}</span><span className="pf-title">{t.title}</span></button>
        <span className="tl2-flags">{ov > 0 && <span className="rt-flag ov sm" title={`Runs alongside ${ov} other task(s)`}>∥ {ov}</span>}{od > 0 && <span className="rt-flag od sm">{od}d</span>}{bl && <span className="rt-flag bl sm">⚠︎ BLOCKED</span>}</span></div>
      <div className="rt-r rg-track" style={{ width: g.W }} onClick={() => open(t)} {...tipFor(t)}><GBg g={g} />{ganttMarks(t, g)}</div>
    </div>;
  };
  const group = (title, list) => (list.length ? <><div className="rt-row pf-grp" style={{ width: L + g.W }}><div className="rt-l">{title} <span className="muted">· {list.length}</span></div><div className="rt-r rg-track" style={{ width: g.W }}><GBg g={g} /></div></div>{list.map(lane)}</> : null);
  return (
    <div className="rt-focus-v">
      <div className="pf-head">
        <button className="btn sm" onClick={back}>← Back to {disc?.name || 'Discipline'}</button>
        <div className="pf-id"><div className="rt-kicker">{disc?.name} · Resource Timeline</div><h2>{p.name.toUpperCase()} — RESOURCE TIMELINE</h2>
          <div className="pf-meta"><span>Capacity: <b>{p.weekly_capacity_hours == null ? 'not set' : `${fmtH(p.weekly_capacity_hours)} h/week`}</b></span><span>{H.plural(ps.active, 'active task')}</span>
            {ps.blocked > 0 && <span className="tbad">⚠︎ {ps.blocked} blocked</span>}{ps.overdue > 0 && <span className="tbad">⚠︎ {ps.overdue} overdue</span>}
            {ps.unest > 0 && <span className="twarn">{ps.unest} unestimated</span>}<span>Peak {ps.peak} concurrent</span></div>
          {note && <div className={`rt-ovn big ${note.key}`}>{note.text}</div>}</div>
      </div>
      <div className="rt-toolbar"><RangeBar vs={vs} setVs={setVs} g={g} /></div>
      <div className="rt-grid rg rg-big pf-grid" ref={gridRef} role="grid" aria-label={`${p.name} resource timeline`} style={{ '--l': `${L}px` }}>
        <div className="rt-row rt-hdr rg-hdr" style={{ width: L + g.W }}><div className="rt-l rg-hl">Project / task</div><div className="rt-r rg-hr" style={{ width: g.W }}><GHeader g={g} /></div></div>
        <div className="rt-row pf-week" style={{ width: L + g.W }}>
          <div className="rt-l"><b>Weekly load</b><span className="muted small">dated tasks · known hours / capacity</span></div>
          <div className="rt-r rg-track" style={{ width: g.W }}><GBg g={g} />{weekly.map((w) => <span key={w.wk} className={`pf-wk ${w.over ? 'over' : ''} ${w.unest ? 'unest' : ''}`} style={{ left: g.x(w.wk), width: g.colW }}>
            {w.n ? <><b>{H.plural(w.n, 'task')}</b>{w.kn ? <span>{fmtH(w.h)}{w.cap ? ` / ${fmtH(w.cap)}` : ''} h</span> : null}{w.over ? <em className="o">OVER CAPACITY</em> : w.unest ? <em>+{w.unest} unest.</em> : null}</> : <span className="muted">—</span>}</span>)}</div>
        </div>
        <div className="rt-row pf-conc" style={{ width: L + g.W }}>
          <div className="rt-l"><b>Concurrent tasks</b><span className="muted small">days with 2+ tasks running</span></div>
          <div className="rt-r rg-track" style={{ width: g.W }}><GBg g={g} />{bands.map((b) => { const a = g.x(b.from); const w = g.x(M.addDays(b.to, 1)) - a; return <span key={b.from} className={`pf-band n${Math.min(b.n, 3)}`} style={{ left: a, width: w }} title={`${b.n} tasks at once · ${M.fmtD(b.from)}–${M.fmtD(b.to)}`}>{w > 18 ? b.n : ''}</span>; })}
            {!bands.length && <span className="rg-nodate">No overlapping dated tasks in this period</span>}</div>
        </div>
        {group('Scheduled (Start → Due)', dated)}
        {group('Only one date set', partial)}
        {group('Dates not defined', none)}
        {group('Done', done)}
      </div>
      <Legend extra="∥ n = runs alongside n other tasks. Overlap is not an error by itself; over capacity is when known hours exceed capacity." />
      {tip && <TaskTip db={db} t={tip.t} today={today} pos={tip} />}
    </div>
  );
}

// ── Task panel (add / edit) ─────────────────────────────────────────────────
function TaskPanel({ store, db, row, close, say, setConfirm }) {
  const isNew = !row.id; const today = todayISO();
  const [f, setF] = useState(() => ({ person_id: '', project_id: '', title: '', phase_key: '', start_date: '', due_date: '', hours_per_week: '', status: '', priority: '', notes: '', ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) }));
  const F = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const person = db.rt_people.find((p) => p.id === f.person_id);
  const disc = person && db.rt_disciplines.find((d) => d.id === person.discipline_id);
  const groups = M.disciplinesOf(db).map((d) => ({ d, people: M.peopleOf(db, d.id) })).filter((g) => g.people.length);
  const orig = row.person_id && db.rt_people.find((p) => p.id === row.person_id);
  const projects = M.activeProjects(db); const origProj = row.project_id && db.rt_projects.find((p) => p.id === row.project_id && !p.active);
  const save = () => { if (say(store.saveTask({ ...f, id: row.id }), isNew ? 'Task added' : 'Task saved')) close(); };
  const live = { ...row, ...f, start_date: f.start_date || null, due_date: f.due_date || null, hours_per_week: f.hours_per_week === '' ? null : +f.hours_per_week, active: row.active ?? true };
  const reasons = M.attentionReasons(live, today);
  return (
    <Drawer title={isNew ? 'Add task' : 'Edit task'} close={close} footer={<>
      <button className="btn primary" id="rt-save" onClick={save}>Save</button><button className="btn" onClick={close}>Cancel</button><span className="grow" />
      {!isNew && <button className="btn danger" onClick={() => setConfirm({ title: 'Delete this task?', text: `"${row.title}" will be removed from the Resource Tracker for everyone. This cannot be undone.`, action: () => { if (say(store.deleteTask(row.id), 'Task deleted')) close(); } })}>Delete</button>}</>}>
      <div className="rt-form">
        {!isNew && reasons.length > 0 && <div className="rt-panel-iss">{reasons.map((r) => <span key={r} className={`rt-flag ${/Overdue|Blocked/.test(r) ? (/Overdue/.test(r) ? 'od' : 'bl') : 'nt'}`}>{r === 'Blocked' ? '⚠︎ BLOCKED' : r}</span>)}</div>}
        <label>Person<select id="rt-f-person" value={f.person_id} onChange={F('person_id')}><option value="">Choose…</option>
          {groups.map((g) => <optgroup key={g.d.id} label={g.d.name}>{g.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
          {orig && !orig.active && <optgroup label="Inactive"><option value={orig.id}>{orig.name} (inactive)</option></optgroup>}</select></label>
        <div className="rt-derived">Discipline: <b>{disc ? disc.name : '—'}</b> <span className="muted">(from the person)</span></div>
        <label>Project<select id="rt-f-project" value={f.project_id} onChange={F('project_id')}><option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {origProj && <option value={origProj.id}>{origProj.name} (archived)</option>}</select></label>
        <label>Task<input id="rt-f-title" value={f.title} onChange={F('title')} placeholder="What needs doing" /></label>
        <label>Phase (future PM Workflow classification)<select id="rt-f-phase" value={f.phase_key} onChange={F('phase_key')}><option value="">Not assigned</option>{PM_PHASES.map((p) => <option key={p.key} value={p.key}>{p.no} {p.label}</option>)}</select></label>
        <div className="rt-2"><label>Start<input type="date" id="rt-f-start" value={f.start_date} onChange={F('start_date')} /></label><label>Due<input type="date" id="rt-f-due" value={f.due_date} onChange={F('due_date')} /></label></div>
        <label>Hrs / Week<input type="number" id="rt-f-hrs" min="0" max="80" step="0.5" value={f.hours_per_week} onChange={F('hours_per_week')} placeholder="Blank = unestimated" /></label>
        <div className="rt-2"><label>Status<select id="rt-f-status" value={f.status} onChange={F('status')}><option value="">— not set —</option>{M.STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Priority<select id="rt-f-priority" value={f.priority} onChange={F('priority')}><option value="">— not set —</option>{M.PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></label></div>
        <label>Notes<textarea id="rt-f-notes" rows={4} value={f.notes} onChange={F('notes')} /></label>
        <p className="small muted">Blank dates and Hrs / Week stay blank. Workload counts Hrs / Week in every week between Start and Due. Hours never change task progress.</p>
      </div>
    </Drawer>
  );
}

// ── Projects screen ─────────────────────────────────────────────────────────
function Projects({ store, db, setPanel, say, setConfirm }) {
  const [showArch, setShowArch] = useState(false);
  const count = (id) => db.rt_tasks.filter((t) => t.project_id === id).length;
  const list = M.sortBy(db.rt_projects.filter((p) => showArch || p.active));
  return (
    <div className="rt-page">
      <div className="rt-toolbar"><label className="check small"><input type="checkbox" checked={showArch} onChange={(e) => setShowArch(e.target.checked)} /> Show archived</label><span className="grow" />
        <button className="btn primary sm" onClick={() => setPanel({ kind: 'project', row: {} })}>+ Add Project</button></div>
      <div className="rt-tablewrap"><table className="rt-table">
        <thead><tr><th>Project</th><th>Status</th><th>Project Manager</th><th>Start</th><th>Target finish</th><th>Tasks</th><th>Notes</th><th /></tr></thead>
        <tbody>{list.map((p) => <tr key={p.id} className={p.active ? '' : 'inactive'}>
          <td><b>{p.name}</b>{!p.active && <span className="muted"> · archived</span>}</td><td>{p.status || <span className="muted">—</span>}</td><td>{p.project_manager || <span className="muted">—</span>}</td>
          <td>{p.start_date ? M.fmtD(p.start_date, true) : <span className="muted">—</span>}</td><td>{p.target_finish ? M.fmtD(p.target_finish, true) : <span className="muted">—</span>}</td><td>{count(p.id)}</td>
          <td className="small">{p.notes || <span className="muted">—</span>}</td>
          <td className="nowrap"><button className="linkish small" onClick={() => setPanel({ kind: 'project', row: p })}>Edit</button>{' · '}
            {p.active ? <button className="linkish small" onClick={() => say(store.setProjectActive(p.id, false), `${p.name} archived`)}>Archive</button> : <button className="linkish small" onClick={() => say(store.setProjectActive(p.id, true), `${p.name} restored`)}>Restore</button>}
            {!count(p.id) && <>{' · '}<button className="linkish small" onClick={() => setConfirm({ title: `Delete ${p.name}?`, text: 'No tasks reference this project. It will be removed permanently.', action: () => say(store.deleteProject(p.id), 'Project deleted') })}>Delete</button></>}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted">Projects with tasks can only be archived, never deleted. Archived projects leave the Add Task list and filters but keep their tasks.</p>
    </div>
  );
}
function ProjectPanel({ store, row, close, say }) {
  const isNew = !row.id;
  const [f, setF] = useState(() => ({ name: '', status: '', project_manager: '', start_date: '', target_finish: '', notes: '', ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) }));
  const F = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => { if (say(store.saveProject({ ...f, id: row.id }), isNew ? `Project "${f.name.trim()}" added` : 'Project saved')) close(); };
  return (
    <Drawer title={isNew ? 'Add project' : 'Edit project'} close={close} footer={<><button className="btn primary" id="rt-p-save" onClick={save}>Save</button><button className="btn" onClick={close}>Cancel</button></>}>
      <div className="rt-form">
        <label>Project name<input id="rt-p-name" value={f.name} onChange={F('name')} /></label>
        <div className="rt-2"><label>Status<input id="rt-p-status" value={f.status} onChange={F('status')} placeholder="e.g. Active" list="rt-pstat" /></label>
          <label>Project Manager (optional)<input id="rt-p-pm" value={f.project_manager} onChange={F('project_manager')} /></label></div>
        <datalist id="rt-pstat"><option>Active</option><option>On Hold</option><option>Completed</option></datalist>
        <div className="rt-2"><label>Start (optional)<input type="date" id="rt-p-start" value={f.start_date} onChange={F('start_date')} /></label><label>Target finish (optional)<input type="date" id="rt-p-finish" value={f.target_finish} onChange={F('target_finish')} /></label></div>
        <label>Notes<textarea id="rt-p-notes" rows={3} value={f.notes} onChange={F('notes')} /></label>
      </div>
    </Drawer>
  );
}

// ── Team screen ─────────────────────────────────────────────────────────────
function Team({ store, db, setPanel, say }) {
  const [showInactive, setShowInactive] = useState(false);
  const discs = M.disciplinesOf(db, showInactive);
  return (
    <div className="rt-page">
      <div className="rt-toolbar"><label className="check small"><input type="checkbox" id="rt-show-inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive people and disciplines</label><span className="grow" />
        <button className="btn sm" onClick={() => setPanel({ kind: 'discipline', row: {} })}>+ Add Discipline</button></div>
      <div className="rt-team">{discs.map((d, i) => {
        const people = M.peopleOf(db, d.id, showInactive);
        return <section key={d.id} className={`rt-dcard ${d.active ? '' : 'inactive'} ${d.kind === 'management' ? 'mgmt' : ''}`} aria-label={d.name}>
          <header><h2>{d.name}{!d.active && <span className="muted"> · inactive</span>}</h2>
            <span className="rt-dacts">
              <button className="linkish small" aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => say(store.moveDiscipline(d.id, -1), 'Order updated')}>↑</button>
              <button className="linkish small" aria-label={`Move ${d.name} down`} disabled={i === discs.length - 1} onClick={() => say(store.moveDiscipline(d.id, 1), 'Order updated')}>↓</button>
              <button className="linkish small" onClick={() => setPanel({ kind: 'discipline', row: d })}>Rename</button>
              {d.active ? <button className="linkish small" onClick={() => say(store.setDisciplineActive(d.id, false), `${d.name} deactivated`)}>Deactivate</button> : <button className="linkish small" onClick={() => say(store.setDisciplineActive(d.id, true), `${d.name} reactivated`)}>Reactivate</button>}
              {d.active && <button className="btn sm" onClick={() => setPanel({ kind: 'person', row: { discipline_id: d.id } })}>+ Add Person</button>}</span></header>
          {people.length ? <ul className="rt-people">{people.map((p) => <li key={p.id} className={p.active ? '' : 'inactive'}>
            <span className="rt-pn">{p.name}</span><span className="rt-role">{p.role || <span className="muted">—</span>}</span>
            <span className="rt-cap">{p.weekly_capacity_hours == null ? <span className="muted">capacity not set</span> : `${fmtH(p.weekly_capacity_hours)} h`}</span>
            <span className="rt-act">{p.active ? 'Active' : 'Inactive'}</span>
            <span className="rt-pacts"><button className="linkish small" onClick={() => setPanel({ kind: 'person', row: p })}>Edit</button>{' · '}
              {p.active ? <button className="linkish small" onClick={() => say(store.setPersonActive(p.id, false), `${p.name} deactivated — their tasks stay visible`)}>Deactivate</button> : <button className="linkish small" onClick={() => say(store.setPersonActive(p.id, true), `${p.name} reactivated`)}>Reactivate</button>}</span></li>)}</ul>
            : <p className="muted small rt-none">No people yet.</p>}
        </section>;
      })}</div>
    </div>
  );
}
function PersonPanel({ store, db, row, close, say }) {
  const isNew = !row.id;
  const [f, setF] = useState(() => ({ name: '', role: '', weekly_capacity_hours: '', discipline_id: '', active: true, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) }));
  const F = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const n = row.id ? db.rt_tasks.filter((t) => t.person_id === row.id).length : 0;
  const save = () => { if (say(store.savePerson({ ...f, id: row.id }), isNew ? `${f.name.trim()} added` : 'Person saved')) close(); };
  return (
    <Drawer title={isNew ? 'Add person' : `Edit ${row.name}`} close={close} footer={<><button className="btn primary" id="rt-m-save" onClick={save}>Save</button><button className="btn" onClick={close}>Cancel</button></>}>
      <div className="rt-form">
        <label>Name<input id="rt-m-name" value={f.name} onChange={F('name')} /></label>
        <label>Discipline<select id="rt-m-disc" value={f.discipline_id} onChange={F('discipline_id')}><option value="">Choose…</option>{M.disciplinesOf(db).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Role<input id="rt-m-role" value={f.role} onChange={F('role')} placeholder="e.g. Architect" /></label>
        <label>Weekly capacity (h)<input type="number" id="rt-m-cap" min="0" max="80" value={f.weekly_capacity_hours} onChange={F('weekly_capacity_hours')} placeholder="Blank = not set" /></label>
        <label className="check"><input type="checkbox" id="rt-m-active" checked={!!f.active} onChange={F('active')} /> Active</label>
        {!isNew && <p className="small muted">{n} task{n === 1 ? '' : 's'}. Deactivating removes {row.name} from new assignment lists; their tasks stay visible in the Planner.</p>}
      </div>
    </Drawer>
  );
}
function DisciplinePanel({ store, row, close, say }) {
  const [name, setName] = useState(row.name || '');
  const save = () => { if (say(store.saveDiscipline({ id: row.id, name }), row.id ? 'Discipline renamed' : `Discipline "${name.trim()}" added`)) close(); };
  return (
    <Drawer title={row.id ? `Rename ${row.name}` : 'Add discipline'} close={close} footer={<><button className="btn primary" id="rt-d-save" onClick={save}>Save</button><button className="btn" onClick={close}>Cancel</button></>}>
      <div className="rt-form"><label>Discipline name<input id="rt-d-name" value={name} onChange={(e) => setName(e.target.value)} /></label></div>
    </Drawer>
  );
}
