import { describe, expect, it } from 'vitest';
import { ALL_ATTRS, ATTR_GROUP, MENTAL, PHYSICAL, TECHNICAL, overall, overallFor, positionFit, positionWeights, slotRating, ageAt } from '../src/engine/attributes';
import { TALENT_BANDS, createCareer, defaultOptions, previewClubs } from '../src/engine/career';
import { generatePlayer } from '../src/engine/playerGen';
import { Rng } from '../src/engine/rng';
import { dayOf } from '../src/engine/dates';
import { POSITIONS, type Position } from '../src/engine/types';
import { developAnnual, growthContext, growthPointsPerYear, previewTraining } from '../src/engine/progression';
import { clone, newCareer, playMatches, user } from './helpers';

const DAY = dayOf(2026, 7, 1);
const gen = (rng: Rng, position: Position, ovr: number, age: number, potential?: number) =>
  generatePlayer(rng, { id: `t-${position}-${ovr}-${age}-${rng.int(0, 1e6)}`, position, ovr, age, potential, nationality: 'ENG', day: DAY });

describe('attributes', () => {
  it('has exactly 32 distinct attributes split across technical, physical and mental', () => {
    expect(ALL_ATTRS).toHaveLength(32);
    expect(new Set(ALL_ATTRS).size).toBe(32);
    expect(TECHNICAL.length + PHYSICAL.length + MENTAL.length).toBe(32);
    for (const k of ALL_ATTRS) expect(['technical', 'physical', 'mental']).toContain(ATTR_GROUP[k]);
  });

  it('weights each position so a flat profile gives exactly that rating', () => {
    for (const pos of POSITIONS) {
      const total = positionWeights(pos).reduce((a, [, w]) => a + w, 0);
      expect(total).toBeCloseTo(1, 6);
      const flat = Object.fromEntries(ALL_ATTRS.map((k) => [k, 62])) as Record<(typeof ALL_ATTRS)[number], number>;
      expect(overallFor(flat, pos)).toBeCloseTo(62, 6);
    }
  });

  it('rates a goalkeeper highly as a keeper but poorly as a striker', () => {
    const rng = new Rng(3);
    const gk = gen(rng, 'GK', 78, 27);
    expect(overallFor(gk.attrs, 'GK')).toBeGreaterThan(overallFor(gk.attrs, 'ST') + 15);
    expect(slotRating(gk, 'ST')).toBeLessThan(slotRating(gk, 'GK') - 20);
  });

  it('values a striker most in his own position and penalises out-of-position use', () => {
    const rng = new Rng(4);
    const st = gen(rng, 'ST', 75, 25);
    expect(positionFit(st, 'ST')).toBe(1);
    expect(positionFit(st, 'CB')).toBeLessThan(0.8);
    expect(slotRating(st, 'ST')).toBeGreaterThan(slotRating(st, 'CB'));
  });
});

describe('player generation', () => {
  it('produces players near the requested overall, with a potential and caps that never sit below current ability', () => {
    const rng = new Rng(21);
    for (const pos of POSITIONS) {
      for (const [ovr, age] of [[55, 16], [70, 22], [82, 29]] as const) {
        const p = gen(rng, pos, ovr, age);
        expect(Math.abs(overall(p) - ovr)).toBeLessThanOrEqual(5);
        expect(p.potential).toBeGreaterThanOrEqual(overall(p));
        for (const k of ALL_ATTRS) {
          expect(p.attrs[k]).toBeGreaterThanOrEqual(1);
          expect(p.attrs[k]).toBeLessThanOrEqual(99);
          expect(p.caps[k]).toBeGreaterThanOrEqual(p.attrs[k]);
        }
      }
    }
  });

  it('gives young players more headroom than veterans', () => {
    const rng = new Rng(22);
    let young = 0;
    let old = 0;
    for (let i = 0; i < 40; i++) {
      const y = gen(rng, 'CM', 60, 17);
      const o = gen(rng, 'CM', 60, 33);
      young += y.potential - overall(y);
      old += o.potential - overall(o);
    }
    expect(young / 40).toBeGreaterThan(old / 40 + 4);
  });

  it('is deterministic for a given random stream', () => {
    const a = generatePlayer(new Rng(9), { id: 'x', position: 'LW', ovr: 66, age: 20, nationality: 'ENG', day: DAY });
    const b = generatePlayer(new Rng(9), { id: 'x', position: 'LW', ovr: 66, age: 20, nationality: 'ENG', day: DAY });
    expect(b).toEqual(a);
  });
});

describe('new career player', () => {
  it('starts at 16 with 32 attributes and a hidden potential above current ability', () => {
    const s = newCareer(31);
    const p = user(s);
    expect(ageAt(p.birthDay, s.day)).toBe(16);
    expect(Object.keys(p.attrs)).toHaveLength(32);
    expect(p.potential).toBeGreaterThan(overall(p));
    expect(s.career.startOverall).toBe(overall(p));
  });

  it('gives different footballers different attributes from different profile seeds, in the same world', () => {
    const a = createCareer({ ...defaultOptions(55), profileSeed: 1 });
    const b = createCareer({ ...defaultOptions(55), profileSeed: 2 });
    expect(Object.keys(a.clubs).sort()).toEqual(Object.keys(b.clubs).sort());
    expect(user(a).attrs).not.toEqual(user(b).attrs);
  });

  it('uses the same world for the wizard preview as for the real career', () => {
    const prev = previewClubs(77, 'youth');
    const s = createCareer({ ...defaultOptions(77), pathway: 'youth' });
    for (const c of prev.clubs) expect(s.clubs[c.id].name).toBe(c.name);
  });

  it('honours the custom ability and talent band', () => {
    const s = createCareer({ ...defaultOptions(88), pathway: 'custom', custom: { ovr: 60, talent: 'exceptional' } });
    const p = user(s);
    expect(Math.abs(overall(p) - 60)).toBeLessThanOrEqual(3);
    const [lo, hi] = TALENT_BANDS.exceptional.range;
    expect(p.potential).toBeGreaterThanOrEqual(lo - 2);
    expect(p.potential).toBeLessThanOrEqual(hi + 2);
  });

  it('is deterministic: the same options always build the same career', () => {
    // only the wall-clock creation stamp (and the id derived from it) may differ, so pin it
    const a = newCareer(404, { now: 1_700_000_000_000 });
    const b = newCareer(404, { now: 1_700_000_000_000 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('progression', () => {
  it('grows the young, holds the prime, declines the old (annual NPC development)', () => {
    const rng = new Rng(61);
    const avgDelta = (age: number, ovr: number, years: number) => {
      let total = 0;
      const n = 30;
      for (let i = 0; i < n; i++) {
        const p = gen(rng, 'CM', ovr, age, ovr + 14);
        const before = overall(p);
        let day = DAY;
        for (let y = 0; y < years; y++) {
          developAnnual(p, { coaching: 12, youthFacilities: 12, playingShare: 0.8, rng, day });
          day += 365;
        }
        total += overall(p) - before;
      }
      return total / n;
    };
    expect(avgDelta(17, 55, 2)).toBeGreaterThan(2);
    expect(avgDelta(35, 70, 3)).toBeLessThan(-1.5);
  });

  it('never lets potential fall below current ability, nor attributes exceed 99', () => {
    const rng = new Rng(62);
    for (let i = 0; i < 40; i++) {
      const p = gen(rng, 'AM', 70 + (i % 12), 18 + (i % 14));
      let day = DAY;
      for (let y = 0; y < 5; y++) {
        developAnnual(p, { coaching: 10, youthFacilities: 10, playingShare: 0.6, rng, day });
        day += 365;
        expect(p.potential).toBeGreaterThanOrEqual(overall(p));
        for (const k of ALL_ATTRS) expect(p.attrs[k]).toBeLessThanOrEqual(99);
      }
    }
  });

  it('explains every change to the user\'s attributes and moves them one point at a time, never past the cap', () => {
    const s = newCareer(71);
    const start = clone(user(s).attrs);
    playMatches(s, 14);
    const p = user(s);
    expect(s.career.attrChanges.length).toBeGreaterThan(0);
    for (const ch of s.career.attrChanges) {
      expect(ch.reason.trim().length).toBeGreaterThan(3);
      expect(Math.abs(ch.to - ch.from)).toBe(1);
      expect(ALL_ATTRS).toContain(ch.attr);
    }
    for (const k of ALL_ATTRS) {
      expect(p.attrs[k]).toBeLessThanOrEqual(Math.max(p.caps[k], start[k]));
      expect(p.attrs[k]).toBeGreaterThanOrEqual(1);
    }
    expect(s.career.ovrHistory.length).toBeGreaterThan(1);
  });

  it('develops a talented 16-year-old over a season without exceeding hidden potential', () => {
    const s = newCareer(72, { difficulty: 'casual' });
    const startOvr = overall(user(s));
    playMatches(s, 40);
    const p = user(s);
    expect(overall(p)).toBeGreaterThan(startOvr);
    expect(overall(p)).toBeLessThanOrEqual(p.potential);
  });

  it('scales growth by difficulty: casual faster than standard faster than simulation', () => {
    const mult = (d: 'casual' | 'standard' | 'simulation') => {
      const s = newCareer(73, { difficulty: d });
      return growthContext(s, user(s), s.training.plan).multiplier;
    };
    expect(mult('casual')).toBeGreaterThan(mult('standard'));
    expect(mult('standard')).toBeGreaterThan(mult('simulation'));
  });

  it('previews training so that focus and intensity change the projected points and risk', () => {
    const s = newCareer(74);
    const p = user(s);
    const rest = previewTraining(s, p, { ...s.training.plan, intensity: 'rest' });
    const hard = previewTraining(s, p, { ...s.training.plan, intensity: 'intensive' });
    expect(hard.totalPoints).toBeGreaterThan(rest.totalPoints);
    expect(hard.injuryRiskWeek).toBeGreaterThan(rest.injuryRiskWeek);
    const fin = previewTraining(s, p, { ...s.training.plan, focus: 'finishing', intensity: 'normal' });
    expect(fin.weeklyPoints.length).toBeGreaterThan(0);
    expect(growthPointsPerYear(p, s.day)).toBeGreaterThan(0);
  });
});
