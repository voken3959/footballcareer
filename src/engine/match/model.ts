/**
 * Match model: composite skills, spatial helpers, xG, duel probabilities.
 *
 * Documented model baselines
 * --------------------------
 *  - xG is a logistic function of distance and the angle the goal subtends, scaled by shot type and defensive pressure.
 *  - P(goal) = xG * finisherMultiplier * keeperMultiplier, clamped. At the baseline (finisher skill 62, keeper skill 62)
 *    both multipliers are 1, so an xG of 0.25 is a 25% scoring probability. Better finishers / worse keepers move it up,
 *    never to certainty, and the result is realised through blocked / off-target / saved / goal outcomes.
 *  - A duel between attacking strength A and defensive strength D succeeds with probability sigmoid((A - D) / 10),
 *    so 80 vs 78 gives about 55%.
 */
import type { Attrs, Player, ShotType } from '../types';
import { clamp, sigmoid } from '../rng';

export const BASELINE_FINISHING = 62;
export const BASELINE_KEEPER = 62;
export const DUEL_SCALE = 10;
export const PITCH_L = 105;
export const PITCH_W = 68;

export interface Skills {
  passShort: number; passLong: number; through: number; cross: number; dribble: number; retention: number;
  defend: number; tackle: number; intercept: number; aerialAtt: number; aerialDef: number; pace: number;
  shoot: number; longShot: number; headShot: number; gkSave: number; gk1v1: number; run: number; recv: number;
  aggression: number; setPiece: number; penalty: number;
}

export function computeSkills(a: Attrs): Skills {
  const pace = a.acceleration * 0.45 + a.sprintSpeed * 0.55;
  return {
    passShort: a.shortPassing * 0.55 + a.vision * 0.15 + a.firstTouch * 0.15 + a.composure * 0.15,
    passLong: a.longPassing * 0.6 + a.vision * 0.2 + a.decisions * 0.1 + a.composure * 0.1,
    through: a.vision * 0.4 + a.shortPassing * 0.3 + a.decisions * 0.15 + a.composure * 0.15,
    cross: a.crossing * 0.7 + a.longPassing * 0.1 + a.vision * 0.1 + a.composure * 0.1,
    dribble: a.dribbling * 0.3 + a.ballControl * 0.2 + a.agility * 0.2 + a.acceleration * 0.15 + a.decisions * 0.15,
    retention: a.ballControl * 0.3 + a.firstTouch * 0.2 + a.composure * 0.2 + a.strength * 0.15 + a.balance * 0.15,
    defend: a.tackling * 0.25 + a.anticipation * 0.2 + a.defensiveAwareness * 0.2 + a.positioning * 0.15 + a.strength * 0.1 + a.concentration * 0.1,
    tackle: a.tackling * 0.5 + a.strength * 0.2 + a.anticipation * 0.15 + a.defensiveAwareness * 0.15,
    intercept: a.anticipation * 0.4 + a.defensiveAwareness * 0.25 + a.positioning * 0.2 + a.concentration * 0.15,
    aerialAtt: a.heading * 0.4 + a.jumping * 0.25 + a.strength * 0.2 + a.offTheBall * 0.15,
    aerialDef: a.heading * 0.35 + a.jumping * 0.25 + a.strength * 0.2 + a.marking * 0.2,
    pace,
    shoot: a.finishing * 0.65 + a.composure * 0.2 + a.firstTouch * 0.15,
    longShot: a.longShots * 0.65 + a.composure * 0.15 + a.ballControl * 0.2,
    headShot: a.heading * 0.55 + a.finishing * 0.2 + a.jumping * 0.15 + a.composure * 0.1,
    gkSave: a.reflexes * 0.4 + a.handling * 0.25 + a.positioning * 0.2 + a.concentration * 0.1 + a.anticipation * 0.05,
    gk1v1: a.oneOnOnes * 0.5 + a.reflexes * 0.2 + a.positioning * 0.15 + a.composure * 0.15,
    run: a.offTheBall * 0.5 + pace * 0.3 + a.decisions * 0.2,
    recv: a.firstTouch * 0.5 + a.ballControl * 0.5,
    aggression: (a.workRate * 0.4 + (100 - a.composure) * 0.3 + (100 - a.tackling) * 0.3),
    setPiece: a.crossing * 0.4 + a.longPassing * 0.3 + a.vision * 0.2 + a.composure * 0.1,
    penalty: a.finishing * 0.5 + a.composure * 0.4 + a.decisions * 0.1,
  };
}

/** Probability that an attacker with strength `att` beats a defender with strength `def`. */
export function duelProbability(att: number, def: number, bias = 0): number {
  return sigmoid((att - def) / DUEL_SCALE + bias);
}

export interface Geometry { dist: number; angle: number }

/** Distance (m) and the angle (rad) the goal subtends from own-perspective coordinates (attacking towards x = 1). */
export function shotGeometry(xOwn: number, yOwn: number): Geometry {
  const dx = Math.max(0.3, (1 - xOwn) * PITCH_L);
  const dy = (yOwn - 0.5) * PITCH_W;
  const dist = Math.hypot(dx, dy);
  const angle = Math.abs(Math.atan2(dy + 3.66, dx) - Math.atan2(dy - 3.66, dx));
  return { dist, angle };
}

/**
 * Shot quality (xG) for an open-play shot before finisher/keeper adjustments.
 * `pressure` is 0..1 defensive interference.
 */
export function expectedGoals(dist: number, angle: number, type: ShotType, pressure: number): number {
  if (type === 'penalty') return 0.76;
  if (type === 'freeKick') return clamp(0.095 - 0.0024 * (dist - 18), 0.025, 0.11);
  let logit = -1.84 - 0.075 * dist + 2.5 * angle;
  let xg = 1 / (1 + Math.exp(-logit));
  if (type === 'oneOnOne') xg = clamp(0.28 + 0.1 * (1 - dist / 30), 0.22, 0.4);
  else if (type === 'header') xg *= 0.68;
  else if (type === 'volley') xg *= 0.85;
  else if (type === 'tapIn') xg = Math.max(xg, 0.3);
  xg *= 1 - 0.45 * clamp(pressure, 0, 1);
  return clamp(xg, 0.005, 0.85);
}

export function finisherMultiplier(skill: number): number {
  return 1 + (0.9 * (skill - BASELINE_FINISHING)) / 100;
}

export function keeperMultiplier(skill: number): number {
  return 1 - (0.8 * (skill - BASELINE_KEEPER)) / 100;
}

/** Final probability of a goal given xG and the two relevant skills (documented adjustment). */
export function goalProbability(xg: number, shooterSkill: number, keeperSkill: number): number {
  return clamp(xg * finisherMultiplier(shooterSkill) * keeperMultiplier(keeperSkill), 0.004, 0.93);
}

export const distM = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot((ax - bx) * PITCH_L, (ay - by) * PITCH_W);

/** Shortest distance (m) from point p to segment a-b, all in normalised pitch coordinates. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const apx = (px - ax) * PITCH_L, apy = (py - ay) * PITCH_W;
  const abx = (bx - ax) * PITCH_L, aby = (by - ay) * PITCH_W;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : clamp((apx * abx + apy * aby) / len2, 0, 1);
  return Math.hypot(apx - abx * t, apy - aby * t);
}

export function playerMeta(p: Player): string {
  return `${p.displayName}`;
}
