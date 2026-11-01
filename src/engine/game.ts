/**
 * Public game API used by the UI and the tests. All functions mutate the GameState they are given (the store clones before
 * calling when it needs undo) and commit the career random stream so a saved career reproduces exactly.
 */
import type { Fixture, GameState, MatchRecord, Player } from './types';
import { rngOf, commitRng, userPlayer } from './util';
import { getPlan } from './season';
import { beginDay, pendingUserFixture, playOtherClubFixtures, nextUserFixture, type PendingFixture } from './daily';
import { rolloverSeason } from './rollover';
import { onUserMatchPlayed, processTransfersDaily } from './transfers';
import { processLifeDaily, resolveLifeDecision } from './life';
import { resolveRetirementDecision } from './retirement';
import type { ActionResult } from './transfers';
import { playDevMatch, selectionCtx, simulateAndApply, fixtureImportance, fixtureKind } from './matchday';
import { applyNationalFixture, runNationalFixture } from './international';
import { explainSelection, pickMatchSquad, type SquadSelection } from './selection';
import { teamStrength, type TeamStrength } from './match/engine';
import { leagueTable, positionIn } from './competitions';
import { formValue } from './condition';

export type StopReason = 'match' | 'target' | 'offer' | 'decision' | 'retired' | 'season_end';

export interface AdvanceResult {
  days: number;
  stop: StopReason;
  message: string;
  rolled: boolean;
}

const BLOCKING_DECISIONS = new Set(['retirement', 'free_agent']);

function openOfferCount(state: GameState): number {
  return state.transfers.offers.filter((o) => o.status === 'open' || o.status === 'negotiating').length;
}

function stepOneDay(state: GameState): { stop?: StopReason; message?: string; rolled: boolean } {
  const rng = rngOf(state);
  state.day++;
  let rolled = false;
  const plan = getPlan(state);
  const offersBefore = openOfferCount(state);
  const decisionsBefore = state.decisions.length;
  if (state.day === plan.end) {
    rolloverSeason(state, rng);
    rolled = true;
  }
  beginDay(state, rng);
  processTransfersDaily(state, rng);
  processLifeDaily(state, rng);
  const pend = pendingUserFixture(state);
  if (pend) {
    commitRng(state, rng);
    return { stop: 'match', message: describePending(state, pend), rolled };
  }
  playOtherClubFixtures(state);
  commitRng(state, rng);
  if (state.career.retired) return { stop: 'retired', message: 'Your playing career is over.', rolled };
  if (rolled) return { stop: 'season_end', message: 'A new season begins.', rolled };
  if (openOfferCount(state) > offersBefore) return { stop: 'offer', message: 'You have a new offer.', rolled };
  if (state.decisions.length > decisionsBefore && state.decisions.slice(decisionsBefore).some((d) => BLOCKING_DECISIONS.has(d.kind))) {
    return { stop: 'decision', message: 'A decision needs your attention.', rolled };
  }
  return { rolled };
}

function describePending(state: GameState, p: PendingFixture): string {
  const f = p.fixture;
  const name = (id: string) => (p.kind === 'club' ? state.clubs[id]?.name : state.nations[id]?.name) ?? id;
  return `${name(f.homeId)} v ${name(f.awayId)} (${state.competitions[f.compId]?.name ?? ''})`;
}

/** Advance up to `days` days, stopping early at the user's matches, new offers or decisions. */
export function advanceDays(state: GameState, days: number): AdvanceResult {
  if (state.career.retired) return { days: 0, stop: 'retired', message: 'Your career is over.', rolled: false };
  const pend = pendingUserFixture(state);
  if (pend) return { days: 0, stop: 'match', message: `Match day: ${describePending(state, pend)}`, rolled: false };
  let n = 0;
  let rolled = false;
  while (n < days) {
    const r = stepOneDay(state);
    n++;
    rolled = rolled || r.rolled;
    if (r.stop) return { days: n, stop: r.stop, message: r.message ?? '', rolled };
  }
  return { days: n, stop: 'target', message: n === 1 ? 'One day passed.' : `${n} days passed.`, rolled };
}

/** Advance until the user's next match day (or another interruption). */
export function advanceToNextMatch(state: GameState, maxDays = 200): AdvanceResult {
  if (state.career.retired) return { days: 0, stop: 'retired', message: 'Your career is over.', rolled: false };
  const pend = pendingUserFixture(state);
  if (pend) return { days: 0, stop: 'match', message: `Match day: ${describePending(state, pend)}`, rolled: false };
  let n = 0;
  let rolled = false;
  while (n < maxDays) {
    const r = stepOneDay(state);
    n++;
    rolled = rolled || r.rolled;
    if (r.stop) return { days: n, stop: r.stop, message: r.message ?? '', rolled };
  }
  return { days: n, stop: 'target', message: `${n} days passed with no match.`, rolled };
}

export type PlayMode = 'instant' | 'commentary' | 'visual';

export interface PlayResult {
  record: MatchRecord;
  kind: 'club' | 'intl';
  devRecord: MatchRecord | null;
}

/** Play today's fixture for the user. The match is simulated and applied to the world immediately; modes only change how much detail is kept. */
export function playUserMatch(state: GameState, mode: PlayMode): PlayResult | null {
  const pend = pendingUserFixture(state);
  if (!pend) return null;
  const rng = rngOf(state);
  const user = userPlayer(state);
  let record: MatchRecord | null = null;
  let devRecord: MatchRecord | null = null;
  const recordAll = mode !== 'instant';
  if (pend.kind === 'club') {
    const fx = pend.fixture;
    const { run, record: r } = simulateAndApply(state, fx, { recordAll });
    record = r;
    if (fixtureKind(state, fx) === 'league') {
      const side = user.clubId === fx.homeId ? 0 : 1;
      devRecord = playDevMatch(state, fx, run.sides[side].selection);
    }
    playOtherClubFixtures(state);
  } else {
    const run = runNationalFixture(state, pend.fixture, { recordAll });
    record = applyNationalFixture(state, pend.fixture, run);
  }
  commitRng(state, rng);
  if (!record) return null;
  if (pend.kind === 'club') onUserMatchPlayed(state, record);
  return { record, kind: pend.kind, devRecord };
}

/** Answer any pending decision. Dispatches by kind; unknown kinds are simply dismissed. */
export function resolveDecision(state: GameState, decisionId: string, optionId: string): ActionResult {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d) return { ok: false, message: 'That decision is no longer available.' };
  if (d.kind === 'life' || d.kind === 'sponsor') return resolveLifeDecision(state, decisionId, optionId);
  if (d.kind === 'retirement') return resolveRetirementDecision(state, decisionId, optionId);
  state.decisions = state.decisions.filter((x) => x.id !== decisionId);
  return { ok: true, message: 'Understood.' };
}

/* ------------------------------------------------------------------ preview */

export interface MatchPreview {
  pending: PendingFixture;
  homeName: string;
  awayName: string;
  competition: string;
  round: string;
  importance: number;
  userClubSide: 0 | 1 | null;
  selection: SquadSelection | null;
  status: 'start' | 'bench' | 'out' | null;
  reasons: string[];
  strength: [TeamStrength | null, TeamStrength | null];
  table: { home: number; away: number } | null;
  form: { home: ('W' | 'D' | 'L')[]; away: ('W' | 'D' | 'L')[] } | null;
  playerForm: number;
}

export function previewMatch(state: GameState, which?: PendingFixture | null): MatchPreview | null {
  const pending = which ?? pendingUserFixture(state) ?? nextUserFixture(state);
  if (!pending) return null;
  const fx: Fixture = pending.fixture;
  const user = userPlayer(state);
  const comp = state.competitions[fx.compId];
  const isClub = pending.kind === 'club';
  const nm = (id: string) => (isClub ? state.clubs[id]?.name : state.nations[id]?.name) ?? id;
  let selection: SquadSelection | null = null;
  let status: MatchPreview['status'] = null;
  let reasons: string[] = [];
  let side: 0 | 1 | null = null;
  const strength: MatchPreview['strength'] = [null, null];
  if (isClub) {
    side = user.clubId === fx.homeId ? 0 : 1;
    const ctx = selectionCtx(state, fx);
    selection = pickMatchSquad(state, user.clubId as string, ctx);
    const e = explainSelection(state, user.clubId as string, user.id, ctx, selection);
    status = e.status;
    reasons = e.reasons;
    const other = pickMatchSquad(state, side === 0 ? fx.awayId : fx.homeId, ctx);
    const mine = teamStrength(selection.lineup, selection.formation, state.clubs[user.clubId as string].chemistry);
    const theirs = teamStrength(other.lineup, other.formation, state.clubs[side === 0 ? fx.awayId : fx.homeId].chemistry);
    strength[side] = mine;
    strength[1 - side as 0 | 1] = theirs;
  }
  let table: MatchPreview['table'] = null;
  let form: MatchPreview['form'] = null;
  if (isClub && comp.type === 'league') {
    const t = leagueTable(state, comp.id);
    // before the first round is played the table is only alphabetical, so there is no position to report yet
    if (t.some((r) => r.p > 0)) table = { home: positionIn(t, fx.homeId), away: positionIn(t, fx.awayId) };
    form = { home: t.find((r) => r.clubId === fx.homeId)?.form ?? [], away: t.find((r) => r.clubId === fx.awayId)?.form ?? [] };
  }
  return {
    pending, homeName: nm(fx.homeId), awayName: nm(fx.awayId), competition: comp.name, round: fx.round,
    importance: isClub ? fixtureImportance(state, fx) : 0.7, userClubSide: side, selection, status, reasons, strength, table, form,
    playerForm: Math.round(formValue(user)),
  };
}

/** The fixture the user would play next, with how many days away it is. */
export function upcomingFixture(state: GameState): { pending: PendingFixture; inDays: number } | null {
  const pend = pendingUserFixture(state);
  if (pend) return { pending: pend, inDays: 0 };
  const next = nextUserFixture(state);
  return next ? { pending: next, inDays: next.fixture.day - state.day } : null;
}

export function playerById(state: GameState, id: string): Player | undefined {
  return state.players[id];
}
