/** Season set-up: creates the leagues, the cup and the calendar for a season from the clubs' current divisions. */
import type { Competition, GameState } from './types';
import type { Rng } from './rng';
import { MATCHDAYS_PER_SEASON, planSeason, type SeasonPlan } from './calendar';
import { createCup, createLeague } from './competitions';

export const LEAGUE_TEMPLATES = [
  { id: 'L1', name: 'Elite Division', short: 'ELT', level: 1 },
  { id: 'L2', name: 'Challenge Division', short: 'CHD', level: 2 },
] as const;

export const CUP_TEMPLATE = { id: 'CUP', name: 'National Cup', short: 'CUP' } as const;

export const compId = (template: string, season: number) => `${template}-${season}`;

/** A major international tournament is held every second summer (June of an even year). */
export const hasTournament = (season: number) => (season + 1) % 2 === 0;

export function getPlan(state: Pick<GameState, 'season'>): SeasonPlan {
  return planSeason(state.season, MATCHDAYS_PER_SEASON, hasTournament(state.season));
}

export function leagueOf(state: GameState, template: string, season = state.season): Competition | undefined {
  return state.competitions[compId(template, season)];
}

export function cupOf(state: GameState, season = state.season): Competition | undefined {
  return state.competitions[compId(CUP_TEMPLATE.id, season)];
}

/** The league the given club plays in this season. */
export function clubLeague(state: GameState, clubId: string | null | undefined, season = state.season): Competition | undefined {
  if (!clubId) return undefined;
  const club = state.clubs[clubId];
  return club ? leagueOf(state, club.leagueId, season) : undefined;
}

export function templateName(template: string): string {
  return LEAGUE_TEMPLATES.find((t) => t.id === template)?.name ?? template;
}

/** Create all competitions and the calendar for `state.season`. Idempotent for a season that already exists. */
export function setupSeason(state: GameState, rng: Rng): SeasonPlan {
  const season = state.season;
  const plan = getPlan(state);
  if (!state.competitions[compId('L1', season)]) {
    for (const t of LEAGUE_TEMPLATES) {
      const clubIds = Object.values(state.clubs).filter((c) => c.leagueId === t.id).map((c) => c.id).sort();
      createLeague(state, {
        id: compId(t.id, season), name: t.name, short: t.short, level: t.level, season, clubIds, matchdayDays: plan.leagueDays,
      }, rng);
    }
    const all = Object.values(state.clubs).map((c) => c.id).sort();
    createCup(state, compId(CUP_TEMPLATE.id, season), CUP_TEMPLATE.name, CUP_TEMPLATE.short, season, all, plan.cupPlan);
  }
  state.calendar = plan.entries;
  state.transfers.windowOpen = plan.summerWindow[0] <= state.day && state.day <= plan.summerWindow[1];
  return plan;
}
