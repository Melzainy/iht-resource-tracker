// Resource Tracker V1 (redesign/resource-tracker-v2) — Overview · Planner · Settings · My tasks · Check-in.
// Visual and UX follow the approved prototype (ih-resource-tracker-prototype.html). Data does NOT:
// every screen reads the one store (src/rt/store.js) and every change goes through its validated
// actions → adapter (Supabase in production, with Realtime; local seed only for the preview build).
// UI preferences (theme, chosen name, view, Gantt range) are the only things kept in this browser.
import * as M from './model.js';
import * as V from './v2.js';
import { createStore, useStore } from './store.js';
import { localAdapter } from './adapters/local.js';
import { supabaseAdapter } from './adapters/supabase.js';
import { RT_CONFIG, keyProblem } from './config.js';
import { createClient } from '@supabase/supabase-js';
import seed from './seed.json';
import { PM_PHASES, phaseLabel } from './pm-phases.js';
import { DatePick } from './DatePick.jsx';

const { useState, useEffect, useRef } = React;
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
const todayISO = () => (typeof window !== 'undefined' && window.RT_TODAY) || new Date().toISOString().slice(0, 10);

// ── Per-browser view preferences (never data) ───────────────────────────────
const UI_KEY = 'rt-ui-v3';
const EMPTY_F = { disc: '', person: '', project: '', phase: '', status: '', priority: '', q: '', kpi: '', attn: false };
const loadUi = () => { let u = {}; try { u = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { /* storage unavailable */ } return { view: u.view || 'overview', me: u.me || null, weeks: [4, 8, 12].includes(u.weeks) ? u.weeks : 8, off: 0, details: u.details === true, f: { ...EMPTY_F }, more: false }; };
const saveUi = (u) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: u.view, me: u.me, weeks: u.weeks, details: u.details })); } catch (e) { /* ignore */ } };

const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// ── Theme ───────────────────────────────────────────────────────────────────
const THEME_KEY = 'rt-theme';
const curTheme = () => { const a = document.documentElement.getAttribute('data-theme'); if (a === 'dark' || a === 'light') return a; return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; };
function ThemeSwitch() {
  const [t, setT] = useState(curTheme);
  useEffect(() => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ } }, [t]);
  const nx = t === 'dark' ? 'light' : 'dark';
  return <button type="button" id="themeBtn" className="who ix themebtn" onClick={() => setT(nx)} aria-label={`Switch to ${nx} mode`} title={`Switch to ${nx} mode`}><i aria-hidden="true">{t === 'dark' ? '☀' : '☾'}</i>{t === 'dark' ? 'Light' : 'Dark'}</button>;
}

// ── Live save / connection status (subtle; errors are shown prominently elsewhere) ──
function SyncStatus({ store }) {
  if (store.adapter.name === 'local') return <span className="rt-sync" role="status" title={store.adapter.label}><span className="rt-sync-c wait"><i aria-hidden="true" />Local preview</span></span>;
  const c = store.connection;
  const conn = c === 'live' ? ['ok', 'Live', 'Live — changes sync to everyone with this link'] : c === 'connecting' ? ['wait', 'Connecting…', 'Connecting to the shared database…'] : ['bad', 'Reconnecting…', 'Connection lost — reconnecting… (edits may not reach others yet)'];
  const save = store.error ? ['bad', 'Not saved', `Last change not saved: ${store.error}`] : store.saving ? ['wait', 'Saving…', 'Saving…'] : store.savedAt ? ['ok', `Saved ${store.savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'All changes saved'] : null;
  return <span className="rt-sync" role="status" aria-live="polite" title={`${conn[2]}${save ? ` · ${save[2]}` : ''}`}><span className={`rt-sync-c ${conn[0]}`}><i aria-hidden="true" />{conn[1]}</span>{save && <span className={`rt-sync-s ${save[0]}`}>{save[1]}</span>}</span>;
}

// Hover tips for anything with data-tip (Gantt marks, status bars).
function TipLayer() {
  const ref = useRef(null);
  useEffect(() => {
    const tip = ref.current;
    const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; const r = tip.getBoundingClientRect(); let L = x + 12; let T = y - r.height - 12; if (L + r.width > window.innerWidth - 8) L = window.innerWidth - r.width - 8; if (T < 8) T = y + 16; tip.style.left = `${L}px`; tip.style.top = `${T}px`; };
    const mv = (e) => { if (window.__rtDrag) return; const el = e.target.closest?.('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tip.hidden = true; };
    const hide = () => { tip.hidden = true; };
    document.addEventListener('mousemove', mv); document.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => { document.removeEventListener('mousemove', mv); document.removeEventListener('scroll', hide, { capture: true }); };
  }, []);
  return <div ref={ref} className="tip" role="tooltip" hidden />;
}

// ── App shell ───────────────────────────────────────────────────────────────
export function ResourceTracker() {
  const store = useStore(getStore());
  const [ready, setReady] = useState(!!store.db);
  const [loadErr, setLoadErr] = useState(null);
  const [ui, setUiRaw] = useState(loadUi);
  const setUi = (p) => setUiRaw((x) => { const n = { ...x, ...(typeof p === 'function' ? p(x) : p) }; saveUi(n); return n; });
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [panel, setPanel] = useState(null); // drawers: { kind: 'task'|'project', row }
  const [sheet, setSheet] = useState(null); // modals: { kind: 'task', id } | { kind: 'who' }
  const [flow, setFlow] = useState(null); // full screen: { kind: 'check' | 'add' }
  useEffect(() => { if (!store.db) store.init().then(() => setReady(true)).catch((e) => setLoadErr(e.message)); }, []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), toast.bad ? 6000 : 2200); return () => clearTimeout(t); }, [toast]);
  const shell = (body) => <div className="rt-app"><header className="top"><div className="wrap"><Brand /></div></header><main className="wrap">{body}</main></div>;
  if (CONFIG_ERROR) return shell(<p className="note bad">Resource Tracker live database is not configured correctly: {CONFIG_ERROR} Showing nothing rather than risk mixing data.</p>);
  if (loadErr) return shell(<><p className="note bad">Could not load the shared Resource Tracker database: {loadErr}</p><button className="btn ghost" onClick={() => location.reload()}>Try again</button></>);
  if (!ready || !store.db) return shell(<p className="muted" style={{ padding: '32px 0' }}>Loading Resource Tracker…</p>);
  const db = store.db; const today = todayISO(); const I = M.index(db);
  const say = (r, okText) => { if (r && r.ok) { if (okText) setToast({ text: okText }); return true; } setToast({ text: r?.error || 'Not saved', bad: true }); return false; };
  const me = ui.me && I.person[ui.me] ? ui.me : null;
  const myNeeds = me ? V.myTasks(db, me, today).needs : 0;
  const go = (view, f) => { setUi(() => ({ view, ...(f ? { f: { ...EMPTY_F, ...f }, off: 0 } : {}) })); window.scrollTo(0, 0); };
  const openTask = (id) => setSheet({ kind: 'task', id });
  const ctx = { store, db, today, ui, setUi, say, setConfirm, setPanel, setSheet, setFlow, openTask, go, me };
  const view = ui.view === 'me' && !me ? 'overview' : ui.view;
  const nav = [['overview', 'Overview'], ['planner', 'Planner'], ['settings', 'Settings']];
  return (
    <div className="rt-app">
      <header className="top">
        <div className="wrap">
          <Brand />
          <nav className="seg mainnav" aria-label="Sections">{nav.map(([k, l]) => <button key={k} id={`v-${k}`} className="ix" aria-pressed={view === k} aria-current={view === k ? 'page' : undefined} onClick={() => go(k)}>{l}</button>)}</nav>
          <button id="v-me" className="mytasks ix" aria-pressed={view === 'me'} onClick={() => (me ? go('me') : setSheet({ kind: 'who', then: 'me' }))}>My tasks{myNeeds ? <span className="badge" title={`${myNeeds} of your tasks are missing planning data`}>{myNeeds}</span> : null}</button>
          <button id="whoBtn" className="who ix" aria-label="Choose your name" onClick={() => setSheet({ kind: 'who' })}>{me ? <><span className="avatar">{initials(I.person[me].name)}</span>{I.person[me].name} <span aria-hidden="true">▾</span></> : 'Choose your name'}</button>
          <ThemeSwitch />
          <SyncStatus store={store} />
        </div>
      </header>
      {store.error && <div className="errbar" role="alert"><div className="wrap">Last change could not be saved: {store.error} — the screen was refreshed from the {store.adapter.name === 'local' ? 'saved' : 'shared'} data.</div></div>}
      <main className={`wrap ${view === 'planner' ? 'wide' : ''}`} id="app">
        {view === 'overview' && <Overview {...ctx} />}
        {view === 'planner' && <Planner {...ctx} />}
        {view === 'settings' && <Settings {...ctx} />}
        {view === 'me' && <MyTasks {...ctx} />}
      </main>
      <footer className="foot"><div className="wrap"><span>Shared by link · no login yet — don’t enter confidential client, salary or HR information.</span>
        {store.adapter.name === 'local' && <button className="linkish" onClick={() => setConfirm({ title: 'Reset the preview data?', text: 'All changes made in this browser are discarded and the Excel import is loaded again.', label: 'Reset', action: () => store.reset().then(() => setToast({ text: 'Preview data reset' })) })}>Reset preview data</button>}</div></footer>
      {sheet?.kind === 'task' && <TaskSheet {...ctx} id={sheet.id} close={() => setSheet(null)} />}
      {sheet?.kind === 'who' && <WhoSheet {...ctx} close={() => setSheet(null)} pick={(id) => { const then = sheet.then; setSheet(null); setUi({ me: id, ...(then && id ? { view: then } : {}) }); }} />}
      {panel?.kind === 'task' && <TaskPanel {...ctx} row={panel.row} close={() => setPanel(null)} />}
      {panel?.kind === 'project' && <ProjectPanel {...ctx} row={panel.row} close={() => setPanel(null)} />}
      {flow?.kind === 'check' && me && <CheckIn {...ctx} close={() => setFlow(null)} />}
      {flow?.kind === 'add' && <AddTaskFlow {...ctx} close={() => setFlow(null)} />}
      {confirm && <Confirm {...confirm} close={() => setConfirm(null)} />}
      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role="status" onClick={() => setToast(null)}>{toast.text}</div>}
      <TipLayer />
    </div>
  );
}
const Brand = () => <div className="brand"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M12 32H5V8H12V32ZM20 32H13V8H20V32ZM35 32H28V23H21V16H28V8H35V32Z" fill="currentColor" /></svg><span>Resource Tracker</span></div>;

// ── Shared bits ─────────────────────────────────────────────────────────────
const stLabel = (s) => s || 'No status';
const Dot = ({ s }) => <span className={`dot st-${V.stKey(s)}`} aria-hidden="true" />;
function Modal({ close, children, label, wide }) {
  const ref = useRef(null);
  useEffect(() => { const f = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', f); ref.current?.querySelector('button:not(.x),input,select,textarea')?.focus(); return () => window.removeEventListener('keydown', f); }, []);
  return <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} ref={ref}>
    <button type="button" className="iconbtn x ix" aria-label="Close" onClick={close}>×</button>{children}</div></div>;
}
function Drawer({ title, close, children, footer }) {
  const ref = useRef(null);
  useEffect(() => { const f = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', f); ref.current?.querySelector('input,select,textarea')?.focus(); return () => window.removeEventListener('keydown', f); }, []);
  return <><div className="rt-scrim" onClick={close} /><aside className="rt-drawer" role="dialog" aria-label={title} ref={ref}>
    <header><h2>{title}</h2><button className="iconbtn ix" aria-label="Close" onClick={close}>×</button></header>
    <div className="rt-drawer-b">{children}</div><footer>{footer}</footer></aside></>;
}
function Confirm({ title, text, action, label = 'Delete', close }) {
  return <div className="scrim"><div className="sheet" role="alertdialog" aria-label={title}><h3>{title}</h3><p className="muted">{text}</p>
    <div className="row-btns"><button className="btn danger ix" onClick={() => { action(); close(); }}>{label}</button><button className="btn ghost ix" onClick={close}>Cancel</button></div></div></div>;
}
function StackBar({ tasks, label }) {
  const n = tasks.length; if (!n) return <div className="sbar empty" />;
  const mix = V.statusMix(tasks);
  return <div className="sbar">{V.BUCKETS.map(([k, l]) => (mix[k] ? <i key={k} className={`seg-${k}`} style={{ flex: `${mix[k]} 0 0` }} data-tip={`${label} · ${l}: ${mix[k]} of ${n}`} /> : null))}</div>;
}
const StatusLegend = () => <div className="legend">{V.BUCKETS.map(([k, l]) => <span key={k}><i className={`sw seg-${k}`} />{l}</span>)}</div>;
// Text field that saves when you leave it or press Enter (Esc reverts).
function InlineText({ value, onSave, label, id, placeholder, list, inputMode }) {
  const [v, setV] = useState(value ?? ''); const base = useRef(value ?? '');
  useEffect(() => { if ((value ?? '') !== base.current) { setV((cur) => (cur === base.current ? value ?? '' : cur)); base.current = value ?? ''; } }, [value]);
  const save = () => { if (v !== (value ?? '')) { if (!onSave(v)) setV(value ?? ''); } };
  return <input type="text" id={id} aria-label={label} value={v} placeholder={placeholder} list={list} inputMode={inputMode} onChange={(e) => setV(e.target.value)} onBlur={save}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } else if (e.key === 'Escape') { setV(value ?? ''); } }} />;
}
function Switch({ on, onChange, label }) { return <button type="button" className="switch" role="switch" aria-checked={!!on} aria-label={label} onClick={() => onChange(!on)} />; }
// One task as a list row (Overview, My tasks).
function TaskListRow({ db, t, today, onOpen, showPerson, mine }) {
  const I = M.index(db); const dt = V.dueText(t, today); const miss = M.isActive(t) ? V.planningMissing(t) : [];
  return <button className="row ix" data-task={t.id} onClick={() => onOpen(t.id)}>
    <Dot s={t.status} />
    <span style={{ minWidth: 0 }}><span className="t">{t.title}</span>
      <span className="s"><span className="proj">{I.project[t.project_id]?.name || '—'}</span>{showPerson && <span>{I.person[t.person_id]?.name || '—'}</span>}<span>{stLabel(t.status)}</span>
        {t.notes && (t.status === 'Blocked' || t.status === 'Waiting') && <span>“{t.notes}”</span>}
        {miss.length > 0 && mine && <span className="need">＋ Add {miss.join(', ')}</span>}</span></span>
    <span className="right"><span className={dt.late ? 'late' : ''}>{dt.txt}</span></span>
  </button>;
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ db, today, go, openTask, me }) {
  const k = V.overviewKpis(db, today); const cards = V.projectCards(db, today); const attn = V.needsAttention(db, today);
  const I = M.index(db); const first = me ? I.person[me]?.name.split(' ')[0] : null;
  return <>
    <section className="owner-hero">
      <h1>{first ? `${greet()}, ${first}` : 'Overview'}</h1>
      <div className="kpis">
        <button className="kpi ix" data-okpi="blocked" onClick={() => go('planner', { kpi: 'blocked' })} title="Show blocked tasks in the Planner"><span className="label">Blocked</span><span className={`big-num ${k.blocked ? 'red' : ''}`}>{k.blocked}</span></button>
        <button className="kpi ix" data-okpi="late" onClick={() => go('planner', { kpi: 'overdue' })} title="Show late tasks in the Planner"><span className="label">Late</span><span className={`big-num ${k.late ? 'red' : ''}`}>{k.late}</span></button>
        <div className="kpi" data-okpi="done"><span className="label">Done</span><span className="big-num">{k.done}</span><span className="muted">of {k.total}</span></div>
        <div className="kpi" data-okpi="complete" title="Open tasks with Person, Project, Status, Start and Due. Phase, Priority and Notes are optional."><span className="label">Planning data complete</span><span className="big-num">{k.completePct}%</span><span className="muted">{k.complete} of {k.open} open tasks</span><div className="progress thin"><i style={{ width: `${k.completePct}%` }} /></div></div>
      </div>
    </section>
    <section className="section">
      <h2>Projects<span className="count">{cards.length}</span></h2>
      <div className="projgrid">{cards.map(({ p, tasks, done, pct, health, phaseIndex, next }) => (
        <button key={p.id} className="pcard ix" data-oproj={p.name} onClick={() => go('planner', { project: p.id })}>
          <span className="pc-head"><span className="pc-name">{p.name}</span><span className={`hbadge ${health.key}`} title={health.why}><span aria-hidden="true">{health.icon}</span>{health.label}</span></span>
          {phaseIndex >= 0 ? <span className="pc-phase"><span className="phase-steps" title={phaseLabel(p.phase_key)}>{PM_PHASES.map((x, i) => <i key={x.key} className={i < phaseIndex ? 'past' : i === phaseIndex ? 'cur' : ''} />)}</span><small>{phaseLabel(p.phase_key)}</small></span>
            : <span className="pc-phase"><small className="muted">Phase not set</small></span>}
          <span className="pc-prog"><span className="big-num">{pct}%</span><span className="muted">{done}/{tasks.length} done</span></span>
          <StackBar tasks={tasks} label={p.name} />
          <span className="pc-meta">{next ? <>Next: <b>{next.t.title}</b> · {I.person[next.t.person_id]?.name || '—'} · <span className={/late|Blocked/.test(next.why) ? 'late' : ''}>{next.why}</span></> : 'No open tasks with a due date'}</span>
        </button>))}
        {!cards.length && <p className="muted">No active projects. Add one in Settings → Projects &amp; phases.</p>}</div>
      <StatusLegend />
    </section>
    <section className="section">
      <h2>Needs attention<span className="count">{attn.length}</span></h2>
      <div className="list">{attn.slice(0, 12).map((t) => <TaskListRow key={t.id} db={db} t={t} today={today} onOpen={openTask} showPerson />)}
        {!attn.length && <p className="muted" style={{ padding: '16px 0' }}>Nothing blocked or late.</p>}</div>
      {attn.length > 12 && <button className="btn ghost sm ix" style={{ marginTop: 12 }} onClick={() => go('planner', { attn: true })}>Show all {attn.length} in the Planner</button>}
    </section>
  </>;
}

// ── My tasks ────────────────────────────────────────────────────────────────
function MyTasks({ db, today, me, openTask, setFlow }) {
  const I = M.index(db); const p = I.person[me];
  const { open, groups, needs, upToDate } = V.myTasks(db, me, today);
  const pct = open.length ? Math.round((upToDate / open.length) * 100) : 100;
  const late = open.filter((t) => M.isOverdue(t, today)).length; const bl = open.filter(M.isBlocked).length; const wk = open.filter((t) => M.isDueThisWeek(t, today)).length;
  return <>
    <section className="hero">
      <div style={{ display: 'grid', gap: 6 }}>
        <h1>{greet()}, {p.name.split(' ')[0]}</h1>
        <p className="muted lead">{open.length ? (needs ? (needs === open.length ? `All ${open.length} of your tasks need a quick update.` : `${needs} of your ${open.length} tasks ${needs === 1 ? 'needs' : 'need'} a quick update.`) : 'Everything is up to date. Nice.') : 'You have no open tasks.'}</p>
      </div>
      <div className="cards">
        <div className="card focus">
          <div className="card-h"><span className="label">Up to date</span><b className="tnum">{upToDate} / {open.length}</b></div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pct}%` }} /></div>
          {open.length ? <button className="btn primary big ix" id="startCheck" onClick={() => setFlow({ kind: 'check' })}>{needs ? 'Start check-in' : 'Review my tasks'}<span className="sub">· about {Math.max(1, Math.round((open.length * 12) / 60))} min</span></button>
            : <button className="btn primary big ix" onClick={() => setFlow({ kind: 'add' })}>Add a task</button>}
          <small className="muted">Up to date = Status, Start and Due are filled in.</small>
        </div>
        <div className="card">
          <span className="label">Right now</span>
          <div className="mini-kpis"><div><b className={late ? 'red' : ''}>{late}</b><span>Late</span></div><div><b className={bl ? 'red' : ''}>{bl}</b><span>Blocked</span></div><div><b>{wk}</b><span>Due this week</span></div></div>
        </div>
      </div>
    </section>
    {groups.map(([g, list]) => <section key={g} className="section" data-group={g}><h2>{g}<span className="count">{list.length}</span></h2><div className="list">{list.map((t) => <TaskListRow key={t.id} db={db} t={t} today={today} onOpen={openTask} mine />)}</div></section>)}
    <div className="addrow"><button className="btn ghost ix" id="addTask" onClick={() => setFlow({ kind: 'add' })}>＋ Add a task</button></div>
  </>;
}

function WhoSheet({ db, me, pick, close }) {
  const groups = M.disciplinesOf(db).map((d) => ({ d, ps: M.peopleOf(db, d.id) })).filter((x) => x.ps.length);
  return <Modal close={close} label="Who are you?" wide><h3>Who are you?</h3><p className="muted small">This only chooses whose tasks appear under My tasks in this browser. It is not a login.</p>
    <div className="whogrid">{groups.map(({ d, ps }) => <div key={d.id} className="whogroup"><span className="label">{d.name}</span><div className="names">{ps.map((p) => <button key={p.id} className="opt ix" data-me={p.name} aria-pressed={me === p.id} onClick={() => pick(p.id)}><span className="avatar">{initials(p.name)}</span>{p.name}</button>)}</div></div>)}</div>
    {me && <button className="linkish small" onClick={() => pick(null)}>Clear my name</button>}</Modal>;
}

// Quick editor for one task (Overview, My tasks). Every change saves through the store.
function TaskSheet({ store, db, today, id, close, say, go, setPanel }) {
  const t = db.rt_tasks.find((x) => x.id === id);
  const [note, setNote] = useState(t?.notes || '');
  useEffect(() => { if (!t) close(); }, [!t]);
  if (!t) return null;
  const I = M.index(db); const dt = V.dueText(t, today);
  const save = (patch) => say(store.saveTask({ ...t, ...patch }));
  const saveNote = () => { if ((note || null) !== (t.notes || null)) save({ notes: note }); };
  const showNote = t.status === 'Blocked' || t.status === 'Waiting' || t.notes;
  return <Modal close={() => { saveNote(); close(); }} label={t.title}>
    <div className="sheet-h"><span className="proj">{I.project[t.project_id]?.name}</span><h3>{t.title}</h3><span className="muted">{I.person[t.person_id]?.name} · <span className={dt.late ? 'late' : ''}>{dt.txt}</span></span></div>
    <div className="field"><span className="label">How is it going?</span><div className="opts">{V.CHECKIN_ORDER.map((s) => <button key={s} className="opt ix" data-st={s} aria-pressed={t.status === s} onClick={() => save({ status: s })}><Dot s={s} />{s}</button>)}</div></div>
    {showNote && <div className="field"><label className="label" htmlFor="noteIn">{t.status === 'Blocked' ? 'What are you blocked on?' : t.status === 'Waiting' ? 'What are you waiting on?' : 'Notes'}</label><textarea id="noteIn" value={note} placeholder="e.g. Waiting on structural to confirm truss depth" onChange={(e) => setNote(e.target.value)} onBlur={saveNote} /></div>}
    <div className="field-2">
      <div className="field"><span className="label">Start</span><DatePick label="Start" value={t.start_date} onPick={(v) => save({ start_date: v })} className={`cell dpbox ${t.start_date ? '' : 'miss'}`}>{t.start_date ? V.fmtDay(t.start_date) : 'Start not defined'}</DatePick></div>
      <div className="field"><span className="label">Due</span><DatePick label="Due" value={t.due_date} onPick={(v) => save({ due_date: v })} className={`cell dpbox ${t.due_date ? (dt.late ? 'late' : '') : 'miss'}`}>{t.due_date ? V.fmtDay(t.due_date) : 'Due not defined'}</DatePick></div>
    </div>
    <div className="opts small-opts" aria-label="Quick due dates">{V.dueOptions(today).map((o) => <button key={o.label} className="opt ix" data-due={o.d} aria-pressed={t.due_date === o.d} onClick={() => save({ due_date: o.d })}>{o.label}</button>)}</div>
    <div className="row-btns"><button className="btn primary ix" onClick={() => { saveNote(); close(); }}>Done</button><button className="btn ghost ix" onClick={() => { saveNote(); close(); setPanel({ kind: 'task', row: t }); }}>All details…</button><button className="btn ghost ix" onClick={() => { saveNote(); close(); go('planner', { person: t.person_id, q: t.title }); }}>Open in Planner</button></div>
  </Modal>;
}

// ── Full-screen flows ───────────────────────────────────────────────────────
function FlowShell({ pct, label, close, children, bar }) {
  useEffect(() => { const f = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, []);
  return <div className="flow" id="flow" role="dialog" aria-modal="true" aria-label={label}>
    <div className="flow-top"><button className="iconbtn ix" id="fx" aria-label="Close" onClick={close}>×</button><div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pct}%` }} /></div></div>
    <div className="flow-body"><div className="flow-inner">{children}</div></div>
    <div className={`flow-bar ${bar.ok ? 'ok' : ''}`}><div className="in">{bar.html}</div></div></div>;
}
// Check-in: Status → (blocker / waiting note) → Start (if missing) → Due (if missing).
function CheckIn({ store, db, me, today, close, say }) {
  const [queue] = useState(() => V.checkinQueue(db, me).map((t) => t.id));
  const [i, setI] = useState(0); const [step, setStep] = useState('status'); const [sel, setSel] = useState(null);
  const [saved, setSaved] = useState(false); const [count, setCount] = useState(0); const [touched, setTouched] = useState({});
  const noteRef = useRef(null); const goRef = useRef(null);
  const ids = queue.filter((id) => db.rt_tasks.some((t) => t.id === id));
  const t = db.rt_tasks.find((x) => x.id === ids[i]);
  useEffect(() => { goRef.current?.focus(); }, [i, step, saved]);
  if (i >= ids.length || !t) {
    const open = db.rt_tasks.filter((x) => x.person_id === me && M.isActive(x)); const bl = open.filter(M.isBlocked).length; const comp = open.filter(V.isPlanningComplete).length;
    return <FlowShell pct={100} label="Check-in" close={close} bar={{ ok: true, html: <><span /><button className="btn primary ix" id="fend" ref={goRef} onClick={close}>Back to my tasks</button></> }}>
      <div className="done-screen"><div className="done-mark pop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
        <p className="q">Check-in done</p><p className="muted lead">The team now sees an up-to-date picture.{bl ? ' They’ll see what’s blocking you.' : ''}</p>
        <div className="stats"><div><div className="big-num">{count}</div><span className="muted">tasks updated</span></div><div><div className="big-num">{comp}/{open.length}</div><span className="muted">complete</span></div><div><div className="big-num" style={bl ? { color: 'var(--s-stuck)' } : null}>{bl}</div><span className="muted">blocked</span></div></div></div>
    </FlowShell>;
  }
  const I = M.index(db);
  const pct = ((i + (saved ? 1 : 0)) / ids.length) * 100;
  const head = <div className="flow-task"><span className="label">Task {i + 1} of {ids.length} · {I.project[t.project_id]?.name}</span><span className="t">{t.title}</span></div>;
  const nextTask = () => { setI(i + 1); setStep('status'); setSel(null); setSaved(false); setTouched({}); };
  if (saved) {
    const dt = V.dueText(t, today);
    return <FlowShell pct={pct} label="Check-in" close={close} bar={{ ok: true, html: <><span className="msg"><span className="check pop" aria-hidden="true">✓</span>Saved</span><button className="btn primary ix" id="fnext" ref={goRef} onClick={nextTask}>{i + 1 < ids.length ? 'Next task' : 'Finish'}</button></> }}>
      {head}<div className="choice static" aria-live="polite"><Dot s={t.status} /><span>{stLabel(t.status)}<small>{t.status !== 'Done' ? `${t.start_date ? `Starts ${V.fmtDay(t.start_date)}` : 'Start not defined'} · ${dt.txt}` : 'Moved to Done'}</small></span></div>
    </FlowShell>;
  }
  const status = step === 'status' && sel != null ? sel : t.status;
  const advance = (skipped) => {
    let patch = null;
    if (!skipped) {
      if (step === 'status' && sel != null) patch = { status: sel };
      else if (step === 'note') patch = { notes: noteRef.current?.value ?? t.notes };
      else if (step === 'start' && sel != null) patch = { start_date: sel };
      else if (step === 'due' && sel != null) patch = { due_date: sel };
    }
    if (patch && !say(store.saveTask({ ...t, ...patch }))) return;
    const t2 = patch ? { ...t, ...patch } : t;
    const tch = step === 'start' || step === 'due' ? { ...touched, [step]: true } : touched;
    const next = V.checkinSteps(t2, t2.status, tch); const idx = next.indexOf(step);
    setTouched(tch); setSel(null);
    if (idx >= 0 && idx < next.length - 1) setStep(next[idx + 1]);
    else { setSaved(true); setCount(count + 1); }
  };
  let body; let canGo = true; let skip = false;
  if (step === 'status') {
    body = <><p className="q">How is it going?</p><div className="choices">{V.CHECKIN_ORDER.map((s) => <button key={s} className="choice ix" data-v={s} aria-pressed={status === s} onClick={() => setSel(s)}><Dot s={s} /><span>{s}<small>{V.ST_HINT[s]}</small></span></button>)}</div></>;
    canGo = status != null;
  } else if (step === 'note') {
    body = <><p className="q">What are you {t.status === 'Blocked' ? 'blocked' : 'waiting'} on?</p><textarea id="fnote" ref={noteRef} defaultValue={t.notes || ''} placeholder="e.g. Waiting on Kiran for the MEP room layout" /></>; skip = true;
  } else {
    const isStart = step === 'start'; const cur = sel ?? (isStart ? t.start_date : t.due_date);
    const opts = isStart ? V.startOptions(today) : V.dueOptions(today);
    body = <><p className="q">{isStart ? 'When does it start?' : 'When should it be done?'}</p>
      {!isStart && t.start_date && <p className="muted">Starts {V.fmtDay(t.start_date)}</p>}
      <div className="choices grid">{opts.map((o) => <button key={o.label} className="choice ix" data-v={o.d} aria-pressed={cur === o.d} onClick={() => setSel(o.d)}>{o.label}<small>{V.fmtDay(o.d)}</small></button>)}</div>
      <div className="pick-line"><span className="muted">Or pick a date</span><DatePick label={isStart ? 'Start' : 'Due'} value={cur} onPick={(v) => setSel(v)} className="cell dpbox">{cur ? V.fmtDay(cur) : 'Choose a date'}</DatePick></div></>;
    canGo = cur != null; skip = true;
  }
  return <FlowShell pct={pct} label="Check-in" close={close} bar={{ html: <>{skip ? <button className="btn ghost ix" id="fskip" onClick={() => advance(true)}>Skip</button> : <span />}<button className="btn primary ix" id="fgo" ref={goRef} disabled={!canGo} onClick={() => advance(false)}>Continue</button></> }}>{head}{body}</FlowShell>;
}
// Add a task (My tasks): name → project → people → start (optional) → due (optional). One task per person.
function AddTaskFlow({ store, db, today, me, close, say }) {
  const [st, setSt] = useState(0); const [d, setD] = useState({ title: '', project: '', people: me ? [me] : [], start: null, due: null });
  const steps = ['title', 'project', 'people', 'start', 'due']; const s = steps[st];
  const groups = M.disciplinesOf(db).map((x) => ({ x, ps: M.peopleOf(db, x.id) })).filter((g) => g.ps.length);
  const next = (nd = d) => {
    if (st < steps.length - 1) { setSt(st + 1); return; }
    if (nd.start && nd.due && nd.due < nd.start) { say({ ok: false, error: 'Due date is before the start date.' }); return; }
    const res = nd.people.map((pid) => store.saveTask({ person_id: pid, project_id: nd.project, title: nd.title, start_date: nd.start, due_date: nd.due, status: 'Not Started' }));
    const bad = res.find((r) => !r.ok); if (bad) { say(bad); return; }
    say({ ok: true }, `Task added for ${nd.people.map((id) => M.index(db).person[id]?.name).join(', ')}`); close();
  };
  let body; let canGo = true; let skip = false;
  if (s === 'title') { body = <><p className="q">What needs to be done?</p><input type="text" id="atitle" autoFocus value={d.title} maxLength={160} placeholder="e.g. Update window schedule" onChange={(e) => setD({ ...d, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && d.title.trim()) next(); }} /></>; canGo = !!d.title.trim(); }
  if (s === 'project') { body = <><p className="q">Which project?</p><div className="choices">{M.activeProjects(db).map((p) => <button key={p.id} className="choice ix" data-v={p.name} aria-pressed={d.project === p.id} onClick={() => setD({ ...d, project: p.id })}>{p.name}</button>)}</div></>; canGo = !!d.project; }
  if (s === 'people') { body = <><p className="q">Who’s working on it?</p>{groups.map(({ x, ps }) => <div key={x.id} className="whogroup"><span className="label">{x.name}</span><div className="opts">{ps.map((p) => <button key={p.id} className="opt ix" data-p={p.name} aria-pressed={d.people.includes(p.id)} onClick={() => setD({ ...d, people: d.people.includes(p.id) ? d.people.filter((y) => y !== p.id) : [...d.people, p.id] })}><span className="avatar">{initials(p.name)}</span>{p.name}</button>)}</div></div>)}</>; canGo = d.people.length > 0; }
  if (s === 'start' || s === 'due') {
    const opts = s === 'start' ? V.startOptions(today) : V.dueOptions(today);
    body = <><p className="q">{s === 'start' ? 'When does it start?' : 'When should it be done?'}</p><div className="choices grid">{opts.map((o) => <button key={o.label} className="choice ix" data-v={o.d} aria-pressed={d[s] === o.d} onClick={() => setD({ ...d, [s]: o.d })}>{o.label}<small>{V.fmtDay(o.d)}</small></button>)}</div>
      <div className="pick-line"><span className="muted">Or pick a date</span><DatePick label={s === 'start' ? 'Start' : 'Due'} value={d[s]} onPick={(v) => setD({ ...d, [s]: v })} className="cell dpbox">{d[s] ? V.fmtDay(d[s]) : 'Choose a date'}</DatePick></div></>;
    canGo = !!d[s]; skip = true;
  }
  const doSkip = () => { const nd = { ...d, [s]: null }; setD(nd); next(nd); };
  return <FlowShell pct={(st / steps.length) * 100} label="Add a task" close={close} bar={{ html: <>{st ? <button className="btn ghost ix" id="fback" onClick={() => setSt(st - 1)}>Back</button> : <span />}<span className="row-btns">{skip && <button className="btn ghost ix" id="fskip" onClick={doSkip}>Skip</button>}<button className="btn primary ix" id="fgo" disabled={!canGo} onClick={() => next()}>{st === steps.length - 1 ? 'Add task' : 'Continue'}</button></span></> }}>
    <span className="label">New task · step {st + 1} of {steps.length}</span>{body}</FlowShell>;
}

// ── Planner: Discipline → Person → Task table with an integrated Gantt ──────
// Lists and dates save when chosen; text saves on Enter or when you leave the cell.
// Gantt: drag a bar to move it, drag its ends to change Start / Due, drag across an empty
// timeline to set dates. Every change goes through store.saveTask (validated, then Supabase).
const COLS_FULL = [['project', 'Project', 128], ['title', 'Task', 232], ['phase', 'Phase', 150], ['start', 'Start', 96], ['due', 'Due', 108], ['status', 'Status', 124], ['priority', 'Priority', 96], ['notes', 'Notes', 180], ['menu', '', 44]];
const COLS_COMPACT = COLS_FULL.filter(([k]) => ['project', 'title', 'start', 'due', 'status', 'menu'].includes(k));
// hours_per_week is not shown in V1 but is carried through unchanged, so editing a row never clears a stored value.
const fromT = (t) => ({ project_id: t.project_id || '', title: t.title || '', phase_key: t.phase_key || '', start_date: t.start_date || '', due_date: t.due_date || '', hours_per_week: t.hours_per_week == null ? '' : String(t.hours_per_week), status: t.status || '', priority: t.priority || '', notes: t.notes || '' });
const valOf = (f) => ({ ...f, phase_key: f.phase_key || null, start_date: f.start_date || null, due_date: f.due_date || null, hours_per_week: f.hours_per_week === '' ? null : +f.hours_per_week, status: f.status || null, priority: f.priority || null, notes: f.notes || null });
const OPEN_CACHE = {};
function useOpen(filtering, resetKey) {
  const [open, setOpenRaw] = useState(() => (OPEN_CACHE.key === resetKey ? OPEN_CACHE.open : {}));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setOpenRaw({}); }, [resetKey]);
  useEffect(() => { OPEN_CACHE.key = resetKey; OPEN_CACHE.open = open; }, [open, resetKey]);
  return {
    isOpen: (id) => (id in open ? open[id] : filtering),
    toggle: (id) => setOpenRaw((o) => ({ ...o, [id]: !(id in o ? o[id] : filtering) })),
    setOne: (id, v) => setOpenRaw((o) => ({ ...o, [id]: v })),
    setAll: (tree, v) => setOpenRaw(Object.fromEntries(tree.flatMap(({ d, people }) => [[d.id, v], ...people.map(({ p }) => [p.id, v])]))),
  };
}
// State label beside a task bar.
function tagOf(t, today) {
  const od = M.overdueDays(t, today);
  if (M.isBlocked(t)) return ['bl', `⚠ Blocked${od ? ` · ${od}d overdue` : ''}`];
  if (od) return ['od', `${od}d overdue`];
  if (t.status === 'Done') return ['dn', '✓ Done'];
  if (t.due_date && M.isActive(t)) { const k = M.daysBetween(today, t.due_date); if (k >= 0 && k <= 3) return ['ds', k === 0 ? 'Due today' : k === 1 ? 'Due tomorrow' : `Due in ${k}d`]; }
  if (t.status === 'Waiting') return ['wt', 'Waiting'];
  return null;
}
const Lbl = ({ tag, a, b }) => (!tag ? null : b < 78 ? <span className={`glbl ${tag[0]}`} style={{ left: `calc(${b}% + 6px)` }}>{tag[1]}</span> : a > 22 ? <span className={`glbl ${tag[0]}`} style={{ right: `calc(${100 - a}% + 6px)` }}>{tag[1]}</span> : null);
const todayX = (g, today) => (today >= g.r0 && today < g.r1 ? V.pctOf(g, today) + 50 / g.span : null);
function NowLayer({ g, today }) {
  const ws = M.weekStart(today); const L = V.pctOf(g, ws); const R = V.pctOf(g, M.addDays(ws, 7)); const tx = todayX(g, today);
  return <>{R > L && <i className="gnow" style={{ left: `${L}%`, width: `${R - L}%` }} />}{tx != null && <i className="gtoday" style={{ left: `${tx}%` }} />}</>;
}
function TaskMarks({ t, g, today, tip }) {
  const s0 = t.start_date; const d = t.due_date; const lt = M.isOverdue(t, today); const tag = tagOf(t, today);
  const tx = todayX(g, today); const tEnd = tx ?? (today >= g.r1 ? 100 : 0);
  const cls = `seg-${V.stKey(t.status)} ${lt ? 'late' : ''}`;
  const over = (from) => (lt && tEnd > from ? <span className="gover" style={{ left: `${from}%`, width: `${tEnd - from}%` }} /> : null);
  const P = (x) => V.pctOf(g, x);
  if (s0 && d) {
    if (d < g.r0 || s0 >= g.r1) return lt && d < g.r0 && today >= g.r0 ? <>{over(0)}<Lbl tag={tag} a={0} b={tEnd} /></> : <span className={`tl-edge ${d < g.r0 ? '' : 'r'}`}>{d < g.r0 ? `◂ ended ${M.fmtD(d)}` : `starts ${M.fmtD(s0)} ▸`}</span>;
    const L = P(s0); const R = P(M.addDays(d, 1));
    return <><span className={`gbar ${cls}`} data-drag-id={t.id} data-mode="move" style={{ left: `${L}%`, width: `${Math.max(1.2, R - L)}%` }} data-tip={tip}><i className="h h-l" data-mode="start" /><i className="h h-r" data-mode="end" /></span>{over(R)}<Lbl tag={tag} a={L} b={lt ? Math.max(R, tEnd) : R} /></>;
  }
  if (d) {
    if (d >= g.r1) return <span className="tl-edge r">due {M.fmtD(d)} ▸</span>;
    if (d < g.r0) return lt && today >= g.r0 ? <>{over(0)}<Lbl tag={tag} a={0} b={tEnd} /></> : <span className="tl-edge">◂ due {M.fmtD(d)}</span>;
    const X = P(d) + 50 / g.span; const R = P(M.addDays(d, 1));
    return <><span className={`gdia ${cls}`} data-drag-id={t.id} data-mode="due" style={{ left: `calc(${X}% - 7px)` }} data-tip={tip} />{over(R)}<Lbl tag={tag} a={X - 1} b={lt ? Math.max(R, tEnd) : X + 1} /></>;
  }
  if (s0) { if (s0 >= g.r1) return <span className="tl-edge r">starts {M.fmtD(s0)} ▸</span>; const L = P(s0); return <span className={`gbar open-end ${cls}`} data-drag-id={t.id} data-mode="move" style={{ left: `${L}%`, width: `${100 - L}%` }} data-tip={tip}><i className="h h-l" data-mode="start" /></span>; }
  return <span className="tl-none">No dates · drag to set</span>;
}
// Discipline / person summary line: every task in its status colour, most urgent on top.
function SumMarks({ tasks, g, today, I }) {
  const P = (x) => V.pctOf(g, x); const tx = todayX(g, today); const tEnd = tx ?? (today >= g.r1 ? 100 : 0);
  const marks = V.summaryOrder(tasks, today).map(({ t, late }) => {
    const s0 = t.start_date; const d = t.due_date; const c = `seg-${V.stKey(t.status)} ${late ? 'late' : ''} ${t.status === 'Done' ? 'dn' : ''}`;
    const tip = `${t.title} · ${I.project[t.project_id]?.name || '—'} · ${I.person[t.person_id]?.name || '—'} · ${stLabel(t.status)}${late ? ` · ${M.overdueDays(t, today)}d overdue` : ''}`;
    if (s0 && d) { if (d < g.r0 || s0 >= g.r1) return null; const L = P(s0); const R = P(M.addDays(d, 1)); return <span key={t.id} className={`smk ${c}`} style={{ left: `${L}%`, width: `${Math.max(0.8, R - L)}%` }} data-tip={tip} />; }
    if (d) { if (d < g.r0 || d >= g.r1) return null; return <span key={t.id} className={`smd ${c}`} style={{ left: `calc(${P(d) + 50 / g.span}% - 5px)` }} data-tip={tip} />; }
    if (s0 < g.r1) { const L = P(s0); return <span key={t.id} className={`smk open-end ${c}`} style={{ left: `${L}%`, width: `${100 - L}%` }} data-tip={tip} />; }
    return null;
  });
  const late = tasks.filter((t) => M.isOverdue(t, today));
  let ov = null;
  if (late.length) { const first = late.map((t) => t.due_date).sort()[0]; const from = first < g.r0 ? 0 : P(M.addDays(first, 1)); if (tEnd > from) ov = <span className="sover" style={{ left: `${from}%`, width: `${tEnd - from}%` }} />; }
  const open = tasks.filter(M.isActive); const bl = open.filter(M.isBlocked).length;
  const ds = open.filter((t) => !M.isOverdue(t, today) && t.due_date && M.daysBetween(today, t.due_date) >= 0 && M.daysBetween(today, t.due_date) <= 3).length;
  const parts = [bl ? <b key="b" className="bl">⚠ {bl} blocked</b> : null, late.length ? <b key="o" className="od">{late.length} overdue</b> : null, ds ? <b key="d" className="ds">{ds} due soon</b> : null].filter(Boolean);
  let lab = null;
  if (parts.length) {
    const ends = tasks.map((t) => (t.due_date && t.due_date >= g.r0 && t.due_date < g.r1 ? P(M.addDays(t.due_date, 1)) : t.start_date && !t.due_date && t.start_date < g.r1 ? 100 : 0));
    const last = Math.max(tEnd, ...ends);
    const content = parts.flatMap((x, k) => (k ? [<i key={`s${k}`}>·</i>, x] : [x]));
    lab = last < 70 ? <span className="slbl" style={{ left: `calc(${last}% + 8px)` }}>{content}</span> : <span className="slbl" style={{ right: 6 }}>{content}</span>;
  }
  return <>{ov}{marks}{lab}</>;
}

function Planner({ store, db, today, ui, setUi, say, setConfirm, setPanel }) {
  const f = ui.f; const W = ui.weeks; const details = ui.details;
  const setF = (p) => setUi((x) => ({ f: { ...x.f, ...p } }));
  const g = V.ganttRange(today, ui.off, W);
  const filtering = V.plannerFiltering(f);
  const tree = V.plannerTree(db, today, f);
  const kc = V.plannerKpis(db, today, f);
  const I = M.index(db);
  const O = useOpen(filtering, JSON.stringify(f));
  const [drafts, setDrafts] = useState({}); // personId → [{ key, init, id? }] rows added in this session
  const [picker, setPicker] = useState(false);
  const cols = details ? COLS_FULL : COLS_COMPACT; const NC = cols.length;
  const leftW = cols.reduce((s, c) => s + c[2], 0); const tlW = W * (W === 4 ? 150 : W === 8 ? 80 : 60);
  const tableRef = useRef(null); const dragTip = useRef(null); const DR = useRef(null);
  const discs = M.disciplinesOf(db);
  const addDraft = (p, init = {}) => {
    if (!p?.active) return;
    const reset = {}; if (f.person && f.person !== p.id) reset.person = ''; if (f.disc && f.disc !== p.discipline_id) reset.disc = '';
    if (f.q || f.kpi || f.attn || f.status || f.priority) Object.assign(reset, { q: '', kpi: '', attn: false, status: '', priority: '' });
    if (Object.keys(reset).length) setF(reset);
    setTimeout(() => { O.setOne(p.discipline_id, true); O.setOne(p.id, true); }, 0);
    setDrafts((dd) => ({ ...dd, [p.id]: [...(dd[p.id] || []), { key: `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, init: { person_id: p.id, project_id: f.project || '', phase_key: f.phase && f.phase !== '-' ? f.phase : '', ...init } }] }));
  };
  const onCreated = (pid, key, id) => setDrafts((dd) => ({ ...dd, [pid]: dd[pid].map((r) => (r.key === key ? { ...r, id } : r)) }));
  const onCancel = (pid, key) => setDrafts((dd) => ({ ...dd, [pid]: dd[pid].filter((r) => r.key !== key) }));

  // Gantt drag: move / resize / set dates. Painted directly while dragging, saved once on release.
  useEffect(() => {
    const idx = (iso) => M.daysBetween(g.r0, iso);
    const paint = (D, a, b) => {
      const s = M.addDays(g.r0, a); const e = M.addDays(g.r0, b);
      if (D.mode === 'due') D.el.style.left = `calc(${V.pctOf(g, e) + 50 / g.span}% - 7px)`;
      else { D.el.style.left = `${V.pctOf(g, s)}%`; D.el.style.width = `${Math.max(1.2, V.pctOf(g, M.addDays(e, 1)) - V.pctOf(g, s))}%`; }
      const tip = dragTip.current; tip.hidden = false; tip.textContent = D.mode === 'due' ? `Due ${V.fmtDay(e)}` : `${V.fmtDay(s)} → ${V.fmtDay(e)} · ${b - a + 1} days`;
    };
    const move = (e) => {
      const D = DR.current; if (!D) return;
      const d = D.dayAt(e.clientX); const delta = d - D.d0; if (Math.abs(e.clientX - D.x0) > 4) D.moved = true; if (!D.moved) return;
      if (D.mode === 'create') { D.a = Math.min(D.d0, d); D.b = Math.max(D.d0, d); }
      else { const nd = V.dragDates(D.mode, D.t, delta); D.dates = nd; D.b = nd.due_date ? idx(nd.due_date) : D.span - 1; D.a = D.mode === 'due' ? D.b : (nd.start_date ? idx(nd.start_date) : D.b); }
      paint(D, D.a, D.b);
      const tip = dragTip.current; const r = tip.getBoundingClientRect(); tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - r.width - 8)}px`; tip.style.top = `${Math.max(8, e.clientY - r.height - 14)}px`;
    };
    const up = () => {
      const D = DR.current; if (!D) return; DR.current = null; window.__rtDrag = false; dragTip.current.hidden = true; D.ghost?.remove();
      if (!D.moved) { if (D.t) tableRef.current?.querySelector(`[data-row="${D.t.id}"] .c-title input`)?.focus(); return; }
      if (D.mode === 'create') {
        const range = V.createRange(M.addDays(g.r0, D.a), M.addDays(g.r0, D.b));
        if (D.setId) { const t = I.task[D.setId]; if (t) say(store.saveTask({ ...t, ...range }), `Dates set: ${V.fmtDay(range.start_date)} → ${V.fmtDay(range.due_date)}`); }
        else if (D.person) addDraft(D.person, range);
        return;
      }
      if (!D.dates) return;
      say(store.saveTask({ ...D.t, ...D.dates }), `${D.t.title}: ${D.dates.start_date ? M.fmtD(D.dates.start_date) : 'no start'} → ${D.dates.due_date ? M.fmtD(D.dates.due_date) : 'no due'}`);
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
  });
  const onPointerDown = (e) => {
    const tl = e.target.closest('.tl'); if (!tl || e.button !== 0) return;
    const rect = tl.getBoundingClientRect(); const span = g.span;
    const dayAt = (x) => Math.max(0, Math.min(span - 1, Math.floor(((x - rect.left) / rect.width) * span)));
    const mark = e.target.closest('[data-drag-id]');
    let D = null;
    if (mark) { const t = I.task[mark.dataset.dragId]; if (!t) return; D = { mode: e.target.dataset.mode || mark.dataset.mode, t, el: mark }; }
    else if (tl.dataset.tlset || tl.dataset.tladd) {
      const ghost = document.createElement('span'); ghost.className = 'gbar ghost'; tl.appendChild(ghost);
      D = { mode: 'create', el: ghost, ghost, setId: tl.dataset.tlset, person: tl.dataset.tladd ? I.person[tl.dataset.tladd] : null };
    } else return;
    Object.assign(D, { dayAt, x0: e.clientX, d0: dayAt(e.clientX), moved: false, span });
    DR.current = D; window.__rtDrag = true; e.preventDefault();
  };

  const openCount = (d) => db.rt_tasks.filter((t) => t.active !== false && M.isActive(t) && I.person[t.person_id]?.discipline_id === d.id).length;
  const attnBad = db.rt_tasks.filter((t) => t.active !== false && (M.isBlocked(t) || M.isOverdue(t, today))).length;
  const nMore = [f.person, f.project, f.phase, f.status, f.priority].filter(Boolean).length;
  const anyFilter = filtering || f.disc || f.person;
  const peopleOpts = M.sortBy(db.rt_people.filter((p) => !f.disc || p.discipline_id === f.disc));
  const ctx = { store, db, today, say, setConfirm, setPanel, cols, g, attnMode: f.attn, I };
  return <div className="planner">
    <section className="hero plan-hero"><h1>Planner</h1></section>
    <div className="pkpis" role="group" aria-label="Key figures — click to filter">{V.PLANNER_KPIS.map(([k, l, c]) => <button key={k} className={`pkpi ix ${kc[k] ? c : 'zero'}`} data-kpi={k} aria-pressed={f.kpi === k} title={`${V.KPI_HELP[k]} ${f.kpi === k ? 'Click to clear.' : 'Click to show only these.'}`} onClick={() => setF({ kpi: f.kpi === k ? '' : k })}><b>{kc[k]}</b><span>{l}</span></button>)}</div>
    <div className="chips dchips" role="group" aria-label="Discipline"><button className="chip ix" data-pdisc="" aria-pressed={!f.disc} onClick={() => setF({ disc: '', person: '' })}>All disciplines</button>
      {discs.map((d) => <button key={d.id} className="chip ix" data-pdisc={d.name} aria-pressed={f.disc === d.id} onClick={() => { setF({ disc: d.id, person: f.person && I.person[f.person]?.discipline_id !== d.id ? '' : f.person }); setTimeout(() => O.setOne(d.id, true), 0); }}>{d.name}<span className="cc">{openCount(d)}</span></button>)}</div>
    <div className="pfilters">
      <div className="seg" role="group" aria-label="Show"><button className="ix" data-attn="0" aria-pressed={!f.attn} onClick={() => setF({ attn: false })}>All</button><button className="ix" data-attn="1" aria-pressed={!!f.attn} onClick={() => setF({ attn: true })}>Attention{attnBad ? <span className="badge">{attnBad}</span> : null}</button></div>
      <input type="search" id="pfq" placeholder="Search" value={f.q} aria-label="Search project, task, person, notes" onChange={(e) => setF({ q: e.target.value })} />
      <button className="chip ix" data-pmore aria-pressed={!!ui.more} aria-expanded={!!ui.more} onClick={() => setUi({ more: !ui.more })}>Filters{nMore ? ` · ${nMore}` : ''} ▾</button>
      {anyFilter && <button className="btn ghost ix sm" id="pfclear" onClick={() => setUi({ f: { ...EMPTY_F } })}>Clear</button>}
      <span className="pf-right">
        <div className="seg" role="group" aria-label="Move timeline"><button className="ix" aria-label="Earlier" onClick={() => setUi({ off: ui.off - Math.max(1, W / 2) })}>‹</button><button className="ix" aria-pressed={ui.off === 0} onClick={() => setUi({ off: 0 })}>Today</button><button className="ix" aria-label="Later" onClick={() => setUi({ off: ui.off + Math.max(1, W / 2) })}>›</button></div>
        <div className="seg" role="group" aria-label="Weeks shown">{[4, 8, 12].map((w) => <button key={w} className="ix" data-pweeks={w} aria-pressed={W === w} onClick={() => setUi({ weeks: w })}>{w}w</button>)}</div>
        <button className="chip ix" data-pdetails aria-pressed={details} onClick={() => setUi({ details: !details })} title="Show every field: Phase, Priority and Notes">Details</button>
        <div className="seg" role="group" aria-label="Expand or collapse"><button className="ix" id="expAll" onClick={() => O.setAll(tree, true)}>Expand all</button><button className="ix" id="colAll" onClick={() => O.setAll(tree, false)}>Collapse all</button></div>
        <button className="btn primary sm ix" id="addFor" onClick={() => setPicker(true)}>＋ Add task for…</button>
      </span>
    </div>
    {ui.more && <div className="pfilters morefilters">
      <select className="fsel" id="pf-person" aria-label="Person" value={f.person} onChange={(e) => setF({ person: e.target.value })}><option value="">All people</option>{peopleOpts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inactive)'}</option>)}</select>
      <select className="fsel" id="pf-proj" aria-label="Project" value={f.project} onChange={(e) => setF({ project: e.target.value })}><option value="">All projects</option>{M.sortBy(db.rt_projects).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (archived)'}</option>)}</select>
      <select className="fsel" id="pf-phase" aria-label="Phase" value={f.phase} onChange={(e) => setF({ phase: e.target.value })}><option value="">All phases</option><option value="-">Not assigned</option>{PM_PHASES.map((p) => <option key={p.key} value={p.key}>{p.no} {p.label}</option>)}</select>
      <select className="fsel" id="pf-status" aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">All statuses</option>{M.STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}<option value="-">Not set</option></select>
      <select className="fsel" id="pf-prio" aria-label="Priority" value={f.priority} onChange={(e) => setF({ priority: e.target.value })}><option value="">All priorities</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s} value={s}>{s}</option>)}<option value="-">Not set</option></select>
    </div>}
    <div className="twrap"><table className="ptable" ref={tableRef} style={{ minWidth: leftW + tlW }} onPointerDown={onPointerDown} aria-label="Resource planner">
      <colgroup>{cols.map(([k, , w]) => <col key={k} style={{ width: w }} />)}<col /></colgroup>
      <thead><tr>{cols.map(([k, l]) => <th key={k} className={`c-${k}`}>{l || <span className="sr">Actions</span>}</th>)}<th className="c-tl"><div className="tlh" style={{ '--w': W }}>{g.weeks.map((wk) => <span key={wk} className={wk === M.weekStart(today) ? 'now' : ''}>{M.wkLabel(wk)}<small>{M.fmtD(wk)}</small></span>)}</div></th></tr></thead>
      <tbody>
        {!tree.length && <tr><td colSpan={NC + 1} className="muted empty-cell">{filtering ? 'Nothing matches these filters.' : 'No disciplines yet. Add them in Settings → People.'}</td></tr>}
        {tree.map(({ d, people }) => {
          const dOpen = O.isOpen(d.id); const dts = people.flatMap((x) => x.tasks); const dOp = dts.filter(M.isActive);
          const bl = dOp.filter(M.isBlocked).length; const ov = dOp.filter((t) => M.isOverdue(t, today)).length;
          return <React.Fragment key={d.id}>
            <tr className={`drow ${d.kind === 'management' ? 'mgmt' : ''}`} data-name={d.name}><td colSpan={NC}><button className="dtoggle ix" data-disc={d.name} aria-expanded={dOpen} onClick={() => O.toggle(d.id)}><span className="chev" aria-hidden="true">{dOpen ? '▾' : '▸'}</span><b>{d.name}</b><span className="muted">{dOp.length}</span>{bl > 0 && <span className="flag bad">{bl} blocked</span>}{ov > 0 && <span className="flag od">{ov} overdue</span>}</button></td>
              <td className="c-tl"><div className="tl tl-sum" style={{ '--w': W }}><NowLayer g={g} today={today} /><SumMarks tasks={dts} g={g} today={today} I={I} /></div></td></tr>
            {dOpen && !people.length && <tr className="prow"><td colSpan={NC + 1} className="muted empty-cell">No people yet</td></tr>}
            {dOpen && people.map(({ p, tasks }) => {
              const pOpen = O.isOpen(p.id); const pOp = tasks.filter(M.isActive);
              const pbl = pOp.filter(M.isBlocked).length; const pod = pOp.filter((t) => M.isOverdue(t, today)).length;
              const mine = drafts[p.id] || []; const pinned = new Set(mine.filter((r) => r.id).map((r) => r.id));
              const lines = [...tasks.filter((t) => !pinned.has(t.id)).map((t) => ({ key: t.id, t })),
                ...mine.map((r) => (r.id ? (I.task[r.id] ? { key: r.key, t: I.task[r.id], r } : null) : { key: r.key, t: r.init, r })).filter(Boolean)];
              return <React.Fragment key={p.id}>
                <tr className={`prow ${pOpen ? 'open' : ''} ${p.active ? '' : 'inactive'}`} data-name={p.name}><td colSpan={NC}><button type="button" className="pline ptoggle ix" data-pers={p.name} aria-expanded={pOpen} onClick={() => O.toggle(p.id)} title={`${pOpen ? 'Hide' : 'Show'} ${p.name}’s tasks`}>
                  <span className="chev" aria-hidden="true">{pOpen ? '▾' : '▸'}</span><span className="avatar">{initials(p.name)}</span><b>{p.name}</b>{!p.active && <span className="muted">(inactive)</span>}<span className="pcount">{pOp.length} {pOp.length === 1 ? 'task' : 'tasks'}</span>{pbl > 0 && <span className="flag bad">{pbl} blocked</span>}{pod > 0 && <span className="flag od">{pod} overdue</span>}</button></td>
                  <td className="c-tl"><div className="tl tl-sum" style={{ '--w': W }}><NowLayer g={g} today={today} /><SumMarks tasks={tasks} g={g} today={today} I={I} /></div></td></tr>
                {pOpen && lines.map(({ key, t, r }) => <TaskRow key={key} ctx={ctx} t={t} personId={p.id} autoFocus={!!r && !r.id} onCreated={(id) => onCreated(p.id, key, id)} onCancel={() => onCancel(p.id, key)} />)}
                {pOpen && <tr className="addrow-t"><td colSpan={NC}>{p.active ? <button className="addtask ix" data-addfor={p.name} onClick={() => addDraft(p)}>＋ Add task</button> : <span className="addtask muted">Inactive — no new assignments</span>}</td>
                  <td className="c-tl">{p.active ? <div className="tl tl-add" data-tladd={p.id} style={{ '--w': W }}><NowLayer g={g} today={today} /><span className="tl-hint">＋ drag to add</span></div> : <div className="tl" style={{ '--w': W }} />}</td></tr>}
              </React.Fragment>;
            })}
          </React.Fragment>;
        })}
      </tbody></table></div>
    <div className="glegend" aria-label="Timeline legend"><span><i className="lb seg-doing" />In progress</span><span><i className="lb seg-waiting" />Waiting</span><span><i className="lb seg-stuck" />Blocked</span><span><i className="lb seg-not" />Not started</span><span><i className="lb seg-none" />No status</span><span><i className="lb seg-done" />Done</span><span><i className="lov" />Overdue (Due → today)</span><span><i className="ld" />Due date only</span><span><i className="lt" />Today</span><span><i className="ln" />This week</span></div>
    <p className="hint muted">Edit any cell: lists and dates save when chosen; text saves on Enter or when you leave the cell. Drag a bar to move it, drag its ends to change Start or Due, or drag across an empty timeline to set dates.</p>
    <div ref={dragTip} className="tip" hidden />
    {picker && <Modal close={() => setPicker(false)} label="Add a task for…" wide><h3>Add a task for…</h3><p className="muted small">Pick a person. Their row opens with a new task ready to fill in. Numbers show open tasks.</p>
      <div className="whogrid">{discs.map((d) => ({ d, ps: M.peopleOf(db, d.id) })).filter((x) => x.ps.length).map(({ d, ps }) => <div key={d.id} className="whogroup"><span className="label">{d.name}</span><div className="names">{ps.map((p) => <button key={p.id} className="opt ix" data-addto={p.name} onClick={() => { setPicker(false); addDraft(p); }}><span className="avatar">{initials(p.name)}</span>{p.name}<span className="muted cnt">{db.rt_tasks.filter((t) => t.person_id === p.id && t.active !== false && M.isActive(t)).length}</span></button>)}</div></div>)}</div></Modal>}
  </div>;
}

// One editable task row: table cells + its Gantt marks. Remote changes update every field this
// row hasn't changed locally; a field being edited keeps the user's text until it is saved.
function TaskRow({ ctx, t, personId, autoFocus, onCreated, onCancel }) {
  const { store, db, today, say, setConfirm, setPanel, cols, g, attnMode, I } = ctx;
  const isNew = !t.id;
  const [f, setF] = useState(() => fromT(t));
  const [err, setErr] = useState(null); const [saved, setSaved] = useState(0); const [menu, setMenu] = useState(false);
  const ref = useRef(null); const skip = useRef(false); const base = useRef(fromT(t));
  useEffect(() => {
    const prev = base.current; const next = fromT(t); base.current = next;
    setF((cur) => Object.fromEntries(Object.keys(next).map((k) => [k, cur[k] === prev[k] ? next[k] : cur[k]])));
  }, [t.id, t.updated_at, t.due_date, t.start_date, t.hours_per_week, t.status, t.priority, t.phase_key, t.project_id, t.title, t.notes]);
  useEffect(() => { if (!saved) return undefined; const tm = setTimeout(() => setSaved(0), 1600); return () => clearTimeout(tm); }, [saved]);
  useEffect(() => { if (!menu) return undefined; const h = (e) => { if (!ref.current?.querySelector('.c-menu')?.contains(e.target)) setMenu(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [menu]);
  const commit = (nf = f, explicit = false) => {
    if (isNew) {
      if (!nf.project_id || !nf.title.trim()) { if (explicit) setErr('Choose a project and enter a task name.'); return false; }
      const r = store.saveTask({ ...valOf(nf), person_id: personId });
      if (!r.ok) { setErr(r.error); say(r); return false; }
      setErr(null); setSaved(Date.now()); onCreated(r.row.id); return true;
    }
    const changed = Object.fromEntries(Object.keys(nf).filter((k) => nf[k] !== base.current[k]).map((k) => [k, nf[k]]));
    if (!Object.keys(changed).length) { setErr(null); return true; }
    const r = store.saveTask({ ...t, ...fromT(t), ...changed, id: t.id });
    if (!r.ok) { setErr(r.error); say(r); return false; }
    setErr(null); setSaved(Date.now()); return true;
  };
  const blank = !f.project_id && !f.title && !f.start_date && !f.due_date && !f.hours_per_week && !f.notes;
  const upd = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (k) => (e) => { const nf = { ...f, [k]: e.target.value }; setF(nf); commit(nf); };
  const pickDate = (k) => (v) => { const nf = { ...f, [k]: v || '' }; setF(nf); commit(nf); };
  const keys = (k) => (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(f, true); }
    else if (e.key === 'Escape') { e.preventDefault(); skip.current = true; if (isNew && blank) { onCancel(); return; } setF({ ...f, [k]: fromT(t)[k] }); setErr(null); e.target.blur(); }
  };
  const leave = () => { if (skip.current) { skip.current = false; return; } commit(); };
  const dt = { ...t, ...valOf(f), person_id: personId, active: t.active ?? true };
  const od = M.overdueDays(dt, today); const bl = M.isBlocked(dt);
  const projects = M.activeProjects(db); const curProj = t.project_id && db.rt_projects.find((p) => p.id === t.project_id && !p.active);
  const reasons = attnMode && M.isActive(dt) ? V.attention(dt, today) : [];
  const tip = `${dt.title || 'New task'} · ${I.project[dt.project_id]?.name || 'No project'} · ${dt.start_date ? V.fmtDay(dt.start_date) : 'Start not defined'} → ${dt.due_date ? V.fmtDay(dt.due_date) : 'Due not defined'} · ${stLabel(dt.status)}`;
  const cells = {
    project: <select className={`cell ${f.project_id ? '' : 'empty'}`} aria-label="Project" autoFocus={autoFocus} value={f.project_id} onChange={pick('project_id')} onKeyDown={keys('project_id')}>
      <option value="">Choose project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}{curProj && <option value={curProj.id}>{curProj.name} (archived)</option>}</select>,
    title: <><input className="cell ttl" type="text" aria-label="Task" value={f.title} placeholder={isNew ? 'Task name…' : ''} onChange={upd('title')} onBlur={leave} onKeyDown={keys('title')} />
      {(reasons.length > 0 || err) && <span className="flags">{err ? <span className="flag bad" role="alert">{err}</span> : reasons.map(([c, l]) => <span key={l} className={`flag ${c}`}>{l}</span>)}</span>}</>,
    phase: <select className={`cell ${f.phase_key ? '' : 'muted'}`} aria-label="Phase" value={f.phase_key} title={phaseLabel(f.phase_key)} onChange={pick('phase_key')} onKeyDown={keys('phase_key')}><option value="">Not assigned</option>{PM_PHASES.map((p) => <option key={p.key} value={p.key}>{p.no} {p.label}</option>)}</select>,
    start: <DatePick label="Start" value={f.start_date} onPick={pickDate('start_date')} className={`cell dcell ${f.start_date ? '' : 'miss'}`}>{f.start_date ? M.fmtD(f.start_date) : 'Not set'}</DatePick>,
    due: <DatePick label="Due" value={f.due_date} onPick={pickDate('due_date')} className={`cell dcell ${f.due_date ? (od ? 'late' : '') : 'miss'}`}>{f.due_date ? <>{M.fmtD(f.due_date)}{od > 0 && <small className="odtag"> · {od}d late</small>}</> : 'Not set'}</DatePick>,
    status: <select className={`cell st st-${V.stKey(f.status)} ${f.status ? '' : 'empty'}`} aria-label="Status" value={f.status} onChange={pick('status')} onKeyDown={keys('status')}><option value="">— status —</option>{M.STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>,
    priority: <select className={`cell pr pr-${(f.priority || 'none').toLowerCase()}`} aria-label="Priority" value={f.priority} onChange={pick('priority')} onKeyDown={keys('priority')}><option value="">—</option>{['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s} value={s}>{s}</option>)}</select>,
    notes: <input className={`cell ${bl && f.notes ? 'blnote' : ''}`} type="text" aria-label="Notes" value={f.notes} placeholder={bl ? 'Blocker reason…' : 'Notes'} title={f.notes} onChange={upd('notes')} onBlur={leave} onKeyDown={keys('notes')} />,
    menu: isNew ? <span className="rowacts"><button className="xbtn ok ix" aria-label="Save task" title="Save (Enter)" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(f, true)}>✓</button><button className="xbtn ix" aria-label="Cancel new task" title="Cancel (Esc)" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>×</button></span>
      : <span className="rowacts">{saved ? <span className="savedmark" title="Saved">✓</span> : null}<button className="xbtn ix" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
        {menu && <div className="rt-menu" role="menu"><button role="menuitem" onClick={() => { setMenu(false); setPanel({ kind: 'task', row: t }); }}>More details…</button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(false); setConfirm({ title: 'Delete this task?', text: `"${t.title}" will be removed from the Resource Tracker for everyone. This cannot be undone.`, action: () => say(store.deleteTask(t.id), 'Task deleted') }); }}>Delete task</button></div>}</span>,
  };
  const undated = !isNew && !t.start_date && !t.due_date;
  return <tr ref={ref} className={`trow ${isNew ? 'draft' : ''} ${dt.status === 'Done' ? 'is-done' : ''} ${bl ? 'is-stuck' : ''} ${od ? 'is-late' : ''} ${err ? 'has-err' : ''} ${menu ? 'menu-open' : ''}`} data-row={t.id || ''} data-title={t.title || ''}>
    {cols.map(([k]) => <td key={k} className={`c-${k}`}>{cells[k]}</td>)}
    <td className="c-tl"><div className="tl" data-tlset={undated ? t.id : undefined} style={{ '--w': g.weeks.length }}><NowLayer g={g} today={today} />
      {isNew && blank ? <span className="tl-none">New task — choose a project and name it</span> : <TaskMarks t={dt} g={g} today={today} tip={tip} />}</div></td>
  </tr>;
}

// ── Task drawer ("More details…": reassign person, every field) ─────────────
function TaskPanel({ store, db, row, close, say, setConfirm }) {
  const [f, setF] = useState(() => ({ person_id: '', project_id: '', title: '', phase_key: '', start_date: '', due_date: '', hours_per_week: '', status: '', priority: '', notes: '', ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) }));
  const F = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const person = db.rt_people.find((p) => p.id === f.person_id); const disc = person && db.rt_disciplines.find((d) => d.id === person.discipline_id);
  const groups = M.disciplinesOf(db).map((d) => ({ d, people: M.peopleOf(db, d.id) })).filter((x) => x.people.length);
  const orig = row.person_id && db.rt_people.find((p) => p.id === row.person_id);
  const projects = M.activeProjects(db); const origProj = row.project_id && db.rt_projects.find((p) => p.id === row.project_id && !p.active);
  const save = () => { if (say(store.saveTask({ ...f, id: row.id }), 'Task saved')) close(); };
  const live = { ...row, ...valOf(f), active: row.active ?? true };
  const miss = M.isActive(live) ? V.planningMissing(live) : [];
  return <Drawer title="Task details" close={close} footer={<><button className="btn primary ix" id="rt-save" onClick={save}>Save</button><button className="btn ghost ix" onClick={close}>Cancel</button><span className="grow" />
    <button className="btn danger ix" onClick={() => setConfirm({ title: 'Delete this task?', text: `"${row.title}" will be removed from the Resource Tracker for everyone. This cannot be undone.`, action: () => { if (say(store.deleteTask(row.id), 'Task deleted')) close(); } })}>Delete</button></>}>
    <div className="rt-form">
      {miss.length > 0 && <p className="flag warn">Missing for planning: {miss.join(', ')}</p>}
      <label>Person<select id="rt-f-person" value={f.person_id} onChange={F('person_id')}><option value="">Choose…</option>
        {groups.map((x) => <optgroup key={x.d.id} label={x.d.name}>{x.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        {orig && !orig.active && <optgroup label="Inactive"><option value={orig.id}>{orig.name} (inactive)</option></optgroup>}</select></label>
      <div className="muted small">Discipline: <b>{disc ? disc.name : '—'}</b> (from the person)</div>
      <label>Project<select id="rt-f-project" value={f.project_id} onChange={F('project_id')}><option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}{origProj && <option value={origProj.id}>{origProj.name} (archived)</option>}</select></label>
      <label>Task<input type="text" id="rt-f-title" value={f.title} onChange={F('title')} /></label>
      <label>Phase<select id="rt-f-phase" value={f.phase_key} onChange={F('phase_key')}><option value="">Not assigned</option>{PM_PHASES.map((p) => <option key={p.key} value={p.key}>{p.no} {p.label}</option>)}</select></label>
      <div className="rt-2"><label>Start<input type="date" id="rt-f-start" value={f.start_date} onChange={F('start_date')} /></label><label>Due<input type="date" id="rt-f-due" value={f.due_date} onChange={F('due_date')} /></label></div>
      <div className="rt-2"><label>Status<select id="rt-f-status" value={f.status} onChange={F('status')}><option value="">— not set —</option>{M.STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Priority<select id="rt-f-priority" value={f.priority} onChange={F('priority')}><option value="">— not set —</option>{M.PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></label></div>
      <label>Notes<textarea id="rt-f-notes" rows={4} value={f.notes} onChange={F('notes')} /></label>
      <p className="small muted">Blank dates stay blank. Planning data is complete with Person, Project, Status, Start and Due.</p>
    </div>
  </Drawer>;
}

// ── Settings: Projects & phases · People ─────────────────────────
function Settings(props) {
  const [tab, setTab] = useState('projects');
  return <>
    <section className="hero" style={{ paddingBottom: 0 }}><h1>Settings</h1>
      <div className="subtabs" role="tablist">{[['projects', 'Projects & phases'], ['people', 'People']].map(([k, l]) => <button key={k} className="ix" role="tab" data-settab={k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div></section>
    <div className="setbody">{tab === 'projects' ? <ProjectsTab {...props} /> : <PeopleTab {...props} />}</div>
  </>;
}
function ProjectsTab({ store, db, say, setConfirm, setPanel }) {
  const [showArch, setShowArch] = useState(false); const [nm, setNm] = useState('');
  const supported = store.supportsProjectPhase;
  const count = (id) => db.rt_tasks.filter((t) => t.project_id === id).length;
  const list = M.sortBy(db.rt_projects.filter((p) => showArch || p.active));
  const save = (p, patch, okText) => say(store.saveProject({ ...p, ...patch }), okText);
  const add = () => { if (say(store.saveProject({ name: nm, status: 'Active' }), `Added ${nm.trim()}`)) setNm(''); };
  return <>
    <div className="settools"><label className="check"><input type="checkbox" id="showArch" checked={showArch} onChange={(e) => setShowArch(e.target.checked)} /> Show archived projects</label></div>
    {!supported && <p className="note warn">Current project phase can’t be saved yet: the database needs the one-time update that adds <code>rt_projects.phase_key</code>. Everything else works.</p>}
    <div className="setlist">{list.map((p) => {
      const n = count(p.id); const pi = p.phase_key ? PM_PHASES.findIndex((x) => x.key === p.phase_key) : -1;
      return <div key={p.id} className={`setrow proj ${p.active ? '' : 'off'}`} data-project={p.name}>
        <div className="f"><label className="label" htmlFor={`pn-${p.id}`}>Project</label><InlineText id={`pn-${p.id}`} label="Project name" value={p.name} onSave={(v) => save(p, { name: v }, 'Saved')} /></div>
        <div className="f wide"><label className="label" htmlFor={`pp-${p.id}`}>Current phase</label><select id={`pp-${p.id}`} value={p.phase_key || ''} disabled={!supported} title={supported ? '' : 'Needs the database update first'} onChange={(e) => save(p, { phase_key: e.target.value }, 'Phase saved')}><option value="">Not set</option>{PM_PHASES.map((x) => <option key={x.key} value={x.key}>{x.no} {x.label}</option>)}</select>
          <span className="phase-steps">{PM_PHASES.map((x, j) => <i key={x.key} className={j < pi ? 'past' : j === pi ? 'cur' : ''} />)}</span></div>
        <div className="f"><label className="label" htmlFor={`ps-${p.id}`}>Status</label><InlineText id={`ps-${p.id}`} label="Project status" list="rt-pstat" value={p.status || ''} placeholder="e.g. Active" onSave={(v) => save(p, { status: v }, 'Saved')} /></div>
        <div className="f sw-f"><span className="label">Active</span><Switch on={p.active} label={`${p.name} active`} onChange={(v) => say(store.setProjectActive(p.id, v), v ? `${p.name} restored` : `${p.name} archived — its ${n} tasks are kept`)} /><small className="muted">{n} {n === 1 ? 'task' : 'tasks'}</small></div>
        <div className="f acts"><button className="btn ghost sm ix" onClick={() => setPanel({ kind: 'project', row: p })}>Details</button>
          {!n && <button className="btn ghost sm ix danger-t" onClick={() => setConfirm({ title: `Delete ${p.name}?`, text: 'No tasks reference this project. It will be removed permanently.', action: () => say(store.deleteProject(p.id), 'Project deleted') })}>Delete</button>}</div>
      </div>;
    })}</div>
    <datalist id="rt-pstat"><option>Active</option><option>On Hold</option><option>Completed</option></datalist>
    <div className="addline"><label className="label" htmlFor="newProj">New project</label><div className="addrow" style={{ margin: 0 }}><input type="text" id="newProj" placeholder="Project name" value={nm} onChange={(e) => setNm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /><button className="btn primary ix" id="addProj" onClick={add}>Add project</button></div></div>
    <p className="small muted">Projects with tasks can only be archived, never deleted. Archived projects leave the project lists for new work but keep their tasks.</p>
    <h2 className="sub-h">Phases</h2>
    <ol className="phaselist">{PM_PHASES.map((p) => <li key={p.key}><b>{p.label}</b> <code className="muted">{p.key}</code></li>)}</ol>
    <p className="small muted">The six PM Workflow phases. Tasks and projects store the permanent id; the names are display only.</p>
  </>;
}
function ProjectPanel({ store, row, close, say }) {
  const [f, setF] = useState(() => ({ name: '', status: '', project_manager: '', start_date: '', target_finish: '', notes: '', ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? ''])) }));
  const F = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => { const { phase_key: _ph, ...rest } = f; if (say(store.saveProject({ ...rest, id: row.id }), 'Project saved')) close(); };
  return <Drawer title={`Project · ${row.name}`} close={close} footer={<><button className="btn primary ix" id="rt-p-save" onClick={save}>Save</button><button className="btn ghost ix" onClick={close}>Cancel</button></>}>
    <div className="rt-form">
      <label>Project name<input type="text" id="rt-p-name" value={f.name} onChange={F('name')} /></label>
      <div className="rt-2"><label>Status<input type="text" id="rt-p-status" value={f.status} onChange={F('status')} list="rt-pstat2" /></label><label>Project manager<input type="text" id="rt-p-pm" value={f.project_manager} onChange={F('project_manager')} /></label></div>
      <datalist id="rt-pstat2"><option>Active</option><option>On Hold</option><option>Completed</option></datalist>
      <div className="rt-2"><label>Start<input type="date" id="rt-p-start" value={f.start_date} onChange={F('start_date')} /></label><label>Target finish<input type="date" id="rt-p-finish" value={f.target_finish} onChange={F('target_finish')} /></label></div>
      <label>Notes<textarea id="rt-p-notes" rows={3} value={f.notes} onChange={F('notes')} /></label>
    </div>
  </Drawer>;
}
function PeopleTab({ store, db, say }) {
  const [showInactive, setShowInactive] = useState(false); const [newDisc, setNewDisc] = useState(''); const [adds, setAdds] = useState({});
  const discs = M.disciplinesOf(db, showInactive); const active = M.disciplinesOf(db);
  const openCount = (pid) => db.rt_tasks.filter((t) => t.person_id === pid && t.active !== false && M.isActive(t)).length;
  const sp = (p, patch, okText) => say(store.savePerson({ ...p, ...patch }), okText);
  const addPerson = (d) => { const nm = (adds[d.id] || '').trim(); if (say(store.savePerson({ name: nm, discipline_id: d.id, active: true }), `Added ${nm}`)) setAdds({ ...adds, [d.id]: '' }); };
  const addDisc = () => { if (say(store.saveDiscipline({ name: newDisc }), `Added ${newDisc.trim()}`)) setNewDisc(''); };
  const pos = (d) => active.findIndex((x) => x.id === d.id);
  return <>
    <div className="settools"><label className="check"><input type="checkbox" id="rt-show-inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive people and disciplines</label></div>
    <p className="small muted">Deactivating someone removes them from new assignments — their tasks stay.</p>
    {discs.map((d) => {
      const ps = M.peopleOf(db, d.id, showInactive);
      return <section key={d.id} className={`dsec ${d.active ? '' : 'off'}`} data-disc={d.name}>
        <header className="dsec-h">
          <InlineText id={`dn-${d.id}`} label="Discipline name" value={d.name} onSave={(v) => say(store.saveDiscipline({ id: d.id, name: v }), 'Discipline renamed')} />
          {!d.active && <span className="muted">inactive</span>}
          <span className="dsec-acts">
            <button className="btn ghost sm ix" aria-label={`Move ${d.name} up`} disabled={!d.active || pos(d) <= 0} onClick={() => say(store.moveDiscipline(d.id, -1))}>↑</button>
            <button className="btn ghost sm ix" aria-label={`Move ${d.name} down`} disabled={!d.active || pos(d) === active.length - 1} onClick={() => say(store.moveDiscipline(d.id, 1))}>↓</button>
            {d.active ? <button className="btn ghost sm ix" onClick={() => say(store.setDisciplineActive(d.id, false), `${d.name} deactivated`)}>Deactivate</button> : <button className="btn ghost sm ix" onClick={() => say(store.setDisciplineActive(d.id, true), `${d.name} reactivated`)}>Reactivate</button>}
          </span>
        </header>
        <div className="setlist">{ps.map((p) => <div key={p.id} className={`setrow person ${p.active ? '' : 'off'}`} data-person={p.name}>
          <div className="f"><label className="label" htmlFor={`en-${p.id}`}>Name</label><InlineText id={`en-${p.id}`} label="Name" value={p.name} onSave={(v) => sp(p, { name: v }, 'Saved')} /></div>
          <div className="f"><label className="label" htmlFor={`et-${p.id}`}>Discipline</label><select id={`et-${p.id}`} value={p.discipline_id} onChange={(e) => sp(p, { discipline_id: e.target.value }, `${p.name} moved`)}>{active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}{!d.active && <option value={d.id}>{d.name}</option>}</select></div>
          <div className="f"><label className="label" htmlFor={`er-${p.id}`}>Role</label><InlineText id={`er-${p.id}`} label="Role" value={p.role || ''} placeholder="e.g. Architect" onSave={(v) => sp(p, { role: v }, 'Saved')} /></div>
          <div className="f sw-f"><span className="label">Active</span><Switch on={p.active} label={`${p.name} active`} onChange={(v) => say(store.setPersonActive(p.id, v), v ? `${p.name} reactivated` : `${p.name} deactivated — their tasks stay`)} /><small className="muted">{openCount(p.id)} open</small></div>
        </div>)}{!ps.length && <p className="muted small none">No people yet.</p>}</div>
        {d.active && <div className="addline inline"><input type="text" id={`newPerson-${d.id}`} aria-label={`New person in ${d.name}`} placeholder={`Add a person to ${d.name}`} value={adds[d.id] || ''} onChange={(e) => setAdds({ ...adds, [d.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addPerson(d); }} /><button className="btn ghost ix" data-addperson={d.name} onClick={() => addPerson(d)}>Add person</button></div>}
      </section>;
    })}
    <div className="addline"><label className="label" htmlFor="newDisc">New discipline</label><div className="addrow" style={{ margin: 0 }}><input type="text" id="newDisc" placeholder="Discipline name" value={newDisc} onChange={(e) => setNewDisc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addDisc(); }} /><button className="btn primary ix" id="addDisc" onClick={addDisc}>Add discipline</button></div></div>
  </>;
}
