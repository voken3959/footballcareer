import { createCareer, defaultOptions, type NewCareerOptions } from '../src/engine/career';
import { advanceDays, advanceToNextMatch, playUserMatch, resolveDecision, type PlayMode } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/world';
import { slotRating, overall } from '../src/engine/attributes';
import { FORMATIONS } from '../src/engine/formations';
import { dayOf } from '../src/engine/dates';
import { acceptOffer, openOffers } from '../src/engine/transfers';
import type { MatchSideInput } from '../src/engine/match/engine';
import type { Club, GameState, Player } from '../src/engine/types';

export const clone = <T>(s: T): T => JSON.parse(JSON.stringify(s));

export function newCareer(seed = 101, over: Partial<NewCareerOptions> = {}): GameState {
  return createCareer({ ...defaultOptions(seed), ...over });
}

export const user = (s: GameState): Player => s.players[s.userId];

/**
 * Answer every open decision the way a hands-off player would: keep playing when asked about retirement, acknowledge a
 * free-agent notice, and take the cautious last option (usually "decline") for everything else. `pick` can override any kind.
 */
export function dismissDecisions(state: GameState, pick: (kind: string, optionIds: string[]) => string | null = () => null): void {
  for (const d of [...state.decisions]) {
    const ids = d.options.map((o) => o.id);
    const choice = pick(d.kind, ids);
    if (choice) resolveDecision(state, d.id, choice);
    else if (d.kind === 'retirement') resolveDecision(state, d.id, ids.includes('continue') ? 'continue' : ids.includes('continue_abroad') ? 'continue_abroad' : ids[0]);
    else if (d.kind === 'free_agent') resolveDecision(state, d.id, ids[0]);
    else if (ids.length) resolveDecision(state, d.id, ids[ids.length - 1]);
  }
}

/** Deal with whatever has stopped the calendar: answer decisions and, if he has no club, sign the first offer on the table. */
export function autoHandle(state: GameState, pick?: (kind: string, optionIds: string[]) => string | null): void {
  dismissDecisions(state, pick);
  const u = state.players[state.userId];
  if (!u.clubId && !state.career.retired && !state.flags.abroadClub) {
    for (const o of openOffers(state)) if (acceptOffer(state, o.id).ok) break;
  }
}

export interface PlayOutcome {
  played: number;
  stop: string;
  rolled: boolean;
}

/** Play up to `n` of the user's matches (any competition), skipping idle days. Stops early if the career ends. */
export function playMatches(state: GameState, n: number, mode: PlayMode = 'instant'): PlayOutcome {
  let played = 0;
  let rolled = false;
  let stop = 'target';
  let guard = 0;
  while (played < n && guard++ < n * 40 + 400) {
    const r = advanceToNextMatch(state);
    rolled = rolled || r.rolled;
    stop = r.stop;
    if (r.stop === 'match') {
      playUserMatch(state, mode);
      played++;
    } else if (r.stop === 'retired') break;
    else if (r.stop === 'decision') dismissDecisions(state);
  }
  return { played, stop, rolled };
}

/** Advance through the calendar until `season` is reached (or the career ends), playing every user match instantly. */
export function playUntilSeason(state: GameState, season: number, onStop: (state: GameState) => void = autoHandle): void {
  let guard = 0;
  while (state.season < season && !state.career.retired && guard++ < 8000) {
    const r = advanceToNextMatch(state);
    if (r.stop === 'match') playUserMatch(state, 'instant');
    else if (r.stop === 'retired') break;
    else if (r.stop === 'decision' || r.stop === 'offer' || r.stop === 'season_end') onStop(state);
  }
}

export function idleDays(state: GameState, n: number): void {
  let left = n;
  let guard = 0;
  while (left > 0 && guard++ < n + 50) {
    const r = advanceDays(state, left);
    left -= Math.max(1, r.days);
    if (r.stop === 'match') playUserMatch(state, 'instant');
    else if (r.stop === 'retired') return;
    else if (r.stop === 'decision') dismissDecisions(state);
  }
}

/* ------------------------------ a standalone world for match-engine tests ------------------------------ */

export const world = generateWorld(new Rng(11), { next: 1 }, dayOf(2026, 7, 1), 2026);

export function sideFor(club: Club): MatchSideInput {
  const f = FORMATIONS[club.manager.formation];
  const squad = world.squads[club.id].map((id) => world.players[id]);
  const used = new Set<string>();
  const lineup: Player[] = [];
  for (const slot of f.slots) {
    let best: Player | null = null;
    let bs = -1;
    for (const p of squad) {
      if (used.has(p.id)) continue;
      const s = slotRating(p, slot.pos);
      if (s > bs) { bs = s; best = p; }
    }
    used.add(best!.id);
    lineup.push(best!);
  }
  const bench = squad.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a)).slice(0, 7);
  return { clubId: club.id, name: club.name, shortName: club.shortName, formation: club.manager.formation, tactics: club.manager.tactics, lineup, bench, chemistry: club.chemistry, manager: club.manager };
}

export const worldClubs = (): Club[] => Object.values(world.clubs);
