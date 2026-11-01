import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import {
  POINTS_DRAW, POINTS_WIN, clubCupStage, competitionFixtures, computeTable, createCup, doubleRoundRobin, drawCupRound,
  isEliminated, leagueTable, positionIn, resolveTie, updateCupAfterFixture,
} from '../src/engine/competitions';
import { cupOf, leagueOf, LEAGUE_TEMPLATES, compId } from '../src/engine/season';
import type { Fixture, GameState } from '../src/engine/types';
import { newCareer, playUntilSeason, user } from './helpers';

const fx = (id: string, home: string, away: string, hg: number, ag: number, day: number, extra: Partial<Fixture> = {}): Fixture => ({
  id, compId: 'T', round: 'x', matchday: 1, day, homeId: home, awayId: away, played: true,
  result: { hg, ag, scorers: [], cards: [] }, ...extra,
});

describe('league fixtures', () => {
  it.each([4, 5, 12, 20])('builds a balanced double round-robin for %i clubs', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    const rounds = doubleRoundRobin(ids, new Rng(n));
    const perRound = Math.floor(n / 2);
    expect(rounds).toHaveLength(2 * (n % 2 === 0 ? n - 1 : n));
    const seen = new Map<string, number>();
    for (const round of rounds) {
      const busy = new Set<string>();
      expect(round).toHaveLength(perRound);
      for (const { home, away } of round) {
        expect(home).not.toBe(away);
        expect(busy.has(home) || busy.has(away)).toBe(false); // nobody plays twice in a matchday
        busy.add(home); busy.add(away);
        seen.set(`${home}>${away}`, (seen.get(`${home}>${away}`) ?? 0) + 1);
      }
    }
    for (const a of ids) for (const b of ids) if (a !== b) expect(seen.get(`${a}>${b}`)).toBe(1); // each ordered pair exactly once
  });

  it('is reproducible from the seed', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
    expect(doubleRoundRobin(ids, new Rng(3))).toEqual(doubleRoundRobin(ids, new Rng(3)));
    expect(doubleRoundRobin(ids, new Rng(3))).not.toEqual(doubleRoundRobin(ids, new Rng(4)));
  });
});

describe('league table', () => {
  it('awards three points for a win and one for a draw, ranking by points then goal difference', () => {
    const fixtures = [fx('1', 'A', 'B', 2, 0, 1), fx('2', 'C', 'D', 1, 0, 2), fx('3', 'A', 'C', 1, 1, 3), fx('4', 'B', 'D', 3, 1, 4)];
    const t = computeTable(['A', 'B', 'C', 'D'], fixtures);
    expect(t.map((r) => r.clubId)).toEqual(['A', 'C', 'B', 'D']);
    const a = t[0];
    expect([a.p, a.w, a.d, a.l, a.gf, a.ga, a.gd, a.pts]).toEqual([2, 1, 1, 0, 3, 1, 2, 4]);
    expect(POINTS_WIN).toBe(3);
    expect(POINTS_DRAW).toBe(1);
    expect(t[3].form).toEqual(['L', 'L']);
    for (const r of t) expect(r.pts).toBe(r.w * 3 + r.d);
  });

  it('ignores fixtures that have not been played', () => {
    const unplayed: Fixture = { ...fx('9', 'A', 'B', 0, 0, 5), played: false, result: undefined };
    const t = computeTable(['A', 'B'], [unplayed]);
    expect(t.every((r) => r.p === 0 && r.pts === 0)).toBe(true);
  });

  it('breaks ties on head-to-head points before falling back to the club name', () => {
    // X and Y are level on points, goal difference and goals scored; X beat Y, so X ranks above Y even though Y sorts first by name
    const fixtures = [fx('1', 'X', 'Y', 1, 0, 1), fx('2', 'P', 'X', 1, 0, 2), fx('3', 'Q', 'Y', 0, 1, 3)];
    const names: Record<string, string> = { X: 'Zed Town', Y: 'Alpha United', P: 'Pine FC', Q: 'Quay FC' };
    const t = computeTable(['X', 'Y', 'P', 'Q'], fixtures, (id) => names[id]);
    const order = t.map((r) => r.clubId);
    expect(order.indexOf('X')).toBeLessThan(order.indexOf('Y'));
  });

  it('keeps only the last five results as form', () => {
    const fixtures = Array.from({ length: 8 }, (_, i) => fx(`f${i}`, 'A', 'B', i % 2, 0, i + 1));
    const row = computeTable(['A', 'B'], fixtures).find((r) => r.clubId === 'A')!;
    expect(row.form).toHaveLength(5);
  });
});

describe('knockout cup mechanics', () => {
  function cupState(teams: string[]): { s: GameState; id: string } {
    const s = newCareer(5);
    const id = 'TEST-CUP';
    createCup(s, id, 'Test Cup', 'TST', 2026, teams, [
      { name: 'Round 1', legs: 1, day: s.day + 10, drawDay: s.day + 5 },
      { name: 'Semi-final', legs: 2, day: s.day + 20, day2: s.day + 27, drawDay: s.day + 15 },
      { name: 'Final', legs: 1, day: s.day + 40, drawDay: s.day + 35 },
    ]);
    return { s, id };
  }
  const settle = (s: GameState, fid: string, hg: number, ag: number, extra: Partial<NonNullable<Fixture['result']>> = {}) => {
    const f = s.fixtures[fid];
    f.played = true;
    f.result = { hg, ag, scorers: [], cards: [], ...extra };
    return updateCupAfterFixture(s, f);
  };

  it('gives a bye to the top club when a round has an odd number of teams', () => {
    const { s, id } = cupState(['a', 'b', 'c', 'd', 'e']);
    s.clubs = { ...s.clubs, a: { ...s.clubs[Object.keys(s.clubs)[0]], id: 'a', reputation: 99 } } as typeof s.clubs;
    const comp = s.competitions[id];
    const round = drawCupRound(s, comp, 0, new Rng(1));
    const byes = round.ties.filter((t) => t.b === null);
    expect(byes).toHaveLength(1);
    expect(byes[0].winner).toBe('a');
    expect(byes[0].decidedBy).toBe('bye');
    expect(round.ties.filter((t) => t.b !== null)).toHaveLength(2);
    // drawing the same round twice changes nothing
    expect(drawCupRound(s, comp, 0, new Rng(99))).toBe(round);
  });

  it('settles a single-leg tie on the day, then advances only the winners', () => {
    const { s, id } = cupState(['a', 'b', 'c', 'd']);
    const comp = s.competitions[id];
    const r1 = drawCupRound(s, comp, 0, new Rng(2));
    const [t1, t2] = r1.ties;
    expect(settle(s, t1.fixtureIds[0], 2, 1).tieDone?.winner).toBe(t1.a);
    expect(r1.completed).toBe(false);
    const out = settle(s, t2.fixtureIds[0], 0, 3);
    expect(out.roundDone).toBe(true);
    expect(out.tieDone?.winner).toBe(t2.b);
    expect(isEliminated(comp, t1.b as string)).toBe(true);
    expect(isEliminated(comp, t1.a)).toBe(false);
    const r2 = drawCupRound(s, comp, 1, new Rng(3));
    expect(r2.ties.flatMap((t) => [t.a, t.b])).toEqual(expect.arrayContaining([t1.a, t2.b]));
    expect(r2.ties.flatMap((t) => [t.a, t.b])).not.toContain(t1.b);
  });

  it('decides a two-legged tie on aggregate, and on penalties when level', () => {
    const { s, id } = cupState(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const comp = s.competitions[id];
    const r1 = drawCupRound(s, comp, 0, new Rng(2));
    for (const t of r1.ties) settle(s, t.fixtureIds[0], 1, 0);
    const semi = drawCupRound(s, comp, 1, new Rng(3));
    expect(semi.ties).toHaveLength(2);
    const [tie] = semi.ties;
    expect(tie.fixtureIds).toHaveLength(2);
    const [leg1, leg2] = tie.fixtureIds.map((fid) => s.fixtures[fid]);
    expect(leg1.homeId).toBe(tie.a);
    expect(leg2.homeId).toBe(tie.b);
    expect(settle(s, leg1.id, 2, 0).tieDone).toBeNull(); // not decided after one leg
    const decided = settle(s, leg2.id, 1, 1);
    expect(decided.tieDone).toMatchObject({ winner: tie.a, decidedBy: 'aggregate', agg: [3, 1] });

    // a second tie that is level on aggregate goes to the shoot-out result of the second leg
    const other = semi.ties[1];
    const [o1, o2] = other.fixtureIds.map((fid) => s.fixtures[fid]);
    settle(s, o1.id, 1, 1);
    const pen = settle(s, o2.id, 2, 2, { et: true, pens: [3, 5] });
    expect(pen.tieDone?.decidedBy).toBe('penalties');
    expect(pen.tieDone?.winner).toBe(o2.awayId); // the away side of the second leg won the shoot-out 5-3
    expect(resolveTie(s, other)?.winner).toBe(o2.awayId);
  });

  it('crowns the winner of the final on a neutral ground and records the runner-up', () => {
    const { s, id } = cupState(['a', 'b']);
    const comp = s.competitions[id];
    // with two clubs the first round is already a single tie; make it the last round by trimming the plan
    comp.rounds = [comp.rounds![2]];
    const final = drawCupRound(s, comp, 0, new Rng(4));
    const tie = final.ties[0];
    expect(s.fixtures[tie.fixtureIds[0]].neutral).toBe(true);
    const r = settle(s, tie.fixtureIds[0], 1, 0);
    expect(r.cupDone).toBe(true);
    expect(comp.completed).toBe(true);
    expect(comp.winnerId).toBe(tie.a);
    expect(comp.runnerUpId).toBe(tie.b);
    expect(clubCupStage(comp, tie.a)).toBe('Winner');
    expect(clubCupStage(comp, tie.b as string)).toContain('Out in the');
  });
});

describe('a full season of the whole world', () => {
  let s: GameState;
  const SEASON = 2026;

  beforeAll(() => {
    s = newCareer(2026);
    playUntilSeason(s, SEASON + 1);
  }, 240000);

  it('rolls over into the next season and records the one just played', () => {
    expect(s.season).toBe(SEASON + 1);
    expect(s.career.seasons.length).toBeGreaterThanOrEqual(1);
    expect(s.lastSeasonSummary?.season).toBe(SEASON);
    expect(s.awards.some((a) => a.season === SEASON)).toBe(true);
  });

  it('plays every league fixture exactly once and keeps each table internally consistent', () => {
    for (const t of LEAGUE_TEMPLATES) {
      const comp = leagueOf(s, t.id, SEASON)!;
      const n = comp.clubIds.length;
      const fixtures = competitionFixtures(s, comp.id);
      expect(fixtures).toHaveLength(n * (n - 1));
      expect(fixtures.every((f) => f.played && f.result)).toBe(true);
      const table = leagueTable(s, comp.id);
      expect(table).toHaveLength(n);
      let gf = 0;
      let ga = 0;
      for (const r of table) {
        expect(r.p).toBe(2 * (n - 1));
        expect(r.w + r.d + r.l).toBe(r.p);
        expect(r.pts).toBe(3 * r.w + r.d);
        expect(r.gd).toBe(r.gf - r.ga);
        gf += r.gf; ga += r.ga;
      }
      expect(gf).toBe(ga);
      for (let i = 1; i < table.length; i++) expect(table[i - 1].pts).toBeGreaterThanOrEqual(table[i].pts);
      expect(comp.completed).toBe(true);
      expect(comp.winnerId).toBe(table[0].clubId);
    }
  });

  it('never schedules a club twice on the same day', () => {
    const perDay = new Map<string, string>();
    for (const comp of Object.values(s.competitions)) {
      if (comp.season !== SEASON || comp.type === 'intl' || comp.type === 'dev') continue;
      for (const id of comp.fixtureIds) {
        const f = s.fixtures[id];
        for (const club of [f.homeId, f.awayId]) {
          const key = `${club}@${f.day}`;
          expect(perDay.has(key), `${club} plays twice on day ${f.day}: ${perDay.get(key)} and ${f.id}`).toBe(false);
          perDay.set(key, f.id);
        }
      }
    }
  });

  it('promotes the top three of the second tier and relegates the bottom three of the first', () => {
    const t1 = leagueTable(s, compId('L1', SEASON));
    const t2 = leagueTable(s, compId('L2', SEASON));
    for (const r of t1.slice(-3)) expect(s.clubs[r.clubId].leagueId).toBe('L2');
    for (const r of t2.slice(0, 3)) expect(s.clubs[r.clubId].leagueId).toBe('L1');
    for (const r of t1.slice(0, t1.length - 3)) expect(s.clubs[r.clubId].leagueId).toBe('L1');
    for (const r of t2.slice(3)) expect(s.clubs[r.clubId].leagueId).toBe('L2');
    // next season's divisions have the same size as before and contain exactly the clubs that now sit in them
    for (const t of LEAGUE_TEMPLATES) {
      const next = leagueOf(s, t.id, SEASON + 1)!;
      const prev = leagueOf(s, t.id, SEASON)!;
      expect(next.clubIds).toHaveLength(prev.clubIds.length);
      expect([...next.clubIds].sort()).toEqual(Object.values(s.clubs).filter((c) => c.leagueId === t.id).map((c) => c.id).sort());
      expect(next.completed).toBe(false);
      expect(next.fixtureIds.every((id) => !s.fixtures[id].played)).toBe(true);
    }
  });

  it('completes the domestic cup with a winner and a runner-up', () => {
    const cup = cupOf(s, SEASON)!;
    expect(cup.completed).toBe(true);
    expect(cup.winnerId).toBeTruthy();
    expect(cup.runnerUpId).toBeTruthy();
    expect(cup.winnerId).not.toBe(cup.runnerUpId);
    expect(clubCupStage(cup, cup.winnerId as string)).toBe('Winner');
    for (const r of cup.rounds!) {
      expect(r.completed).toBe(true);
      for (const t of r.ties) expect(t.winner).toBeTruthy();
    }
    // the final is the only tie in the last round
    expect(cup.rounds![cup.rounds!.length - 1].ties).toHaveLength(1);
  });

  it('records the champions in the history book', () => {
    const l1 = leagueOf(s, 'L1', SEASON)!;
    const rec = s.history.find((h) => h.season === SEASON && h.compId === l1.id);
    expect(rec?.winnerId).toBe(l1.winnerId);
    expect(s.history.some((h) => h.season === SEASON && h.compId === cupOf(s, SEASON)!.id)).toBe(true);
  });

  it('keeps the user\'s own league position consistent with the table', () => {
    const rec = s.career.seasons.find((x) => x.season === SEASON);
    expect(rec).toBeTruthy();
    const clubId = rec!.clubId;
    const table = leagueTable(s, compId(s.clubs[clubId].leagueId === 'L2' || rec!.leagueName.startsWith('Challenge') ? 'L2' : 'L1', SEASON));
    expect(rec!.leaguePos).toBe(positionIn(table, clubId));
    expect(user(s).clubId).toBeTruthy();
  });

  it('gives identical results when the same career is played again', () => {
    const again = newCareer(2026);
    playUntilSeason(again, SEASON + 1);
    expect(again.rngState).toBe(s.rngState);
    expect(leagueTable(again, compId('L1', SEASON)).map((r) => [r.clubId, r.pts, r.gd])).toEqual(leagueTable(s, compId('L1', SEASON)).map((r) => [r.clubId, r.pts, r.gd]));
    expect(cupOf(again, SEASON)!.winnerId).toBe(cupOf(s, SEASON)!.winnerId);
    expect(again.career.appearances).toEqual(s.career.appearances);
  }, 240000);
});
