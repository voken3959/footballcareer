/**
 * Transfers, contracts and the agent.
 *
 * Interest builds in stages (rumour, scouting report, formal offer) from how the player compares with each club's own squad,
 * how visible he is (form, minutes, reputation) and what the club can afford. Offers can be accepted, rejected or negotiated;
 * negotiation outcomes depend on the agent, personality and difficulty. Moves only complete in a transfer window (free
 * transfers, pre-contracts and extensions excepted), the selling club must agree the fee, and every payment goes through the
 * ledger exactly once.
 */
import type {
  Agent, Bonuses, Club, Contract, GameState, MatchRecord, Player, Position, SquadRole, TransferOffer,
} from './types';
import { Rng, clamp, seedFrom } from './rng';
import { ageAt, overall, slotRating } from './attributes';
import { dayOfWeek, formatShort, seasonEndDay } from './dates';
import { addNews, clubName, moveToClub, rngOf, commitRng, squadPlayers, userPlayer } from './util';
import {
  defaultBonuses, effectiveRating, fairWage, marketValue, money, roundMoney, roundWage, transferBudgetFor, yearsLeft,
} from './economy';
import { assessRole, squadOf } from './selection';
import { closeSpell, unlock, addMilestone } from './awards';
import { claim, payOnce, post } from './finance';
import { genContract } from './world';
import { freeShirt } from './world';
import { getPlan } from './season';
import { transferWindowOpenOn } from './calendar';
import { genName } from './playerGen';
import { NATIONS } from './names';
import { formValue } from './condition';

export const STARTERS: Record<Position, number> = { GK: 1, CB: 2, RB: 1, LB: 1, DM: 1, CM: 2, AM: 1, RW: 1, LW: 1, ST: 2 };
const SIGNING_LIMIT = 5;

/* ------------------------------------------------------------------ helpers */

export function difficultyFactors(state: GameState): { wage: number; patience: number; consent: number; interest: number } {
  switch (state.settings.difficulty) {
    case 'casual': return { wage: 1.1, patience: 1, consent: 1.1, interest: 1.25 };
    case 'simulation': return { wage: 0.92, patience: -1, consent: 0.9, interest: 0.8 };
    default: return { wage: 1, patience: 0, consent: 1, interest: 1 };
  }
}

function personalityEdge(p: Player): { wage: number; patience: number } {
  switch (p.personality) {
    case 'charismatic': return { wage: 0.03, patience: 1 };
    case 'ambitious': return { wage: 0.02, patience: 0 };
    case 'professional': return { wage: 0.01, patience: 1 };
    case 'reserved': return { wage: -0.02, patience: 0 };
    case 'loyal': return { wage: -0.01, patience: 1 };
    case 'risk-taking': return { wage: 0.015, patience: -1 };
    default: return { wage: 0, patience: 0 };
  }
}

export function wageBill(state: GameState, clubId: string): number {
  return (state.squads[clubId] ?? []).reduce((s, id) => s + (state.players[id]?.contract?.wage ?? 0), 0);
}

export function wageRoom(state: GameState, clubId: string): number {
  return state.clubs[clubId].wageBudget - wageBill(state, clubId);
}

/** How visible the player is to scouts (0.3 .. 1.5). */
export function visibility(state: GameState): number {
  const p = userPlayer(state);
  const apps = (p.stats.league?.apps ?? 0) + (p.stats.cup?.apps ?? 0) + (p.stats.dev?.apps ?? 0) * 0.3;
  const recent = Math.min(1, p.recentRatings.length / 5);
  return clamp(0.35 + Math.min(0.45, apps / 25) + p.reputation / 200 + recent * 0.1 + state.reputation.media / 400, 0.3, 1.5);
}

export interface Appeal { eff: number; form: number; vis: number; raw: number }

export function userAppeal(state: GameState): Appeal {
  const p = userPlayer(state);
  const age = ageAt(p.birthDay, state.day);
  const raw = effectiveRating(overall(p), p.potential, age);
  const ratings = p.recentRatings.slice(-5);
  const form = ratings.length >= 3 ? clamp((ratings.reduce((a, b) => a + b, 0) / ratings.length - 6.4) * 2.6, -2.5, 4.5) : 0;
  const goals = p.position === 'ST' || p.position === 'AM' || p.position === 'RW' || p.position === 'LW' ? Math.min(2, ((p.stats.league?.goals ?? 0) + (p.stats.cup?.goals ?? 0)) / 6) : 0;
  return { raw, form: form + goals, eff: raw + form + goals, vis: visibility(state) };
}

/** Rating a player needs to be a starter at a club in his position. */
export function clubNeedLevel(state: GameState, clubId: string, p: Player): number {
  const sq = squadOf(state, clubId).filter((x) => x.id !== p.id && (x.position === p.position || x.secondary === p.position));
  const rated = sq.map((x) => slotRating(x, p.position)).sort((a, b) => b - a);
  const n = STARTERS[p.position];
  return rated[n - 1] ?? rated[rated.length - 1] ?? 40;
}

function clubCanFund(state: GameState, club: Club, fee: number, wage: number): boolean {
  return club.transferBudget >= fee && wageRoom(state, club.id) >= wage * 0.9 && club.signingsThisWindow < SIGNING_LIMIT;
}

function offerTerms(state: GameState, rng: Rng, club: Club, p: Player, role: SquadRole): { wage: number; max: number; years: number; minYears: number; maxYears: number; bonuses: Bonuses; signing: number } {
  const age = ageAt(p.birthDay, state.day);
  const f = difficultyFactors(state);
  const form = formValue(p);
  const formMul = clamp(0.95 + (form - 50) / 500, 0.9, 1.1);
  const roleMul = role === 'Key player' ? 1.12 : role === 'Regular starter' ? 1.05 : role === 'Fringe player' || role === 'Youth prospect' ? 0.92 : 1;
  const base = fairWage(overall(p), p.potential, age, club.reputation, p.reputation) * roleMul * formMul;
  let wage = roundWage(base * rng.range(0.88, 1.04) * (1 + (f.wage - 1) * 0.5));
  const room = wageRoom(state, club.id);
  wage = Math.min(wage, Math.floor(room * 0.95));
  const max = roundWage(Math.min(wage * rng.range(1.12, 1.32) * f.wage, room * 0.98));
  const years = age <= 21 ? rng.int(3, 5) : age <= 28 ? rng.int(3, 4) : age <= 31 ? rng.int(2, 3) : rng.int(1, 2);
  const maxYears = age >= 32 ? 2 : age >= 29 ? 4 : 5;
  const bonuses = defaultBonuses(wage, role);
  const signing = roundWage(wage * rng.range(2, 6));
  return { wage, max: Math.max(max, wage), years, minYears: 1, maxYears, bonuses: { ...bonuses, signing, signingPaid: false }, signing };
}

function pushLog(o: TransferOffer, state: GameState, by: 'club' | 'you' | 'agent', text: string): void {
  (o.log ||= []).push({ day: state.day, by, text });
}

/** The club the user has promised to join when his contract ends, if he has agreed a pre-contract. */
export function preContractClub(state: GameState): Club | null {
  const id = state.flags.preContractOffer;
  if (typeof id !== 'string') return null;
  const o = state.transfers.offers.find((x) => x.id === id);
  return o ? state.clubs[o.fromClubId] ?? null : null;
}

export function openOffers(state: GameState): TransferOffer[] {
  return state.transfers.offers.filter((o) => o.status === 'open' || o.status === 'negotiating');
}

function windowEnd(state: GameState): number {
  const plan = getPlan(state);
  const d = state.day;
  if (d >= plan.summerWindow[0] && d <= plan.summerWindow[1]) return plan.summerWindow[1];
  if (d >= plan.winterWindow[0] && d <= plan.winterWindow[1]) return plan.winterWindow[1];
  return d + 7;
}

export function windowInfo(state: GameState): { open: boolean; label: string; closesIn: number | null; opensIn: number | null } {
  const plan = getPlan(state);
  const d = state.day;
  const open = transferWindowOpenOn(plan, d);
  if (open) return { open, label: d <= plan.summerWindow[1] ? 'Summer window' : 'January window', closesIn: windowEnd(state) - d, opensIn: null };
  const nexts = [plan.summerWindow[0], plan.winterWindow[0]].filter((x) => x > d);
  const next = nexts.length ? Math.min(...nexts) : seasonEndDay(state.season) + 1;
  return { open, label: 'Window closed', closesIn: null, opensIn: next - d };
}

/* --------------------------------------------------------------- creating offers */

function valuationBySeller(state: GameState, p: Player, sellerId: string): number {
  const role = state.career.squadRole;
  const mult = role === 'Key player' ? 1.3 : role === 'Regular starter' ? 1.12 : role === 'Important player' ? 1.0 : role === 'Rotation option' ? 0.92 : 0.82;
  const req = typeof state.flags.transferRequest === 'number' && state.day - state.flags.transferRequest < 90 ? 0.85 : 1;
  const contractLeft = p.contract ? clamp(yearsLeft(p.contract, state.day) / 2.5, 0.5, 1) : 1;
  return marketValue(p, state.day) * mult * req * (0.85 + 0.15 * contractLeft);
}

function reasonText(state: GameState, club: Club, p: Player, role: SquadRole, starterName: string | null): string {
  const need = clubNeedLevel(state, club.id, p);
  const eff = Math.round(slotRating(p, p.position));
  const parts: string[] = [];
  if (starterName) parts.push(`Their best ${p.position} option is ${starterName} (rated about ${Math.round(need)}); you are ${eff >= need ? 'already at that level' : 'close to it'}.`);
  if (p.recentRatings.length >= 3) {
    const avg = p.recentRatings.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, p.recentRatings.length);
    if (avg >= 6.8) parts.push(`Scouts liked your recent form (average rating ${avg.toFixed(1)}).`);
  }
  if (ageAt(p.birthDay, state.day) <= 21 && p.potential - overall(p) >= 8) parts.push('They see a high ceiling in you.');
  parts.push(`Projected role: ${role.toLowerCase()}.`);
  return parts.join(' ');
}

function newOfferBase(state: GameState, kind: TransferOffer['kind'], club: Club): Pick<TransferOffer, 'id' | 'kind' | 'fromClubId' | 'createdDay' | 'status' | 'log'> {
  return { id: `o${state.transfers.nextOfferId++}`, kind, fromClubId: club.id, createdDay: state.day, status: 'open', log: [] };
}

export function createPermanentOffer(state: GameState, rng: Rng, club: Club, opts: { viaClause?: boolean; agentFound?: boolean } = {}): TransferOffer | null {
  const user = userPlayer(state);
  if (!user.clubId || user.loan || club.id === user.clubId || preContractClub(state)) return null;
  const f = difficultyFactors(state);
  const value = marketValue(user, state.day);
  const clause = user.contract?.releaseClause ?? null;
  let fee = roundMoney(value * rng.range(0.82, 1.15));
  // a club bids what it can afford: it opens at no more than its budget and has to raise the bid if the seller wants more
  if (!opts.viaClause) fee = Math.min(fee, roundMoney(club.transferBudget * 0.97));
  if (opts.viaClause && clause) fee = clause;
  if (fee < value * 0.45) return null;
  const role = assessRole(state, club, user, state.day);
  const terms = offerTerms(state, rng, club, user, role.role);
  if (terms.wage < 150 || !clubCanFund(state, club, fee, terms.wage)) return null;
  const seller = valuationBySeller(state, user, user.clubId);
  const floor = seller * 0.97 * (2 - f.consent);
  // a club only bids when it could pay what the selling club will actually accept; a bid that can never be raised that far
  // would just be withdrawn a few days later and the player could never complete a transfer for a fee
  if (!opts.viaClause && club.transferBudget < floor * 1.03) return null;
  const agreed = !!opts.viaClause || fee >= floor;
  const eo = openOffers(state).find((o) => o.fromClubId === club.id && o.kind === 'permanent');
  if (eo) return null;
  const o: TransferOffer = {
    ...newOfferBase(state, 'permanent', club), fee, sellerAgreed: agreed, wage: terms.wage, years: terms.years, role: role.role, bonuses: terms.bonuses,
    releaseClause: null, signingBonus: terms.signing, expiresDay: Math.min(state.day + 12, windowEnd(state)), status: agreed ? 'open' : 'negotiating',
    patience: clamp(3 + difficultyFactors(state).patience + personalityEdge(user).patience + Math.floor(state.transfers.agent.quality / 8), 1, 6),
    note: agreed ? `${club.name} have agreed a fee with ${clubName(state, user.clubId)}.` : `${club.name} have made a bid of ${money(fee)}. ${clubName(state, user.clubId)} have not yet agreed.`,
    maxWage: terms.max, minYears: terms.minYears, maxYears: terms.maxYears, reason: reasonText(state, club, user, role.role, role.starterName), projectedRole: role.role, bidRounds: 0,
  };
  pushLog(o, state, 'club', `Opening offer: ${money(terms.wage)} a week for ${terms.years} years, fee ${money(fee)}.`);
  if (opts.agentFound) pushLog(o, state, 'agent', 'Your agent made the introduction.');
  state.transfers.offers.push(o);
  state.transfers.history.push({ day: state.day, text: `${club.name} bid ${money(fee)} for you`, offerId: o.id, result: o.status });
  addNews(state, 'transfer', `${club.name} make an offer for ${user.displayName}`,
    `${club.name} have bid ${money(fee)} for ${user.firstName} ${user.lastName} and offered personal terms of ${money(terms.wage)} a week.`, { clubId: club.id, important: true });
  return o;
}

export function createFreeOffer(state: GameState, rng: Rng, club: Club, pre = false): TransferOffer | null {
  const user = userPlayer(state);
  if (club.id === user.clubId || preContractClub(state)) return null;
  const role = assessRole(state, club, user, state.day);
  const terms = offerTerms(state, rng, club, user, role.role);
  if (terms.wage < 120) return null;
  if (openOffers(state).some((o) => o.fromClubId === club.id && (o.kind === 'free'))) return null;
  const startDay = pre ? (user.contract?.endDay ?? state.day) + 1 : state.day;
  const o: TransferOffer = {
    ...newOfferBase(state, 'free', club), fee: 0, sellerAgreed: true, wage: terms.wage, years: terms.years, role: role.role, bonuses: terms.bonuses, releaseClause: null,
    signingBonus: terms.signing, expiresDay: state.day + (pre ? 30 : 14), patience: clamp(3 + personalityEdge(user).patience + difficultyFactors(state).patience, 1, 5),
    note: pre ? `${club.name} offer you a pre-contract. You would join on ${formatShort(startDay)} when your deal ends.` : `${club.name} offer you a free transfer.`,
    maxWage: terms.max, minYears: terms.minYears, maxYears: terms.maxYears, preContract: pre || undefined, startDay, reason: reasonText(state, club, user, role.role, role.starterName),
    projectedRole: role.role,
  };
  pushLog(o, state, 'club', `Offer: ${money(terms.wage)} a week for ${terms.years} years${pre ? ' (pre-contract)' : ''}.`);
  state.transfers.offers.push(o);
  addNews(state, 'transfer', `${club.name} ${pre ? 'offer a pre-contract to' : 'make a move for'} ${user.displayName}`, o.note, { clubId: club.id, important: true });
  return o;
}

export function createLoanOffer(state: GameState, rng: Rng, club: Club): TransferOffer | null {
  const user = userPlayer(state);
  if (!user.clubId || user.loan || club.id === user.clubId || preContractClub(state)) return null;
  if (openOffers(state).some((o) => o.fromClubId === club.id && o.kind === 'loan')) return null;
  const role = assessRole(state, club, user, state.day);
  const end = seasonEndDay(state.season);
  const wage = user.contract?.wage ?? 0;
  const o: TransferOffer = {
    ...newOfferBase(state, 'loan', club), fee: 0, sellerAgreed: true, wage, years: 0, role: role.role, bonuses: user.contract?.bonuses ?? defaultBonuses(wage, role.role),
    releaseClause: null, signingBonus: 0, expiresDay: Math.min(state.day + 12, windowEnd(state)), patience: 2, maxWage: wage, minYears: 0, maxYears: 0, loanEndDay: end,
    note: `${club.name} want you on loan until the end of the season. Your contract at ${clubName(state, user.clubId)} stays in place.`,
    reason: reasonText(state, club, user, role.role, role.starterName), projectedRole: role.role,
  };
  pushLog(o, state, 'club', `Loan offer until ${formatShort(end)}. You would be ${role.role.toLowerCase()}.`);
  state.transfers.offers.push(o);
  return o;
}

export function createExtensionOffer(state: GameState, rng: Rng): TransferOffer | null {
  const user = userPlayer(state);
  const c = user.contract;
  if (!user.clubId || !c || user.loan || preContractClub(state)) return null;
  if (openOffers(state).some((o) => o.kind === 'extension')) return null;
  const club = state.clubs[user.clubId];
  const role = assessRole(state, club, user, state.day);
  const terms = offerTerms(state, rng, club, user, role.role);
  const wage = Math.max(terms.wage, Math.round(c.wage * 1.02));
  const room = wageRoom(state, club.id) + c.wage;
  if (wage > room) return null;
  const o: TransferOffer = {
    ...newOfferBase(state, 'extension', club), fee: 0, sellerAgreed: true, wage, years: terms.years, role: role.role, bonuses: { ...terms.bonuses, loyalty: roundWage(wage * 3) },
    releaseClause: null, signingBonus: roundWage(terms.signing * 0.6), expiresDay: state.day + 30,
    patience: clamp(3 + personalityEdge(user).patience + difficultyFactors(state).patience, 1, 5), maxWage: Math.min(Math.max(terms.max, wage), room),
    minYears: 1, maxYears: terms.maxYears, note: `${club.name} want to extend your contract (it runs to ${formatShort(c.endDay)}).`,
    reason: `The club rates you as ${role.role.toLowerCase()} and wants to secure your future.`, projectedRole: role.role,
  };
  pushLog(o, state, 'club', `Offer: ${money(wage)} a week for ${terms.years} years.`);
  state.transfers.offers.push(o);
  addNews(state, 'contract', `${club.name} offer ${user.displayName} a new contract`, o.note, { clubId: club.id, important: true });
  return o;
}

/* ----------------------------------------------------------------- interest */

interface Cand { club: Club; gap: number; fit: number }

/**
 * Clubs that could plausibly want the player: he would improve their side, they could pay for him (or his contract is
 * nearly up) and the move is not a big step down in standing. The best fits come first.
 */
function candidates(state: GameState, user: Player): Cand[] {
  const app = userAppeal(state);
  const value = marketValue(user, state.day);
  const myRep = user.clubId ? state.clubs[user.clubId].reputation : 30;
  const nearlyFree = !user.clubId || (!!user.contract && yearsLeft(user.contract, state.day) <= 0.5);
  const wantsOut = typeof state.flags.transferRequest === 'number' && state.day - state.flags.transferRequest < 90;
  const out: Cand[] = [];
  for (const club of Object.values(state.clubs)) {
    if (club.id === user.clubId) continue;
    const gap = app.eff - clubNeedLevel(state, club.id, user);
    const step = club.reputation - myRep;
    if (gap < -3 || (step < -10 && !wantsOut)) continue;
    if (!nearlyFree && club.transferBudget < value * 0.45) continue;
    out.push({ club, gap, fit: Math.min(gap, 10) + clamp(step, -15, 15) * 0.25 });
  }
  return out.sort((a, b) => b.fit - a.fit);
}

function bumpInterest(state: GameState, rng: Rng, user: Player, club: Club, gap: number, windowOpen: boolean, preAllowed: boolean): void {
  const existing = state.transfers.rumours.find((r) => r.clubId === club.id && state.day - r.day < 70);
  if (!existing) {
    state.transfers.rumours.push({ day: state.day, clubId: club.id, strength: 1 });
    addNews(state, 'rumour', `${club.name} linked with ${user.displayName}`, `Reports suggest ${club.name} have been watching ${user.firstName} ${user.lastName}. Nothing has been confirmed.`, { clubId: club.id });
    return;
  }
  if (existing.strength === 1) {
    existing.strength = 2;
    existing.day = state.day;
    const summary = `Scouts from ${club.name} watched you in recent matches. They rate you highly${gap >= 4 ? ' and could move soon' : ''}.`;
    state.transfers.scoutReports.push({ day: state.day, clubId: club.id, summary });
    addNews(state, 'rumour', `${club.name} scouts watch ${user.displayName}`, summary, { clubId: club.id });
    return;
  }
  // stage three: a formal approach
  if (preAllowed && user.contract && yearsLeft(user.contract, state.day) <= 0.5) {
    if (createFreeOffer(state, rng, club, true)) existing.strength = 3;
    return;
  }
  if (windowOpen) {
    const clause = user.contract?.releaseClause;
    const viaClause = !!clause && club.transferBudget >= clause && gap >= 2;
    if (createPermanentOffer(state, rng, club, { viaClause })) existing.strength = 3;
  }
}

/** Weekly scan: which clubs take an interest, and how far that interest goes. */
export function scanInterest(state: GameState, rng: Rng, boost = 1): void {
  const user = userPlayer(state);
  if (!user.clubId || user.retired || user.loan || preContractClub(state)) return;
  const f = difficultyFactors(state);
  const app = userAppeal(state);
  const open = state.transfers.windowOpen;
  const plan = getPlan(state);
  const preAllowed = state.day >= plan.winterWindow[0];
  const cands = candidates(state, user).slice(0, 8);
  const req = typeof state.flags.transferRequest === 'number' && state.day - state.flags.transferRequest < 90 ? 1.3 : 1;
  for (const { club, gap } of cands) {
    const p = 0.1 * app.vis * clamp((gap + 3) / 7, 0, 1.6) * (0.75 + club.ambition * 0.5) * f.interest * req * boost * (open ? 1 : 0.7);
    if (rng.next() < p) bumpInterest(state, rng, user, club, gap, open, preAllowed);
  }
  state.transfers.lastInterestDay = state.day;
}

/** Young players who are not playing attract loan offers from clubs where they would get minutes. */
export function scanLoanInterest(state: GameState, rng: Rng): void {
  const user = userPlayer(state);
  if (!user.clubId || user.loan || !state.transfers.windowOpen) return;
  const age = ageAt(user.birthDay, state.day);
  const role = state.career.squadRole;
  const sidelined = role === 'Youth prospect' || role === 'Fringe player' || (role === 'Rotation option' && age <= 21);
  if (age > 23 || !sidelined) return;
  if (openOffers(state).some((o) => o.kind === 'loan')) return;
  if (!rng.chance(0.22 * difficultyFactors(state).interest)) return;
  const club = state.clubs[user.clubId];
  const app = userAppeal(state);
  const options = Object.values(state.clubs)
    .filter((c) => c.id !== user.clubId && c.reputation <= club.reputation + 6 && wageRoom(state, c.id) > 0)
    .map((c) => ({ c, gap: app.raw - clubNeedLevel(state, c.id, user) }))
    .filter((x) => x.gap >= 1)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  if (!options.length) return;
  const pick = options[Math.floor(rng.next() * options.length)];
  const o = createLoanOffer(state, rng, pick.c);
  if (o) addNews(state, 'transfer', `${pick.c.name} want ${user.displayName} on loan`, o.note, { clubId: pick.c.id });
}

/** Called after each of the user's matches: a strong display can make a club act sooner. */
export function onUserMatchPlayed(state: GameState, rec: MatchRecord): void {
  const s = rec.userSummary;
  if (!s || rec.isDev || s.minutes < 30) return;
  const strong = (s.rating ?? 0) >= 7.8 || s.goals >= 2;
  if (!strong) return;
  const rng = rngOf(state);
  scanInterest(state, rng, 2.4);
  commitRng(state, rng);
}

/* ------------------------------------------------------------- daily process */

/** A club with a live bid or free-transfer offer in for the player keeps its money and wage room for him. */
function committedToUser(state: GameState, clubId: string): boolean {
  return state.transfers.offers.some((o) => o.fromClubId === clubId && (o.status === 'open' || o.status === 'negotiating') && (o.kind === 'permanent' || o.kind === 'free'));
}

/** Whether the club behind a live offer can still pay for it (budgets and wage bills are reset at each rollover). */
function offerStillFunded(state: GameState, o: TransferOffer): boolean {
  if ((o.kind !== 'permanent' && o.kind !== 'free') || o.preContract) return true;
  const club = state.clubs[o.fromClubId];
  if (!club) return false;
  return (o.kind !== 'permanent' || club.transferBudget >= o.fee) && wageRoom(state, club.id) >= o.wage * 0.9;
}

function expireOffers(state: GameState): void {
  for (const o of state.transfers.offers) {
    if (o.status !== 'open' && o.status !== 'negotiating') continue;
    if (o.expiresDay < state.day) {
      o.status = 'expired';
      pushLog(o, state, 'club', 'The offer has expired.');
      state.transfers.history.push({ day: state.day, text: `Offer from ${clubName(state, o.fromClubId)} expired`, offerId: o.id, result: 'expired' });
    } else if (!offerStillFunded(state, o)) {
      o.status = 'withdrawn';
      o.note = `${clubName(state, o.fromClubId)} have pulled out: they can no longer afford the deal.`;
      pushLog(o, state, 'club', 'The club withdrew because it can no longer afford the deal.');
      state.transfers.history.push({ day: state.day, text: `${clubName(state, o.fromClubId)} withdrew their offer`, offerId: o.id, result: 'withdrawn' });
    }
  }
  if (state.transfers.offers.length > 60) {
    const live = (o: TransferOffer) => o.status === 'open' || o.status === 'negotiating' || o.id === state.flags.preContractOffer;
    state.transfers.offers = state.transfers.offers.filter(live).concat(state.transfers.offers.filter((o) => !live(o)).slice(-30));
  }
}

function progressBids(state: GameState, rng: Rng): void {
  const user = userPlayer(state);
  for (const o of state.transfers.offers) {
    if (o.status !== 'negotiating' || o.kind !== 'permanent') continue;
    if (state.day - o.createdDay < 1 || (state.day - o.createdDay) % 2 !== 0) continue;
    const club = state.clubs[o.fromClubId];
    const f = difficultyFactors(state);
    o.bidRounds = (o.bidRounds ?? 0) + 1;
    const seller = valuationBySeller(state, user, user.clubId ?? '');
    let raise = roundMoney(o.fee * rng.range(1.05, 1.1));
    if (raise > club.transferBudget) raise = Math.floor(club.transferBudget * 0.99); // bid everything the club has before giving up
    if (raise <= o.fee || o.bidRounds > 5) {
      o.status = 'withdrawn';
      o.note = `${club.name} have walked away: ${clubName(state, user.clubId)} would not sell at their price.`;
      pushLog(o, state, 'club', 'The bid was withdrawn.');
      continue;
    }
    o.fee = raise;
    pushLog(o, state, 'club', `Raised the bid to ${money(raise)}.`);
    if (raise >= seller * 0.97 * (2 - f.consent)) {
      o.sellerAgreed = true;
      o.status = 'open';
      o.note = `${clubName(state, user.clubId)} accepted a bid of ${money(raise)} from ${club.name}.`;
      addNews(state, 'transfer', `${club.name} agree a fee for ${user.displayName}`, o.note, { clubId: club.id, important: true });
      pushLog(o, state, 'club', 'Fee agreed with your club. Personal terms are up to you.');
    }
  }
}

function freeAgentOffers(state: GameState, rng: Rng): void {
  const user = userPlayer(state);
  if (user.clubId || user.retired || state.flags.abroadClub) return;
  if (openOffers(state).length >= 2) return;
  const daysFree = state.day - (state.flags.freeSince as number ?? state.day);
  if (state.day % 2 !== 0 && daysFree > 3) return;
  const app = userAppeal(state);
  const all = Object.values(state.clubs).map((club) => ({ club, gap: app.eff - clubNeedLevel(state, club.id, user) })).sort((a, b) => b.gap - a.gap);
  // the longer you wait, the lower the bar for a club to make an offer; after a week someone always will
  const slack = 2 + daysFree * 1.2;
  const pool = all.filter((x) => x.gap >= -slack && wageRoom(state, x.club.id) > 200).slice(0, 10);
  const pick = pool.length ? pool[Math.floor(rng.next() * Math.min(pool.length, 5))] : null;
  if (pick) createFreeOffer(state, rng, pick.club, false);
  else if (daysFree >= 10) {
    const any = all.filter((x) => wageRoom(state, x.club.id) > 100).slice(-8);
    if (any.length) createFreeOffer(state, rng, rng.pick(any).club, false);
  }
}

function extensionCheck(state: GameState, rng: Rng): void {
  const user = userPlayer(state);
  const c = user.contract;
  if (!c || user.loan || !user.clubId) return;
  const last = (state.flags.lastExtensionOffer as number) ?? -999;
  if (state.day - last < 100) return;
  const left = yearsLeft(c, state.day);
  if (left > 1.4) return;
  const role = state.career.squadRole;
  const age = ageAt(user.birthDay, state.day);
  const valued = role === 'Key player' || role === 'Regular starter' || role === 'Important player' || (age <= 21 && user.potential - overall(user) >= 6 && state.career.managerTrust >= 40);
  if (!valued && !(role === 'Rotation option' && rng.chance(0.4))) return;
  if (createExtensionOffer(state, rng)) state.flags.lastExtensionOffer = state.day;
}

function loanReturns(state: GameState): void {
  const user = userPlayer(state);
  if (user.loan && state.day >= user.loan.endDay) {
    const parent = state.clubs[user.loan.parentClubId];
    closeSpell(state, false);
    user.loan = null;
    if (parent) {
      moveToClub(state, user, parent.id);
      addNews(state, 'transfer', `${user.displayName} returns from loan`, `Your loan spell has ended and you are back at ${parent.name}.`, { clubId: parent.id });
    }
  }
}

/* ------------------------------------------------------------- AI transfers */

function aiMarket(state: GameState, rng: Rng): void {
  const clubs = Object.values(state.clubs).filter((c) => c.signingsThisWindow < SIGNING_LIMIT && !committedToUser(state, c.id));
  const attempts = 6; // per day while a window is open: enough that a season has a few dozen moves between the other clubs
  for (let a = 0; a < attempts; a++) {
    const club = rng.pick(clubs);
    if (!club) return;
    const squad = squadOf(state, club.id);
    if (squad.length >= 33) continue;
    const poss = Object.keys(STARTERS) as Position[];
    const pos = rng.pick(poss);
    const starters = squad.filter((p) => p.position === pos).map((p) => overall(p)).sort((x, y) => y - x);
    const level = starters[STARTERS[pos] - 1] ?? 40;
    // free agent first
    const fa = state.transfers.freeAgentIds.map((id) => state.players[id]).filter((p) => p && p.id !== state.userId && p.position === pos && !p.retired && overall(p) >= level - 3)
      .sort((x, y) => overall(y) - overall(x))[0];
    if (fa && rng.chance(0.6)) {
      const age = ageAt(fa.birthDay, state.day);
      const contract = genContract(rng, fa, club, state.day, state.season, age);
      if (contract.wage <= wageRoom(state, club.id)) {
        moveToClub(state, fa, club.id);
        fa.contract = { ...contract, startDay: state.day, id: `c${fa.id}-${state.day}` };
        fa.shirt = freeShirt(squadOf(state, club.id).filter((x) => x.id !== fa.id), 0);
        club.signingsThisWindow++;
        if (club.id === userPlayer(state).clubId || overall(fa) >= 62) addNews(state, 'transfer', `${club.name} sign ${fa.displayName}`, `${fa.firstName} ${fa.lastName} (${fa.position}, ${age}) joins ${club.name} on a free transfer.`, { clubId: club.id });
        continue;
      }
    }
    if (!rng.chance(0.35)) continue;
    // buy from another club
    const sellers = Object.values(state.clubs).filter((c) => c.id !== club.id);
    const seller = rng.pick(sellers);
    const sellerSquad = squadOf(state, seller.id);
    if (sellerSquad.length <= 25) continue;
    const target = sellerSquad.filter((p) => p.id !== state.userId && p.position === pos && overall(p) >= level + 1 && overall(p) <= level + 7 && ageAt(p.birthDay, state.day) <= 31)
      .sort((x, y) => overall(y) - overall(x))[0];
    if (!target || !target.contract) continue;
    const peers = sellerSquad.filter((p) => p.position === pos).length;
    if (peers <= STARTERS[pos]) continue;
    const fee = roundMoney(marketValue(target, state.day) * rng.range(0.9, 1.25));
    const wage = roundWage(target.contract.wage * rng.range(1.0, 1.2));
    if (!clubCanFund(state, club, fee, wage) || !rng.chance(0.55)) continue;
    const age = ageAt(target.birthDay, state.day);
    club.balance -= fee; club.transferBudget = Math.max(0, club.transferBudget - fee);
    seller.balance += fee; seller.transferBudget += Math.round(fee * 0.5);
    moveToClub(state, target, club.id);
    target.contract = { ...genContract(rng, target, club, state.day, state.season, age), wage, startDay: state.day, id: `c${target.id}-${state.day}` };
    target.shirt = freeShirt(squadOf(state, club.id).filter((x) => x.id !== target.id), 0);
    club.signingsThisWindow++;
    seller.signingsThisWindow++;
    state.transfers.marketNews.push({ day: state.day, text: `${club.name} sign ${target.displayName} from ${seller.name} for ${money(fee)}` });
    if (state.transfers.marketNews.length > 80) state.transfers.marketNews.shift();
    if (fee >= 400000 || club.id === userPlayer(state).clubId || seller.id === userPlayer(state).clubId) {
      addNews(state, 'transfer', `${target.displayName} joins ${club.name} for ${money(fee)}`, `${seller.name} sell ${target.firstName} ${target.lastName} (${target.position}, ${age}) to ${club.name}.`, { clubId: club.id });
    }
  }
}

export function processTransfersDaily(state: GameState, rng: Rng): void {
  const user = userPlayer(state);
  if (state.career.retired) return;
  expireOffers(state);
  loanReturns(state);
  if (!user.clubId && state.flags.freeSince === undefined && !state.flags.abroadClub) state.flags.freeSince = state.day;
  if (user.clubId && state.flags.freeSince !== undefined) delete state.flags.freeSince;
  progressBids(state, rng);
  if (!user.clubId) freeAgentOffers(state, rng);
  if (dayOfWeek(state.day) === 1) {
    scanInterest(state, rng);
    scanLoanInterest(state, rng);
    extensionCheck(state, rng);
  }
  if (state.transfers.windowOpen) aiMarket(state, rng);
  const plan = getPlan(state);
  if (state.day === plan.summerWindow[0] || state.day === plan.winterWindow[0]) {
    for (const c of Object.values(state.clubs)) {
      c.signingsThisWindow = 0;
      // the January window gets a smaller top-up than the summer budget set at rollover
      if (state.day === plan.winterWindow[0]) {
        const sv = squadOf(state, c.id).reduce((s, p) => s + marketValue(p, state.day), 0);
        c.transferBudget += Math.round(transferBudgetFor(c.balance, sv, c.reputation) * 0.35);
      }
    }
  }
  state.transfers.rumours = state.transfers.rumours.filter((r) => state.day - r.day < 120).slice(-30);
  state.transfers.scoutReports = state.transfers.scoutReports.slice(-30);
  if (state.transfers.history.length > 120) state.transfers.history.splice(0, state.transfers.history.length - 120);
}

/* ------------------------------------------------------------- user actions */

export interface ActionResult { ok: boolean; message: string }

export interface Proposal {
  wage: number;
  years: number;
  appearance: number;
  goal: number;
  cleanSheet: number;
  signingBonus: number;
  loyalty: number;
  releaseClause: number | null;
}

export function proposalOf(o: TransferOffer): Proposal {
  return {
    wage: o.wage, years: o.years, appearance: o.bonuses.appearance, goal: o.bonuses.goal, cleanSheet: o.bonuses.cleanSheet,
    signingBonus: o.signingBonus, loyalty: o.bonuses.loyalty, releaseClause: o.releaseClause,
  };
}

/** Weekly-equivalent cost of a package to the club. */
export function packageCost(pr: Proposal): number {
  const yrs = Math.max(1, pr.years);
  return pr.wage + pr.appearance * 0.8 + pr.goal * 0.25 + pr.cleanSheet * 0.15 + (pr.signingBonus + pr.loyalty) / (yrs * 52);
}

export interface NegotiationOutcome extends ActionResult {
  status: 'accepted' | 'countered' | 'rejected' | 'withdrawn';
  offer: TransferOffer;
}

function agentEdge(state: GameState): number {
  return 1 + state.transfers.agent.quality * 0.0035 + (state.transfers.agent.relationship - 50) * 0.0004;
}

export function negotiationCeiling(state: GameState, o: TransferOffer): number {
  const user = userPlayer(state);
  return packageCost({ ...proposalOf(o), wage: o.maxWage, appearance: o.bonuses.appearance, goal: o.bonuses.goal, cleanSheet: o.bonuses.cleanSheet })
    * agentEdge(state) * (1 + personalityEdge(user).wage) * difficultyFactors(state).wage;
}

export function negotiateOffer(state: GameState, offerId: string, proposal: Proposal): NegotiationOutcome | ActionResult {
  const o = state.transfers.offers.find((x) => x.id === offerId);
  if (!o || (o.status !== 'open' && o.status !== 'negotiating')) return { ok: false, message: 'That offer is no longer available.' };
  if (o.kind === 'loan') return { ok: false, message: 'Loan terms are set by the clubs and cannot be negotiated.' };
  const user = userPlayer(state);
  const pr: Proposal = {
    ...proposal,
    wage: Math.max(0, Math.round(proposal.wage)), years: clamp(Math.round(proposal.years), o.minYears, o.maxYears),
    signingBonus: Math.max(0, Math.round(proposal.signingBonus)), loyalty: Math.max(0, Math.round(proposal.loyalty)),
  };
  const notes: string[] = [];
  const value = marketValue(user, state.day);
  if (pr.releaseClause !== null && pr.releaseClause < value * 1.6) {
    pr.releaseClause = null;
    notes.push('They will not accept a release clause that low.');
  }
  const asked = packageCost(pr);
  const initial = packageCost({ ...proposalOf(o), wage: o.wage });
  const ceiling = negotiationCeiling(state, o);
  pushLog(o, state, 'you', `Proposal: ${money(pr.wage)} a week for ${pr.years} years, signing bonus ${money(pr.signingBonus)}.`);
  const apply = (p: Proposal) => {
    o.wage = p.wage; o.years = p.years; o.signingBonus = p.signingBonus; o.releaseClause = p.releaseClause;
    o.bonuses = { ...o.bonuses, appearance: p.appearance, goal: p.goal, cleanSheet: p.cleanSheet, loyalty: p.loyalty, signing: p.signingBonus, signingPaid: false };
  };
  const fresh = (status: NegotiationOutcome['status'], message: string): NegotiationOutcome => ({ ok: status === 'accepted' || status === 'countered', status, message, offer: o });
  if (asked <= initial * 1.001) {
    apply(pr);
    pushLog(o, state, 'club', `Agreed. ${notes.join(' ')}`.trim());
    o.note = 'Terms agreed. You can accept the deal.';
    return fresh('accepted', `${clubName(state, o.fromClubId)} accept your terms. ${notes.join(' ')}`.trim());
  }
  if (asked <= ceiling * 0.96) {
    apply(pr);
    pushLog(o, state, 'club', 'Agreed to your terms.');
    o.note = 'Terms agreed. You can accept the deal.';
    return fresh('accepted', `${clubName(state, o.fromClubId)} agree to your terms. ${notes.join(' ')}`.trim());
  }
  if (asked <= ceiling * 1.07 && o.patience > 0) {
    o.patience--;
    const mid = (asked + Math.min(ceiling * 0.96, asked)) / 2;
    const scale = clamp(mid / asked, 0.85, 1);
    const counter: Proposal = {
      ...pr, wage: roundWage(pr.wage * scale), appearance: roundWage(pr.appearance * scale), goal: roundWage(pr.goal * scale),
      cleanSheet: roundWage(pr.cleanSheet * scale), signingBonus: roundWage(pr.signingBonus * scale), loyalty: roundWage(pr.loyalty * scale),
    };
    apply(counter);
    pushLog(o, state, 'club', `Counter-offer: ${money(counter.wage)} a week. ${notes.join(' ')}`.trim());
    o.note = 'The club has made a counter-offer.';
    return fresh('countered', `They come back with ${money(counter.wage)} a week. ${notes.join(' ')} (patience: ${o.patience})`.trim());
  }
  o.patience--;
  if (o.patience <= 0) {
    o.status = 'withdrawn';
    pushLog(o, state, 'club', 'Talks have broken down and the offer is withdrawn.');
    state.transfers.history.push({ day: state.day, text: `Talks with ${clubName(state, o.fromClubId)} broke down`, offerId: o.id, result: 'failed' });
    addNews(state, 'transfer', `${clubName(state, o.fromClubId)} walk away from ${user.displayName}`, 'Contract talks broke down over personal terms.', { clubId: o.fromClubId });
    return fresh('withdrawn', `${clubName(state, o.fromClubId)} are not prepared to go that high and have ended the talks.`);
  }
  pushLog(o, state, 'club', 'Rejected: the demands are too high.');
  return fresh('rejected', `${clubName(state, o.fromClubId)} rejected that. Try something closer to their offer. (patience: ${o.patience})`);
}

export function rejectOffer(state: GameState, offerId: string): ActionResult {
  const o = state.transfers.offers.find((x) => x.id === offerId);
  if (!o || (o.status !== 'open' && o.status !== 'negotiating')) return { ok: false, message: 'That offer is no longer available.' };
  o.status = 'rejected';
  pushLog(o, state, 'you', 'You turned the offer down.');
  state.transfers.history.push({ day: state.day, text: `You rejected ${clubName(state, o.fromClubId)}`, offerId: o.id, result: 'rejected' });
  if (o.kind === 'permanent' || o.kind === 'free') {
    const r = state.transfers.rumours.find((x) => x.clubId === o.fromClubId);
    if (r) r.day = state.day - 40;
  }
  return { ok: true, message: `You turned down ${clubName(state, o.fromClubId)}.` };
}

/**
 * Contracts run to 30 June. A deal of N years signed during season S covers seasons S .. S+N-1, so it ends on
 * seasonEndDay(S + N - 1). An extension never shortens a deal that already runs longer.
 */
function contractFromOffer(state: GameState, o: TransferOffer, clubId: string, start: number, season = state.season): Contract {
  let endDay = seasonEndDay(season + o.years - 1);
  const current = state.players[state.userId].contract;
  if (o.kind === 'extension' && current) endDay = Math.max(endDay, current.endDay);
  return {
    id: `c${state.userId}-${o.id}`, clubId, wage: o.wage, startDay: start, endDay, role: o.projectedRole ?? o.role,
    bonuses: { ...o.bonuses, signing: o.signingBonus, signingPaid: true }, releaseClause: o.releaseClause, type: 'professional',
  };
}

export function acceptOffer(state: GameState, offerId: string): ActionResult {
  const o = state.transfers.offers.find((x) => x.id === offerId);
  const user = userPlayer(state);
  if (!o || (o.status !== 'open' && o.status !== 'negotiating')) return { ok: false, message: 'That offer is no longer available.' };
  if (o.status === 'negotiating' || !o.sellerAgreed) return { ok: false, message: `${clubName(state, o.fromClubId)} have not yet agreed a fee with ${clubName(state, user.clubId)}.` };
  const club = state.clubs[o.fromClubId];
  if (o.expiresDay < state.day) { o.status = 'expired'; return { ok: false, message: 'The offer has expired.' }; }
  const bound = preContractClub(state);
  if (bound && user.clubId) {
    return { ok: false, message: `You have already agreed to join ${bound.name} when your contract ends, so you cannot agree another move.` };
  }
  if ((o.kind === 'permanent' || o.kind === 'loan') && !state.transfers.windowOpen) return { ok: false, message: 'The transfer window is closed. The move cannot be completed now.' };

  if (o.kind === 'extension') {
    const old = user.contract;
    const contract = contractFromOffer(state, o, club.id, state.day);
    user.contract = contract;
    payOnce(state, `sign:${contract.id}`, 'signing_bonus', `Signing bonus: new contract at ${club.name}`, o.signingBonus);
    state.finance.careerEarnings += 0;
    o.status = 'accepted';
    state.career.contracts.push({ day: state.day, clubId: club.id, wage: o.wage, years: o.years, role: contract.role, kind: 'extended' });
    unlock(state, 'first_extension');
    addMilestone(state, `ext:${o.id}`, `New contract at ${club.name}`, `${money(o.wage)} a week until ${formatShort(contract.endDay)}.`, 'contract');
    addNews(state, 'contract', `${user.displayName} signs a new contract at ${club.name}`, `${money(o.wage)} a week for ${o.years} more years.${old ? ` The previous deal paid ${money(old.wage)}.` : ''}`, { clubId: club.id, important: true });
    state.transfers.history.push({ day: state.day, text: `Signed a new contract at ${club.name}`, offerId: o.id, result: 'accepted' });
    state.transfers.agent.relationship = clamp(state.transfers.agent.relationship + 2, 0, 100);
    return { ok: true, message: `You signed a new contract with ${club.name}.` };
  }

  if (o.kind === 'loan') {
    const parent = user.clubId as string;
    closeSpell(state, false);
    user.loan = { parentClubId: parent, endDay: o.loanEndDay ?? seasonEndDay(state.season), wageSharePct: 100 };
    moveToClub(state, user, club.id);
    user.shirt = freeShirt(squadOf(state, club.id).filter((x) => x.id !== user.id), user.shirt);
    o.status = 'accepted';
    state.career.transfers.push({ day: state.day, season: state.season, fromClubId: parent, toClubId: club.id, fee: 0, kind: 'loan' });
    state.career.clubSpellStart[club.id] = state.day;
    unlock(state, 'first_transfer', `Loaned to ${club.name} from ${clubName(state, parent)}.`);
    addNews(state, 'transfer', `${user.displayName} joins ${club.name} on loan`, `The move runs until ${formatShort(user.loan.endDay)}.`, { clubId: club.id, important: true });
    state.transfers.history.push({ day: state.day, text: `Joined ${club.name} on loan`, offerId: o.id, result: 'accepted' });
    afterMove(state, club, o);
    return { ok: true, message: `You joined ${club.name} on loan until ${formatShort(user.loan.endDay)}.` };
  }

  if (o.kind === 'free' && o.preContract) {
    state.flags.preContractOffer = o.id;
    o.status = 'accepted';
    for (const x of openOffers(state)) { if (x.id !== o.id && x.kind !== 'extension') { x.status = 'withdrawn'; pushLog(x, state, 'club', 'Withdrawn: you agreed a pre-contract elsewhere.'); } }
    addNews(state, 'transfer', `${user.displayName} agrees a pre-contract with ${club.name}`, `You will join ${club.name} when your contract at ${clubName(state, user.clubId)} ends.`, { clubId: club.id, important: true });
    state.transfers.history.push({ day: state.day, text: `Agreed a pre-contract with ${club.name}`, offerId: o.id, result: 'accepted' });
    return { ok: true, message: `Pre-contract agreed. You will join ${club.name} when your current deal ends.` };
  }

  // permanent or free transfer, effective now
  if (o.kind === 'permanent' && !clubCanFund(state, club, o.fee, o.wage)) {
    o.status = 'withdrawn';
    return { ok: false, message: `${club.name} can no longer afford the deal.` };
  }
  return completeMove(state, o, club);
}

function completeMove(state: GameState, o: TransferOffer, club: Club): ActionResult {
  const user = userPlayer(state);
  const from = user.clubId;
  closeSpell(state, false);
  if (from && o.fee > 0) {
    const seller = state.clubs[from];
    club.balance -= o.fee; club.transferBudget = Math.max(0, club.transferBudget - o.fee);
    seller.balance += o.fee; seller.transferBudget += Math.round(o.fee * 0.5);
  }
  user.loan = null;
  moveToClub(state, user, club.id);
  const contract = contractFromOffer(state, o, club.id, state.day);
  user.contract = contract;
  user.shirt = freeShirt(squadOf(state, club.id).filter((x) => x.id !== user.id), user.shirt);
  o.status = 'accepted';
  payOnce(state, `sign:${contract.id}`, 'signing_bonus', `Signing bonus: ${club.name}`, o.signingBonus);
  if (o.signingBonus > 0) {
    const fee = Math.round(o.signingBonus * (state.transfers.agent.feePct / 100));
    if (fee > 0 && claim(state, `agentfee:${contract.id}`)) post(state, 'agent_fee', 'Agent commission on signing bonus', -fee);
  }
  state.career.transfers.push({ day: state.day, season: state.season, fromClubId: from, toClubId: club.id, fee: o.fee, kind: o.kind === 'free' ? 'free' : 'permanent' });
  state.career.contracts.push({ day: state.day, clubId: club.id, wage: o.wage, years: o.years, role: contract.role, kind: 'signed' });
  state.career.clubSpellStart[club.id] = state.day;
  unlock(state, 'first_transfer', `Joined ${club.name}${from ? ` from ${clubName(state, from)}` : ''}${o.fee > 0 ? ` for ${money(o.fee)}` : ' on a free transfer'}.`);
  addMilestone(state, `move:${o.id}`, `Signed for ${club.name}`, `${o.fee > 0 ? `Fee ${money(o.fee)}. ` : ''}${money(o.wage)} a week for ${o.years} years.`, 'transfer');
  addNews(state, 'transfer', `${user.displayName} joins ${club.name}`,
    `${club.name} complete the signing of ${user.firstName} ${user.lastName}${from ? ` from ${clubName(state, from)}` : ''} ${o.fee > 0 ? `for ${money(o.fee)}` : 'on a free transfer'}. He signs for ${o.years} years on ${money(o.wage)} a week.`,
    { clubId: club.id, important: true });
  state.transfers.history.push({ day: state.day, text: `Signed for ${club.name}${o.fee > 0 ? ` (${money(o.fee)})` : ''}`, offerId: o.id, result: 'accepted' });
  club.signingsThisWindow++;
  if (from) state.clubs[from].signingsThisWindow++;
  afterMove(state, club, o);
  return { ok: true, message: `You signed for ${club.name}.` };
}

function afterMove(state: GameState, club: Club, accepted: TransferOffer): void {
  const user = userPlayer(state);
  for (const x of openOffers(state)) {
    if (x.id !== accepted.id) { x.status = 'withdrawn'; pushLog(x, state, 'club', 'Withdrawn after you agreed a move.'); }
  }
  delete state.flags.transferRequest;
  delete state.flags.reducedRole;
  state.career.managerTrust = 50;
  // a fresh start: the new club's fans and staff do not know you yet
  state.reputation.club = Math.min(state.reputation.club, 25);
  state.career.trainingPerformance = clamp(state.career.trainingPerformance, 45, 60);
  user.cond.morale = clamp(user.cond.morale + 6, 5, 100);
  user.cond.confidence = clamp(user.cond.confidence + 3, 5, 100);
  state.career.squadRole = assessRole(state, club, user, state.day).role;
  const mgr = state.relationships.find((r) => r.kind === 'manager');
  if (mgr) { mgr.name = club.manager.name; mgr.value = 50; mgr.note = 'A new manager who will judge you on what he sees.'; }
  // teammates from the old club drift out of daily contact; meet new ones
  const mates = squadPlayers(state, club.id).filter((p) => p.id !== user.id);
  state.relationships = state.relationships.filter((r) => r.kind !== 'teammate');
  const mentor = [...mates].sort((a, b) => ageAt(b.birthDay, state.day) - ageAt(a.birthDay, state.day))[0];
  const peer = mates.filter((p) => p.position === user.position).sort((a, b) => overall(b) - overall(a))[0] ?? mates[0];
  if (mentor) state.relationships.push({ id: 'rel_mentor', name: mentor.displayName, kind: 'teammate', value: 45, note: 'The senior pro in the dressing room.', playerId: mentor.id });
  if (peer && peer.id !== mentor?.id) state.relationships.push({ id: 'rel_peer', name: peer.displayName, kind: 'teammate', value: 45, note: 'Your main rival for a place in the side.', playerId: peer.id });
  state.career.squadRole = assessRole(state, club, user, state.day).role;
}

/**
 * Called by the season rollover when the user's contract has expired and a pre-contract was agreed.
 * `newSeason` is the season that is just starting (state.season has not advanced yet at that point of the rollover).
 */
export function completePreContract(state: GameState, newSeason: number): boolean {
  const id = state.flags.preContractOffer;
  if (typeof id !== 'string') return false;
  const o = state.transfers.offers.find((x) => x.id === id);
  delete state.flags.preContractOffer;
  if (!o) return false;
  const club = state.clubs[o.fromClubId];
  const user = userPlayer(state);
  const contract = contractFromOffer(state, o, club.id, state.day, newSeason);
  moveToClub(state, user, club.id);
  user.contract = contract;
  user.shirt = freeShirt(squadOf(state, club.id).filter((x) => x.id !== user.id), user.shirt);
  payOnce(state, `sign:${contract.id}`, 'signing_bonus', `Signing bonus: ${club.name}`, o.signingBonus);
  state.career.transfers.push({ day: state.day, season: state.season, fromClubId: null, toClubId: club.id, fee: 0, kind: 'free' });
  state.career.contracts.push({ day: state.day, clubId: club.id, wage: o.wage, years: o.years, role: contract.role, kind: 'signed' });
  state.career.clubSpellStart[club.id] = state.day;
  unlock(state, 'first_transfer', `Joined ${club.name} on a pre-contract.`);
  addNews(state, 'transfer', `${user.displayName} joins ${club.name}`, `The pre-contract agreed earlier takes effect: ${money(o.wage)} a week for ${o.years} years.`, { clubId: club.id, important: true });
  afterMove(state, club, o);
  return true;
}

/* ---------------------------------------------------------- user-triggered asks */

export function requestExtension(state: GameState): ActionResult {
  const user = userPlayer(state);
  if (!user.contract || !user.clubId) return { ok: false, message: 'You have no contract to extend.' };
  if (user.loan) return { ok: false, message: 'You are on loan. Talk to your parent club when you return.' };
  const bound = preContractClub(state);
  if (bound) return { ok: false, message: `You have agreed to join ${bound.name} when your contract ends, so ${state.clubs[user.clubId].name} will not talk about a new deal.` };
  const last = (state.flags.lastExtensionAsk as number) ?? -999;
  if (state.day - last < 45) return { ok: false, message: 'You asked recently. The club asks you to wait before raising it again.' };
  state.flags.lastExtensionAsk = state.day;
  const club = state.clubs[user.clubId];
  const role = state.career.squadRole;
  const age = ageAt(user.birthDay, state.day);
  const left = yearsLeft(user.contract, state.day);
  if (openOffers(state).some((o) => o.kind === 'extension')) return { ok: false, message: 'There is already an extension offer waiting for you.' };
  const willing = role === 'Key player' || role === 'Regular starter' || role === 'Important player'
    || (age <= 21 && user.potential - overall(user) >= 6 && state.career.managerTrust >= 40)
    || (role === 'Rotation option' && state.career.managerTrust >= 55);
  if (!willing) {
    state.career.managerTrust = clamp(state.career.managerTrust - 1, 0, 100);
    return { ok: false, message: `${club.name} are not ready to offer a new deal yet. ${club.manager.name} wants to see more from you (${role.toLowerCase()}).` };
  }
  if (left > 3.2) return { ok: false, message: 'Your contract has plenty of time left. The club does not see the need to renegotiate yet.' };
  const rng = rngOf(state);
  const o = createExtensionOffer(state, rng);
  commitRng(state, rng);
  if (!o) return { ok: false, message: `${club.name} cannot afford to improve your terms at the moment.` };
  return { ok: true, message: `${club.name} have made an offer. Review it in Transfers.` };
}

export function requestTransfer(state: GameState): ActionResult {
  const user = userPlayer(state);
  if (!user.clubId) return { ok: false, message: 'You have no club.' };
  if (typeof state.flags.transferRequest === 'number') return { ok: false, message: 'You have already asked to leave.' };
  state.flags.transferRequest = state.day;
  user.cond.morale = clamp(user.cond.morale - 3, 5, 100);
  state.career.managerTrust = clamp(state.career.managerTrust - 8, 0, 100);
  const mgr = state.relationships.find((r) => r.kind === 'manager');
  if (mgr) mgr.value = clamp(mgr.value - 10, 0, 100);
  addNews(state, 'club', `${user.displayName} wants to leave ${clubName(state, user.clubId)}`, 'The player has asked to be allowed to move on. The club will consider offers.', { clubId: user.clubId, important: true });
  return { ok: true, message: 'Your transfer request is in. Clubs will find it easier to sign you, but the manager is not pleased.' };
}

export function withdrawTransferRequest(state: GameState): ActionResult {
  if (typeof state.flags.transferRequest !== 'number') return { ok: false, message: 'You have not asked to leave.' };
  delete state.flags.transferRequest;
  state.career.managerTrust = clamp(state.career.managerTrust + 2, 0, 100);
  return { ok: true, message: 'You withdrew your transfer request.' };
}

/* ---------------------------------------------------------------- the agent */

export function agentWageAdvice(state: GameState): { fair: number; low: number; high: number; current: number; value: number; yearsLeft: number; comment: string } {
  const user = userPlayer(state);
  const age = ageAt(user.birthDay, state.day);
  const rep = user.clubId ? state.clubs[user.clubId].reputation : 50;
  const fair = fairWage(overall(user), user.potential, age, rep, user.reputation);
  const acc = 0.06 + (20 - state.transfers.agent.quality) * 0.008;
  const noise = ((seedFrom(state.seed, 'advice', state.day) % 1000) / 1000 - 0.5) * 2 * acc;
  const est = fair * (1 + noise * 0.5);
  const current = user.contract?.wage ?? 0;
  const comment = current === 0 ? 'You are between clubs, so expect clubs to start low.'
    : current < est * 0.85 ? 'You are underpaid for your level. A new deal should bring a rise.'
      : current > est * 1.15 ? 'You are already paid above your market rate. Do not expect a big rise.' : 'Your wage is about right for your level.';
  return { fair: roundWage(est), low: roundWage(est * (1 - acc)), high: roundWage(est * (1 + acc)), current, value: marketValue(user, state.day), yearsLeft: yearsLeft(user.contract, state.day), comment };
}

export interface ClubFit { club: Club; projectedRole: SquadRole; gap: number; estWage: number; chance: number; reason: string; division: number }

export function agentRecommendations(state: GameState, count = 6): ClubFit[] {
  const user = userPlayer(state);
  const app = userAppeal(state);
  const q = state.transfers.agent.quality;
  const out: ClubFit[] = [];
  for (const club of Object.values(state.clubs)) {
    if (club.id === user.clubId) continue;
    const gap = app.eff - clubNeedLevel(state, club.id, user);
    const role = assessRole(state, club, user, state.day);
    const rep = user.clubId ? state.clubs[user.clubId].reputation : 40;
    const step = club.reputation - rep;
    const chance = clamp(0.4 + gap * 0.07 - Math.max(0, step) * 0.004 + q * 0.01, 0.03, 0.92);
    // the agent weighs playing time and progression, not just prestige
    out.push({
      club, projectedRole: role.role, gap, estWage: roundWage(fairWage(overall(user), user.potential, ageAt(user.birthDay, state.day), club.reputation, user.reputation)),
      chance, division: club.division,
      reason: role.role === 'Key player' || role.role === 'Regular starter' ? 'You would likely start there.' : step > 12 ? 'A step up, but game time is far from certain.' : role.note,
    });
  }
  return out.sort((a, b) => (b.chance * 40 + (b.projectedRole === 'Key player' ? 12 : b.projectedRole === 'Regular starter' ? 8 : b.projectedRole === 'Important player' ? 4 : 0) + b.club.reputation * 0.08)
    - (a.chance * 40 + (a.projectedRole === 'Key player' ? 12 : a.projectedRole === 'Regular starter' ? 8 : a.projectedRole === 'Important player' ? 4 : 0) + a.club.reputation * 0.08)).slice(0, count);
}

/** The agent canvasses clubs. Interested clubs make contact; in a window they may bid straight away. */
export function agentCanvass(state: GameState): ActionResult & { lines: string[] } {
  const user = userPlayer(state);
  const agent = state.transfers.agent;
  const wait = 21 - Math.floor(agent.quality / 4);
  if (state.day - agent.lastCanvassDay < wait) return { ok: false, message: `${agent.name} has only just made calls. Give it ${wait - (state.day - agent.lastCanvassDay)} more days.`, lines: [] };
  agent.lastCanvassDay = state.day;
  const rng = rngOf(state);
  const reach = 3 + Math.floor(agent.quality / 3);
  const recs = agentRecommendations(state, reach);
  const lines: string[] = [];
  let made = 0;
  for (const r of recs) {
    if (rng.next() < r.chance) {
      const existing = state.transfers.rumours.find((x) => x.clubId === r.club.id);
      if (existing) existing.strength = Math.max(existing.strength, 2); else state.transfers.rumours.push({ day: state.day, clubId: r.club.id, strength: 2 });
      state.transfers.scoutReports.push({ day: state.day, clubId: r.club.id, summary: `${r.club.name} asked about you after a call from ${agent.name}.` });
      if (!user.clubId) { if (createFreeOffer(state, rng, r.club, false)) { made++; lines.push(`${r.club.name} made an offer.`); continue; } }
      else if (state.transfers.windowOpen && !user.loan) { if (createPermanentOffer(state, rng, r.club, { agentFound: true })) { made++; lines.push(`${r.club.name} made a bid.`); continue; } }
      lines.push(`${r.club.name} are interested${state.transfers.windowOpen ? '' : ' and will move when the window opens'}.`);
    } else lines.push(`${r.club.name} passed for now.`);
  }
  commitRng(state, rng);
  agent.relationship = clamp(agent.relationship + 1, 0, 100);
  return { ok: true, message: made ? `${agent.name} found ${made} offer${made === 1 ? '' : 's'}.` : `${agent.name} made the calls. See the report below.`, lines };
}

export function requestLoan(state: GameState): ActionResult {
  const user = userPlayer(state);
  if (!user.clubId || user.loan) return { ok: false, message: user.loan ? 'You are already on loan.' : 'You have no club.' };
  if (!state.transfers.windowOpen) return { ok: false, message: 'Loans can only be arranged while the transfer window is open.' };
  const club = state.clubs[user.clubId];
  const age = ageAt(user.birthDay, state.day);
  const role = state.career.squadRole;
  const willing = (role === 'Youth prospect' || role === 'Fringe player' || (role === 'Rotation option' && age <= 22)) && (age <= 23);
  if (!willing) return { ok: false, message: `${club.name} want to keep you in the squad. A loan is not on the table (${role.toLowerCase()}).` };
  const rng = rngOf(state);
  const app = userAppeal(state);
  const options = Object.values(state.clubs).filter((c) => c.id !== user.clubId && c.reputation <= club.reputation + 6)
    .map((c) => ({ c, gap: app.eff - clubNeedLevel(state, c.id, user) })).filter((x) => x.gap >= 1).sort((a, b) => b.gap - a.gap).slice(0, 6);
  let made = 0;
  for (const x of options) {
    if (made >= 2) break;
    if (rng.next() < 0.35 + state.transfers.agent.quality * 0.02 && createLoanOffer(state, rng, x.c)) made++;
  }
  commitRng(state, rng);
  return made ? { ok: true, message: `${state.transfers.agent.name} found ${made} loan option${made === 1 ? '' : 's'}.` } : { ok: false, message: 'No club has a loan offer that suits you right now.' };
}

export function agentCandidates(state: GameState): (Agent & { cost: string })[] {
  const out: (Agent & { cost: string })[] = [];
  const day = state.day;
  for (let i = 0; i < 3; i++) {
    const r = new Rng(seedFrom(state.seed, 'agents', Math.floor(day / 60), i));
    const quality = [r.int(4, 8), r.int(9, 13), r.int(14, 19)][i];
    const nat = NATIONS[r.int(0, NATIONS.length - 1)].code;
    const n = genName(r, r.chance(0.7) ? 'ENG' : nat);
    const fee = [3, 5, 8][i];
    out.push({ id: `agent-${Math.floor(day / 60)}-${i}`, name: `${n.first[0]}. ${n.last}`, quality, feePct: fee, relationship: 50, hiredDay: day, lastCanvassDay: day - 60, cost: `${fee}% of wages` });
  }
  return out;
}

export function hireAgent(state: GameState, id: string): ActionResult {
  const c = agentCandidates(state).find((a) => a.id === id);
  if (!c) return { ok: false, message: 'That agent is no longer available.' };
  if (state.transfers.agent.id === c.id) return { ok: false, message: 'He already represents you.' };
  const { cost, ...agent } = c;
  state.transfers.agent = agent;
  const rel = state.relationships.find((r) => r.kind === 'agent');
  if (rel) { rel.name = agent.name; rel.value = agent.relationship; }
  addNews(state, 'life', `${userPlayer(state).displayName} appoints ${agent.name} as agent`, `The new representative takes ${agent.feePct}% of wages.`, {});
  return { ok: true, message: `${agent.name} is now your agent (${agent.feePct}% of your wages).` };
}
