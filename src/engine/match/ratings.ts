import type { PlayerMatchStats, Position } from '../types';
import { clamp } from '../rng';

type Group = 'GK' | 'DEF' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';
const groupOf = (pos: Position): Group =>
  pos === 'GK' ? 'GK' : pos === 'CB' || pos === 'RB' || pos === 'LB' ? 'DEF' : pos === 'DM' ? 'DM' : pos === 'CM' ? 'CM'
    : pos === 'AM' ? 'AM' : pos === 'RW' || pos === 'LW' ? 'W' : 'ST';

const GOAL_VALUE: Record<Group, number> = { GK: 1.4, DEF: 1.3, DM: 1.2, CM: 1.1, AM: 1.0, W: 1.0, ST: 0.9 };
// expected defensive actions per 90 (tackles won + interceptions) used to judge defensive contribution
const DEF_EXPECT: Record<Group, number> = { GK: 0, DEF: 3.4, DM: 4.0, CM: 2.8, AM: 1.2, W: 1.4, ST: 0.7 };

export interface RatingContext {
  teamGoals: number;
  oppGoals: number;
  won: boolean | null;
  matchMinutes: number; // minutes the match lasted (90 or 120)
}

/** Rating 3.0..10.0 built from recorded actions; the context-neutral baseline is 6.2. */
export function ratePlayer(s: PlayerMatchStats, ctx: RatingContext): number {
  const g = groupOf(s.slot);
  const mins = Math.max(0, s.minutes);
  if (mins <= 0) return 0;
  let r = 6.2;
  // goals with diminishing weight
  for (let i = 0; i < s.goals; i++) r += GOAL_VALUE[g] * Math.pow(0.88, i);
  r += 0.65 * s.assists;
  r += 0.11 * Math.min(6, s.keyPasses);
  r += 0.05 * s.shotsOnTarget;
  r -= 0.28 * Math.max(0, s.xg - s.goals);
  r += 0.1 * s.dribblesWon - 0.04 * (s.dribbles - s.dribblesWon);
  const defActions = s.tacklesWon + s.interceptions;
  r += 0.1 * defActions + 0.05 * s.clearances + 0.09 * s.blocks;
  if (g !== 'GK') r += clamp((defActions - DEF_EXPECT[g] * (mins / 90)) * 0.3, -0.6, 0) * (g === 'DEF' || g === 'DM' ? 1 : 0.4);
  r -= 0.04 * (s.tackles - s.tacklesWon);
  r += 0.22 * s.saves;
  if (g === 'GK') r -= 0.38 * s.conceded;
  else if (g === 'DEF') r -= 0.2 * s.conceded;
  else if (g === 'DM') r -= 0.09 * s.conceded;
  else if (g === 'CM') r -= 0.05 * s.conceded;
  if (s.conceded === 0 && mins >= 60) r += g === 'GK' ? 0.5 : g === 'DEF' ? 0.4 : g === 'DM' ? 0.2 : 0;
  r += 0.02 * (s.passesCompleted - 0.82 * s.passes);
  r += 0.0045 * Math.min(60, s.passesCompleted) * (g === 'GK' || g === 'ST' ? 0.4 : 1) - 0.1;
  r -= 0.022 * s.turnovers;
  r -= 0.45 * s.errors;
  r -= 0.05 * s.fouls;
  r += 0.03 * s.fouled;
  r -= 0.25 * s.yellow + 1.8 * s.red;
  r -= 1.2 * s.ownGoals;
  r -= 0.04 * s.offsides;
  if (ctx.won === true) r += 0.22;
  else if (ctx.won === false) r -= 0.22;
  // few minutes -> compress towards neutral
  const shrink = Math.min(1, Math.sqrt(mins / 70));
  r = 6.2 + (r - 6.2) * shrink;
  const soft = 6.2 + 3.8 * Math.tanh((r - 6.2) / 3.4);
  return Math.round(clamp(soft, 3, 10) * 10) / 10;
}
