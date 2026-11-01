/**
 * International football. Sixteen national teams with pools drawn from every player of that nationality in the world
 * (plus generated "abroad" players so each nation has depth). Two senior matches per international break, qualifying groups
 * in tournament seasons and a finals tournament in June (group stage then semi-finals and final). Youth call-ups feed
 * U21 friendlies. A call-up is earned by beating the other players in the pool for a place; it is never automatic.
 */
import type {
  Competition, Fixture, GameState, MatchRecord, MatchResult, NationalTeam, Player, Position,
} from './types';
import { emptyStatLine } from './types';
import { Rng, clamp, seedFrom } from './rng';
import { NATIONS, NATION_BY_CODE, nationName } from './names';
import { makeManager } from './world';
import { generatePlayer } from './playerGen';
import { CREST_COLOURS, makeCrest } from './clubData';
import { FORMATIONS } from './formations';
import { ageAt, overall, slotRating } from './attributes';
import { pickFromPool, availability, type SelectionContext, type SquadSelection } from './selection';
import { simulateMatch, type MatchInput, type MatchSideInput } from './match/engine';
import { computeTable, summarise } from './competitions';
import { dayOf, formatShort, seasonLabel } from './dates';
import { getPlan, hasTournament } from './season';
import { addNews, uid } from './util';
import { applyInjury, injuryFactor, matchSeed, userEffects, type FixtureRun, type PreparedSide } from './matchday';
import { unlock } from './awards';
import { injuryNews } from './news';

export const SENIOR_SQUAD = 23;
const ABROAD_PER_NATION = 28;
/** Players of a nation who play overseas or at unlisted clubs and are young enough for the U21 side. */
const ABROAD_YOUTH_PER_NATION = 14;
const MAX_ABROAD_SENIORS = 34;
const YOUTH_POSITIONS: Position[] = ['GK', 'GK', 'CB', 'CB', 'CB', 'RB', 'LB', 'DM', 'CM', 'CM', 'AM', 'RW', 'LW', 'ST'];
const ABROAD_POSITIONS: Position[] = [
  'GK', 'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'CB', 'RB', 'RB', 'LB', 'LB', 'DM', 'DM', 'CM', 'CM', 'CM', 'CM', 'AM', 'AM',
  'RW', 'RW', 'LW', 'LW', 'ST', 'ST', 'ST', 'ST',
];

export const tournamentYear = (season: number) => season + 1;
export const tournamentName = (season: number) => (tournamentYear(season) % 4 === 0 ? 'Continental Championship' : 'World Cup');

export const isYouthFixture = (fx: Fixture) => fx.compId.startsWith('U21');
export const isNationCode = (id: string) => id.length === 3 && !!NATION_BY_CODE[id];

/* ------------------------------------------------------------------ set-up */

function genAbroad(state: GameState, rng: Rng, code: string, strength: number, i: number, youth = false): Player {
  const pos = youth ? YOUTH_POSITIONS[i % YOUTH_POSITIONS.length] : ABROAD_POSITIONS[i % ABROAD_POSITIONS.length];
  const age = youth ? clamp(Math.round(rng.normal(19.4, 1.2)), 17, 21) : clamp(Math.round(rng.normal(26.5, 3.8)), 19, 35);
  const ovr = youth
    ? clamp(Math.round(strength - 17 + rng.normal(0, 4.5) + (i % 4 === 0 ? 3 : 0)), 30, 82)
    : clamp(Math.round(strength - 7 + rng.normal(0, 4.5) + (i % 4 === 0 ? 4 : 0)), 36, 90);
  const p = generatePlayer(rng, { id: uid(state, 'p'), position: pos, ovr, age, nationality: code, clubId: null, clubRep: 60, day: state.day });
  p.nationalPool = code;
  p.shirt = youth ? 30 + (i % 20) : i + 1;
  return p;
}

export function initNations(state: GameState, rng: Rng): Record<string, NationalTeam> {
  const out: Record<string, NationalTeam> = {};
  NATIONS.forEach((n, idx) => {
    for (let i = 0; i < ABROAD_PER_NATION; i++) {
      const p = genAbroad(state, rng, n.code, n.strength, i);
      state.players[p.id] = p;
    }
    for (let i = 0; i < ABROAD_YOUTH_PER_NATION; i++) {
      const p = genAbroad(state, rng, n.code, n.strength, i, true);
      state.players[p.id] = p;
    }
    const g = { next: state.nextId };
    const manager = makeManager(rng, g, n.strength + 5);
    state.nextId = g.next;
    const crest = makeCrest(n.code, idx, rng.int(0, 3), rng.int(0, 3));
    crest.primary = CREST_COLOURS[(idx * 5 + 2) % CREST_COLOURS.length][0];
    crest.secondary = CREST_COLOURS[(idx * 5 + 2) % CREST_COLOURS.length][1];
    out[n.code] = { code: n.code, name: n.name, strength: n.strength, poolIds: [], manager, crest };
  });
  state.nations = out;
  refreshPools(state);
  setupInternational(state, rng);
  return out;
}

/** Everyone eligible for a nation, as ids. Recomputed at season start and when the user switches nation. */
export function refreshPools(state: GameState): void {
  const by: Record<string, string[]> = {};
  for (const p of Object.values(state.players)) {
    if (p.retired) continue;
    (by[p.nationality] ||= []).push(p.id);
  }
  const user = state.players[state.userId];
  for (const code of Object.keys(state.nations)) {
    const ids = (by[code] ?? []).filter((id) => id !== state.userId);
    if (state.international.nation === code || (user.nationality === code && state.international.nation === code)) ids.push(state.userId);
    state.nations[code].poolIds = ids;
  }
}

/** Candidates for a national selection: the best by ability (keeps selection fast for large pools), optionally U21 only. */
export function nationalPool(state: GameState, code: string, youth = false, limit = 110): Player[] {
  const team = state.nations[code];
  if (!team) return [];
  let list = team.poolIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  if (youth) list = list.filter((p) => ageAt(p.birthDay, state.day) <= 21);
  list.sort((a, b) => overall(b) - overall(a));
  const top = list.slice(0, limit);
  const user = state.players[state.userId];
  if (state.international.nation === code && list.includes(user) && !top.includes(user)) top.push(user);
  return top;
}

const intlCtx = (state: GameState, importance = 0.8): SelectionContext => ({ day: state.day, importance, competition: 'intl' });

export function pickNational(state: GameState, code: string, youth: boolean, importance = 0.8, day = state.day): SquadSelection {
  const team = state.nations[code];
  const ctx = { ...intlCtx(state, importance), day };
  const sel = pickFromPool(state, { manager: team.manager }, nationalPool(state, code, youth), ctx);
  // a thin U21 pool must never produce a side with gaps: widen to the whole nation rather than field fewer than eleven
  if (youth && sel.lineup.some((p) => !p)) return pickFromPool(state, { manager: team.manager }, nationalPool(state, code, false), ctx);
  return sel;
}

export interface NationalSquad extends SquadSelection {
  reserves: Player[];
  squad: Player[];
}

/** 23-player squad: the matchday eighteen plus five reserves chosen by the same logic. */
export function pickSquad(state: GameState, code: string, youth: boolean, day = state.day): NationalSquad {
  const base = pickNational(state, code, youth, 0.8, day);
  const used = new Set([...base.lineup, ...base.bench].map((p) => p.id));
  const ctx = { ...intlCtx(state), day };
  const rest = nationalPool(state, code, youth)
    .filter((p) => !used.has(p.id) && availability(p) === 'available')
    .map((p) => ({ p, s: slotRating(p, p.position) + 0 * ctx.importance }))
    .sort((a, b) => b.s - a.s);
  const reserves: Player[] = [];
  const gks = rest.filter((x) => x.p.position === 'GK');
  const bench = [...base.bench];
  const hasGk = [...base.lineup, ...bench].filter((p) => p.position === 'GK').length;
  if (hasGk < 3 && gks[0]) { reserves.push(gks[0].p); }
  for (const x of rest) { if (reserves.length >= SENIOR_SQUAD - 18) break; if (!reserves.includes(x.p)) reserves.push(x.p); }
  return { ...base, reserves, squad: [...base.lineup, ...base.bench, ...reserves] };
}

function mkFixture(
  state: GameState, comp: Competition, id: string, round: string, matchday: number, day: number, home: string, away: string,
  opts: { neutral?: boolean; knockout?: boolean } = {},
): Fixture {
  const fx: Fixture = { id, compId: comp.id, round, matchday, day, homeId: home, awayId: away, played: false, neutral: opts.neutral, knockout: opts.knockout };
  state.fixtures[id] = fx;
  comp.fixtureIds.push(id);
  return fx;
}

function newIntlComp(state: GameState, id: string, name: string, short: string, season: number, clubIds: string[], format: string): Competition {
  const comp: Competition = { id, name, short, type: 'intl', season, level: 0, clubIds, fixtureIds: [], completed: false, format };
  state.competitions[id] = comp;
  return comp;
}

/** Day slots for international matches in a season: two per break (Thursday, then the following Tuesday). */
export function intlSlots(state: GameState): number[] {
  const plan = getPlan(state);
  return plan.breakSaturdays.flatMap((s) => [s - 2, s + 3]);
}

function strengthOf(state: GameState, code: string): number {
  const s = pickNational(state, code, false, 0.8, state.day);
  const xi = s.lineup.filter(Boolean).map((p, i) => slotRating(p, FORMATIONS[s.formation].slots[i].pos));
  return xi.length ? xi.reduce((a, b) => a + b, 0) / xi.length : 0;
}

export function nationStrength(state: GameState, code: string): number {
  return Math.round(strengthOf(state, code) * 10) / 10;
}

/** Create the season's international programme: qualifying groups in tournament seasons, friendlies otherwise. */
export function setupInternational(state: GameState, rng: Rng): void {
  const season = state.season;
  const codes = Object.keys(state.nations);
  const slots = intlSlots(state);
  const friendlyId = `INTF-${season}`;
  if (state.competitions[friendlyId] || state.competitions[`QUAL-${season}`]) return;
  const friendlies = newIntlComp(state, friendlyId, 'International friendlies', 'FRI', season, codes, 'Friendly matches with no table.');
  const pairUp = (slotIdx: number, day: number) => {
    const order = rng.shuffle(codes);
    for (let i = 0; i < order.length; i += 2) {
      mkFixture(state, friendlies, `${friendlyId}:${slotIdx}:${i / 2}`, 'Friendly', 0, day, order[i], order[i + 1]);
    }
  };
  if (!hasTournament(season)) {
    slots.forEach((d, i) => pairUp(i, d));
    return;
  }
  // qualifying: four groups of four from seeded pots, double round robin over six matchdays
  const name = tournamentName(season);
  const ranked = [...codes].sort((a, b) => strengthOf(state, b) - strengthOf(state, a));
  const groups: { name: string; teams: string[] }[] = [0, 1, 2, 3].map((g) => ({ name: `Group ${'ABCD'[g]}`, teams: [] }));
  for (let pot = 0; pot < 4; pot++) {
    const pool = rng.shuffle(ranked.slice(pot * 4, pot * 4 + 4));
    pool.forEach((c, g) => groups[g].teams.push(c));
  }
  const qual = newIntlComp(state, `QUAL-${season}`, `${name} qualifying`, 'QUAL', season, codes,
    `Four groups of four, home and away. The top two in each group reach the ${name} finals in June.`);
  qual.groups = groups;
  groups.forEach((grp, gi) => {
    const t = grp.teams;
    // each matchday the four teams form two pairs; the six pairings cover every team twice
    const rounds: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
    for (let md = 0; md < 6; md++) {
      const r = rounds[md % 3];
      const flip = md >= 3;
      r.forEach(([a, b], k) => {
        const home = flip ? t[b] : t[a];
        const away = flip ? t[a] : t[b];
        mkFixture(state, qual, `${qual.id}:${gi}:${md}:${k}`, `${grp.name}, matchday ${md + 1}`, md + 1, slots[md], home, away);
      });
    }
  });
  slots.slice(6).forEach((d, i) => pairUp(6 + i, d));
}

/** After the last qualifying matchday: build the finals competition from the group tables. */
export function maybeCreateFinals(state: GameState, rng: Rng): void {
  const season = state.season;
  const qual = state.competitions[`QUAL-${season}`];
  if (!qual || state.competitions[`FINALS-${season}`]) return;
  const fxs = qual.fixtureIds.map((id) => state.fixtures[id]);
  if (!fxs.every((f) => f.played)) return;
  qual.completed = true;
  const tables = (qual.groups ?? []).map((g) => computeTable(g.teams, fxs.filter((f) => g.teams.includes(f.homeId))));
  const w = tables.map((t) => t[0].clubId);
  const r = tables.map((t) => t[1].clubId);
  qual.winnerId = w[0];
  const name = tournamentName(season);
  const finalists = [...w, ...r];
  const finals = newIntlComp(state, `FINALS-${season}`, `${name} ${tournamentYear(season)}`, 'FIN', season, finalists,
    'Eight nations in two groups of four, then semi-finals and a final on neutral ground. Extra time and penalties settle knockout games.');
  finals.groups = [
    { name: 'Group A', teams: [w[0], r[1], w[2], r[3]] },
    { name: 'Group B', teams: [w[1], r[0], w[3], r[2]] },
  ];
  const start = getPlan(state).tournamentStart ?? dayOf(season + 1, 6, 8);
  finals.groups.forEach((grp, gi) => {
    const t = grp.teams;
    const order: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
    order.forEach((pairs, md) => {
      pairs.forEach(([a, b], k) => {
        mkFixture(state, finals, `${finals.id}:${gi}:${md}:${k}`, `${grp.name}, matchday ${md + 1}`, md + 1, start + md * 4, t[a], t[b], { neutral: true });
      });
    });
  });
  addNews(state, 'international', `${name} ${tournamentYear(season)} finalists decided`,
    `${finalists.map((c) => nationName(c)).join(', ')} have qualified for the finals in June.`, { important: finalists.includes(state.international.nation) });
  if (!finalists.includes(state.international.nation)) {
    state.international.tournaments.push({ season: tournamentYear(season), name, result: 'Did not qualify' });
  }
}

/** Advance the finals bracket after a finals fixture is played. */
export function advanceFinals(state: GameState): void {
  const comp = state.competitions[`FINALS-${state.season}`];
  if (!comp || comp.completed) return;
  const fxs = comp.fixtureIds.map((id) => state.fixtures[id]);
  const groupFx = fxs.filter((f) => f.round.startsWith('Group'));
  const start = getPlan(state).tournamentStart ?? dayOf(state.season + 1, 6, 8);
  if (!groupFx.every((f) => f.played)) return;
  const sf = fxs.filter((f) => f.round === 'Semi-final');
  if (!sf.length) {
    const tables = (comp.groups ?? []).map((g) => computeTable(g.teams, groupFx.filter((f) => g.teams.includes(f.homeId))));
    mkFixture(state, comp, `${comp.id}:SF1`, 'Semi-final', 0, start + 13, tables[0][0].clubId, tables[1][1].clubId, { neutral: true, knockout: true });
    mkFixture(state, comp, `${comp.id}:SF2`, 'Semi-final', 0, start + 13, tables[1][0].clubId, tables[0][1].clubId, { neutral: true, knockout: true });
    return;
  }
  if (!sf.every((f) => f.played)) return;
  const final = fxs.find((f) => f.round === 'Final');
  const winnerOf = (f: Fixture) => {
    const r = f.result;
    if (!r) return f.homeId;
    if (r.hg !== r.ag) return r.hg > r.ag ? f.homeId : f.awayId;
    return (r.pens?.[0] ?? 0) > (r.pens?.[1] ?? 0) ? f.homeId : f.awayId;
  };
  if (!final) {
    mkFixture(state, comp, `${comp.id}:F`, 'Final', 0, start + 19, winnerOf(sf[0]), winnerOf(sf[1]), { neutral: true, knockout: true });
    return;
  }
  if (!final.played) return;
  comp.winnerId = winnerOf(final);
  comp.runnerUpId = comp.winnerId === final.homeId ? final.awayId : final.homeId;
  comp.completed = true;
  state.history.push({ season: state.season, compId: comp.id, name: comp.name, winnerId: comp.winnerId, runnerUpId: comp.runnerUpId });
  addNews(state, 'international', `${nationName(comp.winnerId)} win the ${comp.name}`,
    `${nationName(comp.winnerId)} beat ${nationName(comp.runnerUpId)} in the final.`, { important: comp.winnerId === state.international.nation });
  recordTournamentResult(state, comp);
}

function recordTournamentResult(state: GameState, comp: Competition): void {
  const nation = state.international.nation;
  const mine = comp.fixtureIds.map((id) => state.fixtures[id]).filter((f) => f.homeId === nation || f.awayId === nation);
  if (!mine.length) return;
  const u = state.players[state.userId];
  const played = (u.stats.intl?.apps ?? 0) > 0 && state.international.callUps.some((c) => c.level === 'senior' && c.played && c.day >= (getPlan(state).tournamentStart ?? 0));
  const reachedFinal = mine.some((f) => f.round === 'Final');
  const reachedSemi = mine.some((f) => f.round === 'Semi-final');
  const won = comp.winnerId === nation;
  const result = won ? 'Winners' : reachedFinal ? 'Runners-up' : reachedSemi ? 'Semi-finalists' : 'Group stage';
  const inSquad = state.international.callUps.some((c) => c.level === 'senior' && c.day >= (getPlan(state).tournamentStart ?? 0) - 12);
  if (inSquad || played) {
    state.international.tournaments.push({ season: tournamentYear(state.season), name: comp.name, result });
    if (won) {
      state.international.trophies.push({ season: tournamentYear(state.season), name: comp.name });
      state.career.trophies.push({ season: state.season, compId: comp.id, name: comp.name, clubId: nation, day: state.day });
      unlock(state, 'first_trophy', `${comp.name} with ${nationName(nation)}.`);
    }
  } else {
    state.international.tournaments.push({ season: tournamentYear(state.season), name: comp.name, result: `${result} (not in squad)` });
  }
}

/* ------------------------------------------------------------- user call-ups */

export interface CallUpAssessment {
  status: 'none' | 'youth' | 'senior_watchlist' | 'senior_squad';
  level: 'senior' | 'youth' | null;
  rank: number;
  needed: number;
  rivals: { id: string; name: string; ovr: number; age: number; clubName: string }[];
  opinion: number;
  reason: string;
}

const NEED: Record<Position, number> = { GK: 3, CB: 4, RB: 2, LB: 2, DM: 2, CM: 4, AM: 2, RW: 2, LW: 2, ST: 3 };

export function assessCallUp(state: GameState, youth = false): CallUpAssessment {
  const user = state.players[state.userId];
  const code = state.international.nation;
  const sq = pickSquad(state, code, youth);
  const inSquad = sq.squad.some((p) => p.id === user.id);
  const sameGroup = nationalPool(state, code, youth).filter((p) => p.position === user.position && availability(p) !== 'retired');
  const ranked = sameGroup.map((p) => ({ p, s: slotRating(p, user.position) })).sort((a, b) => b.s - a.s);
  const rank = ranked.findIndex((x) => x.p.id === user.id) + 1;
  const needed = NEED[user.position];
  const myScore = slotRating(user, user.position);
  const cut = ranked[Math.min(needed, ranked.length) - 1]?.s ?? myScore;
  const opinion = clamp(Math.round(50 + (myScore - cut) * 4 + (user.injury ? -10 : 0)), 0, 100);
  const rivals = ranked.slice(0, 6).map(({ p }) => ({
    id: p.id, name: p.displayName, ovr: Math.round(overall(p)), age: ageAt(p.birthDay, state.day), clubName: p.clubId ? state.clubs[p.clubId]?.name ?? 'Abroad' : 'Abroad',
  }));
  let status: CallUpAssessment['status'] = 'none';
  let reason: string;
  if (inSquad) {
    status = youth ? 'youth' : 'senior_squad';
    reason = youth ? 'You are among the best young players in your position.' : 'You are among the best players in your position for your country.';
  } else if (!youth && rank > 0 && rank <= needed + 3) {
    status = 'senior_watchlist';
    reason = `The manager is watching you. You rank ${rank} among ${user.position}s in the pool; the squad takes ${needed}.`;
  } else {
    reason = rank > 0 ? `You rank ${rank} among ${user.position}s eligible for ${nationName(code)}. The squad takes ${needed}.` : 'You are not yet in the national pool.';
  }
  return { status, level: inSquad ? (youth ? 'youth' : 'senior') : null, rank, needed, rivals, opinion, reason };
}

function announceCallUps(state: GameState, rng: Rng, breakIdx: number): void {
  const user = state.players[state.userId];
  const intl = state.international;
  const code = intl.nation;
  const plan = getPlan(state);
  const thu = plan.intlDays[breakIdx];
  intl.calledUpNow = false;
  if (user.retired || user.injury && user.injury.daysLeft > 14) {
    intl.squadStatus = 'none';
    return;
  }
  const senior = assessCallUp(state, false);
  intl.managerOpinion = Math.round(intl.managerOpinion * 0.4 + senior.opinion * 0.6);
  const youthOk = ageAt(user.birthDay, state.day) <= 21;
  const slots = [thu, thu + 5];
  if (senior.level === 'senior') {
    intl.squadStatus = 'senior_squad';
    intl.calledUpNow = true;
    intl.lastCallUpDay = thu;
    state.flags.callUpLevel = 'senior';
    state.flags.callUpBreak = breakIdx;
    intl.callUps.push({ day: thu, label: `${nationName(code)} senior squad`, level: 'senior', played: false });
    addNews(state, 'international', `${user.displayName} called up by ${nationName(code)}`,
      `${state.nations[code].manager.name} names ${user.firstName} ${user.lastName} in his squad for the ${formatShort(thu)} and ${formatShort(slots[1])} matches.`, { important: true });
    state.reputation.national = clamp(state.reputation.national + 2, 0, 100);
    return;
  }
  if (youthOk) {
    const youth = assessCallUp(state, true);
    if (youth.level === 'youth') {
      intl.squadStatus = 'youth';
      intl.calledUpNow = true;
      intl.lastCallUpDay = thu;
      state.flags.callUpLevel = 'youth';
      state.flags.callUpBreak = breakIdx;
      // one U21 friendly against another nation's youth team
      const others = Object.keys(state.nations).filter((c) => c !== code);
      const opp = rng.pick(others);
      const comp = state.competitions[`U21-${state.season}`] ?? newIntlComp(state, `U21-${state.season}`, 'U21 international friendlies', 'U21', state.season, Object.keys(state.nations), 'Youth friendlies for under-21 national teams.');
      const home = rng.chance(0.5);
      mkFixture(state, comp, `${comp.id}:${breakIdx}`, 'U21 friendly', 0, thu + 5, home ? code : opp, home ? opp : code);
      intl.callUps.push({ day: thu + 5, label: `${nationName(code)} U21`, level: 'youth', played: false });
      addNews(state, 'international', `${user.displayName} named in ${nationName(code)} U21 squad`,
        `A call-up for the youth team to face ${nationName(opp)} on ${formatShort(thu + 5)}.`, { important: true });
      return;
    }
  }
  intl.squadStatus = senior.status === 'senior_watchlist' ? 'senior_watchlist' : 'none';
  state.flags.callUpLevel = '';
}

/* ----------------------------------------------------------- running fixtures */

function nationalSide(state: GameState, code: string, youth: boolean, importance: number, day: number): PreparedSide {
  const team = state.nations[code];
  const selection = pickNational(state, code, youth, importance, day);
  const input: MatchSideInput = {
    clubId: code, name: youth ? `${team.name} U21` : team.name, shortName: code, formation: selection.formation, tactics: team.manager.tactics,
    lineup: selection.lineup, bench: selection.bench, chemistry: 72, manager: team.manager,
  };
  const user = state.players[state.userId];
  if (state.training.plan.matchInstruction !== 'default' && (selection.lineup.some((p) => p.id === user.id) || selection.bench.some((p) => p.id === user.id))) {
    input.instruction = { playerId: user.id, instruction: state.training.plan.matchInstruction };
  }
  return { input, selection };
}

function intlImportance(fx: Fixture): number {
  if (fx.compId.startsWith('FINALS')) return fx.round === 'Final' ? 1 : fx.round === 'Semi-final' ? 0.9 : 0.75;
  if (fx.compId.startsWith('QUAL')) return 0.7;
  return 0.35;
}

export function runNationalFixture(state: GameState, fx: Fixture, opts: { recordAll?: boolean } = {}): FixtureRun {
  const youth = isYouthFixture(fx);
  const imp = intlImportance(fx);
  const home = nationalSide(state, fx.homeId, youth, imp, fx.day);
  const away = nationalSide(state, fx.awayId, youth, imp, fx.day);
  const input: MatchInput = {
    seed: matchSeed(state, fx.id), home: home.input, away: away.input, neutral: fx.neutral, knockout: fx.knockout, importance: imp,
    recordAll: opts.recordAll, injuryFactor: injuryFactor(state),
  };
  return { fixture: fx, result: simulateMatch(input), sides: [home, away], extra: [] };
}

function applyNationalStats(state: GameState, res: MatchResult, side: 0 | 1): void {
  for (const l of res.lineups[side]) {
    const p = state.players[l.playerId];
    const st = res.players[l.playerId];
    if (!p || !st || st.minutes <= 0 || p.id === state.userId) continue;
    const line = (p.stats.intl ||= emptyStatLine());
    line.apps++;
    if (st.started) line.starts++;
    line.minutes += st.minutes;
    line.goals += st.goals;
    line.assists += st.assists;
    line.ratingSum += st.rating;
  }
}

export function userInvolvedIntl(state: GameState, fx: Fixture): boolean {
  const user = state.players[state.userId];
  if (!state.international.calledUpNow) return false;
  const code = state.international.nation;
  if (fx.homeId !== code && fx.awayId !== code) return false;
  const level = state.flags.callUpLevel;
  if (isYouthFixture(fx)) return level === 'youth';
  return level === 'senior' && !user.retired;
}

/** Apply a national fixture; returns a MatchRecord only when the user is part of the squad for it. */
export function applyNationalFixture(state: GameState, fx: Fixture, run: FixtureRun): MatchRecord | null {
  const res = run.result;
  const comp = state.competitions[fx.compId];
  fx.played = true;
  fx.result = summarise(res);
  fx.detail = 'light';
  applyNationalStats(state, res, 0);
  applyNationalStats(state, res, 1);
  const user = state.players[state.userId];
  const involved = userInvolvedIntl(state, fx);
  let record: MatchRecord | null = null;
  if (involved) {
    fx.detail = 'full';
    const code = state.international.nation;
    const side: 0 | 1 = fx.homeId === code ? 0 : 1;
    const sel = run.sides[side].selection;
    const youth = isYouthFixture(fx);
    const inXI = sel.lineup.some((p) => p.id === user.id);
    const onBench = sel.bench.some((p) => p.id === user.id);
    const selected = inXI ? 'start' : onBench ? 'bench' : 'notInSquad';
    const st = res.players[user.id];
    const mins = st?.minutes ?? 0;
    const explain = [inXI ? `Selected by ${state.nations[code].manager.name} for ${nationName(code)}${youth ? ' U21' : ''}.` : onBench ? 'Named as a substitute.' : 'In the squad but not in the matchday eighteen.'];
    const summary = userEffects(state, null, 'intl', res, side, sel, { selected: mins > 0 && selected === 'bench' ? 'bench' : selected, explain }, 0.9);
    // international minutes carry their own physical cost and statistics
    if (mins > 0 && st) {
      const line = (user.stats.intl ||= emptyStatLine());
      line.apps++;
      if (st.started) line.starts++;
      line.minutes += st.minutes; line.goals += st.goals; line.assists += st.assists; line.yellows += st.yellow; line.reds += st.red;
      line.ratingSum += st.rating; line.shots += st.shots; line.conceded += st.conceded;
      if (res.motm === user.id) line.motm++;
      const load = (mins / 90) * (30 + (100 - user.attrs.stamina) * 0.15);
      user.cond.fatigue = clamp(user.cond.fatigue + load, 0, 100);
      user.cond.sharpness = clamp(user.cond.sharpness + 6 * (mins / 90), 0, 100);
      user.lastMinutesDay = fx.day;
      if (!youth) {
        state.international.caps++;
        state.international.goals += st.goals;
        state.international.assists += st.assists;
        unlock(state, 'first_cap', `Capped by ${nationName(code)} against ${nationName(fx.homeId === code ? fx.awayId : fx.homeId)}.`);
        if (st.goals) unlock(state, 'first_intl_goal');
        state.reputation.national = clamp(state.reputation.national + 1.5 + (st.rating - 6.5) * 0.8, 0, 100);
        state.international.managerOpinion = clamp(state.international.managerOpinion + (st.rating - 6.3) * 1.5, 0, 100);
      } else {
        state.international.youthCaps++;
      }
      const cu = [...state.international.callUps].reverse().find((c) => c.level === (youth ? 'youth' : 'senior') && !c.played && c.day <= fx.day + 8);
      if (cu) cu.played = true;
    }
    for (const inj of res.injuries) {
      if (inj.playerId === user.id) { applyInjury(state, user, inj.type, inj.days, 'match'); injuryNews(state, user, inj.type, inj.days, false); }
    }
    const names: Record<string, string> = {};
    for (const id of Object.keys(res.players)) names[id] = state.players[id]?.displayName ?? '?';
    record = {
      fixtureId: fx.id, compId: fx.compId, compName: comp.name, round: fx.round, day: fx.day, homeId: fx.homeId, awayId: fx.awayId, result: res,
      userSummary: summary, homeName: state.nations[fx.homeId].name + (youth ? ' U21' : ''), awayName: state.nations[fx.awayId].name + (youth ? ' U21' : ''), playerNames: names,
    };
    state.matchRecords[fx.id] = record;
    state.userMatchLog.push(fx.id);
    addNews(state, 'international', `${record.homeName} ${res.hg}-${res.ag} ${record.awayName}`,
      `${comp.name} - ${fx.round}. ${mins > 0 ? `${user.displayName} played ${mins} minutes and was rated ${st?.rating.toFixed(1)}.` : 'You did not play.'}`, { important: mins > 0 });
  }
  if (fx.compId.startsWith('QUAL')) maybeCreateFinals(state, new Rng(seedFrom(state.seed, 'finals', state.season)));
  if (fx.compId.startsWith('FINALS')) advanceFinals(state);
  return record;
}

export function userIntlFixtureOn(state: GameState, day: number): Fixture | null {
  const code = state.international.nation;
  for (const comp of Object.values(state.competitions)) {
    if (comp.type !== 'intl' || comp.season !== state.season) continue;
    for (const id of comp.fixtureIds) {
      const f = state.fixtures[id];
      if (f.day === day && !f.played && (f.homeId === code || f.awayId === code) && userInvolvedIntl(state, f)) return f;
    }
  }
  return null;
}

/** All national fixtures on a day, except (optionally) the user's own. */
export function nationalFixturesOn(state: GameState, day: number): Fixture[] {
  const out: Fixture[] = [];
  for (const comp of Object.values(state.competitions)) {
    if (comp.type !== 'intl' || comp.season !== state.season) continue;
    for (const id of comp.fixtureIds) {
      const f = state.fixtures[id];
      if (f.day === day && !f.played) out.push(f);
    }
  }
  return out;
}

/** Daily international processing: call-ups when squads are named, and every national fixture of the day (bar the user's). */
export function processInternationalDay(state: GameState, rng: Rng, skipUserFixture: boolean): void {
  const plan = getPlan(state);
  plan.breakSaturdays.forEach((s, i) => {
    if (state.day === s - 9) announceCallUps(state, rng, i);
  });
  // the call-up window closes after the break
  if (state.international.calledUpNow && plan.breakSaturdays.every((s) => state.day > s + 4)) state.international.calledUpNow = false;
  const todays = nationalFixturesOn(state, state.day);
  for (const fx of todays) {
    if (skipUserFixture && userInvolvedIntl(state, fx)) continue;
    applyNationalFixture(state, fx, runNationalFixture(state, fx));
  }
  if (plan.breakSaturdays.some((s) => state.day === s + 4)) state.international.calledUpNow = false;
}

/** Switch the nation the user represents (only while he has no senior caps and is eligible). */
export function canSwitchNation(state: GameState, code: string): { ok: boolean; reason: string } {
  const i = state.international;
  if (!i.eligible.includes(code)) return { ok: false, reason: `You are not eligible for ${nationName(code)}.` };
  if (code === i.nation) return { ok: false, reason: `You already represent ${nationName(code)}.` };
  if (i.caps > 0) return { ok: false, reason: 'Players with senior caps are tied to their nation.' };
  return { ok: true, reason: 'Allowed: you have no senior caps.' };
}

export function switchNation(state: GameState, code: string): boolean {
  const c = canSwitchNation(state, code);
  if (!c.ok) return false;
  state.international.nation = code;
  state.international.squadStatus = 'none';
  state.international.calledUpNow = false;
  state.international.managerOpinion = 25;
  refreshPools(state);
  addNews(state, 'international', `${state.players[state.userId].displayName} commits to ${nationName(code)}`, `The player has chosen to represent ${nationName(code)} at international level.`, { important: true });
  return true;
}

/** Season-end refresh for national pools: abroad players age, retire and are replaced. */
export function rolloverInternational(state: GameState, rng: Rng, developer: (p: Player) => void): void {
  for (const p of Object.values(state.players)) {
    if (!p.nationalPool || p.retired) continue;
    developer(p);
    const age = ageAt(p.birthDay, state.day);
    if (age >= 36 || (age >= 33 && rng.chance(0.25))) {
      p.retired = true;
      const code = p.nationalPool;
      const n = NATION_BY_CODE[code];
      const repl = genAbroad(state, rng, code, n.strength, rng.int(0, 27));
      repl.birthDay = state.day - Math.round(clamp(rng.normal(23, 2.5), 19, 29) * 365.25);
      state.players[repl.id] = repl;
    }
  }
  // keep the U21 pool full as players age out of it, and stop the senior pool from growing without limit
  for (const n of NATIONS) {
    const abroad = Object.values(state.players).filter((p) => p.nationalPool === n.code && !p.retired);
    const young = abroad.filter((p) => ageAt(p.birthDay, state.day) <= 21);
    const have = new Set(young.map((p) => p.position));
    for (let i = young.length, k = 0; i < ABROAD_YOUTH_PER_NATION; i++, k++) {
      // fill the positions that are thinnest first
      const idx = YOUTH_POSITIONS.findIndex((pos) => !have.has(pos));
      const p = genAbroad(state, rng, n.code, n.strength, idx >= 0 ? idx : rng.int(0, YOUTH_POSITIONS.length - 1), true);
      have.add(p.position);
      state.players[p.id] = p;
    }
    const seniors = abroad.filter((p) => ageAt(p.birthDay, state.day) > 21).sort((a, b) => overall(b) - overall(a));
    for (const extra of seniors.slice(MAX_ABROAD_SENIORS)) extra.retired = true;
  }
  refreshPools(state);
}

export function seasonInternationalLabel(state: GameState): string {
  return hasTournament(state.season) ? `${tournamentName(state.season)} ${tournamentYear(state.season)}` : `${seasonLabel(state.season)} friendlies`;
}

