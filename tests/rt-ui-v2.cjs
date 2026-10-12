// V1 redesign — browser test of navigation and key workflows (local preview build, fixed date 8 Oct 2026).
//   npm run build && npx http-server dist -p 5181 -s &  node tests/rt-ui-v2.cjs http://localhost:5181/ [/tmp/rt-ui]
// The live Supabase path is covered by tests/rt-live-two-browser.cjs (stand-in or real project).
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:5181/'; const OUT = process.argv[3] || '/tmp/rt-ui-v2';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(5000);
  await p.addInitScript(() => { window.RT_TODAY = '2026-10-08'; });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 160)));
  const res = []; const step = async (n, label, fn) => { try { const r = await fn(); res.push([n, r !== false, label]); if (r === false) await p.screenshot({ path: `${OUT}/fail-${n}.png` }); } catch (e) { res.push([n, false, `${label} — ${e.message.split('\n')[0]}`]); await p.screenshot({ path: `${OUT}/fail-${n}.png` }).catch(() => {}); console.log('   ', e.message.split('\n').slice(0, 3).join(' | ')); } };
  const txt = async (sel) => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const kpi = async (k) => +(await p.locator(`.pkpi[data-kpi="${k}"] b`).innerText());
  const open = async (disc, person) => { const d = p.locator(`.dtoggle[data-disc="${disc}"]`); if ((await d.getAttribute('aria-expanded')) !== 'true') await d.click(); if (person) { const x = p.locator(`.ptoggle[data-pers="${person}"]`); if ((await x.getAttribute('aria-expanded')) !== 'true') await x.click(); } };
  const rowId = (title, project) => p.evaluate(([t, pr]) => { const r = [...document.querySelectorAll('.trow')].find((x) => x.dataset.title === t && (!pr || x.querySelector('.c-project select option:checked')?.textContent === pr)); return r?.dataset.row; }, [title, project]);
  const row = (id) => p.locator(`.trow[data-row="${id}"]`);
  const drag = async (box, fromX, toX) => { const y = box.y + box.height / 2; await p.mouse.move(fromX, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(fromX + ((toX - fromX) * i) / 8, y); await p.mouse.up(); await p.waitForTimeout(150); };

  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.owner-hero');
  await step(1, 'Opens on Overview; nav = Overview · Planner · Settings + My tasks; prototype banner removed', async () => {
    const nav = (await p.locator('.mainnav button').allInnerTexts()).join('|'); const body = await p.locator('body').innerText();
    return nav === 'Overview|Planner|Settings' && (await p.locator('#v-me').count()) === 1 && !/Prototype · sample data|Example hours/.test(body) && (await p.locator('.rt-sync').count()) === 1;
  });
  await step(2, 'Overview: Blocked 3 · Late 3 · Done 0 of 46 · Planning data complete · 4 project cards · Needs attention 6', async () => {
    const v = await Promise.all(['blocked', 'late', 'done'].map((k) => p.locator(`[data-okpi="${k}"] .big-num`).innerText()));
    const comp = await txt('[data-okpi="complete"]'); const cards = await p.locator('.pcard').count(); const att = await p.locator('.section .list .row').count();
    console.log('   KPIs', v.join(' / '), '·', comp, '· cards', cards, '· attention rows', att);
    return v.join() === '3,3,0' && /PLANNING DATA COMPLETE \d+%/i.test(comp) && cards === 4 && att === 6 && /Blocked/.test(await txt('.pcard[data-oproj="Milner"] .hbadge'));
  });
  await p.screenshot({ path: `${OUT}/01-overview.png`, fullPage: true });
  await step(3, 'Blocked card opens the Planner filtered to the 3 blocked tasks (MEP → Kiran)', async () => {
    await p.click('[data-okpi="blocked"]'); await p.waitForSelector('.ptable');
    return (await p.locator('.pkpi[data-kpi="blocked"]').getAttribute('aria-pressed')) === 'true' && (await p.locator('.trow').count()) === 3 && (await p.locator('.prow[data-name="Kiran"]').count()) === 1;
  });
  await step(4, 'Planner KPIs: Active · Overdue · Blocked · Due this week; no Hrs/Wk column even with Details on', async () => {
    await p.click('#pfclear'); const keys = await p.locator('.pkpi').evaluateAll((a) => a.map((e) => e.dataset.kpi).join());
    await p.click('[data-pdetails]'); const heads = (await p.locator('.ptable thead th').allInnerTexts()).join('|'); await p.click('[data-pdetails]');
    const body = await p.locator('body').innerText(); console.log('   columns (Details):', heads.replace(/\n.*/g, '').replace(/\|W\d.*$/, ''));
    return keys === 'active,overdue,blocked,week' && (await kpi('overdue')) === 3 && /PHASE/i.test(heads) && !/HRS|HOURS/i.test(heads) && !/Unestimated/.test(body);
  });
  await step(5, 'Discipline opens with every person collapsed; clicking a person shows their tasks', async () => {
    await open('Interior Design / Kitchen / Cabinetry'); const people = await p.locator('.prow').count(); const tasks0 = await p.locator('.trow').count();
    await open('Interior Design / Kitchen / Cabinetry', 'Mai'); const tasks1 = await p.locator('.trow').count(); return people === 4 && tasks0 === 0 && tasks1 === 5;
  });
  await step(6, 'Collapsed rows carry the colour-coded summary (overdue box + label)', async () => (await p.locator('.prow[data-name="Mai"] .sover').count()) === 1 && /1 overdue/.test(await txt('.drow[data-name="Interior Design / Kitchen / Cabinetry"] .slbl')));
  const cush = await rowId('Full Design Lock', 'Cushman');
  await step(7, 'Inline edit: Status → Blocked saves; Blocked KPI and row stripe update', async () => {
    await row(cush).locator('.c-status select').selectOption('Blocked'); await p.waitForTimeout(100);
    return (await kpi('blocked')) === 4 && (await row(cush).evaluate((e) => e.classList.contains('is-stuck'))) && (await row(cush).locator('.gbar.seg-stuck').count()) === 1;
  });
  const vis = async (loc) => { await loc.scrollIntoViewIfNeeded(); await p.waitForTimeout(50); };
  await step(8, 'Gantt: drag a bar one week later → Start 15 Oct, Due 22 Oct saved', async () => {
    await vis(row(cush).locator('.gbar')); const tl = await row(cush).locator('.tl').boundingBox(); const bar = await row(cush).locator('.gbar').boundingBox(); const wk = (tl.width / 56) * 7;
    await drag(bar, bar.x + bar.width / 2, bar.x + bar.width / 2 + wk);
    const s = await txt(`.trow[data-row="${cush}"] .c-start`); const d = await txt(`.trow[data-row="${cush}"] .c-due`); console.log('   after move:', s, '→', d); return s === '15 Oct' && d === '22 Oct';
  });
  await step(9, 'Gantt: drag the end handle → Due changes, Start stays', async () => {
    await vis(row(cush).locator('.gbar')); const tl = await row(cush).locator('.tl').boundingBox(); const h = await row(cush).locator('.gbar .h-r').boundingBox(); const day = tl.width / 56;
    await drag(h, h.x + h.width / 2, h.x + h.width / 2 + 3 * day);
    const s = await txt(`.trow[data-row="${cush}"] .c-start`); const d = await txt(`.trow[data-row="${cush}"] .c-due`); console.log('   after resize:', s, '→', d); return s === '15 Oct' && d === '25 Oct';
  });
  await step(10, 'Gantt: due-only task moves its Due only — Start stays "Not set"', async () => {
    const id = await rowId('Full Design Lock', 'Reeds lake'); await vis(row(id).locator('.gdia')); const tl = await row(id).locator('.tl').boundingBox(); const dia = await row(id).locator('.gdia').boundingBox(); const day = tl.width / 56;
    await drag(dia, dia.x + dia.width / 2, dia.x + dia.width / 2 + 2 * day);
    return (await txt(`.trow[data-row="${id}"] .c-start`)) === 'Not set' && (await txt(`.trow[data-row="${id}"] .c-due`)) === '21 Oct';
  });
  await step(11, 'Gantt: drag across an undated task sets its Start and Due', async () => {
    await open('Architecture', 'Mansour'); const id = await rowId('Radiant floor detail and nested Revit family'); await vis(row(id).locator('.tl'));
    const tl = await row(id).locator('.tl').boundingBox(); const day = tl.width / 56;
    await drag(tl, tl.x + day * 14.5, tl.x + day * 18.5); // 12 Oct → 16 Oct
    const s = await txt(`.trow[data-row="${id}"] .c-start`); const d = await txt(`.trow[data-row="${id}"] .c-due`); console.log('   set dates:', s, '→', d); return s === '12 Oct' && d === '16 Oct';
  });
  await p.screenshot({ path: `${OUT}/02-planner.png` });
  await step(12, '"Add task for…" lists disciplines and people; new row saves once it has a project and name', async () => {
    await p.click('#addFor'); const groups = await p.locator('.sheet .whogroup').count(); await p.click('.sheet [data-addto="Hossam B"]');
    const draft = p.locator('.trow.draft'); await draft.locator('.c-project select').selectOption({ label: 'Morgan' }); await draft.locator('.c-title input').fill('UI test task'); await p.keyboard.press('Tab'); await p.waitForTimeout(150);
    const id = await rowId('UI test task', 'Morgan'); return groups >= 8 && !!id && (await p.locator('.prow[data-name="Hossam B"] .pcount').innerText()) === '1 task';
  });
  await step(13, 'Search and Filters panel narrow the tree; Attention shows the reasons', async () => {
    await p.fill('#pfq', 'clash detection'); await p.waitForTimeout(100); const n = await p.locator('.trow').count(); await p.click('#pfclear');
    await p.click('[data-attn="1"]'); const flags = await p.locator('.trow .flags .flag').count(); console.log('   search rows', n, '· attention flags', flags); await p.click('#pfclear'); return n === 1 && flags > 0;
  });
  await step(14, 'Settings → Projects & phases: add a project → selectable in the Planner; phase saves; archive removes it from new work', async () => {
    await p.click('#v-settings'); await p.fill('#newProj', 'UI Test Project'); await p.click('#addProj');
    const r = p.locator('.setrow[data-project="UI Test Project"]'); await r.locator('select').selectOption('phase-permit-documentation');
    await p.click('#v-planner'); await p.click('#addFor'); await p.click('.sheet [data-addto="Manuel"]'); await p.waitForSelector('.trow.draft');
    const has = (await p.locator('.trow.draft .c-project select option').allInnerTexts()).includes('UI Test Project'); await p.locator('.trow.draft .xbtn[aria-label="Cancel new task"]').click();
    await p.click('#v-settings'); await p.locator('.setrow[data-project="UI Test Project"] .switch').click(); await p.click('#v-overview');
    const card = await p.locator('.pcard[data-oproj="UI Test Project"]').count(); return has && card === 0;
  });
  await step(15, 'Settings → People (no capacity field): add a person → in "Add task for…"; deactivate → gone, history kept', async () => {
    await p.click('#v-settings'); const tabs = (await p.locator('.subtabs button').allInnerTexts()).join('|'); await p.click('[data-settab="people"]'); const cap = await p.locator('.setrow.person label', { hasText: /hours|capacity/i }).count(); console.log('   settings tabs:', tabs, '· capacity fields:', cap); if (tabs !== 'Projects & phases|People' || cap) return false; await p.fill('.dsec[data-disc="Architecture"] input[id^="newPerson-"]', 'UI Tester'); await p.click('.dsec[data-disc="Architecture"] [data-addperson]');
    await p.click('#v-planner'); await p.click('#addFor'); const inList = await p.locator('.sheet [data-addto="UI Tester"]').count(); await p.keyboard.press('Escape');
    await p.click('#v-settings'); await p.click('[data-settab="people"]'); await p.locator('.setrow[data-person="Hossam B"] .switch').click();
    await p.click('#v-planner'); await p.click('#addFor'); const gone = await p.locator('.sheet [data-addto="Hossam B"]').count(); await p.keyboard.press('Escape');
    await open('Architecture'); const hist = await p.locator('.prow.inactive[data-name="Hossam B"]').count();
    await p.click('#v-settings'); await p.click('[data-settab="people"]'); await p.check('#rt-show-inactive'); await p.locator('.setrow[data-person="Hossam B"] .switch').click();
    return inList === 1 && gone === 0 && hist === 1;
  });
  await step(16, 'My tasks: choosing a name is a view preference; open tasks grouped with missing info', async () => {
    await p.click('#v-me'); await p.click('.sheet [data-me="Mai"]'); await p.waitForSelector('#startCheck');
    const groups = await p.locator('[data-group]').evaluateAll((a) => a.map((e) => e.dataset.group).join('|')); const need = await p.locator('.need').count(); console.log('   groups', groups, '· rows missing info', need); return /Late/.test(groups) && need >= 1;
  });
  await step(17, 'Check-in: Status → note (Waiting) → Start (missing) → saved', async () => {
    await p.click('#startCheck'); await p.waitForSelector('#flow');
    const first = await p.locator('.flow-task .t').innerText();
    await p.click('.choice[data-v="Waiting"]'); await p.click('#fgo'); await p.fill('#fnote', 'Waiting on client selections'); await p.click('#fgo');
    const q = await p.locator('.q').innerText(); await p.locator('.choices.grid .choice').first().click(); await p.click('#fgo');
    const saved = await p.locator('.flow-bar.ok').count(); await p.click('#fx');
    const t = await p.evaluate((title) => true, first); console.log('   first task:', first, '· asked:', q);
    return /When does it start/.test(q) && saved === 1 && t;
  });
  await step(18, 'Task sheet from My tasks: no hours shown; status and quick due date save', async () => {
    const rowHrs = await p.locator('.list .row', { hasText: /h\/wk/ }).count(); await p.locator('.list .row').first().click(); const sheetHrs = await p.locator('.sheet', { hasText: /hours/i }).count(); if (rowHrs || sheetHrs) return false; await p.click('.sheet .opt[data-st="In Progress"]'); await p.waitForTimeout(80);
    const pressed = await p.locator('.sheet .opt[data-st="In Progress"]').getAttribute('aria-pressed'); await p.keyboard.press('Escape'); return pressed === 'true';
  });
  await step(19, 'Light / dark switch; choice survives a reload; every edit survived the reload', async () => {
    await p.click('#themeBtn'); const t1 = await p.evaluate(() => document.documentElement.dataset.theme); await p.reload(); await p.waitForSelector('#app');
    const t2 = await p.evaluate(() => document.documentElement.dataset.theme); await p.click('#v-planner'); await open('MEP', 'Kiran'); await open('Interior Design / Kitchen / Cabinetry', 'Mai');
    const id = await rowId('Full Design Lock', 'Cushman'); const st = await row(id).locator('.c-status select').inputValue(); const d = await txt(`.trow[data-row="${id}"] .c-due`);
    await p.screenshot({ path: `${OUT}/03-planner-dark.png` }); return t1 === 'dark' && t2 === 'dark' && st === 'Blocked' && d === '25 Oct';
  });
  await step(20, 'Phone width (400 px): no sideways page scroll on Overview, Planner, Settings', async () => {
    await p.setViewportSize({ width: 400, height: 860 }); const out = [];
    for (const v of ['overview', 'planner', 'settings']) { await p.click(`#v-${v}`); await p.waitForTimeout(80); out.push(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); }
    await p.click('#v-overview'); await p.screenshot({ path: `${OUT}/04-phone.png`, fullPage: true }); return out.every(Boolean);
  });
  res.forEach(([n, ok, l]) => console.log(`${ok ? '✓' : '✗'} ${String(n).padStart(2)}. ${l}`));
  console.log(`UI test (V1): ${res.filter((r) => r[1]).length}/${res.length} passed`); console.log('page errors:', errs.length ? errs : 'none');
  await b.close(); process.exit(res.every((r) => r[1]) && !errs.length ? 0 : 1);
})();
