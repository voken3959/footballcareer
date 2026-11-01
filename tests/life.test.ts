import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { ageAt } from '../src/engine/attributes';
import { roundMoney } from '../src/engine/economy';
import { payOnce, payWagesDue, post, weeklyLiving, weeklyTax } from '../src/engine/finance';
import {
  CATALOG, INVESTMENTS, bumpRel, buyItem, cancelService, catalogItem, financeSummary, housingItem, invest, investmentItem,
  investmentStatus, itemStatus, lifeMoodBonus, marketability, processLifeWeekly, relationshipLabel, resaleValue, resolveLifeDecision,
  reviewInvestments, sellInvestment, sellPurchase,
} from '../src/engine/life';
import type { GameState, Purchase } from '../src/engine/types';
import { clone, idleDays, newCareer, user } from './helpers';

const setAge = (s: GameState, age: number) => { user(s).birthDay = s.day - Math.round(age * 365.25) - 10; };
/** set the balance the honest way, through a ledger row, so the audit trail stays unbroken */
const rich = (s: GameState, v = 5_000_000) => { post(s, 'gift', 'Test funds', v - s.finance.balance); };
const ledgerOk = (s: GameState) => {
  const l = s.finance.ledger;
  let run = l.length ? l[0].balanceAfter - l[0].amount : 0;
  for (const e of l) { run += e.amount; expect(e.balanceAfter).toBe(run); }
  if (l.length) expect(l[l.length - 1].balanceAfter).toBe(s.finance.balance);
};

describe('the catalogue', () => {
  it('has unique ids, sensible prices and a described effect for every item', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATALOG) {
      expect(c.name.length).toBeGreaterThan(2);
      expect(c.price).toBeGreaterThanOrEqual(0);
      expect(c.upkeep).toBeGreaterThanOrEqual(0);
      expect(c.effects.length).toBeGreaterThan(0);
      if (c.mode === 'service') expect(c.upkeep).toBeGreaterThan(0);
      if (c.mode === 'experience') expect(c.price).toBeGreaterThan(0);
    }
    const inv = INVESTMENTS.map((i) => i.id);
    expect(new Set(inv).size).toBe(inv.length);
    for (const i of INVESTMENTS) { expect(i.risk).toBeGreaterThan(0); expect(i.risk).toBeLessThanOrEqual(1); expect(i.expectedAnnual).toBeGreaterThan(0); }
  });
});

describe('the shop', () => {
  it('refuses unknown items, items the player is too young for, and anything he cannot afford', () => {
    const s = newCareer(101);
    expect(buyItem(s, 'nope').ok).toBe(false);
    expect(ageAt(user(s).birthDay, s.day)).toBe(16);
    expect(buyItem(s, 'car_used').ok).toBe(false); // minimum age 17
    expect(buyItem(s, 'flat_share').message).toMatch(/18/);
    rich(s, 0);
    const before = s.finance.ledger.length;
    const r = buyItem(s, 'ent_cinema');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/need/i);
    expect(s.finance.balance).toBe(0);
    expect(s.finance.ledger).toHaveLength(before);
  });

  it('charges an experience once, lifts mood, and then enforces the cooldown', () => {
    const s = newCareer(102);
    rich(s, 1000);
    const c = user(s).cond;
    c.morale = 50;
    const item = catalogItem('ent_dinner')!;
    const friend = s.relationships.find((r) => r.kind === 'friend')!;
    const fv = friend.value;
    const r = buyItem(s, item.id);
    expect(r.ok, r.message).toBe(true);
    expect(s.finance.balance).toBe(1000 - item.price);
    expect(c.morale).toBeGreaterThan(50);
    expect(friend.value).toBeGreaterThan(fv);
    expect(s.finance.ledger.at(-1)).toMatchObject({ category: 'purchase', amount: -item.price });
    const again = buyItem(s, item.id);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/again in/);
    expect(s.finance.balance).toBe(1000 - item.price);
    ledgerOk(s);
  });

  it('keeps trips off match days: a weekend away needs clear days before the next game', () => {
    const s = newCareer(103);
    rich(s);
    const trip = catalogItem('trv_holiday')!;
    const st = itemStatus(s, trip);
    // either the next match is far enough away, or the shop says exactly why not
    if (!st.ok) expect(st.reason).toMatch(/clear days/);
    else expect(buyItem(s, trip.id).ok).toBe(true);
  });

  it('lets the player own a car once, depreciates it, and sells it back for less than he paid', () => {
    const s = newCareer(104);
    setAge(s, 20);
    rich(s);
    expect(buyItem(s, 'car_sports').ok).toBe(true);
    const pur = s.finance.purchases.find((p) => p.catalogId === 'car_sports') as Purchase;
    expect(buyItem(s, 'car_sports').message).toMatch(/already own/);
    expect(resaleValue(s, pur)).toBe(pur.price); // brand new
    s.day += 730;
    const later = resaleValue(s, pur);
    expect(later).toBeLessThan(pur.price);
    expect(later).toBeGreaterThan(pur.price * 0.3 - 1);
    const before = s.finance.balance;
    expect(sellPurchase(s, pur.id).ok).toBe(true);
    expect(s.finance.balance).toBe(before + later);
    expect(s.finance.purchases.some((p) => p.id === pur.id)).toBe(false);
    expect(sellPurchase(s, pur.id).ok).toBe(false);
    ledgerOk(s);
  });

  it('starts and cancels a service, and does not let him pay for it twice', () => {
    const s = newCareer(105);
    rich(s);
    expect(buyItem(s, 'svc_physio').ok).toBe(true);
    expect(buyItem(s, 'svc_physio').ok).toBe(false);
    const pur = s.finance.purchases.find((p) => p.catalogId === 'svc_physio') as Purchase;
    expect(pur.upkeep).toBe(catalogItem('svc_physio')!.upkeep);
    expect(financeSummary(s).weeklyLiving).toBeGreaterThanOrEqual(pur.upkeep);
    expect(cancelService(s, pur.id).ok).toBe(true);
    expect(s.finance.purchases.some((p) => p.id === pur.id)).toBe(false);
    expect(cancelService(s, pur.id).ok).toBe(false);
  });

  it('moves house, selling the old home to help pay for the next, and only ever holds one home', () => {
    const s = newCareer(106);
    setAge(s, 24);
    rich(s, 400000);
    expect(housingItem(s).id).toBe('home_family');
    expect(buyItem(s, 'house_own').ok).toBe(true);
    expect(s.finance.housing).toBe('house_own');
    expect(s.finance.balance).toBe(400000 - 285000);
    expect(s.finance.purchases.filter((p) => p.category === 'housing')).toHaveLength(1);
    expect(buyItem(s, 'house_own').message).toMatch(/already live/);
    s.day += 400;
    const old = s.finance.purchases.find((p) => p.category === 'housing') as Purchase;
    const refund = resaleValue(s, old);
    expect(refund).toBeGreaterThan(285000 * 0.95);
    const bal = s.finance.balance;
    rich(s, bal + 2_300_000); // enough for the villa once the house is sold
    const at = s.finance.balance;
    expect(buyItem(s, 'villa').ok).toBe(true);
    expect(s.finance.balance).toBe(at + refund - 2_400_000);
    expect(s.finance.purchases.filter((p) => p.category === 'housing')).toHaveLength(1);
    expect(s.finance.housing).toBe('villa');
    expect(s.finance.ledger.some((e) => e.description.startsWith('Sold'))).toBe(true);
    expect(s.career.achievements.first_home).toBeDefined();
  });

  it('raises resting mood only as far as the cap allows', () => {
    const s = newCareer(107);
    setAge(s, 25);
    rich(s, 1e9);
    const start = lifeMoodBonus(s).total;
    for (const id of ['car_used', 'car_family', 'car_sports', 'car_luxury', 'ent_gaming', 'svc_chef', 'villa']) buyItem(s, id);
    const end = lifeMoodBonus(s);
    expect(end.total).toBeGreaterThan(start);
    expect(end.total).toBeLessThanOrEqual(6);
    expect(end.parts.length).toBeGreaterThan(2);
  });

  it('drops services he can no longer afford when the balance goes below zero', () => {
    const s = newCareer(108);
    rich(s, 100000);
    buyItem(s, 'svc_trainer');
    buyItem(s, 'svc_nutritionist');
    s.finance.balance = -2000;
    processLifeWeekly(s, new Rng(1));
    expect(s.finance.purchases.filter((p) => catalogItem(p.catalogId)?.mode === 'service')).toHaveLength(0);
    expect(s.news.some((n) => /can no longer afford/.test(n.headline))).toBe(true);
  });
});

describe('investments', () => {
  const studio = investmentItem('inv_studio')!;

  it('are for adults with the money, with a limit on how many of one kind', () => {
    const s = newCareer(111);
    rich(s);
    expect(invest(s, studio.id).message).toMatch(/18/);
    setAge(s, 22);
    rich(s, 100);
    expect(investmentStatus(s, studio).ok).toBe(false);
    rich(s);
    expect(invest(s, studio.id).ok).toBe(true);
    expect(invest(s, studio.id).ok).toBe(true);
    expect(invest(s, studio.id).message).toMatch(/two/);
    expect(invest(s, 'nothing').ok).toBe(false);
    expect(s.finance.investments).toHaveLength(2);
    expect(s.finance.balance).toBe(5_000_000 - 2 * studio.cost);
    expect(s.career.achievements.investor).toBeDefined();
    ledgerOk(s);
  });

  it('are reviewed each quarter from the seed alone, so the same career gives the same outcome', () => {
    const run = () => {
      const s = newCareer(112);
      setAge(s, 22);
      rich(s);
      invest(s, 'inv_cafe');
      invest(s, 'inv_startup');
      s.day += 91 * 6 + 3;
      reviewInvestments(s);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.finance.investments.map((i) => [i.value, i.incomeTotal, i.status])).toEqual(b.finance.investments.map((i) => [i.value, i.incomeTotal, i.status]));
    for (const inv of a.finance.investments) expect(inv.history.length).toBeGreaterThanOrEqual(1);
    // reviewing again on the same day changes nothing
    const snap = clone(a.finance);
    reviewInvestments(a);
    expect(a.finance).toEqual(snap);
    ledgerOk(a);
  });

  it('can be sold once, for the value less a selling cost, and failed ventures are worth nothing', () => {
    const s = newCareer(113);
    setAge(s, 22);
    rich(s);
    invest(s, studio.id);
    const inv = s.finance.investments[0];
    const before = s.finance.balance;
    expect(sellInvestment(s, inv.id).ok).toBe(true);
    expect(s.finance.balance).toBe(before + roundMoney(studio.cost * 0.97)); // 3% selling cost, rounded like every other price
    expect(inv.status).toBe('sold');
    expect(sellInvestment(s, inv.id).ok).toBe(false);
    invest(s, 'inv_startup');
    const v = s.finance.investments.find((i) => i.catalogId === 'inv_startup')!;
    v.value = 0;
    v.status = 'failed';
    expect(sellInvestment(s, v.id).ok).toBe(false);
    expect(financeSummary(s).investmentValue).toBe(0);
  });
});

describe('wages, tax and the ledger', () => {
  it('taxes weekly pay in bands, never more than the pay itself', () => {
    expect(weeklyTax(200)).toBe(0);
    expect(weeklyTax(240)).toBe(0);
    expect(weeklyTax(1400)).toBe(232);
    expect(weeklyTax(3200)).toBe(952);
    expect(weeklyTax(5000)).toBe(1762);
    let prev = 0;
    for (let g = 0; g <= 100000; g += 250) {
      const t = weeklyTax(g);
      expect(t).toBeGreaterThanOrEqual(prev);
      expect(t).toBeLessThanOrEqual(g);
      prev = t;
    }
  });

  it('never pays a one-off bonus twice', () => {
    const s = newCareer(121);
    const bal = s.finance.balance;
    expect(payOnce(s, 'k1', 'bonus', 'Test', 500)).not.toBeNull();
    expect(payOnce(s, 'k1', 'bonus', 'Test', 500)).toBeNull();
    expect(payOnce(s, 'k2', 'bonus', 'Nothing', 0)).toBeNull();
    expect(s.finance.balance).toBe(bal + 500);
    expect(s.finance.careerEarnings).toBeGreaterThanOrEqual(500);
  });

  it('pays one wage per elapsed week however the days are skipped', () => {
    const s = newCareer(122);
    const p = user(s);
    const start = s.finance.lastWagePaidDay;
    const gross = p.contract!.wage;
    s.day = start + 7 * 10 + 3;
    const out = payWagesDue(s);
    expect(out).toHaveLength(10);
    expect(s.finance.ledger.filter((e) => e.category === 'wage')).toHaveLength(10);
    for (const e of s.finance.ledger.filter((x) => x.category === 'wage')) expect(e.amount).toBe(gross);
    expect(payWagesDue(s)).toHaveLength(0); // calling again the same day pays nothing more
    ledgerOk(s);
  });

  it('charges living costs every week, including the small ones (regression: £140 once rounded down to nothing)', () => {
    const s = newCareer(125);
    expect(weeklyLiving(s)).toBeGreaterThan(0);
    expect(weeklyLiving(s)).toBe(user(s).contract!.type === 'academy' ? 60 : 140);
    rich(s);
    buyItem(s, 'svc_trainer');
    expect(weeklyLiving(s)).toBe((user(s).contract!.type === 'academy' ? 60 : 140) + catalogItem('svc_trainer')!.upkeep);
    const start = s.finance.lastLivingDay;
    s.day = start + 7 * 6 + 2;
    payWagesDue(s);
    const living = s.finance.ledger.filter((e) => e.category === 'living');
    expect(living).toHaveLength(6);
    for (const e of living) expect(e.amount).toBe(-weeklyLiving(s));
    // the figure shown on the Life screen is the figure actually charged
    expect(financeSummary(s).weeklyLiving).toBe(weeklyLiving(s));
    ledgerOk(s);
  });

  it('keeps the balance equal to the sum of ledger rows over a real stretch of play', () => {
    const s = newCareer(123);
    const before = s.finance.balance;
    const n = s.finance.ledger.length;
    idleDays(s, 63);
    const added = s.finance.ledger.slice(n);
    expect(added.length).toBeGreaterThan(8);
    expect(added.reduce((t, e) => t + e.amount, 0)).toBe(s.finance.balance - before);
    expect(added.filter((e) => e.category === 'wage').length).toBeGreaterThanOrEqual(8);
    expect(added.filter((e) => e.category === 'wage').length).toBeLessThanOrEqual(10);
    expect(added.filter((e) => e.category === 'living').length).toBeGreaterThanOrEqual(8);
    ledgerOk(s);
  });

  it('summarises weekly income and net worth from the same numbers it posts', () => {
    const s = newCareer(124);
    setAge(s, 22);
    rich(s, 1_000_000);
    invest(s, 'inv_studio');
    const f = financeSummary(s);
    expect(f.weeklyNet).toBe(Math.round(f.weeklyGross - f.weeklyTax - f.weeklyAgent - f.weeklyLiving + f.weeklySponsor));
    expect(f.netWorth).toBe(f.balance + f.investmentValue);
    post(s, 'gift', 'Test', 12345);
    expect(financeSummary(s).balance).toBe(f.balance + 12345);
  });
});

describe('relationships and decisions', () => {
  it('keeps relationship values between 0 and 100 and labels them sensibly', () => {
    const s = newCareer(131);
    const rel = s.relationships[0];
    bumpRel(s, rel, 1000);
    expect(rel.value).toBe(100);
    bumpRel(s, rel, -1000);
    expect(rel.value).toBe(0);
    expect(relationshipLabel(90)).toBe('Very close');
    expect(relationshipLabel(10)).toBe('Broken down');
    expect(marketability(s)).toBeGreaterThanOrEqual(0);
    expect(marketability(s)).toBeLessThanOrEqual(100);
  });

  it('raises life events during a season, each of which can be resolved with any of its options', () => {
    const s = newCareer(132);
    let found = false;
    for (let i = 0; i < 160 && !found; i++) {
      idleDays(s, 3);
      found = s.decisions.some((d) => d.kind === 'life' || d.kind === 'sponsor');
    }
    expect(found, 'no life event or sponsor offer arose in about 16 months of play').toBe(true);
    const d = s.decisions.find((x) => x.kind === 'life' || x.kind === 'sponsor')!;
    expect(d.options.length).toBeGreaterThanOrEqual(2);
    expect(resolveLifeDecision(s, d.id, 'not-an-option').ok).toBe(false);
    expect(s.decisions).toContain(d); // an invalid answer leaves it open
    for (const opt of d.options) {
      const t = clone(s);
      const r = resolveLifeDecision(t, d.id, opt.id);
      expect(r.ok, `${d.title} / ${opt.label}: ${r.message}`).toBe(true);
      expect(t.decisions.some((x) => x.id === d.id)).toBe(false);
      expect(r.message.length).toBeGreaterThan(3);
      ledgerOk(t);
      for (const rel of t.relationships) { expect(rel.value).toBeGreaterThanOrEqual(0); expect(rel.value).toBeLessThanOrEqual(100); }
      const c = user(t).cond;
      for (const v of [c.morale, c.confidence, c.fatigue]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
    // the same decision with the same option always has the same outcome
    const a = clone(s);
    const b = clone(s);
    const oid = d.options[0].id;
    expect(resolveLifeDecision(a, d.id, oid).message).toBe(resolveLifeDecision(b, d.id, oid).message);
    expect(resolveLifeDecision(a, d.id, oid).ok).toBe(false); // it is already gone
  }, 120000);

  it('settles an ignored decision on its default when it expires', () => {
    const s = newCareer(133);
    let d = undefined as GameState['decisions'][number] | undefined;
    for (let i = 0; i < 160 && !d; i++) {
      idleDays(s, 3);
      d = s.decisions.find((x) => (x.kind === 'life' || x.kind === 'sponsor') && x.expiresDay !== null);
    }
    expect(d).toBeTruthy();
    const id = d!.id;
    idleDays(s, Math.max(1, (d!.expiresDay as number) - s.day) + 3);
    expect(s.decisions.some((x) => x.id === id)).toBe(false);
  }, 120000);
});
