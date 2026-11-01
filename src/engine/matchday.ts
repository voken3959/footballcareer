/**
 * Match days: build both sides, run the match engine, and apply the result to the whole world.
 * The same code path updates standings, player statistics, fatigue, injuries, suspensions and cups for every fixture,
 * so the user's matches are part of the same simulated world as everyone else's.
 */
import type {
  CompKind, Fixture, GameState, Injury, MatchRecord, MatchResult, Player, PlayerMatchStats, Position,
} from './types';
import { emptyStatLine } from './types';
import { simulateMatch, type MatchInput, type MatchSideInput } from './match/engine';
import { pickMatchSquad, squadOf, availability, explainSelection, type SelectionContext, type SquadSelection } from './selection';
import { FORMATIONS, STYLES } from './formations';
import { positionIn, leagueTable, summarise, updateCupAfterFixture } from './competitions';
import { Rng, clamp, round1, seedFrom } from './rng';
import { injuryByName, INJURY_TYPES } from './injuries';
import { applyMatchExperience, recordChange } from './progression';
import { overall, slotRating, positionFit } from './attributes';
import { generatePlayer } from './playerGen';
import { clubLevel } from './world';
import { clampN, userPlayer } from './util';
import { injuryNews, matchReportNews, suspensionNews } from './news';
import { payOnce } from './finance';
import { afterUserMatch, competitionCompleted } from './awards';
import { assessRole } from './selection';

/* ------------------------------------------------------------------ helpers */

export function fixtureKind(state: GameState, fx: Fixture): CompKind {
  const c = state.competitions[fx.compId];
  return c?.type === 'cup' ? 'cup' : c?.type === 'intl' ? 'intl' : c?.type === 'dev' ? 'dev' : 'league';
}

export function fixtureImportance(state: GameState, fx: Fixture): number {
  const c = state.competitions[fx.compId];
  if (!c) return 0.5;
  if (c.type === 'cup' && c.rounds) {
    const idx = c.rounds.findIndex((r) => r.name === fx.round);
    return [0.4, 0.5, 0.65, 0.85, 1][Math.max(0, idx)] ?? 0.5;
  }
  if (c.type === 'league') {
    let v = 0.42 + 0.18 * (fx.matchday / 30);
    if (fx.matchday >= 24) {
      const table = leagueTable(state, c.id);
      const posH = positionIn(table, fx.homeId);
      const posA = positionIn(table, fx.awayId);
      const n = c.clubIds.length;
      const tense = (pos: number) => pos <= 3 || pos > n - 4;
      if (tense(posH) || tense(posA)) v += 0.16;
    }
    return clamp(v, 0, 1);
  }
  return 0.7;
}

export function selectionCtx(state: GameState, fx: Fixture): SelectionContext {
  const kind = fixtureKind(state, fx);
  return { day: fx.day, importance: fixtureImportance(state, fx), competition: kind === 'dev' ? 'league' : kind };
}

export function injuryFactor(state: GameState): number {
  return state.settings.difficulty === 'casual' ? 0.7 : state.settings.difficulty === 'simulation' ? 1.25 : 1;
}

export interface PreparedSide {
  input: MatchSideInput;
  selection: SquadSelection;
}

export function prepareSide(state: GameState, clubId: string, ctx: SelectionContext): PreparedSide {
  const club = state.clubs[clubId];
  const selection = pickMatchSquad(state, clubId, ctx);
  const input: MatchSideInput = {
    clubId, name: club.name, shortName: club.shortName, formation: selection.formation, tactics: club.manager.tactics,
    lineup: selection.lineup, bench: selection.bench, chemistry: club.chemistry, manager: club.manager,
  };
  const user = userPlayer(state);
  if (user.clubId === clubId && state.training.plan.matchInstruction !== 'default') {
    const inSquad = selection.lineup.some((p) => p.id === user.id) || selection.bench.some((p) => p.id === user.id);
    if (inSquad) input.instruction = { playerId: user.id, instruction: state.training.plan.matchInstruction };
  }
  return { input, selection };
}

export interface FixtureRun {
  fixture: Fixture;
  result: MatchResult;
  sides: [PreparedSide, PreparedSide];
  extra: Player[];
}

export function matchSeed(state: GameState, key: string): number {
  return seedFrom(state.seed, state.simVersion, key);
}

export function firstLegGoals(state: GameState, fx: Fixture): [number, number] | undefined {
  if (fx.leg !== 2 || !fx.tieId) return undefined;
  const comp = state.competitions[fx.compId];
  const tie = comp?.rounds?.flatMap((r) => r.ties).find((t) => t.id === fx.tieId);
  const first = tie ? state.fixtures[tie.fixtureIds[0]] : null;
  if (!first?.result) return undefined;
  return [first.result.ag, first.result.hg]; // goals by [this match's home side, this match's away side] in leg 1
}

export function runFixture(state: GameState, fx: Fixture, opts: { recordAll?: boolean } = {}): FixtureRun {
  const ctx = selectionCtx(state, fx);
  const home = prepareSide(state, fx.homeId, ctx);
  const away = prepareSide(state, fx.awayId, ctx);
  const input: MatchInput = {
    seed: matchSeed(state, fx.id), home: home.input, away: away.input, neutral: fx.neutral, knockout: fx.knockout,
    aggregate: firstLegGoals(state, fx), importance: ctx.importance, recordAll: opts.recordAll, injuryFactor: injuryFactor(state),
  };
  return { fixture: fx, result: simulateMatch(input), sides: [home, away], extra: [] };
}

function attendanceFor(state: GameState, fx: Fixture): number {
  const club = state.clubs[fx.homeId];
  const rng = new Rng(seedFrom(state.seed, 'att', fx.id));
  const fill = clamp(0.5 + club.reputation / 220 + rng.normal(0, 0.06) + (fx.knockout ? 0.12 : 0), 0.35, 1);
  return Math.round((club.capacity * fill) / 10) * 10;
}

/* ----------------------------------------------------------------- injuries */

export function applyInjury(state: GameState, p: Player, typeName: string, days: number, source: 'match' | 'training'): Injury {
  const type = injuryByName(typeName) ?? INJURY_TYPES[0];
  const inj: Injury = { type: type.name, severity: type.severity, startDay: state.day, daysTotal: days, daysLeft: days, source };
  p.injury = inj;
  p.cond.sharpness = Math.max(30, p.cond.sharpness - 4);
  if (type.setbacks && days >= 40) {
    const rng = new Rng(seedFrom(state.seed, 'setback', p.id, state.day));
    for (const k of type.setbacks.attrs) {
      const pts = rng.int(type.setbacks.points[0], type.setbacks.points[1]) - (rng.chance(0.4) ? 1 : 0);
      if (pts <= 0 || p.attrs[k] <= 20) continue;
      const from = p.attrs[k];
      p.attrs[k] = from - pts;
      if (p.id === state.userId) recordChange(state, { day: state.day, attr: k, from, to: from - pts, reason: `Lasting effect of ${type.name.toLowerCase()}` });
    }
  }
  if (p.id === state.userId) {
    state.career.injuries.push({ day: state.day, type: type.name, severity: type.severity, days, source });
    state.career.milestones.push({
      id: `inj${state.day}${state.career.injuries.length}`, day: state.day, season: state.season, title: `Injured: ${type.name}`,
      detail: `Out for ${days} days.`, kind: 'injury',
    });
  }
  return inj;
}

/* ------------------------------------------------------------- applying a match */

function pressOf(state: GameState, clubId: string): number {
  return STYLES[state.clubs[clubId].manager.tactics.style]?.press ?? 0.5;
}

function applyClubSide(
  state: GameState, fx: Fixture, kind: CompKind, res: MatchResult, side: 0 | 1, clubId: string, newsForUser: boolean,
): void {
  const club = state.clubs[clubId];
  const conceded = side === 0 ? res.ag : res.hg;
  // players that sat out serve their ban
  const playedIds = new Set(res.lineups[side].map((l) => l.playerId));
  for (const p of squadOf(state, clubId)) {
    if (p.suspension > 0 && !playedIds.has(p.id)) p.suspension--;
  }
  const press = pressOf(state, clubId);
  const starters: string[] = [];
  for (const l of res.lineups[side]) {
    const p = state.players[l.playerId];
    if (!p) continue;
    const st = res.players[l.playerId];
    if (st.started) starters.push(p.id);
    if (st.minutes <= 0) continue;
    const line = (p.stats[kind] ||= emptyStatLine());
    line.apps++;
    if (st.started) line.starts++;
    line.minutes += st.minutes;
    line.goals += st.goals;
    line.assists += st.assists;
    line.yellows += st.yellow;
    line.reds += st.red;
    if (conceded === 0 && st.minutes >= 60 && ['GK', 'CB', 'RB', 'LB', 'DM'].includes(p.position)) line.cleanSheets++;
    line.conceded += st.conceded;
    line.ratingSum += st.rating;
    if (res.motm === p.id) line.motm++;
    line.shots += st.shots;
    line.ownGoals += st.ownGoals;
    p.recentRatings.push(round1(st.rating));
    if (p.recentRatings.length > 8) p.recentRatings.shift();
    // condition
    const share = st.minutes / 90;
    const load = share * (28 + (100 - p.attrs.stamina) * 0.16 + press * 8) * (kind === 'dev' ? 0.8 : 1);
    p.cond.fatigue = clamp(p.cond.fatigue + load, 0, 100);
    p.cond.sharpness = clamp(p.cond.sharpness + 7 * share + 1, 0, 100);
    p.cond.matchFitness = clamp(p.cond.matchFitness + 0.8 * share, 0, 100);
    p.lastMinutesDay = fx.day;
    // discipline
    const before = p.yellowsSeason;
    p.yellowsSeason += st.yellow > 0 && st.red === 0 ? st.yellow : 0;
    if (st.red > 0) {
      const secondYellow = res.events.some((e) => e.type === 'red' && e.p === p.id && e.d?.secondYellow);
      const bans = secondYellow ? 1 : 2 + (new Rng(seedFrom(state.seed, 'ban', fx.id, p.id)).next() < 0.35 ? 1 : 0);
      p.suspension += bans;
      if (newsForUser) suspensionNews(state, p, `sent off in ${fx.round}, a ${bans}-match ban`);
    } else if (Math.floor(p.yellowsSeason / 5) > Math.floor(before / 5)) {
      p.suspension += 1;
      if (newsForUser || p.id === state.userId) suspensionNews(state, p, `${p.yellowsSeason} yellow cards this season`);
    }
  }
  // injuries
  for (const inj of res.injuries) {
    const p = state.players[inj.playerId];
    if (!p || p.clubId !== clubId && !playedIds.has(p.id)) continue;
    if (!playedIds.has(p.id)) continue;
    applyInjury(state, p, inj.type, inj.days, 'match');
    if (newsForUser || p.id === state.userId) injuryNews(state, p, inj.type, inj.days, newsForUser);
  }
  club.lastLineup = starters.length ? starters : club.lastLineup;
}

function updateChemistry(club: { chemistry: number; lastLineup: string[] }, prevLineup: string[], starters: string[]): void {
  if (!prevLineup.length) return;
  const kept = starters.filter((id) => prevLineup.includes(id)).length / 11;
  club.chemistry = clamp(club.chemistry + (kept - 0.62) * 3, 45, 100);
}

function expectsToStart(role: string): boolean {
  return role === 'Key player' || role === 'Regular starter';
}

export function userEffects(
  state: GameState, fx: Fixture | null, kind: CompKind, res: MatchResult, side: 0 | 1, sel: SquadSelection | null,
  prematch: { selected: NonNullable<MatchRecord['userSummary']>['selected']; explain: string[] }, weightXp: number,
): NonNullable<MatchRecord['userSummary']> {
  const p = userPlayer(state);
  const st: PlayerMatchStats | undefined = res.players[p.id];
  const club = p.clubId ? state.clubs[p.clubId] : null;
  const myGoals = side === 0 ? res.hg : res.ag;
  const oppGoals = side === 0 ? res.ag : res.hg;
  const won = res.pens ? res.pens[side] > res.pens[1 - side] : myGoals > oppGoals;
  const lost = res.pens ? res.pens[side] < res.pens[1 - side] : myGoals < oppGoals;
  const minutes = st?.minutes ?? 0;
  const importance = fx ? fixtureImportance(state, fx) : 0.3;
  const role = state.career.squadRole;
  const analysis: string[] = [...prematch.explain];
  let reaction = '';
  let trustDelta = 0;
  let moraleDelta = 0;
  let confDelta = 0;
  if (st && minutes > 0) {
    const r = st.rating;
    applyMatchExperience(state, p, st, weightXp);
    if (st.goals) analysis.push(`You scored ${st.goals === 1 ? 'a goal' : `${st.goals} goals`}${st.assists ? ` and set up ${st.assists}` : ''}.`);
    else if (st.assists) analysis.push(`You created ${st.assists === 1 ? 'a goal' : `${st.assists} goals`} for your team-mates.`);
    if (st.shots) analysis.push(`${st.shots} shot${st.shots === 1 ? '' : 's'} (${st.shotsOnTarget} on target) worth ${st.xg.toFixed(2)} expected goals.`);
    if (st.passes >= 10) analysis.push(`Passing: ${st.passesCompleted} of ${st.passes} completed (${Math.round((st.passesCompleted / st.passes) * 100)}%).`);
    if (st.tackles) analysis.push(`Won ${st.tacklesWon} of ${st.tackles} tackles.`);
    if (st.dribbles) analysis.push(`Beat your man ${st.dribblesWon} of ${st.dribbles} times.`);
    if (st.saves) analysis.push(`Made ${st.saves} save${st.saves === 1 ? '' : 's'}.`);
    if (st.errors) analysis.push(`${st.errors} costly error${st.errors === 1 ? '' : 's'}.`);
    if (st.red) analysis.push('You were sent off, which hurt the team.');
    else if (st.yellow) analysis.push('You were booked.');
    const recent = p.recentRatings.slice(0, -1);
    if (recent.length >= 3) {
      const avg = recent.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, recent.length);
      analysis.push(`Rating ${r.toFixed(1)} against a recent average of ${avg.toFixed(1)}.`);
    }
    const strict = club?.manager.strictness ?? 0.5;
    if (r >= 8) reaction = 'The manager singled you out for praise after the match.';
    else if (r >= 7) reaction = 'The manager was pleased with your contribution.';
    else if (r >= 6.2) reaction = 'No complaints from the manager.';
    else if (r >= 5.4) reaction = strict > 0.65 ? 'The manager was clearly unhappy with your performance.' : 'The manager wants more from you next time.';
    else reaction = strict > 0.65 ? 'Harsh words from the manager in the dressing room.' : 'The manager spoke to you about the standard of your display.';
    if (st.red) reaction = 'The manager is furious about the red card.';
    trustDelta = (r - 6.4) * (r < 6.4 ? 1.2 + strict * 0.6 : 1.0) * clamp(minutes / 90, 0.3, 1);
    moraleDelta = (won ? 2.5 : lost ? -2 : 0.4) * (0.6 + importance * 0.6) + 1.6 * clamp(minutes / 90, 0, 1) + (r - 6.4) * 0.8;
    confDelta = st.goals * 3 + (r >= 7.5 ? 3 : r < 5.5 ? -4 : (r - 6.4) * 1.5) + (won ? 1 : lost ? -1 : 0) - st.errors * 1.5;
    if (st.red) { moraleDelta -= 3; confDelta -= 4; }
  } else {
    const rest = prematch.selected;
    if (rest === 'injured') reaction = 'You are injured. The medical staff are managing your recovery.';
    else if (rest === 'suspended') reaction = 'You are suspended and cannot play.';
    else if (rest === 'unused') reaction = 'You were named on the bench but did not come on.';
    else reaction = 'You were not in the matchday squad.';
    if (rest === 'unused' || rest === 'notInSquad') {
      moraleDelta = (expectsToStart(role) ? -3.2 : role === 'Important player' ? -1.6 : -0.5) * (0.7 + importance * 0.4);
      moraleDelta += won ? 0.8 : lost ? -0.6 : 0;
      if (expectsToStart(role)) trustDelta = -0.4;
    } else if (rest === 'injured' || rest === 'suspended') moraleDelta = won ? 0.8 : -0.4;
    confDelta = 0;
  }
  p.cond.morale = clamp(p.cond.morale + clampN(moraleDelta, -9, 8), 5, 100);
  p.cond.confidence = clamp(p.cond.confidence + clampN(confDelta, -10, 9), 5, 100);
  state.career.managerTrust = clamp(state.career.managerTrust + clampN(trustDelta, -4, 3.5), 0, 100);
  return {
    selected: prematch.selected, minutes, rating: st && minutes > 0 ? round1(st.rating) : null, goals: st?.goals ?? 0, assists: st?.assists ?? 0,
    subbedOff: !!st && st.started && st.offMin !== null && st.offMin < (res.et ? 120 : 90), managerReaction: reaction, analysis,
  };
}

function userPrematch(state: GameState, fx: Fixture, run: FixtureRun, clubSide: 0 | 1): { selected: NonNullable<MatchRecord['userSummary']>['selected']; explain: string[] } {
  const p = userPlayer(state);
  const sel = run.sides[clubSide].selection;
  const clubId = run.sides[clubSide].input.clubId;
  const ctx = selectionCtx(state, fx);
  if (sel.lineup.some((x) => x.id === p.id)) return { selected: 'start', explain: explainSelection(state, clubId, p.id, ctx, sel).reasons };
  if (sel.bench.some((x) => x.id === p.id)) {
    const e = explainSelection(state, clubId, p.id, ctx, sel).reasons;
    return { selected: 'bench', explain: e };
  }
  if (p.injury) return { selected: 'injured', explain: [`Injured: ${p.injury.type}, ${p.injury.daysLeft} days to go.`] };
  if (p.suspension > 0) return { selected: 'suspended', explain: ['Suspended.'] };
  return { selected: 'notInSquad', explain: explainSelection(state, clubId, p.id, ctx, sel).reasons };
}

const KEEP_EVENTS = new Set([
  'kickoff', 'half_time', 'second_half', 'full_time', 'et_start', 'et_half', 'et_end', 'shootout_start', 'shot', 'goal', 'own_goal',
  'save', 'woodwork', 'yellow', 'red', 'substitution', 'injury', 'penalty_awarded', 'shootout_kick', 'shootout_end', 'tactic', 'big_chance',
]);

const L2_EVENTS = new Set([
  'kickoff', 'full_time', 'et_start', 'goal', 'own_goal', 'yellow', 'red', 'substitution', 'injury', 'penalty_awarded', 'shootout_end',
]);

/**
 * Shrink an old match record so a long career stays small. Level 1 keeps the key events and every player who played;
 * level 2 keeps only goals, cards and substitutions and the statistics of the user and of players who scored, assisted,
 * were booked or were man of the match.
 */
export function compactRecord(rec: MatchRecord, level: 1 | 2 = 1, userId = ''): void {
  const r = rec.result;
  if (level === 1) {
    if (r.events.some((e) => !KEEP_EVENTS.has(e.type))) r.events = r.events.filter((e) => KEEP_EVENTS.has(e.type));
    for (const id of Object.keys(r.players)) if (r.players[id].minutes <= 0) delete r.players[id];
    return;
  }
  if (r.events.some((e) => !L2_EVENTS.has(e.type))) r.events = r.events.filter((e) => L2_EVENTS.has(e.type));
  for (const id of Object.keys(r.players)) {
    const s = r.players[id];
    if (id === userId || id === r.motm || s.goals || s.assists || s.yellow || s.red || s.ownGoals) continue;
    delete r.players[id];
  }
}

/** Called after each user match: the record 7 matches back drops to level 1, the one 31 back to level 2. */
export function compactOldRecords(state: GameState, keepFull = 6, keepMid = 30): void {
  const log = state.userMatchLog;
  const a = log.length - keepFull - 1;
  if (a >= 0) { const rec = state.matchRecords[log[a]]; if (rec) compactRecord(rec, 1, state.userId); }
  const b = log.length - keepMid - 1;
  if (b >= 0) { const rec = state.matchRecords[log[b]]; if (rec) compactRecord(rec, 2, state.userId); }
}

function recordFor(state: GameState, id: string, compId: string, compName: string, round: string, day: number, homeId: string, awayId: string, homeName: string, awayName: string, run: FixtureRun, isDev: boolean): MatchRecord {
  const names: Record<string, string> = {};
  for (const id2 of Object.keys(run.result.players)) names[id2] = state.players[id2]?.displayName ?? run.extra.find((e) => e.id === id2)?.displayName ?? '?';
  return { fixtureId: id, compId, compName, round, day, homeId, awayId, result: run.result, homeName, awayName, playerNames: names, isDev: isDev || undefined };
}

/* --------------------------------------------------------------- main entry */

export interface AppliedFixture {
  record: MatchRecord | null;
}

/** Apply a played fixture to the world. Returns the MatchRecord when the user's club was involved. */
export function applyFixture(state: GameState, fx: Fixture, run: FixtureRun): AppliedFixture {
  const kind = fixtureKind(state, fx);
  const res = run.result;
  const comp = state.competitions[fx.compId];
  const user = userPlayer(state);
  const involvesUserClub = user.clubId === fx.homeId || user.clubId === fx.awayId;
  const prev = [state.clubs[fx.homeId].lastLineup.slice(), state.clubs[fx.awayId].lastLineup.slice()];
  let userPre: ReturnType<typeof userPrematch> | null = null;
  let userSide: 0 | 1 = 0;
  if (involvesUserClub) {
    userSide = user.clubId === fx.homeId ? 0 : 1;
    userPre = userPrematch(state, fx, run, userSide);
  }
  fx.played = true;
  fx.result = { ...summarise(res), attendance: attendanceFor(state, fx) };
  fx.detail = involvesUserClub ? 'full' : 'light';
  applyClubSide(state, fx, kind, res, 0, fx.homeId, involvesUserClub);
  applyClubSide(state, fx, kind, res, 1, fx.awayId, involvesUserClub);
  updateChemistry(state.clubs[fx.homeId], prev[0], state.clubs[fx.homeId].lastLineup);
  updateChemistry(state.clubs[fx.awayId], prev[1], state.clubs[fx.awayId].lastLineup);
  // gate and prize money for cup winners
  let record: MatchRecord | null = null;
  if (involvesUserClub && userPre) {
    const summary = userEffects(state, fx, kind, res, userSide, run.sides[userSide].selection, userPre, 1);
    record = recordFor(state, fx.id, fx.compId, comp.name, fx.round, fx.day, fx.homeId, fx.awayId, state.clubs[fx.homeId].name, state.clubs[fx.awayId].name, run, false);
    record.userSummary = summary;
    state.matchRecords[fx.id] = record;
    state.userMatchLog.push(fx.id);
    userContractBonuses(state, fx.id, res, summary, userSide);
    state.career.squadRole = assessRole(state, state.clubs[user.clubId as string], user, fx.day).role;
    if (kind === 'league' || kind === 'cup') {
      const a = state.career.appearances;
      const st = res.players[user.id];
      if (st && st.minutes > 0) {
        a.apps++; if (st.started) a.starts++;
        a.minutes += st.minutes; a.goals += st.goals; a.assists += st.assists; a.yellows += st.yellow; a.reds += st.red;
        a.ratingSum += st.rating; a.shots += st.shots; a.conceded += st.conceded;
        if (res.motm === user.id) a.motm++;
        if (res.hg + res.ag - (userSide === 0 ? res.hg : res.ag) === 0 && st.minutes >= 60 && ['GK', 'CB', 'RB', 'LB', 'DM'].includes(user.position)) a.cleanSheets++;
        if (st.goals >= 3) state.career.hatTricks++;
      }
    }
    matchReportNews(state, record, user.clubId as string, fx);
    compactOldRecords(state);
  }
  if (comp.type === 'cup') {
    const upd = updateCupAfterFixture(state, fx);
    if (upd.cupDone) competitionCompleted(state, comp);
  }
  if (record) afterUserMatch(state, record);
  return { record };
}

function userContractBonuses(state: GameState, fixtureId: string, res: MatchResult, s: NonNullable<MatchRecord['userSummary']>, side: 0 | 1): void {
  const p = userPlayer(state);
  const c = p.contract;
  if (!c || s.minutes <= 0) return;
  if (c.bonuses.appearance > 0) payOnce(state, `app:${fixtureId}`, 'bonus', 'Appearance bonus', c.bonuses.appearance);
  if (s.goals > 0 && c.bonuses.goal > 0) payOnce(state, `goal:${fixtureId}`, 'bonus', `Goal bonus (${s.goals})`, c.bonuses.goal * s.goals);
  const conceded = side === 0 ? res.ag : res.hg;
  if (conceded === 0 && s.minutes >= 60 && ['GK', 'CB', 'RB', 'LB', 'DM'].includes(p.position) && c.bonuses.cleanSheet > 0) {
    payOnce(state, `cs:${fixtureId}`, 'bonus', 'Clean sheet bonus', c.bonuses.cleanSheet);
  }
}

export function simulateAndApply(state: GameState, fx: Fixture, opts: { recordAll?: boolean } = {}): { run: FixtureRun; record: MatchRecord | null } {
  const run = runFixture(state, fx, opts);
  const { record } = applyFixture(state, fx, run);
  return { run, record };
}

/* ---------------------------------------------------------- reserve (dev) match */

export const DEV_COMP_ID = 'DEV';

function synth(rng: Rng, state: GameState, pos: Position, ovr: number, tag: string, n: number): Player {
  const age = rng.int(17, 20);
  const p = generatePlayer(rng, {
    id: `x${tag}${n}`, position: pos, ovr: clamp(Math.round(ovr), 25, 80), age, nationality: 'ENG', clubId: null, clubRep: 30, day: state.day,
  });
  return p;
}

/**
 * The reserve fixture played alongside a first-team league match for fit squad players who are not in the matchday squad.
 * Opposition and missing team-mates are generated reserve-team players of a plausible level.
 */
export function playDevMatch(state: GameState, fx: Fixture, firstTeam: SquadSelection): MatchRecord | null {
  const user = userPlayer(state);
  if (!user.clubId || user.retired || user.injury || user.suspension > 0 || user.cond.fatigue >= 88) return null;
  const club = state.clubs[user.clubId];
  const inFirst = new Set([...firstTeam.lineup, ...firstTeam.bench].map((p) => p.id));
  if (inFirst.has(user.id)) return null;
  const oppId = fx.homeId === club.id ? fx.awayId : fx.homeId;
  const opp = state.clubs[oppId];
  const rng = new Rng(seedFrom(state.seed, 'devgen', fx.id));
  const formation = FORMATIONS[club.manager.formation];
  const pool = squadOf(state, club.id).filter((p) => !inFirst.has(p.id) && availability(p) === 'available' && p.cond.fatigue < 85);
  const used = new Set<string>();
  const lineup: Player[] = new Array(formation.slots.length);
  const extra: Player[] = [];
  // the user takes the slot he suits best
  let bestSlot = -1;
  let bestScore = -1;
  formation.slots.forEach((s, i) => {
    const sc = slotRating(user, s.pos) * positionFit(user, s.pos);
    if (sc > bestScore) { bestScore = sc; bestSlot = i; }
  });
  lineup[bestSlot] = user;
  used.add(user.id);
  const reserveLevel = clubLevel(club.reputation) - 10;
  formation.slots.forEach((s, i) => {
    if (lineup[i]) return;
    let best: Player | null = null;
    let bs = 0;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      if ((s.pos === 'GK') !== (p.position === 'GK')) continue;
      const fit = positionFit(p, s.pos);
      if (fit < 0.85) continue;
      const sc = slotRating(p, s.pos) * fit;
      if (sc > bs) { bs = sc; best = p; }
    }
    if (best && bs > reserveLevel - 6) { lineup[i] = best; used.add(best.id); }
    else { const x = synth(rng, state, s.pos, reserveLevel + rng.normal(0, 3), 'a', i); extra.push(x); lineup[i] = x; }
  });
  const bench: Player[] = [];
  const spare = pool.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a));
  for (const p of spare.slice(0, 5)) { bench.push(p); used.add(p.id); }
  while (bench.length < 5) { const x = synth(rng, state, bench.length === 0 ? 'GK' : (['CB', 'CM', 'RW', 'ST'] as Position[])[bench.length % 4], reserveLevel, 'b', bench.length); extra.push(x); bench.push(x); }
  const oppForm = FORMATIONS['442'];
  const oppLevel = clubLevel(opp.reputation) - 10;
  const oppLineup = oppForm.slots.map((s, i) => { const x = synth(rng, state, s.pos, oppLevel + rng.normal(0, 3), 'c', i); extra.push(x); return x; });
  const oppBench = (['GK', 'CB', 'CM', 'RW', 'ST'] as Position[]).map((pos, i) => { const x = synth(rng, state, pos, oppLevel - 2, 'd', i); extra.push(x); return x; });
  const mine: MatchSideInput = {
    clubId: club.id, name: `${club.name} Reserves`, shortName: club.shortName, formation: club.manager.formation, tactics: { style: 'balanced', line: 'normal' },
    lineup, bench, chemistry: 60, manager: { strictness: 0.4, rotation: 0.6, temperament: 0.5 },
    instruction: state.training.plan.matchInstruction !== 'default' ? { playerId: user.id, instruction: state.training.plan.matchInstruction } : undefined,
  };
  const theirs: MatchSideInput = {
    clubId: opp.id, name: `${opp.name} Reserves`, shortName: opp.shortName, formation: '442', tactics: { style: 'balanced', line: 'normal' },
    lineup: oppLineup, bench: oppBench, chemistry: 60, manager: { strictness: 0.4, rotation: 0.6, temperament: 0.5 },
  };
  const home = fx.homeId === club.id;
  const res = simulateMatch({
    seed: seedFrom(state.seed, 'dev', fx.id), home: home ? mine : theirs, away: home ? theirs : mine, importance: 0.1, injuryFactor: injuryFactor(state) * 0.5,
  });
  const side: 0 | 1 = home ? 0 : 1;
  applyClubSide(state, fx, 'dev', res, side, club.id, false);
  const run: FixtureRun = { fixture: fx, result: res, sides: [{ input: home ? mine : theirs, selection: firstTeam }, { input: home ? theirs : mine, selection: firstTeam }], extra };
  const id = `${DEV_COMP_ID}:${fx.id}`;
  const rec = recordFor(state, id, DEV_COMP_ID, 'Reserve League', `Matchday ${fx.matchday}`, fx.day, home ? club.id : opp.id, home ? opp.id : club.id,
    home ? mine.name : theirs.name, home ? theirs.name : mine.name, run, true);
  const pre = { selected: 'notInSquad' as const, explain: [`Not in the first-team squad, so you played for the reserves.`] };
  const summary = userEffects(state, null, 'dev', res, side, null, pre, 0.6);
  summary.selected = 'start';
  summary.analysis.splice(0, 1, 'Reserve match: a chance to stay sharp and catch the manager\'s eye.');
  const ust = res.players[user.id];
  if (ust && ust.minutes >= 45) state.career.trainingPerformance = clamp(state.career.trainingPerformance + (ust.rating - 6.3) * 0.8, 0, 100);
  rec.userSummary = summary;
  compactRecord(rec, 2, user.id);
  state.matchRecords[id] = rec;
  state.userMatchLog.push(id);
  return rec;
}
