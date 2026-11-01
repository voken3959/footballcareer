import type { GameState, Player, Position } from '../engine/types';
import { ageAt, ratingBand } from '../engine/attributes';
import { seedFrom, Rng, clamp } from '../engine/rng';
import { dayOfWeek, formatDate } from '../engine/dates';

export { money } from '../engine/economy';
export { formatDate, formatShort, seasonLabel } from '../engine/dates';

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const signed = (v: number, digits = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Text colour class for a 0..100 attribute or overall rating. */
export function ratingClass(v: number): string {
  const b = ratingBand(v);
  return b === 'elite' ? 'text-gold-400' : b === 'great' ? 'text-pitch-400' : b === 'good' ? 'text-ink-50' : b === 'average' ? 'text-ink-200' : 'text-bad-400';
}

/** Match rating colour (1..10). */
export function matchRatingClass(r: number | null | undefined): string {
  if (r === null || r === undefined) return 'text-ink-400';
  return r >= 8 ? 'text-gold-400' : r >= 7 ? 'text-pitch-400' : r >= 6 ? 'text-ink-100' : r >= 5 ? 'text-warn-400' : 'text-bad-400';
}

/** 0..100 condition colour for a "higher is better" bar. */
export function goodBar(v: number): string {
  return v >= 70 ? 'bg-pitch-500' : v >= 45 ? 'bg-warn-400' : 'bg-bad-500';
}
/** Colour for a "lower is better" bar such as fatigue. */
export function badBar(v: number): string {
  return v <= 30 ? 'bg-pitch-500' : v <= 60 ? 'bg-warn-400' : 'bg-bad-500';
}

export function moodWord(v: number): string {
  return v >= 85 ? 'Superb' : v >= 70 ? 'Good' : v >= 50 ? 'Steady' : v >= 35 ? 'Low' : 'Poor';
}

export function ageOf(g: GameState, p: Player): number {
  return ageAt(p.birthDay, g.day);
}

/**
 * Potential is hidden. The coaching staff offer an estimate that is wide for a young player and narrows with age. The offset is
 * fixed per player and per save, so the number does not wobble when you reopen a screen.
 */
export function potentialEstimate(g: GameState, p: Player, coaching = 12): { lo: number; hi: number; mid: number; label: string; atPeak: boolean } {
  const age = ageOf(g, p);
  if (age >= 29) return { lo: p.potential, hi: p.potential, mid: p.potential, label: 'Fully developed', atPeak: true };
  const width = clamp(11 - (age - 16) * 0.75 - (coaching - 10) * 0.25, 3, 12);
  const rng = new Rng(seedFrom(g.seed, p.id, 'scout'));
  const off = rng.range(-width * 0.45, width * 0.45) * (age <= 23 ? 1 : 0.5);
  const mid = clamp(Math.round(p.potential + off), 20, 99);
  const lo = clamp(Math.round(mid - width / 2), 20, 99);
  const hi = clamp(Math.round(mid + width / 2), 20, 99);
  const label = mid >= 86 ? 'World-class ceiling' : mid >= 78 ? 'Excellent ceiling' : mid >= 70 ? 'Good ceiling' : mid >= 62 ? 'Solid ceiling' : 'Limited ceiling';
  return { lo, hi, mid, label, atPeak: false };
}

export function weekday(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek(day)] ?? '';
}

export function inDaysText(n: number): string {
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

export function dateWithOffset(g: GameState, day: number): string {
  return `${formatDate(day, true)} (${inDaysText(day - g.day)})`;
}

export const POSITION_ORDER: Position[] = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'];

export function clsx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function statAvg(ratingSum: number, apps: number): string {
  return apps > 0 ? (ratingSum / apps).toFixed(2) : '–';
}
