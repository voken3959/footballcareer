import type { GameState, NewsItem, Player } from './types';
import { Rng } from './rng';

/** The career's random stream. Always commit it back so saves reproduce exactly. */
export function rngOf(state: GameState): Rng {
  return new Rng(state.rngState);
}

export function commitRng(state: GameState, rng: Rng): void {
  state.rngState = rng.state;
}

export function uid(state: GameState, prefix: string): string {
  return `${prefix}${(state.nextId++).toString(36)}`;
}

export function userPlayer(state: GameState): Player {
  return state.players[state.userId];
}

export function addNews(
  state: GameState, type: NewsItem['type'], headline: string, body: string, opts: { clubId?: string; important?: boolean } = {},
): NewsItem {
  const item: NewsItem = {
    id: state.nextNewsId++, day: state.day, type, headline, body, clubId: opts.clubId, important: opts.important, read: false,
  };
  state.news.push(item);
  if (state.news.length > 1500) state.news.splice(0, state.news.length - 1500);
  return item;
}

export const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function shortName(p: Player): string {
  return p.displayName;
}

export function fullName(p: Player): string {
  return `${p.firstName} ${p.lastName}`;
}

export function clubName(state: GameState, id: string | null | undefined): string {
  if (!id) return 'Free agent';
  return state.clubs[id]?.name ?? 'Unknown club';
}

export function userClub(state: GameState) {
  const id = state.players[state.userId].clubId;
  return id ? state.clubs[id] : null;
}

/** Players currently at a club (incl. loanees in), excluding retired. */
export function squadPlayers(state: GameState, clubId: string): Player[] {
  return (state.squads[clubId] ?? []).map((id) => state.players[id]).filter((p) => p && !p.retired);
}

export function moveToClub(state: GameState, p: Player, clubId: string | null): void {
  if (p.clubId && state.squads[p.clubId]) {
    state.squads[p.clubId] = state.squads[p.clubId].filter((id) => id !== p.id);
  }
  state.transfers.freeAgentIds = state.transfers.freeAgentIds.filter((id) => id !== p.id);
  p.clubId = clubId;
  if (clubId) {
    if (!state.squads[clubId].includes(p.id)) state.squads[clubId].push(p.id);
  } else if (!p.retired && !state.transfers.freeAgentIds.includes(p.id)) {
    state.transfers.freeAgentIds.push(p.id);
  }
}
