// Compact calendar picker for Start / Due — unchanged from the previous Planner (including the
// portal fix that keeps the calendar above the Planner's scroll containers and sticky layers).
import * as M from './model.js';
import { createPortal } from 'react-dom';

const { useState, useEffect, useLayoutEffect, useRef } = React;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const todayISO = () => (typeof window !== 'undefined' && window.RT_TODAY) || new Date().toISOString().slice(0, 10);

const parseTyped = (s, ref) => {
  const v = s.trim(); if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/); if (m) { const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : ref.slice(0, 4); return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = v.match(/^(\d{1,2})\s*([A-Za-z]{3,})\.?\s*(\d{4})?$/); if (m) { const mo = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3))); if (mo >= 0) return `${m[3] || ref.slice(0, 4)}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
};
const validISO = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && M.iso(M.toD(s)) === s;
export function DatePick({ value, onPick, label, className = '', children }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('');
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null); const pop = useRef(null);
  // The calendar is portalled to <body> and placed from the field's screen position, so the
  // Planner/Gantt scroll containers and sticky layers can never clip or cover it.
  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const h = pop.current?.offsetHeight || 292; const w = pop.current?.offsetWidth || 232; const vh = window.innerHeight; const vw = window.innerWidth;
    let top = r.bottom + 3; if (top + h > vh - 8 && r.top - h - 3 >= 8) top = r.top - h - 3; else if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    const p = { top: Math.round(top), left: Math.round(Math.max(8, Math.min(r.left, vw - w - 8))) };
    setPos((o) => (o && o.top === p.top && o.left === p.left ? o : p));
  };
  const show = () => { const base = value || todayISO(); setView(base.slice(0, 7)); setTyped(''); setBad(false); place(); setOpen(true); };
  useLayoutEffect(() => { if (open) place(); }, [open, view]);
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
    {open && pos && createPortal(<div ref={pop} className="rt-cal" role="dialog" aria-label={`${label} — choose a date`} style={{ top: pos.top, left: pos.left }}>
      <div className="rt-cal-h"><button type="button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button><b>{MONTHS[vm - 1]} {vy}</b><button type="button" aria-label="Next month" onClick={() => shift(1)}>›</button></div>
      <div className="rt-cal-g" role="grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="dow">{d}</span>)}
        {cells.map((d) => <button type="button" key={d} role="gridcell" aria-label={M.fmtD(d, true)} aria-selected={d === value} className={`${d.slice(0, 7) === vw ? '' : 'out'} ${d === value ? 'sel' : ''} ${d === today ? 'tod' : ''}`} onClick={() => choose(d)}>{+d.slice(8)}</button>)}</div>
      <div className="rt-cal-f">
        <input className={`rt-cal-in ${bad ? 'bad' : ''}`} aria-label="Type a date" placeholder="Type e.g. 12 Oct" value={typed} onChange={(e) => { setTyped(e.target.value); setBad(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = parseTyped(typed, value || today); if (v === '' || validISO(v)) choose(v || null); else setBad(true); } }} />
        <button type="button" onClick={() => choose(today)}>Today</button>
        <button type="button" className="clr" onClick={() => choose(null)} disabled={!value}>Clear</button>
      </div>
    </div>, document.body)}
  </>;
}
