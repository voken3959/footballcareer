/**
 * Accessibility audit of every screen in the built game (WCAG 2.0/2.1 A and AA through axe-core) plus a horizontal-overflow check.
 *   npm run build && npx vite preview --port 4173 &
 *   node e2e/a11y.cjs [width] [height] [default|access]      (access = larger text, high contrast and reduced motion switched on)
 * Needs `playwright` and `axe-core` to be installed; neither is part of the game's own dependencies.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const W = Number(process.argv[2] || 1280);
const H = Number(process.argv[3] || 800);
const MODE = process.argv[4] || 'default'; // default | access (large text + high contrast + reduced motion)

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

  await page.goto('http://localhost:4173/');
  await page.waitForSelector('text=Pitchside');
  await page.click('text=New career');
  await page.waitForSelector('text=Where does the story begin?');
  await page.click('text=Next');
  await page.waitForSelector('text=Who are you?');
  await page.click('text=Next');
  await page.waitForSelector('text=Position');
  await page.click('text=Next');
  await page.waitForSelector('[role=radio][aria-checked]', { timeout: 20000 });
  await page.click('text=Next');
  await page.waitForSelector('text=Starting attributes');
  await page.click('text=Start career');
  await page.waitForSelector('text=Welcome back', { timeout: 60000 });

  async function go(label) {
    const first = ['Home', 'My Player', 'Matches', 'Club'];
    const nav = page.locator('nav[aria-label=Main]:visible').first();
    if (first.includes(label) || W >= 1024) await nav.locator(`button:has-text("${label}")`).first().click();
    else {
      await nav.locator('button:has-text("More")').click();
      await page.locator(`[role=dialog] button:has-text("${label}")`).first().click();
    }
    await page.waitForTimeout(300);
  }
  async function dismiss() {
    for (let i = 0; i < 4; i++) {
      const dlg = page.locator('[role=dialog]').first();
      if (!(await dlg.isVisible().catch(() => false))) return;
      const later = dlg.locator('button:has-text("Decide later")').first();
      const close = dlg.locator('button[aria-label="Close"]').first();
      if (await later.isVisible().catch(() => false)) await later.click();
      else if (await close.isVisible().catch(() => false)) await close.click();
      else await dlg.locator('button').first().click();
      await page.waitForTimeout(200);
    }
  }
  async function overflow(label) {
    const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, v: document.documentElement.clientWidth }));
    if (r.s > r.v + 1) console.log(`OVERFLOW ${label}: ${r.s} > ${r.v}`);
  }

  const NAV = ['Home', 'My Player', 'Matches', 'Club', 'Training', 'Transfers', 'Competitions', 'National Team', 'Life', 'News', 'Career History', 'Settings'];

  if (MODE === 'access') {
    await go('Settings');
    for (const label of ['Larger text', 'High contrast', 'Reduce motion']) {
      const sw = page.locator(`[role=switch][aria-label="${label}"], label:has-text("${label}") [role=switch], [role=switch]:near(:text("${label}"))`).first();
      const el = page.getByRole('switch', { name: new RegExp(label, 'i') }).first();
      if (await el.count()) { if ((await el.getAttribute('aria-checked')) !== 'true') await el.click(); await page.waitForTimeout(250); console.log(label, 'aria-checked ->', await el.getAttribute('aria-checked')); }
      else console.log('no switch for', label);
    }
    await page.waitForTimeout(300);
    const attrs = await page.evaluate(() => ({ large: document.documentElement.dataset.large, contrast: document.documentElement.dataset.contrast, motion: document.documentElement.dataset.motion, fs: getComputedStyle(document.documentElement).fontSize }));
    console.log('root attrs', JSON.stringify(attrs));
  }

  const agg = {};
  const ccAgg = {};
  for (const label of NAV) {
    await dismiss();
    await go(label);
    await overflow(label);
    const tabs = await page.$$('[role=tablist] [role=tab]');
    const n = Math.max(1, tabs.length);
    for (let i = 0; i < n; i++) {
      if (tabs.length) { const t = (await page.$$('[role=tablist] [role=tab]'))[i]; await t.click(); await page.waitForTimeout(150); await overflow(`${label}#${i}`); }
      await page.addScriptTag({ content: AXE }).catch(() => {});
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
        const cc = r.violations.find((v) => v.id === 'color-contrast');
        window.__cc = cc ? cc.nodes.map((x) => { const d = x.any[0]?.data || {}; return { k: `${d.fgColor} on ${d.bgColor} (${d.contrastRatio}) ${d.fontSize}`, cls: (x.html.match(/class="([^"]*)"/) || [])[1] || x.html.slice(0, 60) }; }) : [];
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((x) => x.target.join(' ') + ' :: ' + (x.any[0]?.message || x.none[0]?.message || x.all[0]?.message || '').slice(0, 110)) }));
      });
      const cc = await page.evaluate(() => window.__cc || []);
      for (const c of cc) { ccAgg[c.k] ||= { n: 0, cls: new Set() }; ccAgg[c.k].n++; if (ccAgg[c.k].cls.size < 4) ccAgg[c.k].cls.add(c.cls.slice(0, 70)); }
      for (const v of res) {
        const k = v.id;
        agg[k] ||= { impact: v.impact, help: v.help, screens: new Set(), count: 0, sample: v.sample };
        agg[k].screens.add(tabs.length ? `${label}#${i}` : label);
        agg[k].count += v.n;
      }
    }
  }
  for (const [id, v] of Object.entries(agg)) console.log(`${v.impact} ${id}: ${v.help} — ${v.count} nodes on ${[...v.screens].join(', ')}\n   ${v.sample.join('\n   ')}`);
  for (const [k, v] of Object.entries(ccAgg).sort((a, b) => b[1].n - a[1].n)) console.log('CC', v.n, k, '|', [...v.cls].join(' ; '));
  if (!Object.keys(agg).length) console.log('axe: no violations');
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
