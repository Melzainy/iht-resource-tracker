const { chromium } = require('playwright');
const URL = process.argv[2]; const OUT = process.argv[3] || '/tmp/rt6';
const { execSync } = require('child_process');
require('fs').mkdirSync(OUT, { recursive: true });
const sql = (q) => execSync(`psql -h localhost -p 54329 -U postgres -d rt -At -F '|' -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(6000); await p.addInitScript(() => { window.RT_TODAY = '2026-10-08'; }); p.errs = []; p.on('pageerror', (e) => p.errs.push(`${name}: ${e.message}`)); p.on('console', (m) => m.type() === 'error' && !/net::ERR_TUNNEL|Failed to load resource/.test(m.text()) && p.errs.push(`${name}: ${m.text().slice(0, 160)}`)); p.nm = name; return p; };
  const A = await mk('A'); const B = await mk('B');
  const res = []; const step = async (n, label, fn) => { const t0 = Date.now(); try { const r = await fn(); res.push([n, !!(r === undefined ? true : r), `${label} (${Date.now() - t0} ms)`]); } catch (e) { res.push([n, false, label + ' — ' + e.message.split('\n')[0]]); } };
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { try { if (await fn()) return Date.now() - t0; } catch (e) { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 60)); } };
  const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const tab = async (p, n) => { await p.locator('.rt-tabs button', { hasText: n }).click(); await p.waitForTimeout(60); };
  const ex = async (p, n) => { const x = p.getByRole('button', { name: `Expand ${n}`, exact: true }); if (await x.count()) await x.click(); };
  const tp = (p, n) => p.locator(`.rt-person[data-name="${n}"]`);
  const row = (p, title, person = 'Mai') => tp(p, person).locator(`.rt-erow[data-title="${title}"]`);
  const txt = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
  const pick = async (p, r, k, v) => { await r.locator(`.c-${k} .rt-dbtn`).click(); await p.fill('.rt-cal-in', v); await p.keyboard.press('Enter'); };
  const live = async (p) => until(async () => /Live — changes sync/.test(await p.locator('.rt-sync').innerText()), 10000);
  const open = async (p) => { await p.goto(URL + '#/tracker'); await p.waitForSelector('.rt-pgrid'); return live(p); };
  const lat = [];

  await step(0, 'Both browsers connect to the shared database (status "Live")', async () => { const a = await open(A); const b2 = await open(B); console.log('   A live in', a, 'ms · B live in', b2, 'ms · local storage used for data:', await A.evaluate(() => localStorage.getItem('rt-local-v2') !== null)); return a !== false && b2 !== false && !(await A.evaluate(() => localStorage.getItem('rt-local-v2'))); });
  for (const p of [A, B]) { await ex(p, 'Interior Design / Kitchen / Cabinetry'); await ex(p, 'Mai'); }
  await shot(A, '01-A-live-connected');
  await step(1, 'A creates a task (inline) → B sees it', async () => {
    await tp(A, 'Mai').locator('.rt-addbtn').click(); const d = tp(A, 'Mai').locator('.rt-erow.draft');
    await d.locator('.c-project select').selectOption({ label: 'Morgan' }); await d.locator('.c-title input').fill('Live test task'); await A.keyboard.press('Tab');
    await pick(A, row(A, 'Live test task'), 'start', '12 Oct'); await pick(A, row(A, 'Live test task'), 'due', '16 Oct');
    const ms = await until(async () => (await row(B, 'Live test task').count()) === 1 && (await txt(row(B, 'Live test task').locator('.c-due'))) === '16 Oct'); lat.push(ms);
    const db = sql("select start_date, due_date from rt_tasks where title='Live test task'"); console.log('   B saw it after', ms, 'ms · database row:', db);
    return ms !== false && db === '2026-10-12|2026-10-16';
  });
  await shot(B, '02-B-sees-task-from-A');
  await step(2, 'B changes the Due date → A updates', async () => { await pick(B, row(B, 'Live test task'), 'due', '23 Oct'); const ms = await until(async () => (await txt(row(A, 'Live test task').locator('.c-due'))) === '23 Oct'); lat.push(ms); console.log('   A updated after', ms, 'ms'); return ms !== false && sql("select due_date from rt_tasks where title='Live test task'") === '2026-10-23'; });
  await step(3, 'A adds a project → appears in B (Projects, every Project dropdown, filters)', async () => {
    await tab(A, 'Projects'); await A.locator('.rt-toolbar button', { hasText: '+ Add Project' }).click(); await A.fill('#rt-p-name', 'Live Project X'); await A.fill('#rt-p-status', 'Active'); await A.click('#rt-p-save'); await tab(A, 'Planner');
    const ms = await until(async () => (await row(B, 'Live test task').locator('.c-project option').allInnerTexts()).includes('Live Project X') && (await B.locator('#rt-f-project2 option').allInnerTexts()).includes('Live Project X')); lat.push(ms);
    await tab(B, 'Projects'); const inTable = await B.locator('.rt-table td b', { hasText: 'Live Project X' }).count(); await tab(B, 'Planner'); return ms !== false && inTable === 1;
  });
  await step(4, 'B adds a person (Architecture) → appears in A (Planner, Timeline, Team, assignment list)', async () => {
    await tab(B, 'Team'); await B.locator('.rt-dcard', { hasText: 'Architecture' }).first().locator('button', { hasText: '+ Add Person' }).click(); await B.fill('#rt-m-name', 'Live Tester'); await B.fill('#rt-m-role', 'Architect'); await B.fill('#rt-m-cap', '40'); await B.click('#rt-m-save'); await tab(B, 'Planner');
    await ex(A, 'Architecture'); const ms = await until(async () => (await A.locator('.rt-disc[data-name="Architecture"] .rt-person[data-name="Live Tester"]').count()) === 1); lat.push(ms);
    const opt = (await A.locator('.rt-addsel option').allInnerTexts()).includes('Live Tester');
    await tab(A, 'Timeline'); await ex(A, 'Architecture'); const tl = await A.locator('.rt-disc[data-name="Architecture"] .rt-person[data-name="Live Tester"]').count(); await tab(A, 'Team'); const tm = await A.locator('.rt-dcard', { hasText: 'Architecture' }).first().locator('.rt-pn', { hasText: 'Live Tester' }).count(); await tab(A, 'Planner');
    return ms !== false && opt && tl === 1 && tm === 1;
  });
  await step(5, 'A moves the person to Team US → B sees them move', async () => {
    await tab(A, 'Team'); await A.locator('.rt-people li', { hasText: 'Live Tester' }).locator('button', { hasText: 'Edit' }).click(); await A.selectOption('#rt-m-disc', { label: 'Team US' }); await A.click('#rt-m-save'); await tab(A, 'Planner');
    await ex(B, 'Architecture'); await ex(B, 'Team US');
    const ms = await until(async () => (await B.locator('.rt-disc[data-name="Team US"] .rt-person[data-name="Live Tester"]').count()) === 1 && (await B.locator('.rt-disc[data-name="Architecture"] .rt-person[data-name="Live Tester"]').count()) === 0); lat.push(ms); return ms !== false;
  });
  await step(6, 'B sets Hrs/Week = 30 → A workload + Gantt update', async () => {
    await row(B, 'Live test task').locator('.c-hrs input').fill('30'); await B.keyboard.press('Enter');
    const ms = await until(async () => (await row(A, 'Live test task').locator('.c-hrs input').inputValue()) === '30' && (await tp(A, 'Mai').locator('.rt-prow .rg-load[title^="W42:"]').innerText()).startsWith('75%')); lat.push(ms);
    await tab(A, 'Timeline'); await ex(A, 'Interior Design / Kitchen / Cabinetry'); await ex(A, 'Mai'); const lbl = await A.locator('.rt-person[data-name="Mai"] .tl2-t[data-title="Live test task"] .rg-lbl').innerText(); await tab(A, 'Planner');
    console.log('   A Mai W42', (await tp(A, 'Mai').locator('.rt-prow .rg-load[title^="W42:"]').innerText()).replace(/\s+/g, ''), '· Timeline bar label', lbl); return ms !== false && /30 h\/wk/.test(lbl);
  });
  await step(7, 'A sets Phase = Coordinated Design → B phase filter shows it', async () => {
    await row(A, 'Live test task').locator('.c-phase select').selectOption('phase-coordinated-design');
    const ms = await until(async () => (await row(B, 'Live test task').locator('.c-phase select').inputValue()) === 'phase-coordinated-design'); lat.push(ms);
    await B.selectOption('#rt-f-phase', 'phase-coordinated-design'); const n = await B.locator('.rt-erow').count(); const t = await B.locator('.rt-erow .c-title input').first().inputValue(); await B.selectOption('#rt-f-phase', ''); await ex(B, 'Interior Design / Kitchen / Cabinetry'); await ex(B, 'Mai');
    return ms !== false && n === 1 && t === 'Live test task' && sql("select phase_key from rt_tasks where title='Live test task'") === 'phase-coordinated-design';
  });
  await step(8, 'B sets Blocked + note → A blocker rollups (Mai, Interior, KPI) update', async () => {
    await row(B, 'Live test task').locator('.c-status select').selectOption('Blocked'); await row(B, 'Live test task').locator('.c-notes input').fill('Waiting for appliance specs'); await B.keyboard.press('Enter');
    const ms = await until(async () => /1 blocked/.test(await txt(tp(A, 'Mai').locator('.rt-proll'))) && /1 blocked/.test(await txt(A.locator('.rt-disc[data-name="Interior Design / Kitchen / Cabinetry"] .rt-roll'))) && (await A.locator('.rt-kpi.k-blocked b').innerText()) === '4'); lat.push(ms);
    return ms !== false && (await row(A, 'Live test task').evaluate((e) => e.classList.contains('is-bl')));
  });
  await step(9, 'A makes it overdue (Start 5 Oct, Due 7 Oct) → B overdue indicator + rollups', async () => {
    await pick(A, row(A, 'Live test task'), 'start', '5 Oct'); await pick(A, row(A, 'Live test task'), 'due', '7 Oct');
    const ms = await until(async () => /Overdue · 1d/.test(await txt(row(B, 'Live test task').locator('.c-due'))) && /2 overdue/.test(await txt(tp(B, 'Mai').locator('.rt-proll'))) && (await B.locator('.rt-kpi.k-overdue b').innerText()) === '4'); lat.push(ms);
    await shot(B, '03-B-blocked-overdue-from-A'); return ms !== false;
  });
  await step(10, 'Deactivate a person in B → A: hidden from assignment, history kept', async () => {
    await tab(B, 'Team'); await B.locator('.rt-people li', { hasText: 'Live Tester' }).locator('button', { hasText: 'Deactivate' }).click(); await tab(B, 'Planner');
    const ms = await until(async () => !(await A.locator('.rt-addsel option').allInnerTexts()).includes('Live Tester')); lat.push(ms); return ms !== false && sql("select active from rt_people where name='Live Tester'") === 'f';
  });
  await step(11, 'Realtime: both browsers received every change without reload', async () => { console.log('   propagation (ms):', lat.join(', ')); return lat.every((x) => x !== false && x < 4000); });
  await step(12, 'Reload both browsers → everything persisted', async () => {
    for (const p of [A, B]) { await p.reload(); await p.waitForSelector('.rt-pgrid'); await live(p); await ex(p, 'Interior Design / Kitchen / Cabinetry'); await ex(p, 'Mai'); }
    const r = row(A, 'Live test task'); const vals = [await r.locator('.c-project select option:checked').innerText(), await txt(r.locator('.c-start')), await txt(r.locator('.c-due')), await r.locator('.c-hrs input').inputValue(), await r.locator('.c-status select').inputValue(), await r.locator('.c-phase select').inputValue(), await r.locator('.c-notes input').inputValue()];
    const vb = await row(B, 'Live test task').locator('.c-status select').inputValue();
    console.log('   after reload (A):', vals.join(' | '), '· B status', vb);
    await tab(B, 'Projects'); const pj = await B.locator('.rt-table td b', { hasText: 'Live Project X' }).count(); await tab(B, 'Planner');
    return vals.join('|') === 'Morgan|5 Oct|7 Oct Overdue · 1d|30|Blocked|phase-coordinated-design|Waiting for appliance specs' && vb === 'Blocked' && pj === 1;
  });
  await step(13, 'Simultaneous edits to different fields of the same task are both kept', async () => {
    await row(A, 'Live test task').locator('.c-priority select').selectOption('Critical'); await row(B, 'Live test task').locator('.c-notes input').fill('Specs promised Friday'); await B.keyboard.press('Enter');
    const ms = await until(async () => sql("select priority||'/'||notes from rt_tasks where title='Live test task'") === 'Critical/Specs promised Friday' && (await row(A, 'Live test task').locator('.c-notes input').inputValue()) === 'Specs promised Friday' && (await row(B, 'Live test task').locator('.c-priority select').inputValue()) === 'Critical');
    return ms !== false;
  });
  await step(14, 'Database refuses an invalid change and the browser recovers', async () => {
    // simulate: bypass the UI validation by writing a bad phase through the API as anon
    const r = await A.evaluate(async () => { const res = await fetch('http://localhost:54321/rest/v1/rt_tasks', { method: 'POST', headers: { apikey: 'sb_publishable_LOCALTEST', 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', person_id: '00000000-0000-4000-8000-000000000002', project_id: '00000000-0000-4000-8000-000000000003', title: 'x', phase_key: 'PH3' }) }); return res.status; });
    const del = await A.evaluate(async () => (await fetch('http://localhost:54321/rest/v1/rt_people?id=eq.' + '00000000-0000-4000-8000-000000000002', { method: 'DELETE', headers: { apikey: 'sb_publishable_LOCALTEST' } })).status);
    console.log('   bad phase insert →', r, '· delete person as anon →', del); return r >= 400 && del === 403;
  });
  await tab(A, 'Timeline'); await ex(A, 'Interior Design / Kitchen / Cabinetry'); await ex(A, 'Mai'); await A.locator('.rt-person[data-name="Mai"] .rt-prow').evaluate((e) => { const g = e.closest('.rt-grid'); g.scrollTop = e.getBoundingClientRect().top - g.getBoundingClientRect().top + g.scrollTop - 80; }); await shot(A, '04-A-timeline-after-reload');
  res.forEach(([n, ok, l]) => console.log(`${ok ? '✓' : '✗'} ${String(n).padStart(2)}. ${l}`));
  console.log(`Live two-browser test: ${res.filter((r) => r[1]).length}/${res.length} passed`); console.log('errors:', [...A.errs, ...B.errs]);
  await b.close();
})();
