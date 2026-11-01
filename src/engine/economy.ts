import type { Contract, Player, SquadRole } from './types';
import { ageAt, overall } from './attributes';
import { clamp } from './rng';

/** Raw market value for a rating (GBP). Exponential so stars are priced far above squad players. */
export function baseValueForRating(r: number): number {
  return 6400 * Math.exp((r - 40) * 0.205);
}

/** Rating blended with potential for young players (clubs pay for what a player may become). */
export function effectiveRating(ovr: number, pot: number, age: number): number {
  const w = age <= 18 ? 0.65 : age <= 21 ? 0.5 : age <= 23 ? 0.35 : age <= 26 ? 0.2 : 0;
  return ovr + Math.max(0, pot - ovr) * w;
}

function ageMultiplier(age: number): number {
  if (age <= 20) return 1.15;
  if (age <= 25) return 1.0;
  if (age <= 28) return 0.95;
  if (age === 29) return 0.8;
  if (age === 30) return 0.65;
  if (age === 31) return 0.5;
  if (age === 32) return 0.35;
  return 0.2;
}

function contractMultiplier(yearsLeft: number): number {
  if (yearsLeft >= 3) return 1;
  if (yearsLeft >= 2) return 0.92;
  if (yearsLeft >= 1) return 0.72;
  if (yearsLeft >= 0.5) return 0.5;
  return 0.35;
}

export function marketValue(p: Player, day: number): number {
  const age = ageAt(p.birthDay, day);
  const ovr = overall(p);
  const eff = effectiveRating(ovr, p.potential, age);
  const yearsLeft = p.contract ? Math.max(0, (p.contract.endDay - day) / 365) : 0;
  const rep = 0.85 + (p.reputation / 100) * 0.35;
  const v = baseValueForRating(eff) * ageMultiplier(age) * contractMultiplier(yearsLeft) * rep;
  return Math.max(5000, roundMoney(v));
}

/**
 * What a club can spend on fees in a window. Real clubs turn over roughly 12-20% of their squad value a year and fund it
 * from cash, debt and sales, so the budget scales with the squad as well as the bank balance.
 */
export function transferBudgetFor(balance: number, squadValue: number, reputation = 50): number {
  // the biggest clubs gamble far more of their squad value on a single star than a mid-table side can, which is what lets
  // the very best players in the world still change clubs for a fee
  const share = 0.14 + 0.2 * Math.max(0, Math.min(1, (reputation - 50) / 40));
  return Math.max(0, Math.round(Math.max(balance * 0.28, squadValue * share)));
}

/** Fair weekly wage for a player at a given club reputation. */
export function fairWage(ovr: number, pot: number, age: number, clubRep: number, repPlayer = 50): number {
  // fees pay for what a player may become; wages pay mostly for what he does now, so potential counts for half as much
  const eff = ovr + (effectiveRating(ovr, pot, age) - ovr) * 0.5;
  const base = baseValueForRating(eff) * 0.0042;
  const floor = 280 + Math.max(0, ovr - 42) * 62;
  const tier = 0.8 + (clubRep / 100) * 0.4;
  const rep = 0.9 + (repPlayer / 100) * 0.2;
  return roundWage(Math.max(floor, base) * tier * rep);
}

export function academyWage(clubRep: number): number {
  return roundWage(80 + clubRep * 2.2);
}

export function roundWage(w: number): number {
  if (w < 1000) return Math.round(w / 10) * 10;
  if (w < 10000) return Math.round(w / 50) * 50;
  if (w < 100000) return Math.round(w / 250) * 250;
  return Math.round(w / 1000) * 1000;
}

export function roundMoney(v: number): number {
  if (v < 20000) return Math.round(v / 500) * 500;
  if (v < 200000) return Math.round(v / 5000) * 5000;
  if (v < 2000000) return Math.round(v / 25000) * 25000;
  if (v < 20000000) return Math.round(v / 250000) * 250000;
  return Math.round(v / 1000000) * 1000000;
}

export function money(v: number, compact = true): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (compact) {
    if (abs >= 1e9) return `${sign}£${(abs / 1e9).toFixed(2)}bn`;
    if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}m`;
    if (abs >= 1e4) return `${sign}£${Math.round(abs / 1000)}k`;
  }
  return `${sign}£${Math.round(abs).toLocaleString('en-GB')}`;
}

export function defaultBonuses(wage: number, role: SquadRole): Contract['bonuses'] {
  const k = role === 'Key player' || role === 'Regular starter' ? 1 : 0.6;
  return {
    appearance: roundWage(wage * 0.06 * k),
    goal: roundWage(wage * 0.12 * k),
    cleanSheet: roundWage(wage * 0.05 * k),
    signing: 0,
    signingPaid: true,
    loyalty: 0,
  };
}

export function yearsLeft(c: Contract | null, day: number): number {
  return c ? Math.max(0, (c.endDay - day) / 365) : 0;
}

/** Minimum wage the player will ask in negotiation. */
export function wageDemand(p: Player, day: number, clubRep: number, difficultyFactor = 1): number {
  const age = ageAt(p.birthDay, day);
  const ovr = overall(p);
  const fair = fairWage(ovr, p.potential, age, clubRep, p.reputation);
  return roundWage(fair * difficultyFactor);
}

export const clampMoney = (v: number) => clamp(v, 0, 1e10);
