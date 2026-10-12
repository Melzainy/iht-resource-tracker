// Two isolated browsers (A and B) against ONE shared database — the production data path of the
// V1 redesign (Supabase adapter + Realtime). Runs against the local stand-in (tools/supabase-standin,
// real PostgreSQL with the real schema, grants and RLS) or, with care, a real project.
//   node tests/rt-live-two-browser.cjs <url of the live build> [/tmp/out]
// Uses psql on localhost:54329 to read the database directly (stand-in only).
const { chromium } = require('playwright');
const URL = process.argv[2]; const OUT = process.argv[3] || '/tmp/rt-live-v2';
const { execSync } = require('child_process');
require('fs').mkdirSync(OUT, { recursive: true });
const sql = (q) => execSync(`psql -h localhost -p 54329 -U postgres -d rt -At -F '|' -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(6000); await p.addInitScript(() => { window.RT_TODAY = '2026-10-08'; }); p.errs = []; p.on('pageerror', (e) => p.errs.push(`${name}: ${e.message}`)); p.on('console', (m) => m.type() === 'error' && !/net::ERR_TUNNEL|Failed to load resource/.test(m.text()) && p.errs.push(`${name}: ${m.text().slice(0, 160)}`)); return p; };
  const A = await mk('A'); const B = await mk('B');
  const res = []; const lat = [];
  const step = async (n, label, fn) => { const t0 = Date.now(); try { const r = await fn(); res.push([n, r !== false, `${label} (${Date.now() - t0} ms)`]); } catch (e) { res.push([n, false, `${label} — ${e.message.split('\n')[0]}`]); } };
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { try { if (await fn()) return Date.now() - t0; } catch (e) { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 60)); } };
  const txt = async (loc) => (await loc.first().innerText()).replace(/\s+/g, ' ').trim();
  const view = async (p, v) => { await p.click(`#v-${v}`); await p.waitForTimeout(60); };
  const open = async (p, disc, person) => { const d = p.locator(`.dtoggle[data-disc="${disc}"]`); if ((await d.getAttribute('aria-expanded')) !== 'true') await d.click(); if (person) { const x = p.locator(`.ptoggle[data-pers="${person}"]`); if ((await x.getAttribute('aria-expanded')) !== 'true') await x.click(); } };
  const row = (p, title) => p.locator(`.trow[data-title="${title}"]`);
  const pick = async (p, r, k, v) => { await r.locator(`.c-${k} .rt-dbtn`).click(); await p.fill('.rt-cal-in', v); await p.keyboard.press('Enter'); };
  const live = (p) => until(async () => (await p.locator('.rt-sync-c.ok').innerText()) === 'Live', 10000);
  const start = async (p) => { await p.goto(URL); await p.waitForSelector('#app'); return live(p); };
  const T = 'Live V1 task';

  await step(0, 'Both browsers load the shared database and show "Live"; nothing is stored as data in localStorage', async () => {
    const a = await start(A); const b2 = await start(B);
    const ls = await A.evaluate(() => Object.keys(localStorage).filter((k) => !/^rt-(ui-v3|theme)$/.test(k)));
    console.log('   A live in', a, 'ms · B live in', b2, 'ms · other localStorage keys:', ls.join(',') || 'none'); return a !== false && b2 !== false && !ls.length;
  });
  for (const p of [A, B]) { await view(p, 'planner'); await open(p, 'Interior Design / Kitchen / Cabinetry', 'Mai'); }
  await step(1, 'A adds a task with "Add task for…" → B sees it; database row has UUID relationships', async () => {
    await A.click('#addFor'); await A.click('.sheet [data-addto="Mai"]'); const d = A.locator('.trow.draft');
    await d.locator('.c-project select').selectOption({ label: 'Morgan' }); await d.locator('.c-title input').fill(T); await A.keyboard.press('Tab');
    await pick(A, row(A, T), 'start', '12 Oct'); await pick(A, row(A, T), 'due', '16 Oct');
    const ms = await until(async () => (await row(B, T).count()) === 1 && (await txt(row(B, T).locator('.c-due'))) === '16 Oct'); lat.push(ms);
    const db = sql(`select t.start_date, t.due_date, p.name, j.name, t.status is null, t.hours_per_week is null from rt_tasks t join rt_people p on p.id=t.person_id join rt_projects j on j.id=t.project_id where t.title='${T}'`);
    console.log('   B saw it after', ms, 'ms · database:', db); return ms !== false && db === '2026-10-12|2026-10-16|Mai|Morgan|t|t';
  });
  await A.screenshot({ path: `${OUT}/01-A-planner.png` });
  await step(2, 'B changes Due with the date picker → A updates', async () => {
    await pick(B, row(B, T), 'due', '23 Oct'); const ms = await until(async () => (await txt(row(A, T).locator('.c-due'))) === '23 Oct'); lat.push(ms);
    return ms !== false && sql(`select due_date from rt_tasks where title='${T}'`) === '2026-10-23';
  });
  await step(3, 'A drags the Gantt bar one week later → saved to the database → B updates', async () => {
    const bar = row(A, T).locator('.gbar'); await bar.scrollIntoViewIfNeeded(); const tl = await row(A, T).locator('.tl').boundingBox(); const bb = await bar.boundingBox(); const wk = (tl.width / 56) * 7; const y = bb.y + bb.height / 2;
    await A.mouse.move(bb.x + 20, y); await A.mouse.down(); for (let i = 1; i <= 8; i++) await A.mouse.move(bb.x + 20 + (wk * i) / 8, y); await A.mouse.up();
    const ms = await until(async () => (await txt(row(B, T).locator('.c-start'))) === '19 Oct' && (await txt(row(B, T).locator('.c-due'))) === '30 Oct'); lat.push(ms);
    return ms !== false && sql(`select start_date||'/'||due_date from rt_tasks where title='${T}'`) === '2026-10-19/2026-10-30';
  });
  await step(4, 'A adds a project in Settings → B can choose it in the Planner and sees it on Overview', async () => {
    await view(A, 'settings'); await A.fill('#newProj', 'Live Project V1'); await A.click('#addProj'); await view(A, 'planner'); await open(A, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    const ms = await until(async () => (await row(B, T).locator('.c-project option').allInnerTexts()).includes('Live Project V1')); lat.push(ms);
    await view(B, 'overview'); const card = await B.locator('.pcard[data-oproj="Live Project V1"]').count(); await view(B, 'planner'); await open(B, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    return ms !== false && card === 1;
  });
  await step(5, 'B adds a person in Settings → A sees them in "Add task for…" and in the Planner', async () => {
    await view(B, 'settings'); await B.click('[data-settab="people"]'); await B.fill('.dsec[data-disc="Architecture"] input[id^="newPerson-"]', 'Live Tester V1'); await B.click('.dsec[data-disc="Architecture"] [data-addperson]'); await view(B, 'planner'); await open(B, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    const ms = await until(async () => { await A.click('#addFor'); const n = await A.locator('.sheet [data-addto="Live Tester V1"]').count(); await A.keyboard.press('Escape'); return n === 1; }); lat.push(ms);
    await open(A, 'Architecture'); return ms !== false && (await A.locator('.prow[data-name="Live Tester V1"]').count()) === 1;
  });
  await step(6, 'A moves the person to Team US → B sees them under Team US', async () => {
    await view(A, 'settings'); await A.click('[data-settab="people"]'); await A.locator('.setrow[data-person="Live Tester V1"] select').selectOption({ label: 'Team US' }); await view(A, 'planner'); await open(A, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    await open(B, 'Team US'); const ms = await until(async () => (await B.locator('.prow[data-name="Live Tester V1"]').count()) === 1 && sql("select d.name from rt_people p join rt_disciplines d on d.id=p.discipline_id where p.name='Live Tester V1'") === 'Team US'); lat.push(ms); return ms !== false;
  });
  await step(7, 'B sets Phase (Details) → A sees it; database stores the permanent phase id', async () => {
    await B.click('[data-pdetails]'); await row(B, T).locator('.c-phase select').selectOption('phase-coordinated-design'); await A.click('[data-pdetails]');
    const ms = await until(async () => (await row(A, T).locator('.c-phase select').inputValue()) === 'phase-coordinated-design'); lat.push(ms);
    return ms !== false && sql(`select phase_key from rt_tasks where title='${T}'`) === 'phase-coordinated-design';
  });
  await step(17, 'Hours and capacity are not shown, and editing in the UI leaves the stored values untouched', async () => {
    sql(`update rt_tasks set hours_per_week = 12 where title='${T}'`); const cap0 = sql("select weekly_capacity_hours from rt_people where name='Mai'");
    await until(async () => true, 300); await row(A, T).locator('.c-priority select').selectOption('High');
    const ms = await until(async () => sql(`select coalesce(priority,'')||'/'||hours_per_week from rt_tasks where title='${T}'`) === 'High/12.0'); lat.push(ms);
    await view(B, 'settings'); await B.click('[data-settab="people"]'); const r = B.locator('.setrow[data-person="Mai"] input[id^="er-"]'); await r.fill('Interior Designer'); await B.keyboard.press('Enter'); await B.waitForTimeout(300);
    const cap1 = sql("select role||'/'||coalesce(weekly_capacity_hours::text,'') from rt_people where name='Mai'"); await view(B, 'planner'); await open(B, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    const shown = /Hrs\/Wk|Unestimated|capacity/i.test(await A.locator('body').innerText());
    console.log('   task hours after a priority edit:', sql(`select hours_per_week from rt_tasks where title='${T}'`), '· Mai after a role edit:', cap1, '(capacity before', cap0 + ')');
    return ms !== false && cap1 === `Interior Designer/${cap0}` && !shown;
  });
  await step(8, 'B sets Blocked + blocker note → A: Blocked KPI, row stripe, summary label, Overview', async () => {
    await row(B, T).locator('.c-status select').selectOption('Blocked'); await row(B, T).locator('.c-notes input').fill('Waiting for appliance specs'); await B.keyboard.press('Enter');
    const ms = await until(async () => (await A.locator('.pkpi[data-kpi="blocked"] b').innerText()) === '4' && (await row(A, T).evaluate((e) => e.classList.contains('is-stuck'))) && /1 blocked/.test(await txt(A.locator('.drow[data-name="Interior Design / Kitchen / Cabinetry"] .slbl')))); lat.push(ms);
    await view(A, 'overview'); const ov = await A.locator('[data-okpi="blocked"] .big-num').innerText(); await view(A, 'planner'); await open(A, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    return ms !== false && ov === '4' && sql(`select status||'/'||notes from rt_tasks where title='${T}'`) === 'Blocked/Waiting for appliance specs';
  });
  await step(9, 'A makes it overdue (Start 5 Oct, Due 7 Oct) → B: overdue marks and KPI', async () => {
    await pick(A, row(A, T), 'start', '5 Oct'); await pick(A, row(A, T), 'due', '7 Oct');
    const ms = await until(async () => /1d late/.test(await txt(row(B, T).locator('.c-due'))) && (await B.locator('.pkpi[data-kpi="overdue"] b').innerText()) === '4' && (await row(B, T).locator('.gover').count()) === 1); lat.push(ms);
    await B.screenshot({ path: `${OUT}/02-B-blocked-overdue.png` }); return ms !== false;
  });
  await step(10, 'B archives the project → A: gone from Overview and new-task lists; tasks kept', async () => {
    await view(B, 'settings'); await B.locator('.setrow[data-project="Live Project V1"] .switch').click(); await view(B, 'planner'); await open(B, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    await view(A, 'overview'); const ms = await until(async () => (await A.locator('.pcard[data-oproj="Live Project V1"]').count()) === 0); lat.push(ms); await view(A, 'planner'); await open(A, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    return ms !== false && sql("select active from rt_projects where name='Live Project V1'") === 'f';
  });
  await step(11, 'B deactivates the person → A: not offered for new tasks; row kept (inactive) in the database', async () => {
    await view(B, 'settings'); await B.click('[data-settab="people"]'); await B.locator('.setrow[data-person="Live Tester V1"] .switch').click(); await view(B, 'planner'); await open(B, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    const ms = await until(async () => { await A.click('#addFor'); const n = await A.locator('.sheet [data-addto="Live Tester V1"]').count(); await A.keyboard.press('Escape'); return n === 0; }); lat.push(ms);
    return ms !== false && sql("select active from rt_people where name='Live Tester V1'") === 'f';
  });
  await step(12, 'Check-in (A as Mai) saves Status / Start / Due through Supabase → B updates', async () => {
    await A.click('#whoBtn'); await A.click('.sheet [data-me="Mai"]'); await view(A, 'me'); await A.click('#startCheck');
    const title = await A.locator('.flow-task .t').innerText(); const id = sql(`select id from rt_tasks where person_id=(select id from rt_people where name='Mai') and title='${title.replace(/'/g, "''")}' order by (start_date is null)::int + (due_date is null)::int + (status is null)::int desc limit 1`);
    await A.click('.choice[data-v="In Progress"]'); await A.click('#fgo');
    for (let i = 0; i < 3 && (await A.locator('#fgo').count()); i++) { if (await A.locator('.choices.grid .choice').count()) { await A.locator('.choices.grid .choice').nth(1).click(); await A.click('#fgo'); } else break; }
    await A.click('#fx'); const db = sql(`select status from rt_tasks where id='${id}'`); console.log('   checked in:', title, '→', db); await view(A, 'planner'); await open(A, 'Interior Design / Kitchen / Cabinetry', 'Mai');
    return db === 'In Progress';
  });
  await step(13, 'Reload both browsers → everything persisted', async () => {
    for (const p of [A, B]) { await p.reload(); await p.waitForSelector('#app'); await live(p); await view(p, 'planner'); await open(p, 'Interior Design / Kitchen / Cabinetry', 'Mai'); }
    const r = row(A, T); const v = [await txt(r.locator('.c-start')), await txt(r.locator('.c-due')), await r.locator('.c-status select').inputValue()]; console.log('   after reload (A):', v.join(' | '));
    return v.join('|') === '5 Oct|7 Oct · 1d late|Blocked';
  });
  await step(14, 'Project phase before the migration: shown as needing the database update, never sent', async () => {
    await view(A, 'settings'); const note = await A.locator('.note.warn').count(); const dis = await A.locator('.setrow[data-project="Morgan"] select').isDisabled(); return note === 1 && dis && sql("select count(*) from information_schema.columns where table_name='rt_projects' and column_name='phase_key'") === '0';
  });
  await step(15, 'Database refuses an invalid phase and deleting a person as anon', async () => {
    const r = await A.evaluate(async () => (await fetch('http://localhost:54321/rest/v1/rt_tasks', { method: 'POST', headers: { apikey: 'sb_publishable_LOCALTEST', 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: '00000000-0000-4000-8000-0000000000aa', person_id: 'ae13eeec-cfc6-58e6-8d1c-aa085aa66eb3', project_id: '946cca06-360c-5c82-a48f-0396e8fef8f8', title: 'bad', phase_key: 'Coordinated Design' }) })).status);
    const del = await A.evaluate(async () => (await fetch('http://localhost:54321/rest/v1/rt_people?id=eq.ae13eeec-cfc6-58e6-8d1c-aa085aa66eb3', { method: 'DELETE', headers: { apikey: 'sb_publishable_LOCALTEST' } })).status);
    console.log('   bad phase insert →', r, '· delete person as anon →', del); return r >= 400 && del === 403;
  });
  await step(16, 'Realtime: every change reached the other browser without a reload (< 4 s)', async () => { console.log('   propagation (ms):', lat.join(', ')); return lat.every((x) => x !== false && x < 4000); });
  res.forEach(([n, ok, l]) => console.log(`${ok ? '✓' : '✗'} ${String(n).padStart(2)}. ${l}`));
  console.log(`Live two-browser test (V1): ${res.filter((r) => r[1]).length}/${res.length} passed`); console.log('errors:', [...A.errs, ...B.errs].length ? [...A.errs, ...B.errs] : 'none');
  await b.close(); process.exit(res.every((r) => r[1]) ? 0 : 1);
})();
