/** News generated from real game events only. Each headline is built from facts in the state, never invented. */
import type { Fixture, GameState, MatchRecord, Player } from './types';
import { addNews, clubName, shortName } from './util';
import { seasonLabel } from './dates';
import { money } from './economy';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
export { ordinal };

function scorerLines(state: GameState, rec: MatchRecord): string {
  const goals = rec.result.events.filter((e) => e.type === 'goal' || e.type === 'own_goal');
  if (!goals.length) return 'No goals.';
  return goals.map((e) => {
    const name = rec.playerNames[e.p ?? ''] ?? 'Unknown';
    return `${name}${e.type === 'own_goal' ? ' (og)' : e.d?.pen ? ' (pen)' : ''} ${e.min + (e.add ? 0 : 0)}'`;
  }).join(', ');
}

export function matchReportNews(state: GameState, rec: MatchRecord, userClubId: string, fx: Fixture | null): void {
  const r = rec.result;
  const home = rec.homeName;
  const away = rec.awayName;
  const mine = userClubId === rec.homeId ? 0 : 1;
  const my = mine === 0 ? r.hg : r.ag;
  const their = mine === 0 ? r.ag : r.hg;
  const opp = mine === 0 ? away : home;
  const us = mine === 0 ? home : away;
  let verb = my > their ? 'beat' : my < their ? 'lose to' : 'draw with';
  if (r.pens) verb = r.pens[mine] > r.pens[1 - mine] ? 'edge past' : 'lose on penalties to';
  const score = `${r.hg}-${r.ag}${r.pens ? ` (${r.pens[0]}-${r.pens[1]} pens)` : r.et ? ' aet' : ''}`;
  const u = rec.userSummary;
  let headline = `${us} ${verb} ${opp}, ${score}`;
  if (u && u.goals >= 2) headline = `${state.players[state.userId].displayName} ${u.goals === 2 ? 'double' : u.goals === 3 ? 'hat-trick' : `${u.goals}-goal haul`}: ${us} ${verb} ${opp}, ${score}`;
  else if (u && u.goals === 1 && my > their) headline = `${state.players[state.userId].displayName} on target as ${us} ${verb} ${opp}, ${score}`;
  const body = [
    `${rec.compName} - ${rec.round}. ${home} ${r.hg}-${r.ag} ${away}${r.et ? ' after extra time' : ''}${r.pens ? `, ${r.pens[0]}-${r.pens[1]} on penalties` : ''}.`,
    `Goals: ${scorerLines(state, rec)}`,
    u ? (u.minutes > 0 ? `${shortName(state.players[state.userId])} played ${u.minutes} minutes and was rated ${u.rating?.toFixed(1)}.` : u.selected === 'injured' ? 'You missed the match through injury.' : u.selected === 'suspended' ? 'You missed the match through suspension.' : `You did not play (${u.selected === 'bench' || u.selected === 'unused' ? 'unused substitute' : 'not in the matchday squad'}).`) : '',
  ].filter(Boolean).join(' ');
  addNews(state, fx?.knockout || rec.compId.startsWith('CUP') ? 'cup' : 'match', headline, body, { clubId: userClubId, important: !!u && (u.goals >= 2 || (u.rating ?? 0) >= 8.5) });
}

export function injuryNews(state: GameState, p: Player, type: string, days: number, userClub: boolean): void {
  const weeks = days >= 14 ? `about ${Math.round(days / 7)} weeks` : `${days} day${days === 1 ? '' : 's'}`;
  addNews(state, 'injury', `${p.displayName} out for ${weeks} with ${type.toLowerCase()}`,
    `${clubName(state, p.clubId)} confirm that ${p.firstName} ${p.lastName} will be sidelined for ${weeks} (${type.toLowerCase()}).`,
    { clubId: p.clubId ?? undefined, important: p.id === state.userId || (userClub && days > 40) });
}

export function recoveryNews(state: GameState, p: Player): void {
  addNews(state, 'injury', `${p.displayName} is back in training`, `${p.firstName} ${p.lastName} has recovered and is available for selection again, though match sharpness will take time to return.`, { clubId: p.clubId ?? undefined });
}

export function suspensionNews(state: GameState, p: Player, why: string): void {
  addNews(state, 'club', `${p.displayName} suspended`, `${p.firstName} ${p.lastName} will miss the next match: ${why}.`, { clubId: p.clubId ?? undefined });
}

export function matchdayRoundup(state: GameState, leagueName: string, md: number, lines: string[]): void {
  if (!lines.length) return;
  addNews(state, 'league', `${leagueName}: matchday ${md} round-up`, lines.join(' '), {});
}

export function transferNews(state: GameState, headline: string, body: string, important = false): void {
  addNews(state, 'transfer', headline, body, { important });
}

export function seasonOpenNews(state: GameState): void {
  addNews(state, 'league', `The ${seasonLabel(state.season)} season is under way`, 'Fixtures are set, the transfer window is open and every club starts level.', {});
}

export function feeText(fee: number): string {
  return fee > 0 ? money(fee) : 'a free transfer';
}
