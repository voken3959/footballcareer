/**
 * Achievements, career milestones, trophies and end-of-season awards. Everything here is derived from recorded match data:
 * nothing is granted unless the underlying competition has finished or the statistic has actually been reached.
 */
import type {
  AwardRecord, Competition, GameState, Milestone, MatchRecord, Player, Position, SeasonRecord, StatLine,
} from './types';
import { emptyStatLine } from './types';
import { ageAt, overall } from './attributes';
import { addNews, clubName } from './util';
import { leagueTable, positionIn } from './competitions';
import { seasonLabel } from './dates';
import { clubLeague, templateName } from './season';

export interface AchievementDef { id: string; title: string; detail: string; kind: Milestone['kind'] }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'debut', title: 'Professional debut', detail: 'Played your first first-team match.', kind: 'debut' },
  { id: 'first_goal', title: 'First goal', detail: 'Scored your first first-team goal.', kind: 'goal' },
  { id: 'first_assist', title: 'First assist', detail: 'Set up your first first-team goal.', kind: 'goal' },
  { id: 'first_hattrick', title: 'First hat-trick', detail: 'Scored three goals in one match.', kind: 'hattrick' },
  { id: 'first_motm', title: 'First man of the match', detail: 'Named the best player on the pitch.', kind: 'rating' },
  { id: 'first_trophy', title: 'First trophy', detail: 'Won a competition with your club.', kind: 'trophy' },
  { id: 'first_transfer', title: 'First transfer', detail: 'Moved to a new club.', kind: 'transfer' },
  { id: 'first_cap', title: 'First international cap', detail: 'Played for the senior national team.', kind: 'cap' },
  { id: 'first_intl_goal', title: 'First international goal', detail: 'Scored for your country.', kind: 'cap' },
  { id: 'apps_50', title: '50 first-team appearances', detail: 'Reached 50 league and cup appearances.', kind: 'apps' },
  { id: 'apps_100', title: '100 career appearances', detail: 'Reached 100 league and cup appearances.', kind: 'apps' },
  { id: 'apps_250', title: '250 career appearances', detail: 'Reached 250 league and cup appearances.', kind: 'apps' },
  { id: 'goals_10', title: '10 career goals', detail: 'Scored 10 first-team goals.', kind: 'goals' },
  { id: 'goals_50', title: '50 career goals', detail: 'Scored 50 first-team goals.', kind: 'goals' },
  { id: 'goals_100', title: '100 career goals', detail: 'Scored 100 first-team goals.', kind: 'goals' },
  { id: 'ovr_55', title: 'Rated 55 overall', detail: 'A solid professional level.', kind: 'rating' },
  { id: 'ovr_65', title: 'Rated 65 overall', detail: 'Good enough for the top flight.', kind: 'rating' },
  { id: 'ovr_75', title: 'Rated 75 overall', detail: 'A genuine top-division performer.', kind: 'rating' },
  { id: 'ovr_85', title: 'Rated 85 overall', detail: 'World-class territory.', kind: 'rating' },
  { id: 'first_extension', title: 'Signed a new contract', detail: 'Agreed a new deal with your club.', kind: 'contract' },
  { id: 'young_poty', title: 'Young Player of the Year', detail: 'Won the young player award in your league.', kind: 'award' },
  { id: 'poty', title: 'Player of the Year', detail: 'Won the player award in your league.', kind: 'award' },
  { id: 'golden_boot', title: 'Top scorer', detail: 'Finished as the leading league scorer.', kind: 'award' },
  { id: 'promotion', title: 'Promoted', detail: 'Won promotion with your club.', kind: 'trophy' },
  { id: 'team_of_season', title: 'Team of the Season', detail: 'Named in the league team of the season.', kind: 'award' },
  { id: 'first_home', title: 'Own front door', detail: 'Bought your own home.', kind: 'life' },
  { id: 'investor', title: 'Investor', detail: 'Made your first investment.', kind: 'life' },
  { id: 'first_sponsor', title: 'Sponsored', detail: 'Signed your first sponsorship deal.', kind: 'life' },
  { id: 'millionaire', title: 'Millionaire', detail: 'Held a balance of £1,000,000 or more.', kind: 'life' },
  { id: 'community_hero', title: 'Community hero', detail: 'Took part in three charity or community events.', kind: 'life' },
  { id: 'cap_10', title: '10 international caps', detail: 'Played ten times for your country.', kind: 'cap' },
  { id: 'cap_50', title: '50 international caps', detail: 'Played fifty times for your country.', kind: 'cap' },
  { id: 'long_career', title: 'Still going', detail: 'Played professionally at 35 or older.', kind: 'apps' },
  { id: 'one_club', title: 'One-club player', detail: 'Completed five seasons at the same club.', kind: 'apps' },
];

export const achievementDef = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

export function unlock(state: GameState, id: string, detailOverride?: string): boolean {
  if (state.career.achievements[id] !== undefined) return false;
  const def = achievementDef(id);
  if (!def) return false;
  state.career.achievements[id] = state.day;
  const m: Milestone = { id: `ach:${id}`, day: state.day, season: state.season, title: def.title, detail: detailOverride ?? def.detail, kind: def.kind };
  state.career.milestones.push(m);
  addNews(state, 'milestone', `${state.players[state.userId].displayName}: ${def.title.toLowerCase()}`, detailOverride ?? def.detail, { clubId: state.players[state.userId].clubId ?? undefined, important: true });
  return true;
}

export function addMilestone(state: GameState, id: string, title: string, detail: string, kind: Milestone['kind']): void {
  if (state.career.milestones.some((m) => m.id === id)) return;
  state.career.milestones.push({ id, day: state.day, season: state.season, title, detail, kind });
}

/** Called after each of the user's matches (first-team and reserve). */
export function afterUserMatch(state: GameState, rec: MatchRecord): void {
  const s = rec.userSummary;
  if (!s || rec.isDev || s.minutes <= 0) return;
  const a = state.career.appearances;
  const user = state.players[state.userId];
  if (a.apps >= 1) unlock(state, 'debut', `Debut for ${clubName(state, user.clubId)} against ${rec.homeId === user.clubId ? rec.awayName : rec.homeName} in the ${rec.compName}.`);
  if (a.goals >= 1) unlock(state, 'first_goal');
  if (a.assists >= 1) unlock(state, 'first_assist');
  if (s.goals >= 3) unlock(state, 'first_hattrick');
  if (rec.result.motm === state.userId) unlock(state, 'first_motm');
  for (const n of [50, 100, 250]) if (a.apps >= n) unlock(state, `apps_${n}`);
  for (const n of [10, 50, 100]) if (a.goals >= n) unlock(state, `goals_${n}`);
  if (user.clubId) {
    const rec2 = state.career.records.mostAppsClub;
    rec2[user.clubId] = (rec2[user.clubId] ?? 0) + 1;
  }
  if (s.goals >= 2) addMilestone(state, `brace:${rec.fixtureId}`, `${s.goals} goals against ${rec.homeId === user.clubId ? rec.awayName : rec.homeName}`, `${rec.homeName} ${rec.result.hg}-${rec.result.ag} ${rec.awayName}.`, 'goal');
}

/** Overall-rating milestones and "fastest to" records. Call weekly. */
export function checkRatingMilestones(state: GameState): void {
  const p = state.players[state.userId];
  const ovr = overall(p);
  if (ovr > state.career.highestOverall) state.career.highestOverall = ovr;
  for (const n of [55, 65, 75, 85]) {
    if (ovr >= n) {
      unlock(state, `ovr_${n}`, `Reached ${n} overall at ${ageAt(p.birthDay, state.day)} years old.`);
      if (state.career.records.firstTo[`ovr${n}`] === undefined) state.career.records.firstTo[`ovr${n}`] = state.day;
    }
  }
}

/* --------------------------------------------------------------- competitions */

export function competitionCompleted(state: GameState, comp: Competition): void {
  if (comp.completed && state.history.some((h) => h.compId === comp.id)) return;
  comp.completed = true;
  let winner = comp.winnerId;
  let runnerUp = comp.runnerUpId;
  if (comp.type === 'league') {
    const table = leagueTable(state, comp.id);
    winner = table[0]?.clubId;
    runnerUp = table[1]?.clubId;
    comp.winnerId = winner;
    comp.runnerUpId = runnerUp;
  }
  if (!winner) return;
  state.history.push({ season: comp.season, compId: comp.id, name: comp.name, winnerId: winner, runnerUpId: runnerUp });
  const user = state.players[state.userId];
  const mine = user.clubId === winner;
  addNews(state, comp.type === 'cup' ? 'cup' : 'league',
    `${clubName(state, winner)} win the ${comp.name} ${seasonLabel(comp.season)}`,
    comp.type === 'cup'
      ? `${clubName(state, winner)} beat ${clubName(state, runnerUp)} in the final to lift the trophy.`
      : `${clubName(state, winner)} are champions of the ${comp.name}, with ${clubName(state, runnerUp)} second.`,
    { clubId: winner, important: mine });
  if (mine) {
    const kind = comp.type === 'cup' ? 'cup' : 'league';
    const line = user.stats[kind];
    const qualifies = (line?.apps ?? 0) >= (comp.type === 'league' ? 5 : 1);
    if (qualifies) {
      state.career.trophies.push({ season: comp.season, compId: comp.id, name: `${comp.name} ${seasonLabel(comp.season)}`, clubId: winner, day: state.day });
      unlock(state, 'first_trophy', `${comp.name} ${seasonLabel(comp.season)} with ${clubName(state, winner)}.`);
      addMilestone(state, `trophy:${comp.id}`, `Won the ${comp.name}`, `${clubName(state, winner)}, ${seasonLabel(comp.season)}.`, 'trophy');
    } else {
      addNews(state, 'milestone', 'Champions, but no medal for you', `${clubName(state, winner)} won the ${comp.name}, but you made too few appearances to receive a winner's medal.`, { clubId: winner });
    }
  }
}

/* ------------------------------------------------------------------- awards */

interface Cand { p: Player; line: StatLine; clubId: string; leagueId: string }

function candidates(state: GameState, template: string, season: number): { list: Cand[]; clubPos: Map<string, number>; n: number } {
  const comp = state.competitions[`${template}-${season}`];
  const table = comp ? leagueTable(state, comp.id) : [];
  const clubPos = new Map(table.map((r, i) => [r.clubId, i + 1]));
  const list: Cand[] = [];
  for (const id of comp?.clubIds ?? []) {
    for (const pid of state.squads[id] ?? []) {
      const p = state.players[pid];
      const line = p?.stats.league;
      if (!p || !line || line.apps === 0) continue;
      list.push({ p, line, clubId: id, leagueId: template });
    }
  }
  return { list, clubPos, n: table.length || 1 };
}

const avgRating = (l: StatLine) => (l.apps ? l.ratingSum / l.apps : 0);

export function computeSeasonAwards(state: GameState, season: number): AwardRecord[] {
  const out: AwardRecord[] = [];
  for (const template of ['L1', 'L2']) {
    const { list, clubPos, n } = candidates(state, template, season);
    if (!list.length) continue;
    const score = (c: Cand) => avgRating(c.line) * Math.min(1, Math.sqrt(c.line.minutes / 2000)) + ((n - (clubPos.get(c.clubId) ?? n)) / n) * 0.3 + (c.p.position === 'ST' || c.p.position === 'AM' ? c.line.goals * 0.012 : 0);
    const eligible = list.filter((c) => c.line.minutes >= 1200);
    const pushAward = (award: string, c: Cand | undefined, value?: string) => {
      if (c) out.push({ season, award, playerId: c.p.id, clubId: c.clubId, value, leagueId: template });
    };
    const scorers = [...list].sort((a, b) => b.line.goals - a.line.goals || a.line.minutes - b.line.minutes);
    if (scorers[0] && scorers[0].line.goals > 0) pushAward('Top Scorer', scorers[0], `${scorers[0].line.goals} goals`);
    const assisters = [...list].sort((a, b) => b.line.assists - a.line.assists || a.line.minutes - b.line.minutes);
    if (assisters[0] && assisters[0].line.assists > 0) pushAward('Top Assister', assisters[0], `${assisters[0].line.assists} assists`);
    const poty = [...eligible].sort((a, b) => score(b) - score(a))[0];
    pushAward('Player of the Year', poty, poty ? `${avgRating(poty.line).toFixed(2)} avg rating` : undefined);
    const young = [...eligible].filter((c) => ageAt(c.p.birthDay, state.day) <= 21).sort((a, b) => score(b) - score(a))[0];
    pushAward('Young Player of the Year', young, young ? `${avgRating(young.line).toFixed(2)} avg rating` : undefined);
    const gk = [...eligible].filter((c) => c.p.position === 'GK').sort((a, b) => (score(b) + b.line.cleanSheets * 0.02) - (score(a) + a.line.cleanSheets * 0.02))[0];
    pushAward('Goalkeeper of the Year', gk, gk ? `${gk.line.cleanSheets} clean sheets` : undefined);
    // team of the season: best player per slot
    const taken = new Set<string>();
    const pick = (positions: Position[], label: string, count = 1) => {
      const pool = list.filter((c) => positions.includes(c.p.position) && c.line.minutes >= 900 && !taken.has(c.p.id)).sort((a, b) => score(b) - score(a));
      for (const c of pool.slice(0, count)) { taken.add(c.p.id); pushAward('Team of the Season', c, label); }
    };
    pick(['GK'], 'GK');
    pick(['RB'], 'RB');
    pick(['CB'], 'CB', 2);
    pick(['LB'], 'LB');
    pick(['DM', 'CM', 'AM'], 'MID', 3);
    pick(['RW'], 'RW');
    pick(['ST'], 'ST');
    pick(['LW'], 'LW');
  }
  return out;
}

export function describeAward(state: GameState, a: AwardRecord): string {
  const p = state.players[a.playerId];
  return `${a.award} (${a.leagueId ? templateName(a.leagueId) : ''}): ${p?.displayName ?? '?'}, ${clubName(state, a.clubId)}${a.value && a.award !== 'Team of the Season' ? ` - ${a.value}` : ''}`;
}


/* ------------------------------------------------------------ season records */

/**
 * Close the user's current spell at a club: write a season-by-season row and reset the club statistics. Called when
 * he leaves a club mid-season and (with final = true) at the end of the season. International statistics belong to the
 * season, not the club, so they are written once, with the final row.
 */
export function closeSpell(state: GameState, final: boolean): SeasonRecord | null {
  const p = state.players[state.userId];
  const clubId = p.clubId;
  if (!clubId) return null;
  const comp = clubLeague(state, clubId);
  const table = comp ? leagueTable(state, comp.id) : [];
  const pos = final && comp?.completed ? positionIn(table, clubId) || null : null;
  const league = p.stats.league ?? emptyStatLine();
  const cup = p.stats.cup ?? emptyStatLine();
  const dev = p.stats.dev ?? emptyStatLine();
  const intl = final ? p.stats.intl ?? emptyStatLine() : emptyStatLine();
  const empty = league.apps + cup.apps + dev.apps + intl.apps === 0;
  const awards = final ? state.awards.filter((a) => a.season === state.season && a.playerId === state.userId).map((a) => a.award) : [];
  const trophies = final ? state.career.trophies.filter((t) => t.season === state.season || t.compId.endsWith(`-${state.season}`)).map((t) => t.name) : [];
  let rec: SeasonRecord | null = null;
  if (!empty || final) {
    rec = {
      season: state.season, clubId, clubName: state.clubs[clubId].name, league: { ...league }, cup: { ...cup }, intl: { ...intl }, dev: { ...dev },
      endOverall: Math.round(overall(p)), endPotential: p.potential, leaguePos: pos, leagueName: comp?.name ?? '', trophies, awards,
    };
    state.career.seasons.push(rec);
  }
  const goals = state.career.seasons.filter((s) => s.season === state.season).reduce((a, s) => a + s.league.goals + s.cup.goals, 0);
  const assists = state.career.seasons.filter((s) => s.season === state.season).reduce((a, s) => a + s.league.assists + s.cup.assists, 0);
  const r = state.career.records;
  if (goals > 0 && (!r.mostGoalsSeason || goals > r.mostGoalsSeason.value)) r.mostGoalsSeason = { season: state.season, value: goals };
  if (assists > 0 && (!r.mostAssistsSeason || assists > r.mostAssistsSeason.value)) r.mostAssistsSeason = { season: state.season, value: assists };
  delete p.stats.league;
  delete p.stats.cup;
  delete p.stats.dev;
  if (final) delete p.stats.intl;
  return rec;
}
