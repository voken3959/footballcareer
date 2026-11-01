/**
 * Player development.
 *
 * Expected yearly growth (overall points) follows an age curve scaled by how far the player is from his potential and slowed
 * by diminishing returns. That budget is spread over attributes by position weights and age group, then modified by training
 * choices, playing time, coaching, personality, fatigue and difficulty. Progress accumulates as fractional "xp" per attribute;
 * when it reaches 1 the attribute rises, and the reason (training / match experience / natural development) is recorded.
 * Ageing runs the same machinery in reverse, mostly through physical attributes.
 */
import type {
  AttrChange, AttrKey, Attrs, GameState, Player, PlayerMatchStats, Position, TrainingFocus, TrainingPlan,
} from './types';
import {
  ALL_ATTRS, ATTR_GROUP, ATTR_LABEL, POSITION_WEIGHTS, ageAt, overall, overallFor, positionWeights,
} from './attributes';
import { Rng, clamp } from './rng';
import { INJURY_TYPES, makeInjury, rollInjuryType } from './injuries';

export type Intensity = TrainingPlan['intensity'];

export const FOCUS_LABEL: Record<TrainingFocus, string> = {
  finishing: 'Finishing', passing: 'Passing', dribbling: 'Dribbling', defending: 'Defending',
  physical: 'Physical conditioning', tactical: 'Tactical awareness', position: 'Position-specific', recovery: 'Recovery',
  goalkeeping: 'Goalkeeping',
};

export const FOCUS_BLURB: Record<TrainingFocus, string> = {
  finishing: 'Shooting drills, movement in the box and composure under pressure.',
  passing: 'Short and long passing, crossing and seeing the pass.',
  dribbling: 'Ball mastery, close control and beating a man.',
  defending: 'Tackling, marking, heading and reading the game.',
  physical: 'Strength, speed, jumping and endurance work.',
  tactical: 'Shape, positioning, concentration and decision-making.',
  position: 'Drills built around the attributes your position needs most.',
  recovery: 'Physio, mobility and sleep. Little growth, but you freshen up and the injury risk falls.',
  goalkeeping: 'Shot-stopping, handling and one-on-one drills.',
};

const FOCUS_ATTRS: Record<Exclude<TrainingFocus, 'position' | 'recovery'>, AttrKey[]> = {
  finishing: ['finishing', 'composure', 'offTheBall', 'longShots', 'firstTouch'],
  passing: ['shortPassing', 'longPassing', 'vision', 'crossing', 'decisions'],
  dribbling: ['dribbling', 'ballControl', 'agility', 'firstTouch', 'acceleration'],
  defending: ['tackling', 'marking', 'defensiveAwareness', 'anticipation', 'heading'],
  physical: ['stamina', 'strength', 'sprintSpeed', 'acceleration', 'jumping', 'balance'],
  tactical: ['positioning', 'decisions', 'concentration', 'anticipation', 'workRate', 'offTheBall'],
  goalkeeping: ['reflexes', 'handling', 'oneOnOnes', 'positioning', 'jumping'],
};

export function focusAttrs(focus: TrainingFocus, pos: Position): AttrKey[] {
  if (focus === 'recovery') return [];
  if (focus === 'position' || (focus === 'goalkeeping')) {
    if (pos === 'GK') return FOCUS_ATTRS.goalkeeping;
    return positionWeights(pos).slice().sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  }
  return FOCUS_ATTRS[focus];
}

export const INTENSITY: Record<Intensity, { label: string; hours: number; fatigue: number; growth: number; injury: number; boost: number; blurb: string }> = {
  rest: { label: 'Rest', hours: 0, fatigue: 0, growth: 0.8, injury: 0, boost: 0, blurb: 'Full rest. You recover fastest but development slows.' },
  light: { label: 'Light recovery', hours: 0.75, fatigue: 3, growth: 0.95, injury: 0.35, boost: 0.4, blurb: 'Gentle sessions that keep you ticking over.' },
  normal: { label: 'Normal training', hours: 1.5, fatigue: 8, growth: 1, injury: 1, boost: 1.4, blurb: 'The standard programme for a professional.' },
  intensive: { label: 'Intensive training', hours: 2.25, fatigue: 14, growth: 1.12, injury: 1.9, boost: 2.4, blurb: 'Fast gains, heavy legs and a higher injury risk.' },
};

/* -------------------------------- growth model -------------------------------- */

const GROWTH: Record<number, number> = {
  16: 5.5, 17: 5.2, 18: 4.6, 19: 4.0, 20: 3.4, 21: 2.8, 22: 2.2, 23: 1.7, 24: 1.2, 25: 0.8, 26: 0.4, 27: 0.1, 28: -0.2,
  29: -0.6, 30: -1.0, 31: -1.4, 32: -1.8, 33: -2.2, 34: -2.7, 35: -3.2,
};

export function baseGrowth(age: number): number {
  if (age <= 16) return 5.5;
  if (age >= 35) return -3.2 - 0.3 * (age - 35);
  return GROWTH[age];
}

function gapReference(age: number): number {
  if (age <= 16) return 18;
  const t: Record<number, number> = { 17: 17, 18: 14, 19: 12, 20: 10, 21: 9, 22: 7, 23: 5, 24: 4 };
  return t[age] ?? 3;
}

/** Expected overall-rating points per year under average circumstances. */
export function growthPointsPerYear(p: Pick<Player, 'attrs' | 'position' | 'potential' | 'birthDay'>, day: number): number {
  const age = ageAt(p.birthDay, day);
  const g = baseGrowth(age);
  if (g <= 0) return g;
  const gap = p.potential - overall(p);
  if (gap <= 0) return 0;
  return g * clamp(gap / gapReference(age), 0, 1.4);
}

/**
 * Attribute points needed to move the overall rating by one point. Progress is concentrated in the attributes a position
 * cares about, so the real figure depends on the shares: 1 / sum(weight * share), kept within sane bounds.
 */
function pointsPerOverall(pos: Position, shares: Record<AttrKey, number>): number {
  let lev = 0;
  for (const [k, w] of positionWeights(pos)) lev += w * (shares[k] ?? 0);
  return clamp(1 / Math.max(lev, 0.001), 8, 45);
}

function ageGroupFactor(group: 'technical' | 'physical' | 'mental', age: number, growing: boolean): number {
  if (!growing) return 1;
  if (group === 'physical') return age <= 21 ? 1.3 : age <= 24 ? 1 : age <= 26 ? 0.45 : 0.15;
  if (group === 'technical') return age <= 26 ? 1 : 0.6;
  return age <= 21 ? 0.9 : age <= 26 ? 1.1 : 1.3;
}

const DECLINE_WEIGHT: Partial<Record<AttrKey, number>> = {
  acceleration: 3, sprintSpeed: 3, agility: 2.2, jumping: 1.5, stamina: 1.8, balance: 0.8, strength: 0.6, naturalFitness: 0.5,
};

function declineShares(age: number): Record<AttrKey, number> {
  const out = {} as Record<AttrKey, number>;
  let total = 0;
  for (const k of ALL_ATTRS) {
    let w = DECLINE_WEIGHT[k] ?? 0;
    if (!w) {
      if (ATTR_GROUP[k] === 'technical') w = age >= 32 ? 0.3 : 0.12;
      else if (k === 'concentration') w = age >= 34 ? 0.6 : 0.2;
      else w = 0.05;
    }
    if (k === 'strength' && age >= 33) w = 1.5;
    out[k] = w;
    total += w;
  }
  for (const k of ALL_ATTRS) out[k] /= total;
  return out;
}

export function growthShares(p: Pick<Player, 'position' | 'attrs' | 'caps' | 'birthDay'>, day: number): Record<AttrKey, number> {
  const age = ageAt(p.birthDay, day);
  const weights = POSITION_WEIGHTS[p.position];
  const wTotal = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
  const out = {} as Record<AttrKey, number>;
  let total = 0;
  for (const k of ALL_ATTRS) {
    const room = p.caps[k] - p.attrs[k];
    let s = 0.75 * ((weights[k] ?? 0) / wTotal) + 0.25 / ALL_ATTRS.length;
    s *= ageGroupFactor(ATTR_GROUP[k], age, true);
    if (room <= 0) s = 0;
    else if (room < 3) s *= 0.5;
    out[k] = s;
    total += s;
  }
  if (total <= 0) return out;
  for (const k of ALL_ATTRS) out[k] /= total;
  return out;
}

/** Diminishing returns: progress gets harder as an attribute rises. */
export function diminishing(level: number): number {
  return clamp(1.3 - (level / 100) * 0.7, 0.55, 1.2);
}

/* --------------------------- circumstance multipliers --------------------------- */

export function coachQuality(state: GameState, clubId: string): number {
  const c = state.clubs[clubId];
  if (!c) return 0.4;
  return 0.5 * (c.trainingFacilities / 20) + 0.5 * (c.manager.coaching / 20);
}

const DIFF_GROWTH = { casual: 1.25, standard: 1, simulation: 0.8 } as const;
const DIFF_DECLINE = { casual: 0.8, standard: 1, simulation: 1.15 } as const;

export interface GrowthContext {
  multiplier: number;
  parts: { label: string; value: number }[];
}

export function minutesShare28(p: Player, state: GameState): number {
  // minutes over the last 28 days relative to four full matches, from the user's match log
  let mins = 0;
  for (let i = state.userMatchLog.length - 1; i >= 0 && i >= state.userMatchLog.length - 6; i--) {
    const rec = state.matchRecords[state.userMatchLog[i]];
    if (!rec || rec.day < state.day - 28) continue;
    const m = rec.result.players[p.id]?.minutes ?? 0;
    mins += rec.isDev ? m * 0.6 : m;
  }
  return clamp(mins / 360, 0, 1);
}

export function growthContext(state: GameState, p: Player, plan: TrainingPlan): GrowthContext {
  const parts: { label: string; value: number }[] = [];
  const club = p.clubId ? state.clubs[p.clubId] : null;
  const growing = baseGrowth(ageAt(p.birthDay, state.day)) > 0;
  const diff = growing ? DIFF_GROWTH[state.settings.difficulty] : DIFF_DECLINE[state.settings.difficulty];
  parts.push({ label: 'Difficulty', value: diff });
  parts.push({ label: INTENSITY[plan.intensity].label, value: growing ? INTENSITY[plan.intensity].growth : (plan.intensity === 'rest' ? 1.05 : plan.intensity === 'intensive' ? 0.92 : 1) });
  const share = minutesShare28(p, state);
  parts.push({ label: 'Playing time', value: growing ? 0.85 + 0.25 * share : 1.15 - 0.2 * share });
  if (club) {
    const q = coachQuality(state, club.id);
    parts.push({ label: 'Coaching & facilities', value: growing ? 0.9 + 0.22 * q : 1.05 - 0.1 * q });
  }
  const prof = p.personality === 'professional' ? 0.06 : p.personality === 'ambitious' ? 0.03 : p.personality === 'competitive' ? 0.02 : 0;
  if (prof) parts.push({ label: 'Professional attitude', value: growing ? 1 + prof : 1 - prof });
  const life = lifestyleGrowthBonus(state);
  if (life) parts.push({ label: 'Lifestyle & support staff', value: growing ? 1 + life : 1 - life });
  if (p.injury) parts.push({ label: 'Injured', value: growing ? 0.4 : 1.1 });
  if (p.cond.fatigue > 75) parts.push({ label: 'Exhaustion', value: growing ? 0.8 : 1.05 });
  const formAdj = (p.recentRatings.length ? clamp((p.recentRatings.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, p.recentRatings.length) - 6.4) * 0.05, -0.06, 0.08) : 0);
  if (formAdj) parts.push({ label: 'Recent form', value: growing ? 1 + formAdj : 1 - formAdj * 0.5 });
  let m = 1;
  for (const x of parts) m *= x.value;
  return { multiplier: m, parts };
}

function lifestyleGrowthBonus(state: GameState): number {
  let b = 0;
  for (const pu of state.finance.purchases) {
    if (pu.catalogId === 'svc_trainer') b += 0.05;
    if (pu.catalogId === 'svc_nutritionist') b += 0.03;
    if (pu.catalogId === 'svc_chef') b += 0.02;
  }
  return Math.min(b, 0.1);
}

/* ------------------------------ user daily growth ------------------------------ */

export function recordChange(state: GameState, ch: AttrChange): void {
  state.career.attrChanges.push(ch);
  if (state.career.attrChanges.length > 400) state.career.attrChanges.splice(0, state.career.attrChanges.length - 400);
  state.career.weeklyChange.push(ch);
}

function reasonFor(state: GameState, p: Player, k: AttrKey, dir: 1 | -1): string {
  const src = state.career.xpSrc[k] ?? { t: 0, m: 0, b: 0 };
  const age = ageAt(p.birthDay, state.day);
  if (dir < 0) {
    if (p.injury) return 'Injury setback while recovering';
    if (minutesShare28(p, state) < 0.2 && state.training.plan.intensity === 'rest') return 'Lack of training and match action';
    if (minutesShare28(p, state) < 0.2) return 'Lack of match action';
    if (ATTR_GROUP[k] === 'physical') return `Ageing: natural physical decline at ${age}`;
    return `Ageing at ${age}`;
  }
  const label = FOCUS_LABEL[state.training.plan.focus];
  if (src.t >= src.b && src.t >= src.m && src.t > 0) {
    const coach = state.clubs[p.clubId ?? '']?.manager.coaching ?? 0;
    return `Training: ${label} sessions${coach >= 13 ? ' (strong coaching)' : ''}`;
  }
  if (src.m >= src.b && src.m > 0) return 'Match experience and good performances';
  return age <= 21 ? 'Natural development as a young player' : 'Steady natural development';
}

function applyXp(state: GameState, p: Player, k: AttrKey, dxp: number, src: 't' | 'm' | 'b'): void {
  if (!dxp) return;
  p.xp[k] = (p.xp[k] ?? 0) + dxp;
  const s = (state.career.xpSrc[k] ||= { t: 0, m: 0, b: 0 });
  if (dxp > 0) s[src] += dxp;
  let guard = 0;
  while (guard++ < 3) {
    const cur: number = p.xp[k] ?? 0;
    if (cur >= 1 && p.attrs[k] < Math.max(p.caps[k], p.attrs[k]) && p.attrs[k] < 99) {
      const from = p.attrs[k];
      p.attrs[k] = from + 1;
      p.xp[k] = cur - 1;
      recordChange(state, { day: state.day, attr: k, from, to: from + 1, reason: reasonFor(state, p, k, 1) });
      state.career.xpSrc[k] = { t: 0, m: 0, b: 0 };
    } else if (cur <= -1 && p.attrs[k] > 1) {
      const from = p.attrs[k];
      p.attrs[k] = from - 1;
      p.xp[k] = cur + 1;
      recordChange(state, { day: state.day, attr: k, from, to: from - 1, reason: reasonFor(state, p, k, -1) });
    } else break;
  }
  if (p.attrs[k] >= p.caps[k] && (p.xp[k] ?? 0) > 0.99) p.xp[k] = 0.99;
}

/** Background growth/decline plus training-focus reallocation for one day. Returns the points applied (for the log). */
export function developUserDaily(state: GameState, p: Player): number {
  const plan = state.training.plan;
  const age = ageAt(p.birthDay, state.day);
  const pts = growthPointsPerYear(p, state.day);
  const ctx = growthContext(state, p, plan);
  let applied = 0;
  if (pts > 0) {
    const shares = growthShares(p, state.day);
    const daily = (pts * pointsPerOverall(p.position, shares) * 0.9) / 365;
    const focus = new Set(focusAttrs(plan.focus, p.position));
    const boost = plan.focus === 'recovery' ? 0 : INTENSITY[plan.intensity].boost;
    const raw = {} as Record<AttrKey, number>;
    let total = 0;
    for (const k of ALL_ATTRS) {
      raw[k] = shares[k] * (focus.has(k) && shares[k] > 0 ? 1 + boost : 1);
      total += raw[k];
    }
    for (const k of ALL_ATTRS) {
      if (shares[k] <= 0) continue;
      const w = raw[k] / total;
      const baseW = shares[k];
      const amount = daily * ctx.multiplier * diminishing(p.attrs[k]);
      const full = amount * w;
      const bgPart = Math.min(full, amount * baseW);
      applyXp(state, p, k, bgPart, 'b');
      applyXp(state, p, k, full - bgPart, 't');
      applied += full;
    }
  } else if (pts < 0) {
    const shares = declineShares(age);
    const daily = (-pts * pointsPerOverall(p.position, shares)) / 365;
    const protect = plan.focus === 'physical' || plan.focus === 'recovery' ? 0.88 : 1;
    for (const k of ALL_ATTRS) {
      const amt = daily * ctx.multiplier * shares[k] * (ATTR_GROUP[k] === 'physical' ? protect : 1) * (1 - Math.min(0.35, p.attrs.naturalFitness / 400));
      applyXp(state, p, k, -amt, 'b');
      applied -= amt;
    }
  }
  return applied;
}

/** Experience from a match: position-relevant attributes plus those the player actually used. */
export function applyMatchExperience(state: GameState, p: Player, st: PlayerMatchStats, weight = 1): void {
  if (st.minutes <= 0) return;
  const growing = baseGrowth(ageAt(p.birthDay, state.day)) > 0;
  if (!growing) return;
  const diff = DIFF_GROWTH[state.settings.difficulty];
  const perf = 0.65 + 0.7 * clamp((st.rating - 5.5) / 2.2, 0, 1);
  const pts = 0.55 * (st.minutes / 90) * perf * diff * weight * (1 + (p.potential - overall(p) > 5 ? 0.15 : 0));
  const act = {} as Partial<Record<AttrKey, number>>;
  const bump = (ks: AttrKey[], v: number) => { for (const k of ks) act[k] = (act[k] ?? 0) + v / ks.length; };
  bump(['finishing', 'composure'], st.goals * 1.2 + st.shotsOnTarget * 0.15);
  bump(['vision', 'shortPassing', 'decisions'], st.assists * 1.2 + st.keyPasses * 0.4 + st.passesCompleted * 0.02);
  bump(['dribbling', 'agility', 'ballControl'], st.dribblesWon * 0.5);
  bump(['tackling', 'anticipation', 'defensiveAwareness', 'marking'], st.tacklesWon * 0.4 + st.interceptions * 0.4 + st.clearances * 0.15);
  bump(['reflexes', 'handling', 'oneOnOnes'], st.saves * 0.5);
  bump(['stamina', 'workRate'], st.minutes / 60);
  const actTotal = Object.values(act).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const shares = growthShares(p, state.day);
  for (const k of ALL_ATTRS) {
    const a = (act[k] ?? 0) / actTotal;
    const s = 0.7 * shares[k] + 0.3 * a;
    if (s <= 0 || p.attrs[k] >= p.caps[k]) continue;
    applyXp(state, p, k, pts * s * diminishing(p.attrs[k]), 'm');
  }
}

/* ------------------------------ NPC annual growth ------------------------------ */

export interface AnnualOpts { coaching: number; youthFacilities: number; playingShare: number; rng: Rng; day: number }

/** One season of development / ageing for a non-user player (applied at season rollover). */
export function developAnnual(p: Player, o: AnnualOpts): void {
  const age = ageAt(p.birthDay, o.day);
  const pts = growthPointsPerYear(p, o.day);
  const rng = o.rng;
  const coach = 0.9 + 0.22 * (0.5 * (o.coaching / 20) + 0.5 * (o.youthFacilities / 20));
  const play = pts > 0 ? 0.85 + 0.25 * o.playingShare : 1.15 - 0.2 * o.playingShare;
  const luck = clamp(rng.normal(1, 0.28), 0.4, 1.7);
  if (pts > 0) {
    const shares = growthShares(p, o.day);
    const budget = pts * pointsPerOverall(p.position, shares) * 0.9 * coach * play * luck;
    for (const k of ALL_ATTRS) {
      if (shares[k] <= 0) continue;
      const room = p.caps[k] - p.attrs[k];
      const want = budget * shares[k] * diminishing(p.attrs[k]) + (p.xp[k] ?? 0);
      let inc = Math.floor(want);
      if (rng.next() < want - inc) inc++;
      inc = Math.min(inc, Math.max(0, room));
      p.attrs[k] = clamp(p.attrs[k] + inc, 1, 99);
      p.xp[k] = 0;
    }
  } else if (pts < 0) {
    const shares = declineShares(age);
    const budget = -pts * pointsPerOverall(p.position, shares) * (0.85 + 0.3 * rng.next()) * (1 - Math.min(0.3, p.attrs.naturalFitness / 450));
    for (const k of ALL_ATTRS) {
      const want = budget * shares[k];
      let dec = Math.floor(want);
      if (rng.next() < want - dec) dec++;
      p.attrs[k] = clamp(p.attrs[k] - dec, 1, 99);
    }
  }
  // the potential can drift for the young and is never below current ability
  if (age <= 22) p.potential = Math.round(clamp(p.potential + rng.normal(0, 1.1), 0, 97));
  const ovr = overall(p);
  if (p.potential < ovr) p.potential = ovr;
  for (const k of ALL_ATTRS) if (p.caps[k] < p.attrs[k]) p.caps[k] = p.attrs[k];
}

export function highestAttrs(p: Player, n = 3): AttrKey[] {
  return ALL_ATTRS.slice().sort((a, b) => p.attrs[b] - p.attrs[a]).slice(0, n);
}

/* ------------------------------ daily condition ------------------------------ */

export function baselineMorale(p: Pick<Player, 'personality'>): number {
  return p.personality === 'reserved' ? 64 : p.personality === 'charismatic' ? 70 : p.personality === 'competitive' ? 66 : 67;
}

/** Recovery and drift applied to every player each day. `playedRecently` keeps sharpness up. */
export function dailyCondition(p: Player, playedRecently: boolean): void {
  const c = p.cond;
  c.fatigue = clamp(c.fatigue * 0.78 - 2 - (p.attrs.naturalFitness - 60) / 90, 0, 100);
  if (!playedRecently) c.sharpness = clamp(c.sharpness - 0.9, 35, 100);
  c.matchFitness = clamp(c.matchFitness + (p.injury ? -0.7 : c.fatigue < 50 ? 0.3 : -0.1), 40, 100);
  const base = baselineMorale(p);
  c.morale = clamp(c.morale + (base - c.morale) * 0.015, 5, 100);
  c.confidence = clamp(c.confidence + (55 - c.confidence) * 0.01, 5, 100);
}

export function healInjury(p: Player): boolean {
  if (!p.injury) return false;
  p.injury.daysLeft--;
  if (p.injury.daysLeft <= 0) {
    const long = p.injury.daysTotal >= 30;
    p.injury = null;
    if (long) { p.cond.sharpness = Math.min(p.cond.sharpness, 45); p.cond.matchFitness = Math.min(p.cond.matchFitness, 70); }
    return true;
  }
  return false;
}

/* ---------------------------- training injuries ---------------------------- */

export function trainingInjuryChance(p: Player, intensity: Intensity, state: GameState, physio = 1): number {
  const fatigue = p.cond.fatigue;
  const diff = state.settings.difficulty === 'casual' ? 0.7 : state.settings.difficulty === 'simulation' ? 1.3 : 1;
  const protection = p.cond.matchFitness > 85 ? 0.9 : 1;
  return 0.0011 * INTENSITY[intensity].injury * (1 + fatigue / 80) * p.injuryProne * diff * protection / physio;
}

export { INJURY_TYPES, makeInjury, rollInjuryType };

/* ------------------------------- previews ------------------------------- */

export interface TrainingPreview {
  weeklyPoints: { attr: AttrKey; label: string; pts: number }[];
  totalPoints: number;
  fatiguePerSession: number;
  injuryRiskWeek: number; // percent
  multiplier: number;
  parts: { label: string; value: number }[];
  recoveryNote: string;
  hours: number;
}

export function previewTraining(state: GameState, p: Player, plan: TrainingPlan): TrainingPreview {
  const pts = growthPointsPerYear(p, state.day);
  const ctx = growthContext(state, p, plan);
  const out: TrainingPreview['weeklyPoints'] = [];
  let total = 0;
  if (pts > 0) {
    const shares = growthShares(p, state.day);
    const daily = (pts * pointsPerOverall(p.position, shares) * 0.9) / 365;
    const focus = new Set(focusAttrs(plan.focus, p.position));
    const boost = plan.focus === 'recovery' ? 0 : INTENSITY[plan.intensity].boost;
    const raw = {} as Record<AttrKey, number>;
    let sum = 0;
    for (const k of ALL_ATTRS) { raw[k] = shares[k] * (focus.has(k) && shares[k] > 0 ? 1 + boost : 1); sum += raw[k]; }
    for (const k of ALL_ATTRS) {
      if (shares[k] <= 0) continue;
      const v = daily * 7 * ctx.multiplier * diminishing(p.attrs[k]) * (raw[k] / sum);
      total += v;
      out.push({ attr: k, label: ATTR_LABEL[k], pts: v });
    }
    out.sort((a, b) => b.pts - a.pts);
  }
  const sessions = 5;
  const inj = 1 - Math.pow(1 - trainingInjuryChance(p, plan.intensity, state), sessions);
  return {
    weeklyPoints: out.slice(0, 8), totalPoints: total, fatiguePerSession: INTENSITY[plan.intensity].fatigue,
    injuryRiskWeek: Math.round(inj * 1000) / 10, multiplier: ctx.multiplier, parts: ctx.parts,
    recoveryNote: plan.intensity === 'rest' ? 'You will be fully fresh but lose a little sharpness.' : plan.intensity === 'intensive' ? 'Expect heavy legs. Avoid stacking this with two matches in a week.' : 'Sustainable alongside a weekly match.',
    hours: INTENSITY[plan.intensity].hours,
  };
}

/** Rough projection of overall rating if circumstances stay average. */
export function projectOverall(p: Player, day: number, years: number): number {
  let ovr = overall(p);
  let d = day;
  const fake = { attrs: p.attrs, position: p.position, potential: p.potential, birthDay: p.birthDay };
  for (let y = 0; y < years; y++) {
    const g = growthPointsPerYear({ ...fake, attrs: { ...fake.attrs } }, d);
    ovr = clamp(ovr + g * 0.9, 1, Math.max(p.potential, ovr));
    d += 365;
  }
  return Math.round(ovr);
}

export function attrsAtCap(p: Player): number {
  return ALL_ATTRS.filter((k) => p.attrs[k] >= p.caps[k]).length;
}

export function overallOfCaps(p: Player): number {
  return Math.round(overallFor(p.caps as Attrs, p.position));
}
