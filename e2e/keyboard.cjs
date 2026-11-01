/**
 * Keyboard audit: tab order, visible focus rings, skip link, dialog focus trap / Escape / focus return, and the system
 * reduced-motion preference.   node e2e/keyboard.cjs   (needs `playwright` and the preview server on port 4173, see a11y.cjs)
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('text=Pitchside');
  await page.click('text=New career');
  await page.waitForSelector('text=Where does the story begin?');
  await page.click('text=Next'); await page.waitForSelector('text=Who are you?');
  await page.click('text=Next'); await page.waitForSelector('text=Position');
  await page.click('text=Next'); await page.waitForSelector('[role=radio][aria-checked]', { timeout: 20000 });
  await page.click('text=Next'); await page.waitForSelector('text=Starting attributes');
  await page.click('text=Start career'); await page.waitForSelector('text=Welcome back', { timeout: 60000 });
  await page.waitForTimeout(500);
  // dismiss any dialog by keyboard only
  for (let i = 0; i < 3; i++) { if (await page.locator('[role=dialog]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } }
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  const info = [];
  const noRing = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, vis: r.width > 0 && r.height > 0, inView: r.bottom > 0 && r.top < innerHeight };
    });
    if (!d) continue;
    info.push(`${d.tag}:${d.text}`);
    if (!d.ring) noRing.push(`${d.tag}:${d.text}`);
  }
  console.log('first tab stops:', info.slice(0, 12).join(' | '));
  console.log('stops without a visible ring:', noRing.length ? noRing.join(', ') : 'none');
  // skip link
  const skip = await page.evaluate(() => !!document.querySelector('a[href="#main"]'));
  console.log('skip link present:', skip);
  // modal: open the season/menu dialog via keyboard
  await page.goto('http://localhost:4173/'); await page.waitForTimeout(800);
  const cont = page.locator('button:has-text("Continue")').first();
  if (await cont.count()) { await cont.click(); await page.waitForSelector('text=Welcome back', { timeout: 60000 }); }
  // open a dialog: the Menu button
  const trigger = page.locator('button:has-text("Menu")').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const hasDlg = await page.locator('[role=dialog]').count();
  console.log('dialog opened by keyboard:', hasDlg > 0);
  if (hasDlg) {
    let inside = true;
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); inside = inside && (await page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))); }
    console.log('focus stayed inside dialog over 25 tabs:', inside);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    console.log('dialog closed with Escape:', (await page.locator('[role=dialog]').count()) === 0);
    console.log('focus returned to trigger:', await page.evaluate(() => /Menu/.test(document.activeElement.textContent || '')));
  }
  // reduced motion honoured from the system setting
  const ctx2 = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto('http://localhost:4173/'); await p2.waitForTimeout(500);
  const anim = await p2.evaluate(() => { const d = document.createElement('div'); d.className = 'slide-in'; document.body.appendChild(d); const cs = getComputedStyle(d); return cs.animationDuration; });
  console.log('slide-in animation duration with system reduce-motion:', anim);
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
