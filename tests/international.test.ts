import { beforeAll, describe, expect, it } from 'vitest';
import { ageAt } from '../src/engine/attributes';
import { computeTable } from '../src/engine/competitions';
import {
  SENIOR_SQUAD, assessCallUp, canSwitchNation, intlSlots, nationStrength, pickSquad, runNationalFixture, switchNation,
} from '../src/engine/international';
import { NATIONS } from '../src/engine/names';
import { hasTournament } from '../src/engine/season';
import type { Fixture, GameState } from '../src/engine/types';
import { newCareer, playUntilSeason, user } from './helpers';

const intlFixtures = (s: GameState, prefix: string): Fixture[] =>
  Object.values(s.competitions).filter((c) => c.id.startsWith(prefix)).flatMap((c) => c.fixtureIds.map((id) => s.fixtures[id]));

describe('national teams', () => {
  const s = newCareer(301);
  const codes = Object.keys(s.nations);

  it('has sixteen nations, each with a deep pool that includes everyone of that nationality', () => {
    expect(codes).toHaveLength(NATIONS.length);
    for (const code of codes) {
      const t = s.nations[code];
      expect(t.poolIds.length).toBeGreaterThanOrEqual(28);
      for (const id of t.poolIds) {
        const p = s.players[id];
        expect(p.nationality).toBe(code);
        expect(p.retired).toBe(false);
      }
      expect(t.manager.formation).toBeTruthy();
    }
  });

  it('puts the user in the pool of the nation he represents, and only that one', () => {
    const rep = s.international.nation;
    expect(rep).toBe(user(s).nationality);
    expect(s.nations[rep].poolIds).toContain(s.userId);
    for (const code of codes) if (code !== rep) expect(s.nations[code].poolIds).not.toContain(s.userId);
  });

  it('names a full 23-player squad for every nation, without duplicates and with enough goalkeepers', () => {
    for (const code of codes) {
      const sq = pickSquad(s, code, false);
      expect(sq.squad).toHaveLength(SENIOR_SQUAD);
      expect(new Set(sq.squad.map((p) => p.id)).size).toBe(SENIOR_SQUAD);
      expect(sq.lineup.every(Boolean)).toBe(true);
      expect(sq.lineup).toHaveLength(11);
      expect(sq.squad.filter((p) => p.position === 'GK').length).toBeGreaterThanOrEqual(2);
      for (const p of sq.squad) expect(p.nationality).toBe(code);
    }
  });

  it('fields an under-21 side of under-21s (or, if the pool is thin, never fewer than eleven)', () => {
    for (const code of codes) {
      const sq = pickSquad(s, code, true);
      expect(sq.lineup).toHaveLength(11);
      expect(sq.lineup.every(Boolean)).toBe(true);
    }
  });

  it('rates stronger nations as stronger', () => {
    const ranked = [...NATIONS].sort((a, b) => b.strength - a.strength);
    const top = ranked.slice(0, 4).reduce((t, n) => t + nationStrength(s, n.code), 0) / 4;
    const bottom = ranked.slice(-4).reduce((t, n) => t + nationStrength(s, n.code), 0) / 4;
    expect(top).toBeGreaterThan(bottom + 4);
  });
});

describe('the call-up assessment', () => {
  it('ranks the user against his rivals and explains where he stands', () => {
    const s = newCareer(311);
    const a = assessCallUp(s, false);
    expect(['none', 'senior_watchlist', 'senior_squad']).toContain(a.status);
    expect(a.needed).toBeGreaterThan(0);
    expect(a.rank).toBeGreaterThan(0);
    expect(a.rivals.length).toBeLessThanOrEqual(6);
    expect(a.opinion).toBeGreaterThanOrEqual(0);
    expect(a.opinion).toBeLessThanOrEqual(100);
    expect(a.reason.length).toBeGreaterThan(10);
    // a 16-year-old with a 41 rating does not make the senior squad
    expect(a.status).not.toBe('senior_squad');
    const y = assessCallUp(s, true);
    expect(['none', 'youth']).toContain(y.status);
  });
});

describe('switching nation', () => {
  it('needs eligibility and no senior caps, then moves the user between pools', () => {
    const s = newCareer(321);
    expect(canSwitchNation(s, 'ZZZ').ok).toBe(false);
    expect(canSwitchNation(s, s.international.nation).ok).toBe(false);
    const other = Object.keys(s.nations).find((c) => c !== s.international.nation) as string;
    expect(switchNation(s, other)).toBe(false); // not eligible
    s.international.eligible.push(other);
    expect(canSwitchNation(s, other).ok).toBe(true);
    const old = s.international.nation;
    expect(switchNation(s, other)).toBe(true);
    expect(s.international.nation).toBe(other);
    expect(s.nations[other].poolIds).toContain(s.userId);
    expect(s.nations[old].poolIds).not.toContain(s.userId);
    expect(s.international.squadStatus).toBe('none');
    // once capped, he is tied to the nation
    s.international.caps = 1;
    s.international.eligible.push(old);
    expect(canSwitchNation(s, old).ok).toBe(false);
    expect(switchNation(s, old)).toBe(false);
    expect(s.international.nation).toBe(other);
  });
});

describe('the international calendar over two seasons', () => {
  let s: GameState;
  let friendlies: Fixture[];
  beforeAll(() => {
    s = newCareer(331);
    playUntilSeason(s, 2027);
    // competitions more than a season old are pruned at the next rollover, so take the 2026 programme while it exists
    friendlies = intlFixtures(s, 'INTF-2026').map((f) => JSON.parse(JSON.stringify(f)) as Fixture);
    playUntilSeason(s, 2028);
  }, 280000);

  it('plays friendlies in an off year, with every nation involved equally in each slot', () => {
    expect(hasTournament(2026)).toBe(false);
    const fx = friendlies;
    expect(fx.length).toBeGreaterThan(0);
    expect(fx.every((f) => f.played && f.result)).toBe(true);
    const byDay = new Map<number, Fixture[]>();
    for (const f of fx) byDay.set(f.day, [...(byDay.get(f.day) ?? []), f]);
    for (const [, list] of byDay) {
      expect(list).toHaveLength(8);
      expect(new Set(list.flatMap((f) => [f.homeId, f.awayId])).size).toBe(16);
    }
    const slots = intlSlots({ ...s, season: 2026 } as GameState);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('runs qualifying in four balanced groups before the finals', () => {
    expect(hasTournament(2027)).toBe(true);
    const qual = s.competitions['QUAL-2027'];
    expect(qual.groups).toHaveLength(4);
    expect(qual.completed).toBe(true);
    const all = qual.groups!.flatMap((g) => g.teams);
    expect(new Set(all).size).toBe(16);
    for (const g of qual.groups!) {
      expect(g.teams).toHaveLength(4);
      const fxs = qual.fixtureIds.map((id) => s.fixtures[id]).filter((f) => g.teams.includes(f.homeId));
      expect(fxs).toHaveLength(12);
      const table = computeTable(g.teams, fxs);
      for (const r of table) expect(r.p).toBe(6);
    }
  });

  it('seeds the finals with the top two of each group, plays them to a result and records the winner', () => {
    const qual = s.competitions['QUAL-2027'];
    const finals = s.competitions['FINALS-2027'];
    expect(finals).toBeTruthy();
    const expected: string[] = [];
    for (const g of qual.groups!) {
      const fxs = qual.fixtureIds.map((id) => s.fixtures[id]).filter((f) => g.teams.includes(f.homeId));
      const t = computeTable(g.teams, fxs);
      expected.push(t[0].clubId, t[1].clubId);
    }
    expect([...finals.clubIds].sort()).toEqual([...expected].sort());
    const fx = finals.fixtureIds.map((id) => s.fixtures[id]);
    expect(fx.filter((f) => f.round.startsWith('Group'))).toHaveLength(12);
    expect(fx.filter((f) => f.round === 'Semi-final')).toHaveLength(2);
    expect(fx.filter((f) => f.round === 'Final')).toHaveLength(1);
    expect(fx.every((f) => f.played && f.neutral)).toBe(true);
    for (const f of fx.filter((x) => x.knockout)) {
      const r = f.result!;
      expect(r.hg !== r.ag || !!r.pens).toBe(true);
    }
    expect(finals.completed).toBe(true);
    expect(finals.clubIds).toContain(finals.winnerId);
    expect(finals.clubIds).toContain(finals.runnerUpId);
    expect(finals.winnerId).not.toBe(finals.runnerUpId);
    expect(s.history.some((h) => h.compId === finals.id && h.winnerId === finals.winnerId)).toBe(true);
    expect(s.international.tournaments.some((t) => t.season === 2028)).toBe(true);
  });

  it('prunes competitions more than a season old, keeping the history', () => {
    expect(intlFixtures(s, 'INTF-2026')).toHaveLength(0);
    expect(s.competitions['QUAL-2027']).toBeTruthy();
  });

  it('never has a nation play twice on the same day', () => {
    const seen = new Set<string>();
    for (const f of [...friendlies, ...intlFixtures(s, 'INTF'), ...intlFixtures(s, 'QUAL'), ...intlFixtures(s, 'FINALS')]) {
      if (seen.has(`f:${f.id}`)) continue;
      seen.add(`f:${f.id}`);
      for (const code of [f.homeId, f.awayId]) {
        const key = `${code}@${f.day}`;
        expect(seen.has(key), `${code} twice on ${f.day}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('replays a national fixture identically from the seed', () => {
    const f = intlFixtures(s, 'QUAL-2027')[0];
    const a = runNationalFixture(s, f);
    const b = runNationalFixture(s, f);
    expect([a.result.hg, a.result.ag]).toEqual([b.result.hg, b.result.ag]);
    expect(JSON.stringify(a.result.team)).toBe(JSON.stringify(b.result.team));
  });
});

describe('a player who is good enough', () => {
  let s: GameState;
  beforeAll(() => {
    s = newCareer(341, { pathway: 'custom', age: 23, custom: { ovr: 84, talent: 'great' }, position: 'ST', difficulty: 'standard' });
    playUntilSeason(s, 2028);
  }, 280000);

  it('is called up, earns caps, and the caps tally with the matches he actually played', () => {
    const i = s.international;
    expect(ageAt(user(s).birthDay, s.day)).toBeGreaterThanOrEqual(24);
    expect(i.callUps.length).toBeGreaterThan(0);
    const played = Object.values(s.matchRecords).filter((m) => /^(INTF|QUAL|FINALS)/.test(m.compId) && (m.userSummary?.minutes ?? 0) > 0);
    expect(i.caps).toBe(played.length);
    expect(i.caps).toBeGreaterThan(0);
    expect(i.callUps.filter((c) => c.level === 'senior' && c.played).length).toBeLessThanOrEqual(i.caps);
    expect(i.goals).toBe(played.reduce((t, m) => t + (m.userSummary?.goals ?? 0), 0));
    expect(s.career.achievements.first_cap).toBeDefined();
    expect(s.reputation.national).toBeGreaterThan(0);
  });

  it('only ever appears in national matches for the nation he represents', () => {
    const nation = s.international.nation;
    for (const m of Object.values(s.matchRecords)) {
      if (!/^(INTF|QUAL|FINALS|U21)/.test(m.compId)) continue;
      expect([m.homeId, m.awayId]).toContain(nation);
    }
  });
});
