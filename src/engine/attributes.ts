import type { AttrGroup, AttrKey, Attrs, Player, Position } from './types';
import { clamp } from './rng';

export const TECHNICAL: AttrKey[] = [
  'finishing', 'longShots', 'shortPassing', 'longPassing', 'crossing', 'dribbling', 'firstTouch', 'ballControl',
  'tackling', 'heading', 'marking', 'reflexes', 'handling', 'oneOnOnes',
];
export const PHYSICAL: AttrKey[] = [
  'acceleration', 'sprintSpeed', 'agility', 'balance', 'strength', 'jumping', 'stamina', 'naturalFitness',
];
export const MENTAL: AttrKey[] = [
  'positioning', 'vision', 'decisions', 'composure', 'anticipation', 'concentration', 'workRate', 'offTheBall',
  'defensiveAwareness', 'leadership',
];
export const ALL_ATTRS: AttrKey[] = [...TECHNICAL, ...PHYSICAL, ...MENTAL];

export const ATTR_GROUP: Record<AttrKey, AttrGroup> = Object.fromEntries([
  ...TECHNICAL.map((a) => [a, 'technical']),
  ...PHYSICAL.map((a) => [a, 'physical']),
  ...MENTAL.map((a) => [a, 'mental']),
]) as Record<AttrKey, AttrGroup>;

export const ATTR_LABEL: Record<AttrKey, string> = {
  finishing: 'Finishing', longShots: 'Long shots', shortPassing: 'Short passing', longPassing: 'Long passing',
  crossing: 'Crossing', dribbling: 'Dribbling', firstTouch: 'First touch', ballControl: 'Ball control',
  tackling: 'Tackling', heading: 'Heading', marking: 'Marking', reflexes: 'GK reflexes', handling: 'Handling',
  oneOnOnes: 'One-on-ones', acceleration: 'Acceleration', sprintSpeed: 'Sprint speed', agility: 'Agility',
  balance: 'Balance', strength: 'Strength', jumping: 'Jumping', stamina: 'Stamina', naturalFitness: 'Natural fitness',
  positioning: 'Positioning', vision: 'Vision', decisions: 'Decisions', composure: 'Composure',
  anticipation: 'Anticipation', concentration: 'Concentration', workRate: 'Work rate', offTheBall: 'Off the ball',
  defensiveAwareness: 'Defensive awareness', leadership: 'Leadership',
};

export const POSITION_LABEL: Record<Position, string> = {
  GK: 'Goalkeeper', RB: 'Right-back', LB: 'Left-back', CB: 'Centre-back', DM: 'Defensive midfielder',
  CM: 'Central midfielder', AM: 'Attacking midfielder', RW: 'Right winger', LW: 'Left winger', ST: 'Striker',
};

type W = Partial<Record<AttrKey, number>>;

/** Position-specific weights used for the overall rating (normalised on use). */
export const POSITION_WEIGHTS: Record<Position, W> = {
  ST: {
    finishing: 22, offTheBall: 12, composure: 10, positioning: 8, firstTouch: 6, ballControl: 5, sprintSpeed: 6,
    acceleration: 5, dribbling: 5, heading: 5, strength: 4, anticipation: 3, decisions: 3, longShots: 2,
    shortPassing: 2, workRate: 2,
  },
  RW: {
    dribbling: 14, acceleration: 10, sprintSpeed: 9, crossing: 9, agility: 6, finishing: 8, ballControl: 7,
    firstTouch: 5, offTheBall: 6, shortPassing: 5, vision: 4, decisions: 4, stamina: 3, workRate: 3, composure: 3,
    longShots: 3,
  },
  LW: {
    dribbling: 14, acceleration: 10, sprintSpeed: 9, crossing: 9, agility: 6, finishing: 8, ballControl: 7,
    firstTouch: 5, offTheBall: 6, shortPassing: 5, vision: 4, decisions: 4, stamina: 3, workRate: 3, composure: 3,
    longShots: 3,
  },
  AM: {
    shortPassing: 10, vision: 12, ballControl: 9, dribbling: 9, firstTouch: 7, decisions: 8, composure: 6,
    finishing: 6, longShots: 5, offTheBall: 7, agility: 4, longPassing: 4, positioning: 3, acceleration: 3,
    anticipation: 3, workRate: 4,
  },
  CM: {
    shortPassing: 12, vision: 9, decisions: 9, ballControl: 8, stamina: 8, longPassing: 7, tackling: 5,
    firstTouch: 6, composure: 6, workRate: 6, positioning: 5, anticipation: 4, defensiveAwareness: 4,
    concentration: 3, strength: 3, offTheBall: 3, balance: 2,
  },
  DM: {
    tackling: 12, defensiveAwareness: 11, anticipation: 9, positioning: 9, shortPassing: 8, strength: 6, stamina: 7,
    marking: 5, decisions: 6, composure: 5, workRate: 5, concentration: 4, ballControl: 4, longPassing: 4, vision: 3,
    heading: 2,
  },
  CB: {
    marking: 13, tackling: 12, defensiveAwareness: 12, heading: 10, strength: 9, anticipation: 9, positioning: 8,
    jumping: 6, concentration: 5, composure: 4, decisions: 3, sprintSpeed: 3, shortPassing: 3, longPassing: 2,
    balance: 1,
  },
  RB: {
    tackling: 9, marking: 6, defensiveAwareness: 8, crossing: 8, stamina: 9, sprintSpeed: 7, acceleration: 6,
    positioning: 6, anticipation: 6, workRate: 6, dribbling: 5, shortPassing: 5, ballControl: 4, decisions: 4,
    agility: 3, concentration: 3, strength: 2, heading: 2,
  },
  LB: {
    tackling: 9, marking: 6, defensiveAwareness: 8, crossing: 8, stamina: 9, sprintSpeed: 7, acceleration: 6,
    positioning: 6, anticipation: 6, workRate: 6, dribbling: 5, shortPassing: 5, ballControl: 4, decisions: 4,
    agility: 3, concentration: 3, strength: 2, heading: 2,
  },
  GK: {
    reflexes: 22, handling: 18, oneOnOnes: 12, positioning: 14, concentration: 8, decisions: 6, composure: 5,
    anticipation: 5, agility: 4, jumping: 3, longPassing: 2, shortPassing: 1,
  },
};

const NORMALISED: Record<Position, [AttrKey, number][]> = {} as Record<Position, [AttrKey, number][]>;
for (const pos of Object.keys(POSITION_WEIGHTS) as Position[]) {
  const w = POSITION_WEIGHTS[pos];
  const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
  NORMALISED[pos] = (Object.entries(w) as [AttrKey, number][]).map(([k, v]) => [k, v / total]);
}

export function positionWeights(pos: Position): [AttrKey, number][] {
  return NORMALISED[pos];
}

/** Position-specific overall rating (1..99) from raw attributes. */
export function overallFor(attrs: Attrs, pos: Position): number {
  let sum = 0;
  for (const [k, w] of NORMALISED[pos]) sum += attrs[k] * w;
  return sum;
}

export function overall(p: Pick<Player, 'attrs' | 'position'>): number {
  return Math.round(overallFor(p.attrs, p.position));
}

/* ---------------------------- position suitability ---------------------------- */

const FIT: Partial<Record<Position, Partial<Record<Position, number>>>> = {
  CB: { DM: 0.86, RB: 0.84, LB: 0.84, CM: 0.75 },
  RB: { LB: 0.86, CB: 0.84, RW: 0.82, DM: 0.8, CM: 0.78 },
  LB: { RB: 0.86, CB: 0.84, LW: 0.82, DM: 0.8, CM: 0.78 },
  DM: { CM: 0.92, CB: 0.86, AM: 0.82, RB: 0.8, LB: 0.8 },
  CM: { DM: 0.92, AM: 0.92, RB: 0.78, LB: 0.78, RW: 0.8, LW: 0.8 },
  AM: { CM: 0.92, RW: 0.88, LW: 0.88, ST: 0.88, DM: 0.8 },
  RW: { LW: 0.9, AM: 0.88, ST: 0.86, RB: 0.82, CM: 0.8 },
  LW: { RW: 0.9, AM: 0.88, ST: 0.86, LB: 0.82, CM: 0.8 },
  ST: { AM: 0.88, RW: 0.86, LW: 0.86, CM: 0.72 },
};

/** How comfortable a player is in a role, 0..1 (1 = natural position). */
export function positionFit(p: Pick<Player, 'position' | 'secondary'>, slot: Position): number {
  if (p.position === slot) return 1;
  if (p.secondary === slot) return 0.96;
  if (slot === 'GK' || p.position === 'GK') return 0.15;
  return FIT[p.position]?.[slot] ?? 0.65;
}

/** Rating a player would deliver in a given slot: attribute fit for that role softened by familiarity. */
export function slotRating(p: Pick<Player, 'attrs' | 'position' | 'secondary'>, slot: Position): number {
  const fit = positionFit(p, slot);
  return overallFor(p.attrs, slot) * (0.5 + 0.5 * fit);
}

/* ---------------------------- derived attributes ---------------------------- */

export interface Derived {
  pace: number;
  shooting: number;
  passing: number;
  ballSkills: number;
  defending: number;
  physicality: number;
  aerial: number;
  gk: number;
  mentality: number;
  workEthic: number;
}

export function derived(a: Attrs): Derived {
  return {
    pace: (a.acceleration * 0.45 + a.sprintSpeed * 0.55),
    shooting: (a.finishing * 0.55 + a.longShots * 0.2 + a.composure * 0.15 + a.offTheBall * 0.1),
    passing: (a.shortPassing * 0.4 + a.longPassing * 0.2 + a.vision * 0.3 + a.crossing * 0.1),
    ballSkills: (a.dribbling * 0.35 + a.ballControl * 0.3 + a.firstTouch * 0.2 + a.agility * 0.15),
    defending: (a.tackling * 0.3 + a.marking * 0.25 + a.defensiveAwareness * 0.25 + a.anticipation * 0.2),
    physicality: (a.strength * 0.35 + a.stamina * 0.3 + a.balance * 0.15 + a.jumping * 0.2),
    aerial: (a.heading * 0.5 + a.jumping * 0.3 + a.strength * 0.2),
    gk: (a.reflexes * 0.35 + a.handling * 0.3 + a.oneOnOnes * 0.2 + a.positioning * 0.15),
    mentality: (a.decisions * 0.3 + a.composure * 0.25 + a.concentration * 0.2 + a.leadership * 0.1 + a.workRate * 0.15),
    workEthic: (a.workRate * 0.6 + a.stamina * 0.4),
  };
}

export function emptyAttrs(v = 1): Attrs {
  return Object.fromEntries(ALL_ATTRS.map((k) => [k, v])) as Attrs;
}

export function clampAttr(v: number): number {
  return clamp(Math.round(v), 1, 99);
}

/* ---------------------------- misc helpers ---------------------------- */

export function ageAt(birthDay: number, day: number): number {
  return Math.floor((day - birthDay) / 365.25);
}

/** Letter-free colour grade used by the UI for ratings. */
export function ratingBand(v: number): 'elite' | 'great' | 'good' | 'average' | 'poor' {
  if (v >= 80) return 'elite';
  if (v >= 70) return 'great';
  if (v >= 60) return 'good';
  if (v >= 48) return 'average';
  return 'poor';
}
