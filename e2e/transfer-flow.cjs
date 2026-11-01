/**
 * Drives the real screens through the transfer part of the career: start a custom 16-year-old with good talent, play on until a club
 * makes a formal offer, negotiate the terms in the dialog, accept, and check that the player really is at the new club.
 *   npm run build && npx vite preview --port 4173 &
 *   node e2e/transfer-flow.cjs [seed-free: the wizard picks its own seed]
 * Needs `playwright` to be installed.
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  const say = (m) => console.log('·', m);
  const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

  await page.goto('http://localhost:4173/');
  await page.waitForSelector('text=Pitchside');
  await page.click('text=New career');
  await page.waitForSelector('text=Where does the story begin?');
  await page.click('text=Custom career');
  await page.click('text=Next');
  await page.waitForSelector('text=Who are you?');
  await page.click('text=Next');
  await page.waitForSelector('text=Position');
  await page.waitForSelector('text=Overall rating at the start');
  await page.locator('input[aria-label="Starting overall"]').fill('64');
  await page.getByRole('radio', { name: 'Great' }).click();
  await page.click('text=Next');
  await page.waitForSelector('[role=radio][aria-checked]', { timeout: 20000 });
  await page.click('text=Next');
  await page.waitForSelector('text=Starting attributes');
  await page.click('text=Start career');
  await page.waitForSelector('text=Welcome back', { timeout: 60000 });
  say('career started');

  const clubName = async () => (await page.locator('header div.truncate').first().innerText()).trim();
  const startClub = await clubName();

  async function dismiss() {
    for (let i = 0; i < 4; i++) {
      const dlg = page.locator('[role=dialog]').first();
      if (!(await dlg.isVisible().catch(() => false))) return;
      if (process.env.DEBUG) say('dialog: ' + (await dlg.innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 260));
      const later = dlg.locator('button:has-text("Decide later")').first();
      const close = dlg.locator('button[aria-label="Close"]').first();
      if (await later.isVisible().catch(() => false)) await later.click();
      else if (await close.isVisible().catch(() => false)) await close.click();
      else await dlg.locator('button').last().click();
      await page.waitForTimeout(150);
    }
  }
  async function openTransfers() {
    await dismiss();
    await page.locator('nav[aria-label=Main]:visible').first().locator('button:has-text("Transfers")').first().click();
    await page.waitForTimeout(250);
    await page.getByRole('tab', { name: /Offers/ }).first().click().catch(() => {});
    await page.waitForTimeout(250);
  }

  // play on, one match at a time through the real buttons, asking the agent to canvass now and then, until a bid arrives
  async function playOneMatch() {
    await dismiss();
    const md = page.locator('button:has-text("Match day")').first();
    if (!(await md.isVisible().catch(() => false))) {
      const cont = page.locator('header button:has-text("Continue to match"), header button:has-text("Skip ahead")').first();
      await cont.click();
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(400);
        await dismiss();
        if (await md.isVisible().catch(() => false)) break;
        if ((await page.locator('header button:has-text("Continue to match")').count()) && !(await page.locator('[role=alertdialog]').count())) {
          if (i > 3) await page.locator('header button:has-text("Continue to match")').first().click().catch(() => {});
        }
      }
    }
    if (!(await md.isVisible().catch(() => false))) return false;
    await md.click();
    await page.waitForSelector('text=Play the match');
    await page.locator('button:has-text("Instant")').first().click();
    await page.waitForTimeout(900);
    const next = page.locator('button:has-text("Continue")').first();
    if (await next.isVisible().catch(() => false)) await next.click();
    await page.waitForSelector('text=Welcome back', { timeout: 20000 });
    return true;
  }
  async function offerOnScreen() {
    await openTransfers();
    const accept = page.locator('section.card[aria-label^="Permanent transfer"] button:has-text("Accept")').first();
    return (await accept.isVisible().catch(() => false)) && (await accept.isEnabled().catch(() => false));
  }
  let found = false;
  for (let i = 0; i < 70 && !found; i++) {
    if (!(await playOneMatch())) { say('could not reach the next match day'); break; }
    if (i % 3 === 2) {
      found = await offerOnScreen();
      if (!found) {
        await page.getByRole('tab', { name: /Agent/ }).first().click().catch(() => {});
        const canvass = page.locator('button:has-text("canvass")').first();
        if (await canvass.isVisible().catch(() => false)) { await canvass.click(); await page.waitForTimeout(300); }
        found = await offerOnScreen();
      }
      await page.locator('nav[aria-label=Main]:visible').first().locator('button:has-text("Home")').first().click();
    }
  }
  if (!found) return fail('no offer arrived through the screens');
  say('an offer is on the table');

  // the permanent bid the screens are showing: negotiate it first, then accept it
  await openTransfers();
  const target = page.locator('section.card[aria-label^="Permanent transfer"]').first();
  say('offer: ' + (await target.getAttribute('aria-label')));
  const negotiate = target.locator('button:has-text("Negotiate terms")');
  if (await negotiate.count()) {
    await negotiate.click();
    await page.waitForSelector('[role=dialog]');
    await page.locator('[role=dialog] button:has-text("Submit proposal")').click();
    await page.waitForTimeout(400);
    await dismiss();
    say('proposal submitted');
  }
  await openTransfers();
  const card2 = page.locator('section.card[aria-label^="Permanent transfer"]').first();
  const acceptBtn = card2.locator('button:has-text("Accept")');
  if (!(await acceptBtn.isEnabled())) return fail('the Accept button is disabled: ' + (await card2.innerText()).slice(0, 300));
  await acceptBtn.click();
  await page.waitForTimeout(300);
  const confirm = page.locator('[role=dialog] button:has-text("Confirm"), [role=dialog] button:has-text("Accept"), [role=dialog] button:has-text("Sign")').last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForTimeout(700);
  await dismiss();

  const after = await clubName();
  say(`club before: ${startClub} | after: ${after}`);
  if (after === startClub) fail('still at the same club after accepting');

  // the move is recorded in the career history and the news
  await page.locator('nav[aria-label=Main]:visible').first().locator('button:has-text("News")').first().click();
  await page.waitForTimeout(400);
  const news = await page.locator('main').innerText();
  if (!/joins|sign/i.test(news)) fail('no transfer story in the news');
  else say('the news carries the transfer story');
  console.log('errors:', JSON.stringify(errors));
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
