/**
 * The player's money. Every change of balance goes through `post`, which writes an auditable ledger row.
 * One-off payments (signing bonuses, loyalty bonuses, per-match bonuses) carry an idempotency key so they can never be
 * paid twice. Wages are paid once per elapsed week, driven by `lastWagePaidDay`, so skipping days cannot skip or duplicate pay.
 */
import type { GameState, LedgerEntry } from './types';
import { userPlayer } from './util';

export type LedgerCategory = LedgerEntry['category'];

const LEDGER_CAP = 4000;

export function post(state: GameState, category: LedgerCategory, description: string, amount: number): LedgerEntry {
  const f = state.finance;
  const amt = Math.round(amount);
  f.balance += amt;
  const e: LedgerEntry = { id: f.nextLedgerId++, day: state.day, category, description, amount: amt, balanceAfter: f.balance };
  f.ledger.push(e);
  if (f.ledger.length > LEDGER_CAP) f.ledger.splice(0, f.ledger.length - LEDGER_CAP);
  return e;
}

/** Claim an idempotency key. Returns false when the key was already used. */
export function claim(state: GameState, key: string): boolean {
  const keys = state.finance.paidBonusKeys;
  if (keys.includes(key)) return false;
  keys.push(key);
  if (keys.length > 6000) keys.splice(0, keys.length - 6000);
  return true;
}

export function payOnce(state: GameState, key: string, category: LedgerCategory, description: string, amount: number): LedgerEntry | null {
  if (amount === 0 || !claim(state, key)) return null;
  const e = post(state, category, description, amount);
  if (amount > 0 && (category === 'bonus' || category === 'signing_bonus' || category === 'loyalty')) state.finance.careerEarnings += amount;
  return e;
}

/** Weekly income tax on a weekly gross wage: personal allowance, then three bands. */
export function weeklyTax(gross: number): number {
  const allowance = 240;
  const b1 = 1400;
  const b2 = 3200;
  const t1 = Math.max(0, Math.min(gross, b1) - allowance) * 0.2;
  const t2 = Math.max(0, Math.min(gross, b2) - b1) * 0.4;
  const t3 = Math.max(0, gross - b2) * 0.45;
  return Math.round(t1 + t2 + t3);
}

export function weeklyPurchaseUpkeep(state: GameState): number {
  return state.finance.purchases.reduce((s, p) => s + p.upkeep, 0);
}

export function weeklyLiving(state: GameState): number {
  const p = userPlayer(state);
  const base = p.contract?.type === 'academy' ? 60 : 140;
  // exact pounds: roundMoney snaps to coarse steps and would turn a £140 week into nothing
  return Math.round(base + weeklyPurchaseUpkeep(state));
}

export interface WeeklySummary {
  gross: number;
  tax: number;
  agent: number;
  living: number;
  net: number;
}

/** Pay every wage week that has fully elapsed. Safe to call every day. */
export function payWagesDue(state: GameState): WeeklySummary[] {
  const f = state.finance;
  const p = userPlayer(state);
  const out: WeeklySummary[] = [];
  let guard = 0;
  while (f.lastWagePaidDay + 7 <= state.day && guard++ < 60) {
    f.lastWagePaidDay += 7;
    const c = p.contract;
    let gross = 0;
    let tax = 0;
    let agent = 0;
    if (c && !p.retired && c.endDay >= f.lastWagePaidDay - 6) {
      gross = c.wage;
      tax = weeklyTax(gross);
      agent = Math.round(gross * (state.transfers.agent.feePct / 100));
      const club = state.clubs[c.clubId]?.shortName ?? 'club';
      const day = f.lastWagePaidDay;
      const saved = state.day;
      state.day = day;
      post(state, 'wage', `Weekly wage from ${club}`, gross);
      f.careerEarnings += gross;
      if (tax) post(state, 'tax', 'Income tax', -tax);
      if (agent) post(state, 'agent_fee', `Agent fee (${state.transfers.agent.feePct}%)`, -agent);
      state.day = saved;
    }
    const living = f.lastLivingDay + 7 <= f.lastWagePaidDay ? weeklyLiving(state) : 0;
    if (living) {
      f.lastLivingDay = f.lastWagePaidDay;
      const saved = state.day;
      state.day = f.lastWagePaidDay;
      post(state, 'living', 'Living costs and upkeep', -living);
      state.day = saved;
    }
    out.push({ gross, tax, agent, living, net: gross - tax - agent - living });
  }
  return out;
}

/** Total of the last `weeks` weekly wage payments (gross) for display. */
export function earningsSince(state: GameState, sinceDay: number): number {
  return state.finance.ledger.filter((e) => e.day >= sinceDay && e.amount > 0).reduce((s, e) => s + e.amount, 0);
}

export function spendingSince(state: GameState, sinceDay: number): number {
  return state.finance.ledger.filter((e) => e.day >= sinceDay && e.amount < 0).reduce((s, e) => s - e.amount, 0);
}

/** AI club finances: baseline weekly income less its actual wage bill. Called once per elapsed week. */
export function clubWeekly(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    const wages = (state.squads[club.id] ?? []).reduce((s, id) => {
      const p = state.players[id];
      if (!p?.contract) return s;
      const share = p.loan ? (p.loan.parentClubId === club.id ? 1 - p.loan.wageSharePct / 100 : p.loan.wageSharePct / 100) : 1;
      return s + p.contract.wage * share;
    }, 0);
    club.balance += Math.round(club.income * 0.8 - wages * 0.98);
    club.balance = Math.max(-club.income * 30, club.balance);
  }
}
