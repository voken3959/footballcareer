/**
 * The end of a career: retirement decisions as the player ages, a move abroad (played out in summary seasons), the reduced role,
 * and the legacy summary generated on retirement. A retired career is never deleted; its history stays readable.
 */
import type {
  Contract, GameState, LegacyClubSpell, LegacySummary, Player, Position, SeasonRecord, StatLine,
} from './types';
import { addStatLine, emptyStatLine } from './types';
import { Rng, clamp, seedFrom } from './rng';
import { ageAt, overall } from './attributes';
import { formatDate, seasonEndDay, seasonLabel } from './dates';
import { addMilestone } from './awards';
import { addNews, clubName, moveToClub, uid, userPlayer } from './util';
import { fairWage, money, roundWage } from './economy';
import { closeSpell } from './awards';
import { createFreeOffer, createPermanentOffer, openOffers } from './transfers';
import { financeSummary } from './life';
import type { ActionResult } from './transfers';

const fail = (message: string): ActionResult => ({ ok: false, message });
const ok = (message: string): ActionResult => ({ ok: true, message });

export const FORCED_RETIREMENT_AGE = 41;
export const EARLIEST_VOLUNTARY_RETIREMENT = 30;

export const ABROAD_CLUBS: { name: string; country: string }[] = [
  { name: 'Sporting Valmora', country: 'Valmora' },
  { name: 'Real Costa Verda', country: 'Costa Verda' },
  { name: 'FC Nordhavn', country: 'Nordhavn' },
  { name: 'Atletico Serrano', country: 'Serrano' },
  { name: 'Al-Zahra Stars', country: 'Zahra' },
  { name: 'Pacific City FC', country: 'the Pacific League' },
];

/* ------------------------------------------------------------------ decisions */

export function retirementOdds(age: number, ovr: number): number {
  if (age >= FORCED_RETIREMENT_AGE) return 1;
  if (age >= 38) return 0.9;
  if (age === 37) return 0.7;
  if (age === 36) return 0.5;
  if (age === 35) return 0.3;
  if (age === 34) return 0.15;
  if (age === 33) return ovr < 55 ? 0.1 : 0.04;
  if (age >= 31 && ovr < 45) return 0.06;
  return 0;
}

function hasRetirementDecision(state: GameState): boolean {
  return state.decisions.some((d) => d.kind === 'retirement');
}

/** The new season's retirement conversation (and the end of an overseas contract). Called by the season rollover. */
export function retirementRollover(state: GameState, rng: Rng, closedSeason: number): void {
  if (state.career.retired) return;
  const user = userPlayer(state);
  const age = ageAt(user.birthDay, state.day);
  if (state.flags.abroadClub) {
    simulateAbroadSeason(state, rng, closedSeason);
    const c = user.contract;
    if (!c || c.endDay <= state.day) {
      user.contract = null;
      if (age >= FORCED_RETIREMENT_AGE) { retireUser(state, 'At 41 your body has had enough.'); return; }
      pushDecision(state, age, true);
    }
    return;
  }
  if (hasRetirementDecision(state)) return;
  const ovr = overall(user);
  if (age >= FORCED_RETIREMENT_AGE) { retireUser(state, `At ${age} your body has told you it is time.`); return; }
  if (rng.chance(retirementOdds(age, ovr))) pushDecision(state, age, false);
}

function pushDecision(state: GameState, age: number, abroad: boolean): void {
  const user = userPlayer(state);
  const options = abroad
    ? [
      { id: 'continue_abroad', label: 'Sign another year abroad', detail: 'One more season in summary form, on similar money' },
      { id: 'return', label: 'Come home and look for a club', detail: 'You become a free agent and offers can arrive again' },
      { id: 'retire', label: 'Retire', detail: 'End your career and see your legacy' },
    ]
    : [
      { id: 'continue', label: 'Keep playing at this level', detail: 'You will be asked again next year' },
      ...(user.clubId && user.contract && !user.loan ? [{ id: 'reduced', label: 'Take a reduced role', detail: 'Lower wage (-25%), lighter training, fewer starts, one more year, more help for team-mates' }] : []),
      { id: 'lower', label: 'Continue at a lower level', detail: 'Clubs lower down the pyramid make offers; you may well play more' },
      { id: 'abroad', label: 'Move abroad', detail: 'A last adventure overseas. Seasons there are played out in summary form' },
      { id: 'retire', label: 'Retire', detail: 'End your career and see your legacy' },
    ];
  state.decisions.push({
    id: uid(state, 'dec'), kind: 'retirement', title: abroad ? 'Your overseas contract has ended' : `You are ${age}: what next?`, day: state.day, expiresDay: null,
    body: abroad
      ? `${String(state.flags.abroadClub)} will not be renewing automatically. It is your call.`
      : `Your body is not what it was, and ${age >= 36 ? 'the end of your career is close' : 'people around you are starting to ask what comes next'}. How do you want to go on?`,
    options, payload: { age, abroad },
  });
  state.career.retirementDecision = { offeredDay: state.day };
}

export function resolveRetirementDecision(state: GameState, decisionId: string, optionId: string): ActionResult {
  const d = state.decisions.find((x) => x.id === decisionId && x.kind === 'retirement');
  if (!d) return fail('That decision is no longer available.');
  if (!d.options.some((o) => o.id === optionId)) return fail('That is not one of the options.');
  const rng = new Rng(seedFrom(state.seed, 'retire', d.id, optionId));
  let res: ActionResult;
  switch (optionId) {
    case 'continue':
      res = ok('You decided to keep playing for now.');
      break;
    case 'reduced': res = takeReducedRole(state); break;
    case 'lower': res = stepDown(state, rng); break;
    case 'abroad': res = startAbroad(state, rng); break;
    case 'continue_abroad': res = renewAbroad(state); break;
    case 'return': res = returnFromAbroad(state); break;
    case 'retire': {
      retireUser(state, 'You decided it was time.');
      res = ok('You have retired. Your career summary is ready.');
      break;
    }
    default: res = fail('Unknown option.');
  }
  if (!res.ok) return res; // leave the decision open so the player can pick something else
  state.decisions = state.decisions.filter((x) => x.id !== d.id);
  if (state.career.retirementDecision) state.career.retirementDecision.choice = optionId;
  return res;
}

/* ----------------------------------------------------------- the individual options */

function takeReducedRole(state: GameState): ActionResult {
  const user = userPlayer(state);
  const c = user.contract;
  if (!c || !user.clubId) return fail('You have no contract to change.');
  const wage = roundWage(c.wage * 0.75);
  user.contract = { ...c, wage, endDay: Math.max(c.endDay, seasonEndDay(state.season)), role: 'Rotation option', bonuses: { ...c.bonuses, loyalty: 0 } };
  state.flags.reducedRole = true;
  state.training.plan.intensity = 'light';
  state.career.managerTrust = clamp(state.career.managerTrust + 8, 0, 100);
  state.reputation.club = clamp(state.reputation.club + 4, 0, 100);
  state.career.contracts.push({ day: state.day, clubId: user.clubId, wage, years: 1, role: 'Rotation option', kind: 'extended' });
  addNews(state, 'contract', `${user.displayName} agrees a reduced role`, `He takes a pay cut to ${money(wage)} a week and will help the younger players while playing less often.`, { clubId: user.clubId });
  return ok(`You agreed a reduced role: ${money(wage)} a week, lighter training and a place mostly on the bench and in the cups.`);
}

function stepDown(state: GameState, rng: Rng): ActionResult {
  const user = userPlayer(state);
  const myRep = user.clubId ? state.clubs[user.clubId].reputation : 55;
  const candidates = Object.values(state.clubs)
    .filter((c) => c.id !== user.clubId && c.reputation <= myRep - 6)
    .sort((a, b) => b.reputation - a.reputation);
  let made = 0;
  for (const c of candidates) {
    if (made >= 3) break;
    if (openOffers(state).some((o) => o.fromClubId === c.id)) continue;
    const o = user.clubId ? createPermanentOffer(state, rng, c) : createFreeOffer(state, rng, c, false);
    if (o) { o.expiresDay = Math.max(o.expiresDay, state.day + 30); made++; }
  }
  state.flags.stepDown = state.season;
  return made
    ? ok(`${made} club${made === 1 ? '' : 's'} lower down have made contact. See the Transfers screen.`)
    : ok('No club lower down could make you an offer right now. You carry on where you are for now.');
}

export function startAbroad(state: GameState, rng: Rng): ActionResult {
  const user = userPlayer(state);
  if (state.flags.abroadClub) return fail('You are already playing abroad.');
  const club = rng.pick(ABROAD_CLUBS);
  const age = ageAt(user.birthDay, state.day);
  const from = user.clubId;
  if (from) closeSpell(state, false);
  moveToClub(state, user, null);
  user.loan = null;
  const wage = roundWage(Math.max(user.contract?.wage ?? 0, fairWage(overall(user), user.potential, age, 70, user.reputation)) * 1.1);
  const years = age >= 37 ? 1 : 2;
  const contract: Contract = {
    id: `c${user.id}-abroad-${state.day}`, clubId: 'abroad', wage, startDay: state.day, endDay: seasonEndDay(state.season + years - 1), role: 'Regular starter',
    bonuses: { appearance: 0, goal: 0, cleanSheet: 0, signing: 0, signingPaid: true, loyalty: 0 }, releaseClause: null, type: 'professional',
  };
  user.contract = contract;
  state.flags.abroadClub = club.name;
  state.flags.abroadCountry = club.country;
  for (const o of openOffers(state)) o.status = 'withdrawn';
  state.career.transfers.push({ day: state.day, season: state.season, fromClubId: from, toClubId: null, toName: `${club.name} (${club.country})`, fee: 0, kind: 'free' });
  state.career.contracts.push({ day: state.day, clubId: 'abroad', wage, years, role: 'Regular starter', kind: 'signed' });
  addMilestone(state, `abroad:${state.day}`, `Moved abroad to ${club.name}`, `${money(wage)} a week for ${years} year${years === 1 ? '' : 's'}.`, 'transfer');
  addNews(state, 'transfer', `${user.displayName} moves abroad`, `${user.firstName} ${user.lastName} signs for ${club.name} in ${club.country} on ${money(wage)} a week.`, { important: true });
  return ok(`You signed for ${club.name} in ${club.country}. Your seasons there are played out in summary form.`);
}

function renewAbroad(state: GameState): ActionResult {
  const user = userPlayer(state);
  const wage = roundWage((state.career.contracts[state.career.contracts.length - 1]?.wage ?? 1000) * 0.95);
  user.contract = {
    id: `c${user.id}-abroad-${state.day}`, clubId: 'abroad', wage, startDay: state.day, endDay: seasonEndDay(state.season), role: 'Regular starter',
    bonuses: { appearance: 0, goal: 0, cleanSheet: 0, signing: 0, signingPaid: true, loyalty: 0 }, releaseClause: null, type: 'professional',
  };
  state.career.contracts.push({ day: state.day, clubId: 'abroad', wage, years: 1, role: 'Regular starter', kind: 'extended' });
  return ok(`You signed another year with ${String(state.flags.abroadClub)} on ${money(wage)} a week.`);
}

export function returnFromAbroad(state: GameState): ActionResult {
  const user = userPlayer(state);
  const name = String(state.flags.abroadClub ?? 'your overseas club');
  delete state.flags.abroadClub;
  delete state.flags.abroadCountry;
  user.contract = null;
  state.flags.freeSince = state.day;
  if (!state.transfers.freeAgentIds.includes(user.id)) state.transfers.freeAgentIds.push(user.id);
  addNews(state, 'transfer', `${user.displayName} leaves ${name}`, 'He is back in the home market and looking for a club.', {});
  return ok('You are home and available. Clubs will make offers.');
}

/** A season abroad, played out in summary: appearances, goals and a rating that follow the player's current ability. */
export function simulateAbroadSeason(state: GameState, rng: Rng, season: number): SeasonRecord {
  const user = userPlayer(state);
  const ovr = overall(user);
  const age = ageAt(user.birthDay, state.day);
  const share = clamp(0.4 + (ovr - 62) / 55 - Math.max(0, age - 34) * 0.04, 0.12, 0.95);
  const apps = Math.round(clamp(34 * share * rng.range(0.85, 1.05), 4, 36));
  const starts = Math.round(apps * clamp(0.5 + share * 0.45, 0.4, 0.97));
  const quality = (ovr / 70) ** 2;
  const rate: Record<Position, [number, number]> = {
    GK: [0, 0], CB: [0.05, 0.03], RB: [0.04, 0.12], LB: [0.04, 0.12], DM: [0.05, 0.08], CM: [0.1, 0.14], AM: [0.24, 0.24], RW: [0.26, 0.2], LW: [0.26, 0.2], ST: [0.46, 0.12],
  };
  const [gr, ar] = rate[user.position];
  const goals = Math.max(0, Math.round(apps * gr * quality * rng.range(0.7, 1.3)));
  const assists = Math.max(0, Math.round(apps * ar * quality * rng.range(0.7, 1.3)));
  const avg = clamp(6.35 + (ovr - 60) * 0.022 + rng.normal(0, 0.15), 5.6, 8.2);
  const line: StatLine = {
    ...emptyStatLine(), apps, starts, minutes: Math.round(starts * 84 + (apps - starts) * 24), goals, assists,
    yellows: Math.round(apps * rng.range(0.05, 0.2)), cleanSheets: user.position === 'GK' || user.position === 'CB' ? Math.round(apps * rng.range(0.2, 0.38)) : 0,
    ratingSum: avg * apps, motm: Math.round(goals * 0.12 + (avg > 7.2 ? 2 : 0)),
  };
  const intl = user.stats.intl ?? emptyStatLine();
  const champion = rng.chance(0.1 + Math.max(0, (ovr - 70) * 0.006));
  const clubLabel = String(state.flags.abroadClub ?? 'Overseas club');
  const trophies = champion ? [`${String(state.flags.abroadCountry ?? 'Overseas')} league title`] : [];
  const rec: SeasonRecord = {
    season, clubId: 'abroad', clubName: clubLabel, league: line, cup: emptyStatLine(), intl: { ...intl }, dev: emptyStatLine(),
    endOverall: Math.round(ovr), endPotential: user.potential, leaguePos: champion ? 1 : null,
    leagueName: `${String(state.flags.abroadCountry ?? 'Overseas')} league`, trophies, awards: [],
  };
  state.career.seasons.push(rec);
  state.career.appearances = addStatLine(state.career.appearances, line);
  if (champion) state.career.trophies.push({ season, compId: 'abroad', name: trophies[0], clubId: 'abroad', day: state.day });
  const r = state.career.records;
  if (goals > 0 && (!r.mostGoalsSeason || goals > r.mostGoalsSeason.value)) r.mostGoalsSeason = { season, value: goals };
  if (assists > 0 && (!r.mostAssistsSeason || assists > r.mostAssistsSeason.value)) r.mostAssistsSeason = { season, value: assists };
  delete user.stats.intl;
  addNews(state, 'life', `${seasonLabel(season)} abroad`, `${apps} appearances, ${goals} goals and ${assists} assists for ${clubLabel}${champion ? ', and a league title' : ''}.`, {});
  return rec;
}

/* ------------------------------------------------------------------ retirement */

export function canRetireNow(state: GameState): { ok: boolean; reason?: string } {
  const user = userPlayer(state);
  if (state.career.retired) return { ok: false, reason: 'You have already retired.' };
  if (ageAt(user.birthDay, state.day) < EARLIEST_VOLUNTARY_RETIREMENT) return { ok: false, reason: `You cannot retire before ${EARLIEST_VOLUNTARY_RETIREMENT}.` };
  return { ok: true };
}

/** Retire on your own initiative from the Career screen. */
export function retireNow(state: GameState): ActionResult {
  const st = canRetireNow(state);
  if (!st.ok) return fail(st.reason ?? 'You cannot retire yet.');
  retireUser(state, 'You decided it was time.');
  return ok('You have retired. Your career summary is ready.');
}

export function retireUser(state: GameState, reason: string): LegacySummary {
  const user = userPlayer(state);
  if (state.career.retired && state.career.legacy) return state.career.legacy;
  if (user.clubId) closeSpell(state, false);
  const lastClub = user.clubId;
  for (const o of state.transfers.offers) if (o.status === 'open' || o.status === 'negotiating') o.status = 'withdrawn';
  state.decisions = state.decisions.filter((d) => d.kind === 'retirement' ? false : d.kind !== 'life' && d.kind !== 'sponsor' && d.kind !== 'free_agent');
  state.career.retired = true;
  state.career.retiredDay = state.day;
  user.retired = true;
  if (lastClub) { state.flags.lastClubId = lastClub; moveToClub(state, user, null); }
  user.contract = null;
  user.loan = null;
  delete state.flags.abroadClub;
  state.transfers.freeAgentIds = state.transfers.freeAgentIds.filter((id) => id !== user.id);
  for (const s of state.finance.sponsorships) if (s.status === 'active') s.status = 'ended';
  const legacy = buildLegacy(state, reason);
  state.career.legacy = legacy;
  addMilestone(state, 'retired', 'Retired from football', `${legacy.verdict}. ${legacy.apps} appearances, ${legacy.goals} goals.`, 'retirement');
  addNews(state, 'milestone', `${user.displayName} announces his retirement`,
    `${legacy.retiredAge}-year-old ${user.firstName} ${user.lastName} ends his career with ${legacy.apps} appearances, ${legacy.goals} goals and ${legacy.trophies.length} trophies. ${legacy.verdict}.`, { important: true });
  return legacy;
}

/* ------------------------------------------------------------------ legacy */


function seasonScore(r: SeasonRecord, trophies: number, awards: number): number {
  const apps = r.league.apps + r.cup.apps;
  const goals = r.league.goals + r.cup.goals;
  const assists = r.league.assists + r.cup.assists;
  const avg = apps ? (r.league.ratingSum + r.cup.ratingSum) / apps : 6;
  return goals * 2.2 + assists * 1.4 + apps * 0.15 + trophies * 14 + awards * 12 + Math.max(0, avg - 6) * 10;
}

export function buildLegacy(state: GameState, reason: string): LegacySummary {
  const user: Player = userPlayer(state);
  const c = state.career;
  const a = c.appearances;
  const myTrophies = c.trophies.map((t) => ({ season: t.season, name: t.name, clubName: t.clubId === 'abroad' ? String(state.flags.abroadClub ?? 'Overseas') : clubName(state, t.clubId) }));
  const myAwards = state.awards.filter((x) => x.playerId === state.userId).map((x) => ({ season: x.season, award: x.award }));
  // club spells: every season record grouped by club
  const spells = new Map<string, LegacyClubSpell>();
  for (const r of c.seasons) {
    const s = spells.get(r.clubId) ?? { clubId: r.clubId, clubName: r.clubName, firstSeason: r.season, lastSeason: r.season, apps: 0, goals: 0, assists: 0, trophies: 0, score: 0 };
    s.firstSeason = Math.min(s.firstSeason, r.season);
    s.lastSeason = Math.max(s.lastSeason, r.season);
    s.apps += r.league.apps + r.cup.apps;
    s.goals += r.league.goals + r.cup.goals;
    s.assists += r.league.assists + r.cup.assists;
    spells.set(r.clubId, s);
  }
  for (const t of c.trophies) { const s = spells.get(t.clubId); if (s) s.trophies++; }
  for (const s of spells.values()) s.score = s.apps * 0.25 + s.goals * 2.5 + s.assists * 1.5 + s.trophies * 14 + (s.lastSeason - s.firstSeason + 1) * 3;
  const clubs = [...spells.values()].sort((x, y) => x.firstSeason - y.firstSeason);
  const bestSpell = [...clubs].sort((x, y) => y.score - x.score)[0] ?? null;

  let bestSeason: LegacySummary['bestSeason'] = null;
  let bestScore = -1;
  for (const r of c.seasons) {
    const tr = c.trophies.filter((t) => t.season === r.season && t.clubId === r.clubId).length;
    const aw = myAwards.filter((x) => x.season === r.season).length;
    const sc = seasonScore(r, tr, aw);
    if (sc > bestScore && r.league.apps + r.cup.apps > 0) {
      bestScore = sc;
      const apps = r.league.apps + r.cup.apps;
      const goals = r.league.goals + r.cup.goals;
      const assists = r.league.assists + r.cup.assists;
      const avg = apps ? (r.league.ratingSum + r.cup.ratingSum) / apps : 0;
      const extra = [...r.trophies, ...r.awards].slice(0, 3).join(', ');
      bestSeason = { season: r.season, clubName: r.clubName, line: `${apps} appearances, ${goals} goals, ${assists} assists, average rating ${avg.toFixed(2)}${extra ? `. ${extra}` : ''}` };
    }
  }

  const timeline: LegacySummary['timeline'] = [];
  const seen = new Set<string>();
  const add = (day: number, season: number, title: string, detail: string, kind: string) => {
    const key = `${day}:${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    timeline.push({ day, season, title, detail, kind });
  };
  for (const m of c.milestones) add(m.day, m.season, m.title, m.detail, m.kind);
  for (const t of c.transfers) {
    const to = t.toName ?? (t.toClubId ? clubName(state, t.toClubId) : 'free agency');
    const title = t.kind === 'academy' ? `Joined the ${to} academy` : t.kind === 'loan' ? `Loaned to ${to}` : t.kind === 'loan_return' ? 'Returned from loan' : `Joined ${to}`;
    add(t.day, t.season, title, t.fee > 0 ? `Fee ${money(t.fee)}.` : t.kind === 'free' ? 'Free transfer.' : '', 'transfer');
  }
  for (const t of c.trophies) add(t.day, t.season, `Won ${t.name}`, clubName(state, t.clubId), 'trophy');
  for (const inj of c.injuries) if (inj.days >= 45) add(inj.day, state.season, `Long injury: ${inj.type}`, `${inj.days} days out.`, 'injury');
  timeline.sort((x, y) => x.day - y.day);
  if (timeline.length > 160) timeline.splice(0, timeline.length - 160);

  const age = ageAt(user.birthDay, state.day);
  const peak = c.highestOverall;
  const nClubs = clubs.filter((x) => x.clubId !== 'abroad').length;
  const seasonsPlayed = c.seasons.length;
  let verdict: string;
  let detail: string;
  if (peak >= 85 && c.trophies.length >= 5) { verdict = 'An all-time great'; detail = 'Among the very best the game has seen: world-class, and he won the big prizes.'; }
  else if (peak >= 80 && (c.trophies.length >= 2 || state.international.caps >= 40)) { verdict = 'A world-class star'; detail = 'A genuine star who played at the highest level for years.'; }
  else if (nClubs === 1 && seasonsPlayed >= 8) { verdict = 'A one-club legend'; detail = 'Loyal to one badge for the best part of a career.'; }
  else if (peak >= 72 && state.international.caps >= 20) { verdict = 'An international regular'; detail = 'A dependable top-division player who represented his country many times.'; }
  else if (peak >= 68) { verdict = 'A solid top-flight professional'; detail = 'A proper career at a good level.'; }
  else if (a.apps >= 300) { verdict = 'A dependable journeyman'; detail = 'Never a star, always a pro, and more than 300 games to prove it.'; }
  else if (c.startOverall + 8 <= peak && peak >= 60) { verdict = 'A late bloomer made good'; detail = 'He came a long way from where he started.'; }
  else { verdict = 'An honest professional'; detail = 'A career spent doing the job as well as he could.'; }

  const fin = financeSummary(state);
  return {
    retiredDay: state.day, retiredAge: age, reason, apps: a.apps, goals: a.goals, assists: a.assists, motm: a.motm,
    avgRating: a.apps ? a.ratingSum / a.apps : 0, cleanSheets: a.cleanSheets, caps: state.international.caps, intlGoals: state.international.goals,
    highestOverall: peak, startOverall: c.startOverall, endOverall: Math.round(overall(user)), careerEarnings: state.finance.careerEarnings, netWorth: fin.netWorth,
    clubs, trophies: myTrophies, awards: myAwards, bestSeason, bestSpell, timeline, verdict, verdictDetail: detail,
  };
}

export function retirementSummaryText(l: LegacySummary): string[] {
  return [
    `Retired aged ${l.retiredAge} on ${formatDate(l.retiredDay)}. ${l.verdict}.`,
    `${l.apps} appearances, ${l.goals} goals, ${l.assists} assists. Highest rating ${l.highestOverall}.`,
    `${l.caps} international caps. ${l.trophies.length} trophies, ${l.awards.length} awards.`,
    `Career earnings ${money(l.careerEarnings)}.`,
  ];
}

