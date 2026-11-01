import type { Player } from './types';
import { clamp } from './rng';

/** Recent form 0..100 from the last match ratings (50 = neutral / no data). */
export function formValue(p: Pick<Player, 'recentRatings'>): number {
  const r = p.recentRatings;
  if (!r.length) return 50;
  const last = r.slice(-5);
  const w = last.map((_, i) => 1 + i * 0.4);
  const avg = last.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((a, b) => a + b, 0);
  return clamp(50 + (avg - 6.4) * 32, 0, 100);
}

export function freshness(p: Pick<Player, 'cond'>): number {
  return 100 - p.cond.fatigue;
}

/**
 * Multiplier (~0.88 .. 1.08) applied to a player's skills for a match.
 * Fatigue is handled separately inside the match (energy), starting from the player's fatigue level.
 */
export function conditionFactor(p: Pick<Player, 'cond' | 'recentRatings'>): number {
  const c = p.cond;
  const f =
    1 + 0.0020 * (c.sharpness - 70) + 0.0015 * (c.matchFitness - 85) + 0.0012 * (c.morale - 65)
    + 0.0012 * (c.confidence - 55) + 0.0020 * (formValue(p) - 50);
  return clamp(f, 0.88, 1.08);
}

/** Overall "ready to play" score 0..100 used by selection and the UI. */
export function readiness(p: Pick<Player, 'cond' | 'recentRatings' | 'injury'>): number {
  if (p.injury) return 0;
  const c = p.cond;
  return clamp(0.42 * (100 - c.fatigue) + 0.2 * c.matchFitness + 0.18 * c.sharpness + 0.1 * c.morale + 0.1 * c.confidence, 0, 100);
}
