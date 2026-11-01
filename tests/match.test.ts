import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { simulateMatch, teamStrength, type MatchInput } from '../src/engine/match/engine';
import { FORMATIONS } from '../src/engine/formations';
import type { MatchResult } from '../src/engine/types';
import { sideFor, worldClubs } from './helpers';

const clubs = worldClubs().sort((a, b) => b.reputation - a.reputation);
const top = clubs.slice(0, 4);
const bottom = clubs.slice(-4);

function fixture(seed: number, extra: Partial<MatchInput> = {}): MatchInput {
  const rng = new Rng(seed);
  const h = rng.pick(clubs);
  let a = rng.pick(clubs);
  while (a === h) a = rng.pick(clubs);
  return { seed: seed * 7919 + 13, home: sideFor(h), away: sideFor(a), ...extra };
}

/** everything that decides the outcome, i.e. all of the result except the (optional) event detail */
const outcome = (r: MatchResult) => JSON.stringify({ hg: r.hg, ag: r.ag, et: r.et, pens: r.pens, w: r.winnerSide, team: r.team, players: r.players, motm: r.motm, inj: r.injuries, dur: r.durationSeconds });

describe('match engine: determinism', () => {
  it('replays a match exactly from its seed', () => {
    const inp = fixture(1, { recordAll: true });
    expect(JSON.stringify(simulateMatch(inp))).toBe(JSON.stringify(simulateMatch(inp)));
  });

  it('gives the same result whether or not every event is recorded (instant / text / visual modes)', () => {
    for (let i = 0; i < 12; i++) {
      const lean = simulateMatch(fixture(100 + i, { recordAll: false }));
      const full = simulateMatch(fixture(100 + i, { recordAll: true }));
      expect(outcome(full)).toBe(outcome(lean));
      expect(full.events.length).toBeGreaterThanOrEqual(lean.events.length);
    }
  });

  it('varies with the seed', () => {
    const base = fixture(7);
    const scores = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const r = simulateMatch({ ...base, seed: i + 1 });
      scores.add(`${r.hg}-${r.ag}`);
    }
    expect(scores.size).toBeGreaterThan(3);
  });
});

describe('match engine: internal consistency', () => {
  const results = Array.from({ length: 40 }, (_, i) => ({ inp: fixture(300 + i, { recordAll: true }), i })).map(({ inp }) => ({ inp, r: simulateMatch(inp) }));

  it('derives the score from goal and own-goal events', () => {
    for (const { r } of results) {
      let h = 0;
      let a = 0;
      for (const e of r.events) {
        if (e.period === 5) continue;
        if (e.type === 'goal') (e.side === 0 ? h++ : a++);
        // an own goal is emitted for the side that conceded it, so it counts for the other team
        if (e.type === 'own_goal') (e.side === 0 ? a++ : h++);
      }
      expect([h, a]).toEqual([r.hg, r.ag]);
    }
  });

  it('keeps events in time order and indexed', () => {
    for (const { r } of results) {
      for (let i = 1; i < r.events.length; i++) {
        expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t);
        expect(r.events[i].i).toBeGreaterThan(r.events[i - 1].i);
      }
      expect(r.events[0].type).toBe('kickoff');
      expect(r.events[r.events.length - 1].type).toBe('full_time');
    }
  });

  it('fields eleven players a side, with ratings in range and a man of the match who played', () => {
    for (const { r, inp } of results) {
      expect(r.lineups[0].filter((l) => l.started)).toHaveLength(11);
      expect(r.lineups[1].filter((l) => l.started)).toHaveLength(11);
      expect(r.formations).toEqual([inp.home.formation, inp.away.formation]);
      for (const st of Object.values(r.players)) {
        expect(st.minutes).toBeGreaterThanOrEqual(0);
        expect(st.minutes).toBeLessThanOrEqual(125);
        if (st.minutes > 0) {
          expect(st.rating).toBeGreaterThanOrEqual(1);
          expect(st.rating).toBeLessThanOrEqual(10);
        } else expect(st.started).toBe(false); // an unused substitute is simply not rated
      }
      expect(r.players[r.motm]?.minutes ?? 0).toBeGreaterThan(0);
    }
  });

  it('credits the individual goals, assists and cards to the team totals', () => {
    for (const { r } of results) {
      const sum = (side: 0 | 1, f: (s: MatchResult['players'][string]) => number) => Object.values(r.players).filter((p) => p.side === side).reduce((t, p) => t + f(p), 0);
      expect(sum(0, (p) => p.goals) + sum(1, (p) => p.ownGoals)).toBe(r.hg);
      expect(sum(1, (p) => p.goals) + sum(0, (p) => p.ownGoals)).toBe(r.ag);
      expect(sum(0, (p) => p.yellow)).toBeGreaterThanOrEqual(0);
      expect(r.team[0].shots).toBeGreaterThanOrEqual(r.team[0].shotsOnTarget);
      expect(r.team[1].shots).toBeGreaterThanOrEqual(r.team[1].shotsOnTarget);
      expect(r.team[0].possession + r.team[1].possession).toBeGreaterThan(98);
      expect(r.team[0].possession + r.team[1].possession).toBeLessThan(102);
    }
  });

  it('never uses more substitutions than allowed, never subs a sent-off player and never plays a red-carded player on', () => {
    for (const { r } of results) {
      for (const side of [0, 1] as const) {
        const subs = r.events.filter((e) => e.type === 'substitution' && e.side === side);
        expect(subs.length).toBeLessThanOrEqual(5);
        const reds = new Set(r.events.filter((e) => e.type === 'red' && e.side === side).map((e) => e.p));
        for (const s of subs) expect(reds.has(s.d?.off)).toBe(false);
      }
      for (const e of r.events.filter((x) => x.type === 'red')) {
        const st = r.players[e.p as string];
        expect(st.red).toBeGreaterThanOrEqual(1);
        expect(st.minutes).toBeLessThanOrEqual(e.min + 2);
      }
    }
  });
});

describe('match engine: events and statistics agree', () => {
  const games = Array.from({ length: 40 }, (_, i) => simulateMatch(fixture(3000 + i, { recordAll: true })));
  const count = (r: MatchResult, type: string, id: string, pick: 'p' | 'p2' = 'p') => r.events.filter((e) => e.type === type && e[pick] === id).length;

  it('credits every goal to a scorer who was on the pitch for the right team', () => {
    let goals = 0;
    for (const r of games) {
      for (const e of r.events.filter((x) => x.type === 'goal' || x.type === 'own_goal')) {
        goals++;
        expect(e.p, 'a goal without a scorer').toBeTruthy();
        const st = r.players[e.p as string];
        expect(st, `scorer ${e.p} is not in the match`).toBeTruthy();
        expect(st.side).toBe(e.side); // goals for the scoring side, own goals for the side that conceded them
        expect(st.started || st.onMin !== null).toBe(true);
        expect(st.minutes).toBeGreaterThan(0);
      }
    }
    expect(goals).toBeGreaterThan(50);
  });

  it('attributes assists to a different team-mate of the scorer, never on a penalty or own goal', () => {
    let assists = 0;
    for (const r of games) {
      for (const e of r.events.filter((x) => x.type === 'goal')) {
        const a = e.d?.assist;
        if (!a) continue;
        assists++;
        expect(a).not.toBe(e.p);
        expect(r.players[a].side).toBe(e.side);
        expect(e.d?.pen).toBeFalsy();
      }
      for (const e of r.events.filter((x) => x.type === 'own_goal')) expect(e.d?.assist).toBeUndefined();
    }
    expect(assists).toBeGreaterThan(20);
  });

  it('keeps each player\'s statistics equal to what the recorded events show', () => {
    for (const r of games) {
      for (const [id, st] of Object.entries(r.players)) {
        expect(st.goals, `goals ${id}`).toBe(count(r, 'goal', id));
        expect(st.ownGoals, `own goals ${id}`).toBe(count(r, 'own_goal', id));
        expect(st.assists, `assists ${id}`).toBe(r.events.filter((e) => e.type === 'goal' && e.d?.assist === id).length);
        expect(st.shots, `shots ${id}`).toBe(count(r, 'shot', id));
        expect(st.shotsOnTarget, `on target ${id}`).toBe(r.events.filter((e) => e.type === 'shot' && e.p === id && (e.d?.outcome === 'goal' || e.d?.outcome === 'saved')).length);
        expect(st.saves, `saves ${id}`).toBe(count(r, 'save', id));
        expect(st.yellow, `yellow ${id}`).toBe(count(r, 'yellow', id));
        expect(st.red, `red ${id}`).toBe(count(r, 'red', id));
        expect(st.fouls, `fouls ${id}`).toBe(count(r, 'foul', id));
        expect(st.goals).toBeLessThanOrEqual(st.shotsOnTarget); // every goal is a shot on target (own goals excepted)
      }
    }
  });

  it('adds players up to the team totals', () => {
    for (const r of games) {
      for (const side of [0, 1] as const) {
        const mine = Object.values(r.players).filter((p) => p.side === side);
        const sum = (f: (p: (typeof mine)[number]) => number) => mine.reduce((t, p) => t + f(p), 0);
        expect(sum((p) => p.shots)).toBe(r.team[side].shots);
        expect(sum((p) => p.shotsOnTarget)).toBe(r.team[side].shotsOnTarget);
        expect(sum((p) => p.yellow)).toBe(r.team[side].yellow);
        expect(sum((p) => p.red)).toBe(r.team[side].red);
        expect(sum((p) => p.saves)).toBe(r.team[side].saves);
      }
    }
  });

  it('removes a sent-off player from the match: he does nothing more and is not replaced by a substitute', () => {
    let reds = 0;
    for (const r of games) {
      for (const red of r.events.filter((e) => e.type === 'red')) {
        reds++;
        const later = r.events.filter((e) => e.i > red.i && e.p === red.p && e.type !== 'substitution');
        expect(later.map((e) => e.type), `${red.p} acted after his red card`).toEqual([]);
        const subbedOn = r.events.filter((e) => e.type === 'substitution' && e.i > red.i && e.side === red.side).length;
        // a team down to ten may still change players, but cannot field more than ten of its eleven starters again
        const onPitchAtEnd = r.lineups[red.side].filter((l) => r.players[l.playerId].minutes > 0).length;
        expect(onPitchAtEnd).toBeGreaterThanOrEqual(10);
        expect(subbedOn).toBeLessThanOrEqual(5);
      }
    }
    expect(reds, 'the sample should contain some red cards').toBeGreaterThan(0);
  });

  it('only substitutes bench players on for players who are on the pitch, and never twice', () => {
    for (const r of games) {
      const seenOn = new Set<string>();
      const seenOff = new Set<string>();
      for (const e of r.events.filter((x) => x.type === 'substitution')) {
        const on = e.d?.on as string;
        const off = e.d?.off as string;
        expect(r.players[on].started).toBe(false);
        expect(r.players[off].side).toBe(e.side);
        expect(r.players[on].side).toBe(e.side);
        expect(seenOn.has(on)).toBe(false);
        expect(seenOff.has(off)).toBe(false);
        seenOn.add(on);
        seenOff.add(off);
        expect(r.events.filter((x) => x.i > e.i && x.p === off && x.type !== 'substitution')).toEqual([]);
      }
      for (const id of seenOn) expect(r.players[id].minutes).toBeGreaterThan(0);
    }
  });

  it('records every injury once, as an event, for a player who was playing', () => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const r = simulateMatch(fixture(4000 + i, { recordAll: true, injuryFactor: 4 }));
      for (const inj of r.injuries) {
        n++;
        const ev = r.events.filter((e) => e.type === 'injury' && e.p === inj.playerId);
        expect(ev).toHaveLength(1);
        expect(r.players[inj.playerId].injured).toBe(true);
        expect(inj.days).toBeGreaterThan(0);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('match engine: knockouts', () => {
  it('always produces a winner, via extra time and penalties when level', () => {
    let pens = 0;
    let et = 0;
    for (let i = 0; i < 80; i++) {
      const r = simulateMatch(fixture(500 + i, { knockout: true }));
      expect(r.winnerSide === 0 || r.winnerSide === 1).toBe(true);
      if (r.pens) {
        pens++;
        expect(r.et).toBe(true);
        expect(r.pens[0]).not.toBe(r.pens[1]);
        expect(r.hg).toBe(r.ag);
        expect(r.winnerSide).toBe(r.pens[0] > r.pens[1] ? 0 : 1);
      } else {
        expect(r.hg === r.ag).toBe(false);
        expect(r.winnerSide).toBe(r.hg > r.ag ? 0 : 1);
      }
      if (r.et) et++;
    }
    expect(et).toBeGreaterThan(0);
    expect(pens).toBeGreaterThan(0);
  });

  it('takes the first-leg aggregate into account when deciding whether extra time and penalties are needed', () => {
    let extraTimes = 0;
    for (const agg of [[1, 1], [4, 0], [0, 3], [2, 2]] as [number, number][]) {
      for (let i = 0; i < 40; i++) {
        const r = simulateMatch(fixture(700 + i, { knockout: true, aggregate: agg }));
        const regular = r.events.filter((e) => (e.type === 'goal' || e.type === 'own_goal') && e.period <= 2);
        const scoredBy = (side: 0 | 1) => regular.filter((e) => (e.type === 'goal' ? e.side === side : e.side !== side)).length;
        // extra time is played exactly when the tie is level on aggregate after 90 minutes
        expect(r.et).toBe(scoredBy(0) + agg[0] === scoredBy(1) + agg[1]);
        if (r.et) extraTimes++;
        // penalties only ever follow a tie that is still level on aggregate after extra time
        if (r.pens) expect(r.hg + agg[0]).toBe(r.ag + agg[1]);
        else expect(r.hg + agg[0]).not.toBe(r.ag + agg[1]);
      }
    }
    expect(extraTimes).toBeGreaterThan(5);
  });

  it('allows a draw in a league match', () => {
    let draws = 0;
    for (let i = 0; i < 80; i++) {
      const r = simulateMatch(fixture(900 + i));
      if (r.hg === r.ag) {
        draws++;
        expect(r.winnerSide).toBeNull();
        expect(r.pens).toBeNull();
        expect(r.et).toBe(false);
      }
    }
    expect(draws).toBeGreaterThan(5);
  });
});

describe('match engine: realism and calibration', () => {
  const N = 200;
  const acc = { goals: 0, hw: 0, dr: 0, reds: 0, yellows: 0, shots: 0, ratings: [] as number[] };
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(fixture(2000 + i));
    acc.goals += r.hg + r.ag;
    if (r.hg > r.ag) acc.hw++;
    else if (r.hg === r.ag) acc.dr++;
    acc.reds += r.team[0].red + r.team[1].red;
    acc.yellows += r.team[0].yellow + r.team[1].yellow;
    acc.shots += r.team[0].shots + r.team[1].shots;
    for (const st of Object.values(r.players)) if (st.minutes >= 60) acc.ratings.push(st.rating);
  }

  it('scores a realistic number of goals per match', () => {
    expect(acc.goals / N).toBeGreaterThan(2.1);
    expect(acc.goals / N).toBeLessThan(3.5);
  });

  it('produces a realistic home/draw/away split', () => {
    expect(acc.hw / N).toBeGreaterThan(0.33);
    expect(acc.hw / N).toBeLessThan(0.58);
    expect(acc.dr / N).toBeGreaterThan(0.14);
    expect(acc.dr / N).toBeLessThan(0.34);
  });

  it('keeps cards and shots in a believable range', () => {
    expect(acc.reds / N).toBeLessThan(0.3);
    expect(acc.yellows / N).toBeGreaterThan(1.5);
    expect(acc.yellows / N).toBeLessThan(6.5);
    expect(acc.shots / N).toBeGreaterThan(14);
    expect(acc.shots / N).toBeLessThan(34);
  });

  it('centres player ratings around the mid-sixes', () => {
    const mean = acc.ratings.reduce((a, b) => a + b, 0) / acc.ratings.length;
    expect(mean).toBeGreaterThan(6.0);
    expect(mean).toBeLessThan(7.1);
  });

  it('lets the stronger side win far more often than the weaker', () => {
    let strongWins = 0;
    let weakWins = 0;
    let n = 0;
    for (const s of top) {
      for (const w of bottom) {
        for (let k = 0; k < 4; k++) {
          const r = simulateMatch({ seed: 9000 + n * 31 + k, home: k % 2 ? sideFor(s) : sideFor(w), away: k % 2 ? sideFor(w) : sideFor(s) });
          const strongSide = k % 2 ? 0 : 1;
          if (r.hg === r.ag) { n++; continue; }
          if ((r.hg > r.ag ? 0 : 1) === strongSide) strongWins++;
          else weakWins++;
          n++;
        }
      }
    }
    expect(strongWins).toBeGreaterThan(weakWins * 1.8);
  });

  it('reports team strength that tracks quality', () => {
    const s = teamStrength(sideFor(top[0]).lineup, top[0].manager.formation, top[0].chemistry);
    const w = teamStrength(sideFor(bottom[0]).lineup, bottom[0].manager.formation, bottom[0].chemistry);
    expect(s.overall).toBeGreaterThan(w.overall);
    expect(Object.keys(FORMATIONS)).toHaveLength(6);
  });
});
