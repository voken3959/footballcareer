import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { ageAt } from '../src/engine/attributes';
import { advanceDays, resolveDecision } from '../src/engine/game';
import { roundWage } from '../src/engine/economy';
import { buyItem } from '../src/engine/life';
import {
  EARLIEST_VOLUNTARY_RETIREMENT, FORCED_RETIREMENT_AGE, buildLegacy, canRetireNow, retireNow, retirementOdds, retirementRollover,
  retirementSummaryText, returnFromAbroad, simulateAbroadSeason, startAbroad,
} from '../src/engine/retirement';
import { openOffers } from '../src/engine/transfers';
import type { GameState } from '../src/engine/types';
import { autoHandle, clone, newCareer, playMatches, playUntilSeason, user } from './helpers';

const setAge = (s: GameState, age: number) => { user(s).birthDay = s.day - Math.round(age * 365.25) - 10; };

/** a veteran whose season-end retirement conversation has started */
function veteranWithDecision(seed: number, age = 36): GameState {
  const s = newCareer(seed);
  setAge(s, age);
  for (let k = 1; k < 60; k++) {
    const t = clone(s);
    retirementRollover(t, new Rng(k), t.season);
    if (t.decisions.some((d) => d.kind === 'retirement')) return t;
  }
  throw new Error('no retirement decision arose');
}

describe('retirement odds', () => {
  it('rise with age, are certain at the forced age and nil for the young', () => {
    expect(retirementOdds(25, 70)).toBe(0);
    expect(retirementOdds(28, 40)).toBe(0);
    expect(retirementOdds(FORCED_RETIREMENT_AGE, 99)).toBe(1);
    let prev = 0;
    for (let age = 33; age <= 45; age++) {
      const o = retirementOdds(age, 70);
      expect(o).toBeGreaterThanOrEqual(prev);
      expect(o).toBeLessThanOrEqual(1);
      prev = o;
    }
    expect(retirementOdds(33, 40)).toBeGreaterThan(retirementOdds(33, 80)); // the weaker player calls it a day sooner
  });
});

describe('retiring on his own initiative', () => {
  it('is not allowed before the earliest voluntary age', () => {
    const s = newCareer(201);
    const c = canRetireNow(s);
    expect(c.ok).toBe(false);
    expect(c.reason).toContain(String(EARLIEST_VOLUNTARY_RETIREMENT));
    expect(retireNow(s).ok).toBe(false);
    expect(s.career.retired).toBe(false);
  });

  it('ends the career cleanly: no club, no contract, no offers, no live sponsors, and the calendar stops', () => {
    const s = newCareer(202);
    playMatches(s, 8);
    setAge(s, 32);
    expect(canRetireNow(s).ok).toBe(true);
    const r = retireNow(s);
    expect(r.ok).toBe(true);
    const p = user(s);
    expect(s.career.retired).toBe(true);
    expect(s.career.retiredDay).toBe(s.day);
    expect(p.retired).toBe(true);
    expect(p.clubId).toBeNull();
    expect(p.contract).toBeNull();
    expect(Object.values(s.squads).some((ids) => ids.includes(p.id))).toBe(false);
    expect(openOffers(s)).toHaveLength(0);
    expect(s.decisions.filter((d) => ['retirement', 'life', 'sponsor', 'free_agent'].includes(d.kind))).toHaveLength(0);
    expect(s.finance.sponsorships.every((x) => x.status !== 'active')).toBe(true);
    expect(s.news.some((n) => /retirement/.test(n.headline))).toBe(true);
    expect(s.career.milestones.some((m) => m.kind === 'retirement')).toBe(true);
    // nothing more can happen
    expect(retireNow(s).ok).toBe(false);
    expect(advanceDays(s, 30)).toMatchObject({ stop: 'retired', days: 0 });
    expect(buyItem(s, 'ent_cinema').ok).toBe(false);
  });
});

describe('the legacy summary', () => {
  function retired(seed = 211) {
    const s = newCareer(seed);
    playMatches(s, 14);
    setAge(s, 33);
    retireNow(s);
    return s;
  }

  it('adds up to the career totals the player actually accumulated', () => {
    const s = retired();
    const l = s.career.legacy!;
    expect(l).toBeTruthy();
    expect(l.apps).toBe(s.career.appearances.apps);
    expect(l.goals).toBe(s.career.appearances.goals);
    expect(l.assists).toBe(s.career.appearances.assists);
    expect(l.trophies).toHaveLength(s.career.trophies.length);
    expect(l.careerEarnings).toBe(s.finance.careerEarnings);
    expect(l.highestOverall).toBe(s.career.highestOverall);
    expect(l.startOverall).toBe(s.career.startOverall);
    expect(l.retiredAge).toBe(ageAt(user(s).birthDay, s.day));
    expect(l.clubs.length).toBeGreaterThanOrEqual(1);
    expect(l.clubs.reduce((t, c) => t + c.apps, 0)).toBeLessThanOrEqual(l.apps + 1);
    expect(l.verdict.length).toBeGreaterThan(3);
    expect(l.verdictDetail.length).toBeGreaterThan(3);
  });

  it('keeps its timeline in date order and is stable when recomputed', () => {
    const s = retired(212);
    const l = s.career.legacy!;
    for (let i = 1; i < l.timeline.length; i++) expect(l.timeline[i].day).toBeGreaterThanOrEqual(l.timeline[i - 1].day);
    const again = buildLegacy(s, l.reason);
    expect(again.verdict).toBe(l.verdict);
    expect(again.apps).toBe(l.apps);
    // the only difference is the retirement milestone itself, which is written after the summary is first built
    expect(again.timeline.filter((t) => t.kind !== 'retirement')).toEqual(l.timeline);
    expect(again.timeline.some((t) => t.kind === 'retirement')).toBe(true);
  });

  it('reads out as plain sentences', () => {
    const s = retired(213);
    const lines = retirementSummaryText(s.career.legacy!);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Retired aged \d+/);
    expect(lines.join(' ')).toMatch(/appearances/);
  });
});

describe('the retirement conversation', () => {
  it('starts once, and not at all for a young player', () => {
    const young = newCareer(221);
    retirementRollover(young, new Rng(1), young.season);
    expect(young.decisions.some((d) => d.kind === 'retirement')).toBe(false);
    const s = veteranWithDecision(222);
    const n = s.decisions.filter((d) => d.kind === 'retirement').length;
    expect(n).toBe(1);
    retirementRollover(s, new Rng(5), s.season); // asking again while one is open does not stack
    expect(s.decisions.filter((d) => d.kind === 'retirement')).toHaveLength(1);
    expect(s.career.retirementDecision).toBeTruthy();
  });

  it('rejects an answer that is not one of the options and leaves the question open', () => {
    const s = veteranWithDecision(223);
    const d = s.decisions.find((x) => x.kind === 'retirement')!;
    expect(resolveDecision(s, d.id, 'nonsense').ok).toBe(false);
    expect(s.decisions).toContain(d);
    expect(s.career.retired).toBe(false);
  });

  it('lets him keep playing, and asks again another year', () => {
    const s = veteranWithDecision(224);
    const d = s.decisions.find((x) => x.kind === 'retirement')!;
    expect(resolveDecision(s, d.id, 'continue').ok).toBe(true);
    expect(s.decisions.some((x) => x.id === d.id)).toBe(false);
    expect(s.career.retired).toBe(false);
    expect(s.career.retirementDecision?.choice).toBe('continue');
  });

  it('takes a reduced role: a quarter off the wage, lighter training, a smaller part to play', () => {
    const s = veteranWithDecision(225);
    const before = user(s).contract!.wage;
    const d = s.decisions.find((x) => x.kind === 'retirement')!;
    expect(d.options.map((o) => o.id)).toContain('reduced');
    expect(resolveDecision(s, d.id, 'reduced').ok).toBe(true);
    expect(user(s).contract!.wage).toBe(roundWage(before * 0.75));
    expect(user(s).contract!.role).toBe('Rotation option');
    expect(s.flags.reducedRole).toBe(true);
    expect(s.training.plan.intensity).toBe('light');
  });

  it('steps down a level by inviting offers from lower-ranked clubs', () => {
    const s = veteranWithDecision(226);
    const d = s.decisions.find((x) => x.kind === 'retirement')!;
    expect(resolveDecision(s, d.id, 'lower').ok).toBe(true);
    expect(s.flags.stepDown).toBe(s.season);
    const myRep = s.clubs[user(s).clubId as string].reputation;
    for (const o of openOffers(s)) expect(s.clubs[o.fromClubId].reputation).toBeLessThanOrEqual(myRep - 6);
  });

  it('retires when he says so, and the summary is ready', () => {
    const s = veteranWithDecision(227);
    const d = s.decisions.find((x) => x.kind === 'retirement')!;
    expect(resolveDecision(s, d.id, 'retire').ok).toBe(true);
    expect(s.career.retired).toBe(true);
    expect(s.career.legacy?.reason).toMatch(/time/);
    expect(s.decisions.some((x) => x.kind === 'retirement')).toBe(false);
  });

  it('forces retirement at the age limit', () => {
    const s = newCareer(228);
    setAge(s, FORCED_RETIREMENT_AGE);
    retirementRollover(s, new Rng(1), s.season);
    expect(s.career.retired).toBe(true);
    expect(s.career.legacy?.reason).toMatch(/body/);
  });
});

describe('moving abroad', () => {
  it('replaces the club with an overseas contract and withdraws every open offer', () => {
    const s = veteranWithDecision(231);
    const d = s.decisions.find((x) => x.kind === 'retirement')!;
    expect(resolveDecision(s, d.id, 'abroad').ok).toBe(true);
    const p = user(s);
    expect(p.clubId).toBeNull();
    expect(p.contract?.clubId).toBe('abroad');
    expect(p.contract!.wage).toBeGreaterThan(0);
    expect(typeof s.flags.abroadClub).toBe('string');
    expect(openOffers(s)).toHaveLength(0);
    expect(s.career.transfers.at(-1)?.toName).toContain(String(s.flags.abroadClub));
    expect(startAbroad(s, new Rng(1)).ok).toBe(false); // already there
  });

  it('plays out each season in summary, with believable numbers, adding to the career record', () => {
    const s = newCareer(232);
    setAge(s, 31);
    startAbroad(s, new Rng(2));
    const before = s.career.appearances.apps;
    const rec = simulateAbroadSeason(s, new Rng(3), s.season);
    expect(rec.clubId).toBe('abroad');
    expect(rec.league.apps).toBeGreaterThanOrEqual(4);
    expect(rec.league.apps).toBeLessThanOrEqual(36);
    expect(rec.league.starts).toBeLessThanOrEqual(rec.league.apps);
    expect(rec.league.ratingSum / rec.league.apps).toBeGreaterThan(5.5);
    expect(rec.league.ratingSum / rec.league.apps).toBeLessThan(8.3);
    expect(s.career.appearances.apps).toBe(before + rec.league.apps);
    expect(s.career.seasons.at(-1)).toBe(rec);
    // the same random stream gives the same season
    const t = newCareer(232);
    setAge(t, 31);
    startAbroad(t, new Rng(2));
    expect(simulateAbroadSeason(t, new Rng(3), t.season)).toEqual(rec);
  });

  it('asks again when the overseas deal ends: renew, come home as a free agent, or retire', () => {
    const base = newCareer(233);
    setAge(base, 34);
    startAbroad(base, new Rng(2));
    base.flags.abroadClub = base.flags.abroadClub ?? 'x';
    user(base).contract!.endDay = base.day - 1;
    retirementRollover(base, new Rng(4), base.season);
    const d = base.decisions.find((x) => x.kind === 'retirement')!;
    expect(d.options.map((o) => o.id)).toEqual(['continue_abroad', 'return', 'retire']);

    const renew = clone(base);
    expect(resolveDecision(renew, d.id, 'continue_abroad').ok).toBe(true);
    expect(user(renew).contract?.clubId).toBe('abroad');
    expect(user(renew).contract!.endDay).toBeGreaterThanOrEqual(renew.day);

    const home = clone(base);
    expect(resolveDecision(home, d.id, 'return').ok).toBe(true);
    expect(home.flags.abroadClub).toBeUndefined();
    expect(user(home).contract).toBeNull();
    expect(home.transfers.freeAgentIds).toContain(user(home).id);
    expect(returnFromAbroad(home).ok).toBe(true); // harmless if repeated

    const stop = clone(base);
    expect(resolveDecision(stop, d.id, 'retire').ok).toBe(true);
    expect(stop.career.retired).toBe(true);
    expect(stop.career.legacy?.clubs.some((c) => c.clubId === 'abroad')).toBe(true);
  });

  it('retires him at the age limit even when overseas', () => {
    const s = newCareer(234);
    setAge(s, FORCED_RETIREMENT_AGE);
    startAbroad(s, new Rng(2));
    user(s).contract!.endDay = s.day - 1;
    retirementRollover(s, new Rng(1), s.season);
    expect(s.career.retired).toBe(true);
  });
});

describe('the end of a long career', () => {
  it('is reached, with a legacy and nothing left hanging, whatever he chooses along the way', () => {
    const s = newCareer(240);
    setAge(s, 38);
    playUntilSeason(s, s.season + 8, autoHandle); // always "keep playing" until the game insists
    expect(s.career.retired).toBe(true);
    const l = s.career.legacy!;
    expect(l.retiredAge).toBeGreaterThanOrEqual(38);
    expect(l.retiredAge).toBeLessThanOrEqual(FORCED_RETIREMENT_AGE + 1);
    expect(user(s).clubId).toBeNull();
    expect(s.decisions.some((d) => d.kind === 'retirement')).toBe(false);
    expect(l.apps).toBe(s.career.appearances.apps);
    expect(s.career.seasons.length).toBeGreaterThanOrEqual(1);
  }, 280000);
});
