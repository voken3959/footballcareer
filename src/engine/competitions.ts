/**
 * Reusable competition formats: double round-robin leagues, single/two-legged knockout cups, standings and
 * qualification helpers. All state lives in GameState (fixtures, competitions); tables are derived from results so they
 * can never drift out of sync with the fixture list.
 */
import type { Competition, CupRound, CupTie, Fixture, FixtureResult, GameState, MatchResult, TableRow } from './types';
import { Rng } from './rng';

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;

export interface Pairing { home: string; away: string }

/** Circle-method double round robin. Every pair meets exactly twice, once at each ground. */
export function doubleRoundRobin(ids: readonly string[], rng: Rng): Pairing[][] {
  const arr: (string | null)[] = rng.shuffle(ids);
  if (arr.length % 2 === 1) arr.push(null);
  const n = arr.length;
  const first: Pairing[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Pairing[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null || b === null) continue;
      const flip = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      round.push(flip ? { home: b, away: a } : { home: a, away: b });
    }
    first.push(round);
    arr.splice(1, 0, arr.pop() as string | null);
  }
  const second = first.map((rd) => rd.map((p) => ({ home: p.away, away: p.home })));
  return [...first, ...second];
}

export interface LeagueSpec {
  id: string;
  name: string;
  short: string;
  level: number;
  season: number;
  clubIds: string[];
  matchdayDays: number[];
}

export function createLeague(state: GameState, spec: LeagueSpec, rng: Rng): Competition {
  const rounds = doubleRoundRobin(spec.clubIds, rng);
  const fixtureIds: string[] = [];
  rounds.forEach((round, md) => {
    round.forEach((pair, k) => {
      const id = `${spec.id}:${md + 1}:${k}`;
      const fx: Fixture = {
        id, compId: spec.id, round: `Matchday ${md + 1}`, matchday: md + 1, day: spec.matchdayDays[md],
        homeId: pair.home, awayId: pair.away, played: false,
      };
      state.fixtures[id] = fx;
      fixtureIds.push(id);
    });
  });
  const comp: Competition = {
    id: spec.id, name: spec.name, short: spec.short, type: 'league', season: spec.season, level: spec.level,
    clubIds: [...spec.clubIds], fixtureIds, completed: false,
    format: `${spec.clubIds.length} clubs, double round-robin (${rounds.length} matchdays). 3 points for a win, 1 for a draw.`,
  };
  state.competitions[spec.id] = comp;
  return comp;
}

/* ------------------------------ tables ------------------------------ */

function emptyRow(clubId: string): TableRow {
  return { clubId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] };
}

/** Standings for a set of fixtures. Tie-breakers: points, goal difference, goals scored, head-to-head points, name. */
export function computeTable(clubIds: readonly string[], fixtures: readonly Fixture[], nameOf?: (id: string) => string): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const id of clubIds) rows.set(id, emptyRow(id));
  const played = fixtures.filter((f) => f.played && f.result).sort((a, b) => a.day - b.day);
  for (const f of played) {
    const h = rows.get(f.homeId);
    const a = rows.get(f.awayId);
    if (!h || !a) continue;
    const { hg, ag } = f.result as FixtureResult;
    h.p++; a.p++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += POINTS_WIN; h.form.push('W'); a.form.push('L'); }
    else if (hg < ag) { a.w++; h.l++; a.pts += POINTS_WIN; h.form.push('L'); a.form.push('W'); }
    else { h.d++; a.d++; h.pts += POINTS_DRAW; a.pts += POINTS_DRAW; h.form.push('D'); a.form.push('D'); }
  }
  const list = [...rows.values()];
  for (const r of list) { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); }
  const h2h = (ids: string[]): Map<string, number> => {
    const pts = new Map<string, number>(ids.map((i) => [i, 0]));
    for (const f of played) {
      if (!ids.includes(f.homeId) || !ids.includes(f.awayId)) continue;
      const { hg, ag } = f.result as FixtureResult;
      if (hg > ag) pts.set(f.homeId, (pts.get(f.homeId) ?? 0) + 3);
      else if (ag > hg) pts.set(f.awayId, (pts.get(f.awayId) ?? 0) + 3);
      else { pts.set(f.homeId, (pts.get(f.homeId) ?? 0) + 1); pts.set(f.awayId, (pts.get(f.awayId) ?? 0) + 1); }
    }
    return pts;
  };
  list.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.clubId.localeCompare(b.clubId));
  // head-to-head among clubs level on points, goal difference and goals scored
  let i = 0;
  while (i < list.length) {
    let j = i + 1;
    while (j < list.length && list[j].pts === list[i].pts && list[j].gd === list[i].gd && list[j].gf === list[i].gf) j++;
    if (j - i > 1) {
      const group = list.slice(i, j);
      const pts = h2h(group.map((g) => g.clubId));
      group.sort((a, b) => (pts.get(b.clubId) ?? 0) - (pts.get(a.clubId) ?? 0)
        || (nameOf ? nameOf(a.clubId).localeCompare(nameOf(b.clubId)) : a.clubId.localeCompare(b.clubId)));
      list.splice(i, j - i, ...group);
    }
    i = j;
  }
  return list;
}

export function competitionFixtures(state: GameState, compId: string): Fixture[] {
  const c = state.competitions[compId];
  return c ? c.fixtureIds.map((id) => state.fixtures[id]).filter(Boolean) : [];
}

export function leagueTable(state: GameState, compId: string): TableRow[] {
  const c = state.competitions[compId];
  if (!c) return [];
  return computeTable(c.clubIds, competitionFixtures(state, compId), (id) => state.clubs[id]?.name ?? id);
}

export function positionIn(table: TableRow[], clubId: string): number {
  const i = table.findIndex((r) => r.clubId === clubId);
  return i < 0 ? 0 : i + 1;
}

/* -------------------------------- cups -------------------------------- */

export interface CupRoundPlan { name: string; legs: 1 | 2; day: number; day2?: number; drawDay: number }

export function createCup(
  state: GameState, id: string, name: string, short: string, season: number, clubIds: string[], plan: CupRoundPlan[],
): Competition {
  const comp: Competition = {
    id, name, short, type: 'cup', season, level: 0, clubIds: [...clubIds], fixtureIds: [], completed: false,
    format: 'Single-leg knockout rounds with a two-legged semi-final. Extra time then penalties settle every tie.',
    rounds: plan.map((p): CupRound => ({ name: p.name, legs: p.legs, day: p.day, day2: p.day2, ties: [], drawn: false, completed: false })),
  };
  state.competitions[id] = comp;
  return comp;
}

export function cupRoundParticipants(state: GameState, comp: Competition, roundIdx: number): string[] {
  const rounds = comp.rounds as CupRound[];
  if (roundIdx === 0) return [...comp.clubIds];
  const prev = rounds[roundIdx - 1];
  return prev.ties.map((t) => t.winner as string);
}

/** Draw a round: pair remaining clubs at random (seeded), creating the ties and their fixtures. */
export function drawCupRound(state: GameState, comp: Competition, roundIdx: number, rng: Rng): CupRound {
  const rounds = comp.rounds as CupRound[];
  const round = rounds[roundIdx];
  if (round.drawn) return round;
  const teams = rng.shuffle(cupRoundParticipants(state, comp, roundIdx));
  const isFinal = roundIdx === rounds.length - 1;
  const ties: CupTie[] = [];
  if (teams.length % 2 === 1) {
    // the highest-reputation club in an odd round receives a bye
    teams.sort((a, b) => (state.clubs[b]?.reputation ?? 0) - (state.clubs[a]?.reputation ?? 0));
    const bye = teams.shift() as string;
    ties.push({ id: `${comp.id}:r${roundIdx + 1}:bye`, a: bye, b: null, fixtureIds: [], winner: bye, decidedBy: 'bye' });
  }
  for (let i = 0; i < teams.length; i += 2) {
    const a = teams[i];
    const b = teams[i + 1];
    const tid = `${comp.id}:r${roundIdx + 1}:t${i / 2 + 1}`;
    const tie: CupTie = { id: tid, a, b, fixtureIds: [] };
    const mk = (suffix: string, home: string, away: string, day: number, leg: 1 | 2 | undefined, knockout: boolean): void => {
      const fid = `${tid}${suffix}`;
      state.fixtures[fid] = {
        id: fid, compId: comp.id, round: round.name, matchday: 0, day, homeId: home, awayId: away, tieId: tid, leg,
        neutral: isFinal && round.legs === 1, knockout, played: false,
      };
      tie.fixtureIds.push(fid);
      comp.fixtureIds.push(fid);
    };
    if (round.legs === 1) mk('', a, b, round.day, undefined, true);
    else { mk(':1', a, b, round.day, 1, false); mk(':2', b, a, round.day2 as number, 2, true); }
    ties.push(tie);
  }
  round.ties = ties;
  round.drawn = true;
  round.completed = ties.every((t) => t.winner !== undefined);
  return round;
}

export interface TieOutcome { winner: string; loser: string; decidedBy: NonNullable<CupTie['decidedBy']>; agg: [number, number] }

/** Decide a tie from its played fixtures (null while it is still open). */
export function resolveTie(state: GameState, tie: CupTie): TieOutcome | null {
  if (!tie.b) return { winner: tie.a, loser: '', decidedBy: 'bye', agg: [0, 0] };
  const fixtures = tie.fixtureIds.map((id) => state.fixtures[id]);
  if (fixtures.some((f) => !f.played || !f.result)) return null;
  let a = 0;
  let b = 0;
  for (const f of fixtures) {
    const r = f.result as FixtureResult;
    if (f.homeId === tie.a) { a += r.hg; b += r.ag; } else { a += r.ag; b += r.hg; }
  }
  const last = fixtures[fixtures.length - 1];
  const lr = last.result as FixtureResult;
  if (a !== b) {
    const winner = a > b ? tie.a : tie.b;
    return { winner, loser: winner === tie.a ? tie.b : tie.a, decidedBy: lr.et ? 'extraTime' : fixtures.length > 1 ? 'aggregate' : 'normal', agg: [a, b] };
  }
  const pens = lr.pens;
  if (pens) {
    const homeWon = pens[0] > pens[1];
    const winner = homeWon ? last.homeId : last.awayId;
    return { winner, loser: winner === tie.a ? tie.b : tie.a, decidedBy: 'penalties', agg: [a, b] };
  }
  // Defensive fallback; the engine always settles knockout matches, so this should never run.
  const rep = (id: string) => state.clubs[id]?.reputation ?? 0;
  const winner = rep(tie.a) >= rep(tie.b) ? tie.a : tie.b;
  return { winner, loser: winner === tie.a ? tie.b : tie.a, decidedBy: 'penalties', agg: [a, b] };
}

/** After a cup fixture is played: settle its tie and, if the round is finished, the round and competition. */
export function updateCupAfterFixture(state: GameState, fixture: Fixture): { tieDone: TieOutcome | null; roundDone: boolean; cupDone: boolean } {
  const comp = state.competitions[fixture.compId];
  if (!comp || comp.type !== 'cup' || !comp.rounds) return { tieDone: null, roundDone: false, cupDone: false };
  for (let ri = 0; ri < comp.rounds.length; ri++) {
    const round = comp.rounds[ri];
    const tie = round.ties.find((t) => t.id === fixture.tieId);
    if (!tie) continue;
    const outcome = resolveTie(state, tie);
    if (!outcome) return { tieDone: null, roundDone: false, cupDone: false };
    tie.winner = outcome.winner;
    tie.decidedBy = outcome.decidedBy;
    tie.agg = outcome.agg;
    round.completed = round.ties.every((t) => t.winner !== undefined);
    let cupDone = false;
    if (round.completed && ri === comp.rounds.length - 1) {
      comp.completed = true;
      comp.winnerId = tie.winner;
      comp.runnerUpId = outcome.loser;
      cupDone = true;
    }
    return { tieDone: outcome, roundDone: round.completed, cupDone };
  }
  return { tieDone: null, roundDone: false, cupDone: false };
}

export function isEliminated(comp: Competition, clubId: string): boolean {
  if (!comp.rounds) return false;
  for (const r of comp.rounds) {
    for (const t of r.ties) {
      if ((t.a === clubId || t.b === clubId) && t.winner && t.winner !== clubId) return true;
    }
  }
  return false;
}

export function clubCupStage(comp: Competition, clubId: string): string {
  if (!comp.rounds) return '-';
  let last = '';
  for (const r of comp.rounds) {
    for (const t of r.ties) {
      if (t.a === clubId || t.b === clubId) {
        last = r.name;
        if (t.winner && t.winner !== clubId) return `Out in the ${r.name}`;
        if (t.winner === clubId && comp.winnerId === clubId) return 'Winner';
      }
    }
  }
  return last ? `In the ${last}` : 'Awaiting draw';
}

/* ---------------------------- results ---------------------------- */

/** Compact stored summary of a match result (events are kept separately only for the user's matches). */
export function summarise(r: MatchResult): FixtureResult {
  const scorers: FixtureResult['scorers'] = [];
  const cards: FixtureResult['cards'] = [];
  for (const e of r.events) {
    if (e.type === 'goal' && e.p) scorers.push({ p: e.p, min: e.min + (e.add ? 0 : 0), side: e.side, pen: e.d?.pen });
    else if (e.type === 'own_goal' && e.p) scorers.push({ p: e.p, min: e.min, side: (1 - e.side) as 0 | 1, og: true });
    else if (e.type === 'red' && e.p) cards.push({ p: e.p, min: e.min, side: e.side, red: true });
    else if (e.type === 'yellow' && e.p && !e.d?.secondYellow) cards.push({ p: e.p, min: e.min, side: e.side, red: false });
  }
  return { hg: r.hg, ag: r.ag, et: r.et || undefined, pens: r.pens ?? undefined, scorers, cards };
}
