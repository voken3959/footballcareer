import type { Appearance, AttrKey, Attrs, Foot, Personality, Player, Position } from './types';
import { Rng, clamp } from './rng';
import {
  ALL_ATTRS, ATTR_GROUP, POSITION_WEIGHTS, overallFor, positionWeights,
} from './attributes';
import { NATION_BY_CODE } from './names';

export const PERSONALITIES: Personality[] = [
  'ambitious', 'loyal', 'professional', 'competitive', 'reserved', 'charismatic', 'risk-taking',
];

const SECONDARY_OPTIONS: Record<Position, Position[]> = {
  GK: [],
  CB: ['DM', 'RB', 'LB'],
  RB: ['LB', 'CB', 'RW'],
  LB: ['RB', 'CB', 'LW'],
  DM: ['CM', 'CB'],
  CM: ['DM', 'AM'],
  AM: ['CM', 'RW', 'LW', 'ST'],
  RW: ['LW', 'AM', 'ST'],
  LW: ['RW', 'AM', 'ST'],
  ST: ['AM', 'RW', 'LW'],
};

export interface GenOpts {
  id: string;
  position: Position;
  secondary?: Position | null;
  ovr: number;
  age: number;
  potential?: number;
  nationality: string;
  clubId?: string | null;
  clubRep?: number;
  day: number;
  personality?: Personality;
  firstName?: string;
  lastName?: string;
  foot?: Foot;
  height?: number;
  weight?: number;
  appearance?: Appearance;
  naturalFitness?: number;
  shirt?: number;
}

export function genName(rng: Rng, nation: string): { first: string; last: string } {
  const def = NATION_BY_CODE[nation] ?? NATION_BY_CODE.ENG;
  return { first: rng.pick(def.first), last: rng.pick(def.last) };
}

export function randomAppearance(rng: Rng): Appearance {
  return { skin: rng.weighted([0, 1, 2, 3, 4, 5], [22, 24, 18, 14, 12, 10]), hair: rng.int(0, 5), style: rng.int(0, 5) };
}

function potentialGap(rng: Rng, age: number): number {
  const spec = age <= 17 ? [14, 7] : age <= 19 ? [10, 6] : age <= 21 ? [7, 5] : age <= 23 ? [4, 3.5] : age <= 26 ? [2, 2] : [0.3, 0.8];
  return clamp(rng.normal(spec[0], spec[1]), 0, 32);
}

export function genAttrs(rng: Rng, pos: Position, target: number, age: number, naturalFitness?: number): Attrs {
  const w = POSITION_WEIGHTS[pos];
  const maxW = Math.max(...(Object.values(w) as number[]));
  const rel = (k: AttrKey) => (w[k] ?? 0) / maxW;
  const norm = positionWeights(pos);
  const rbar = norm.reduce((s, [k, nw]) => s + nw * rel(k), 0);
  const weightedKeys = ALL_ATTRS.filter((k) => w[k]);
  const tweak: Partial<Record<AttrKey, number>> = {};
  for (let i = 0; i < 2; i++) tweak[rng.pick(weightedKeys)] = (tweak[rng.pick(weightedKeys)] ?? 0) + 7;
  for (let i = 0; i < 2; i++) { const k = rng.pick(weightedKeys); tweak[k] = (tweak[k] ?? 0) - 7; }

  const isGK = pos === 'GK';
  const youth = Math.max(0, 20 - age);
  const attrs = {} as Attrs;
  for (const k of ALL_ATTRS) {
    let a: number;
    if (w[k]) {
      a = target + 14 * (rel(k) - rbar) + rng.normal(0, 4.5) + (tweak[k] ?? 0);
    } else if (!isGK && (k === 'reflexes' || k === 'handling' || k === 'oneOnOnes')) {
      a = rng.int(6, 22);
    } else if (isGK && ATTR_GROUP[k] === 'technical') {
      a = target * 0.35 + rng.normal(0, 6);
    } else if (k === 'naturalFitness') {
      a = naturalFitness ?? rng.int(45, 90);
    } else if (k === 'leadership') {
      a = 22 + age * 1.5 + rng.normal(0, 9);
    } else if (ATTR_GROUP[k] === 'technical') {
      a = target * 0.55 + rng.normal(0, 7);
    } else {
      a = target * 0.82 + rng.normal(0, 6);
    }
    // youngsters are physically and mentally less developed
    if (youth > 0 && (k === 'strength' || k === 'stamina' || k === 'jumping')) a -= youth * 1.8;
    if (youth > 0 && (k === 'composure' || k === 'decisions' || k === 'concentration' || k === 'leadership')) a -= youth * 1.3;
    attrs[k] = a;
  }
  // calibrate so the weighted overall equals the target
  for (let it = 0; it < 4; it++) {
    const diff = target - overallFor(attrs, pos);
    if (Math.abs(diff) < 0.35) break;
    for (const k of weightedKeys) attrs[k] = clamp(attrs[k] + diff, 1, 99);
  }
  for (const k of ALL_ATTRS) attrs[k] = clamp(Math.round(attrs[k]), 1, 99);
  return attrs;
}

export function genCaps(rng: Rng, attrs: Attrs, pos: Position, potential: number): Attrs {
  const w = POSITION_WEIGHTS[pos];
  const maxW = Math.max(...(Object.values(w) as number[]));
  const ovr = overallFor(attrs, pos);
  const gap = Math.max(0, potential - ovr);
  const caps = {} as Attrs;
  const gains = {} as Record<AttrKey, number>;
  for (const k of ALL_ATTRS) {
    const rel = (w[k] ?? 0) / maxW;
    let g = w[k] ? gap * (0.55 + 0.9 * rel) * rng.range(0.85, 1.15) : gap * rng.range(0.15, 0.4);
    if (ATTR_GROUP[k] !== 'physical') g = Math.max(g, 2);
    else g = Math.max(g, 1);
    gains[k] = g;
  }
  const build = () => {
    for (const k of ALL_ATTRS) caps[k] = clamp(Math.round(attrs[k] + gains[k]), attrs[k], 99);
  };
  build();
  for (let it = 0; it < 3 && gap > 1; it++) {
    const cur = overallFor(caps, pos);
    const missing = potential - cur;
    if (Math.abs(missing) < 0.4) break;
    const scale = (potential - ovr) / Math.max(0.5, cur - ovr);
    for (const k of ALL_ATTRS) gains[k] *= clamp(scale, 0.5, 2);
    build();
  }
  return caps;
}

function genBody(rng: Rng, pos: Position): { height: number; weight: number } {
  const mean: Record<Position, number> = { GK: 188, CB: 186, ST: 182, DM: 181, CM: 179, AM: 177, RB: 177, LB: 177, RW: 175, LW: 175 };
  const height = Math.round(clamp(rng.normal(mean[pos], 5.2), 163, 203));
  const bmi = clamp(rng.normal(22.6, 1.1), 19.5, 26);
  return { height, weight: Math.round(bmi * (height / 100) ** 2) };
}

function genFoot(rng: Rng, pos: Position): Foot {
  const left = pos === 'LB' || pos === 'LW' ? 0.75 : pos === 'RB' || pos === 'RW' ? 0.08 : 0.22;
  const r = rng.next();
  if (r < 0.07) return 'both';
  return r < 0.07 + left * 0.93 ? 'left' : 'right';
}

export function genSecondary(rng: Rng, pos: Position): Position | null {
  const opts = SECONDARY_OPTIONS[pos];
  if (!opts.length || !rng.chance(0.4)) return null;
  return rng.pick(opts);
}

export function defaultMorale(p: Personality): number {
  return p === 'reserved' ? 66 : p === 'charismatic' ? 72 : 68;
}

export function generatePlayer(rng: Rng, o: GenOpts): Player {
  const nameParts = genName(rng, o.nationality);
  const first = o.firstName ?? nameParts.first;
  const last = o.lastName ?? nameParts.last;
  const body = genBody(rng, o.position);
  const naturalFitness = o.naturalFitness ?? rng.int(45, 90);
  const attrs = genAttrs(rng, o.position, o.ovr, o.age, naturalFitness);
  const ovr = Math.round(overallFor(attrs, o.position));
  const potential = Math.round(clamp(o.potential ?? ovr + potentialGap(rng, o.age), ovr, 97));
  const caps = genCaps(rng, attrs, o.position, potential);
  const personality = o.personality ?? rng.pick(PERSONALITIES);
  const rep = clamp(Math.round(ovr * 0.85 + (o.clubRep ?? 50) * 0.15 - 10), 5, 99);
  const p: Player = {
    id: o.id,
    firstName: first,
    lastName: last,
    displayName: `${first[0]}. ${last}`,
    nationality: o.nationality,
    birthDay: Math.round(o.day - o.age * 365.25 - rng.int(0, 364)),
    foot: o.foot ?? genFoot(rng, o.position),
    height: o.height ?? body.height,
    weight: o.weight ?? body.weight,
    position: o.position,
    secondary: o.secondary !== undefined ? o.secondary : genSecondary(rng, o.position),
    shirt: o.shirt ?? 0,
    attrs,
    caps,
    potential,
    xp: {},
    personality,
    appearance: o.appearance ?? randomAppearance(rng),
    clubId: o.clubId ?? null,
    contract: null,
    loan: null,
    cond: {
      fatigue: rng.int(4, 14), matchFitness: rng.int(82, 94), sharpness: rng.int(68, 84),
      morale: defaultMorale(personality) + rng.int(-4, 4), confidence: rng.int(52, 64),
    },
    injury: null,
    injuryProne: clamp(1 + (65 - naturalFitness) / 120 + rng.normal(0, 0.1), 0.7, 1.4),
    yellowsSeason: 0,
    suspension: 0,
    recentRatings: [],
    stats: {},
    reputation: rep,
    retired: false,
  };
  return p;
}
