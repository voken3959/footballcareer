/**
 * End of season: final tables, awards, promotion and relegation, ageing and development for the whole world, retirements,
 * contract expiry, youth intake, squad refills, manager changes, the user's season record and the set-up of the next season.
 */
import type { AwardRecord, Club, GameState, Player, Position, SeasonSummary } from './types';
import { Rng, clamp, seedFrom } from './rng';
import { dayOf, seasonLabel } from './dates';
import { ageAt, overall } from './attributes';
import { developAnnual } from './progression';
import { computeSeasonAwards, closeSpell, competitionCompleted, describeAward, unlock, addMilestone } from './awards';
import { leagueTable, positionIn } from './competitions';
import { cupOf, getPlan, leagueOf, setupSeason } from './season';
import { addNews, clubName, moveToClub, userPlayer, uid } from './util';
import { genContract, makeManager, clubLevel, freeShirt } from './world';
import { generatePlayer } from './playerGen';
import { academyWage, marketValue, transferBudgetFor } from './economy';
import { baselineMorale } from './progression';
import { rolloverInternational, setupInternational, refreshPools } from './international';
import { simulateAndApply } from './matchday';
import { randomNationality } from './world';
import { squadOf } from './selection';
import { compactRecord } from './matchday';
import { payOnce } from './finance';
import { completePreContract } from './transfers';
import { retirementRollover } from './retirement';

const MIN_BY_POS: Record<Position, number> = { GK: 3, CB: 4, RB: 2, LB: 2, DM: 2, CM: 3, AM: 1, RW: 2, LW: 2, ST: 3 };

function retireChance(age: number, ovr: number): number {
  if (age >= 40) return 1;
  if (age >= 37) return 0.8;
  if (age === 36) return 0.55;
  if (age === 35) return 0.35;
  if (age === 34) return 0.18;
  if (age === 33) return 0.07 + (ovr < 50 ? 0.1 : 0);
  if (age === 32) return ovr < 48 ? 0.08 : 0.01;
  return 0;
}

function playShare(p: Player): number {
  const m = (p.stats.league?.minutes ?? 0) + (p.stats.cup?.minutes ?? 0);
  return clamp(m / 2700, 0, 1);
}

export function retirePlayer(state: GameState, p: Player): void {
  moveToClub(state, p, null);
  p.retired = true;
  p.contract = null;
  state.transfers.freeAgentIds = state.transfers.freeAgentIds.filter((id) => id !== p.id);
}

function releasePlayer(state: GameState, p: Player): void {
  moveToClub(state, p, null);
  p.contract = null;
  p.loan = null;
}

function youthIntake(state: GameState, rng: Rng, club: Club, season: number, startDay: number): void {
  const count = rng.int(2, 3) + (club.youthFacilities >= 14 ? 1 : 0);
  const squad = squadOf(state, club.id);
  const needs = (Object.keys(MIN_BY_POS) as Position[]).map((pos) => ({
    pos, w: Math.max(0.3, MIN_BY_POS[pos] + 1 - squad.filter((p) => p.position === pos).length),
  }));
  for (let i = 0; i < count; i++) {
    const pos = rng.weighted(needs.map((n) => n.pos), needs.map((n) => n.w));
    const age = rng.int(16, 18);
    const base = clubLevel(club.reputation) - 17 + club.youthFacilities * 0.3 + rng.normal(0, 3.2) + (age - 16) * 2.2;
    const p = generatePlayer(rng, {
      id: uid(state, 'p'), position: pos, ovr: clamp(Math.round(base), 22, 70), age, nationality: randomNationality(rng), clubId: club.id,
      clubRep: club.reputation, day: startDay,
    });
    p.contract = {
      ...genContract(rng, p, club, startDay, season, age), wage: academyWage(club.reputation), role: 'Youth prospect', type: 'academy',
      endDay: dayOf(season + rng.int(1, 2), 6, 30),
    };
    p.shirt = freeShirt(squadOf(state, club.id), 0);
    state.players[p.id] = p;
    state.squads[club.id].push(p.id);
  }
}

function refillPositions(state: GameState, rng: Rng, club: Club, season: number, startDay: number): void {
  for (const pos of Object.keys(MIN_BY_POS) as Position[]) {
    let have = squadOf(state, club.id).filter((p) => p.position === pos).length;
    while (have < MIN_BY_POS[pos]) {
      // prefer a free agent who fits the club's level, otherwise bring up a youngster
      const level = clubLevel(club.reputation);
      const fa = state.transfers.freeAgentIds.map((id) => state.players[id]).filter((p) => p && p.id !== state.userId && p.position === pos && !p.retired && ageAt(p.birthDay, startDay) <= 35)
        .sort((a, b) => Math.abs(overall(a) - (level - 5)) - Math.abs(overall(b) - (level - 5)))[0];
      if (fa && overall(fa) >= level - 14) {
        moveToClub(state, fa, club.id);
        fa.contract = genContract(rng, fa, club, startDay, season, ageAt(fa.birthDay, startDay));
        fa.shirt = freeShirt(squadOf(state, club.id).filter((x) => x.id !== fa.id), 0);
      } else {
        const age = rng.int(18, 24);
        const p = generatePlayer(rng, {
          id: uid(state, 'p'), position: pos, ovr: clamp(Math.round(level - 7 + rng.normal(0, 3)), 28, 85), age, nationality: randomNationality(rng),
          clubId: club.id, clubRep: club.reputation, day: startDay,
        });
        p.contract = genContract(rng, p, club, startDay, season, age);
        p.shirt = freeShirt(squadOf(state, club.id), 0);
        state.players[p.id] = p;
        state.squads[club.id].push(p.id);
      }
      have++;
    }
  }
}

function newsRelegationPromotion(state: GameState, rel: string[], pro: string[]): void {
  addNews(state, 'league', 'Promotion and relegation confirmed',
    `Promoted to the Elite Division: ${pro.map((c) => clubName(state, c)).join(', ')}. Relegated to the Challenge Division: ${rel.map((c) => clubName(state, c)).join(', ')}.`, { important: true });
}

export function rolloverSeason(state: GameState, rng: Rng): SeasonSummary {
  const season = state.season;
  const plan = getPlan(state);
  const user = userPlayer(state);
  const startDay = dayOf(season + 1, 7, 1);
  const oldClubId = user.clubId;

  // 0. safety: finish anything still open so tables are final
  for (const comp of Object.values(state.competitions)) {
    if (comp.season !== season || comp.type === 'intl') continue;
    for (const id of comp.fixtureIds) {
      const f = state.fixtures[id];
      if (f && !f.played) simulateAndApply(state, f);
    }
    if (comp.type === 'league' && !comp.completed) competitionCompleted(state, comp);
  }

  // 1. tables
  const l1 = leagueOf(state, 'L1', season);
  const l2 = leagueOf(state, 'L2', season);
  const t1 = l1 ? leagueTable(state, l1.id) : [];
  const t2 = l2 ? leagueTable(state, l2.id) : [];
  const userLeagueId = oldClubId ? state.clubs[oldClubId].leagueId : null;
  const userTable = userLeagueId === 'L2' ? t2 : t1;
  const leaguePos = oldClubId ? positionIn(userTable, oldClubId) || null : null;
  const cup = cupOf(state, season);

  // 2. awards
  const awards: AwardRecord[] = computeSeasonAwards(state, season);
  state.awards.push(...awards);
  const mine = awards.filter((a) => a.playerId === state.userId);
  const headline = awards.filter((a) => a.award !== 'Team of the Season' && (a.leagueId === 'L1' || a.playerId === state.userId));
  for (const a of headline.slice(0, 8)) addNews(state, 'award', `${a.award}: ${state.players[a.playerId]?.displayName}`, describeAward(state, a), { important: a.playerId === state.userId });
  for (const a of mine) {
    const label = `${a.award}${a.value && a.award !== 'Team of the Season' ? ` (${a.value})` : ''}`;
    if (a.award === 'Player of the Year') unlock(state, 'poty', label);
    else if (a.award === 'Young Player of the Year') unlock(state, 'young_poty', label);
    else if (a.award === 'Top Scorer') unlock(state, 'golden_boot', label);
    else if (a.award === 'Team of the Season') unlock(state, 'team_of_season');
    addMilestone(state, `award:${season}:${a.award}`, a.award, `${seasonLabel(season)}: ${label}.`, 'award');
  }

  // 3. promotion and relegation (three up, three down)
  const rel = t1.slice(-3).map((r) => r.clubId);
  const pro = t2.slice(0, 3).map((r) => r.clubId);
  const userPromoted = !!oldClubId && pro.includes(oldClubId);
  const userRelegated = !!oldClubId && rel.includes(oldClubId);
  if ((userPromoted) && (user.stats.league?.apps ?? 0) >= 5) unlock(state, 'promotion', `${clubName(state, oldClubId)} won promotion to the Elite Division.`);
  closeSpell(state, true);
  for (const id of rel) { state.clubs[id].leagueId = 'L2'; state.clubs[id].division = 2; }
  for (const id of pro) { state.clubs[id].leagueId = 'L1'; state.clubs[id].division = 1; }
  newsRelegationPromotion(state, rel, pro);

  // 4. club money, reputation and managers
  for (const [tpl, table] of [['L1', t1], ['L2', t2]] as const) {
    table.forEach((row, i) => {
      const club = state.clubs[row.clubId];
      const pos = i + 1;
      const prize = club.income * (tpl === 'L1' ? 3.2 - pos * 0.12 : 1.3 - pos * 0.045);
      club.balance += Math.round(prize);
      const delta = pos === 1 ? 2.2 : pos <= 3 ? 1.1 : pos >= table.length - 2 ? -1.3 : 0;
      club.reputation = clamp(club.reputation + delta + (tpl === 'L2' && pos <= 3 ? 1.5 : 0) - (tpl === 'L1' && pos > 13 ? 1 : 0), 15, 97);
    });
  }
  for (const id of pro) { state.clubs[id].income = Math.round(state.clubs[id].income * 1.18); }
  for (const id of rel) { state.clubs[id].income = Math.round(state.clubs[id].income * 0.86); }
  let userManagerChanged = false;
  for (const club of Object.values(state.clubs)) {
    const bad = rel.includes(club.id);
    const sack = bad ? rng.chance(0.4) : rng.chance(0.06);
    if (sack) {
      const old = club.manager;
      const g = { next: state.nextId };
      club.manager = makeManager(rng, g, club.reputation);
      state.nextId = g.next;
      addNews(state, 'manager', `${club.name} appoint ${club.manager.name}`, `${old.name} leaves ${club.name}${bad ? ' after relegation' : ''}. ${club.manager.name} brings a ${club.manager.tactics.style} approach.`, { clubId: club.id, important: club.id === oldClubId });
      if (club.id === oldClubId) userManagerChanged = true;
    }
    club.signingsThisWindow = 0;
    club.balance = Math.round(club.balance);
  }

  // 5. development, ageing, retirement, expiries
  const dayNow = state.day;
  const retired: string[] = [];
  for (const p of Object.values(state.players)) {
    if (p.retired || p.id === state.userId || p.nationalPool) continue;
    const club = p.clubId ? state.clubs[p.clubId] : null;
    developAnnual(p, {
      coaching: club?.manager.coaching ?? 6, youthFacilities: club?.youthFacilities ?? 6, playingShare: club ? playShare(p) : 0.2,
      rng: new Rng(seedFrom(state.seed, 'annual', season, p.id)), day: dayNow,
    });
    p.reputation = clamp(Math.round(overall(p) * 0.85 + (club?.reputation ?? 30) * 0.15 - 10), 3, 99);
    p.stats = {};
    p.yellowsSeason = 0;
    p.suspension = 0;
    p.cond.morale = clamp(p.cond.morale + (baselineMorale(p) - p.cond.morale) * 0.5, 20, 95);
    const age = ageAt(p.birthDay, startDay);
    if (rng.chance(retireChance(age, overall(p)))) { retirePlayer(state, p); retired.push(p.id); continue; }
    // loans end, contracts expire
    if (p.loan && p.loan.endDay <= plan.end) {
      const parent = state.clubs[p.loan.parentClubId];
      p.loan = null;
      if (parent) moveToClub(state, p, parent.id);
    }
    if (p.contract && p.contract.endDay <= plan.end && p.clubId) {
      const c = state.clubs[p.clubId];
      const sq = squadOf(state, c.id).map((x) => overall(x)).sort((a, b) => b - a);
      const median = sq[Math.floor(sq.length / 2)] ?? 50;
      const keep = overall(p) >= median - 2 || age <= 23 ? rng.chance(0.86) : rng.chance(0.3);
      if (keep && age < 36) {
        p.contract = { ...genContract(rng, p, c, startDay, season + 1, age), id: `c${p.id}-${season}` };
      } else releasePlayer(state, p);
    }
  }
  // free agents also age; the weakest drift out of the game
  for (const id of state.transfers.freeAgentIds.slice()) {
    const p = state.players[id];
    if (!p || p.retired || p.id === state.userId) continue; // the user decides when to retire
    if (rng.chance(retireChance(ageAt(p.birthDay, startDay), overall(p)) + 0.04)) retirePlayer(state, p);
  }
  const fas = state.transfers.freeAgentIds.map((id) => state.players[id]).filter((p) => p && p.id !== state.userId).sort((a, b) => overall(b) - overall(a));
  for (const p of fas.slice(70)) retirePlayer(state, p);

  // the user: potential drift, contract expiry, loans
  const uAge = ageAt(user.birthDay, startDay);
  if (uAge <= 22) {
    const form = (user.stats.league?.apps ?? 0) > 0 ? 0 : 0;
    user.potential = Math.round(clamp(user.potential + rng.normal(form, 1.2), overall(user), 98));
    for (const k of Object.keys(user.caps) as (keyof typeof user.caps)[]) if (user.caps[k] < user.attrs[k]) user.caps[k] = user.attrs[k];
  }
  user.stats = {};
  user.yellowsSeason = 0;
  user.suspension = 0;
  user.recentRatings = user.recentRatings.slice(-3);
  if (user.loan && user.loan.endDay <= plan.end) {
    const parent = state.clubs[user.loan.parentClubId];
    user.loan = null;
    if (parent) { moveToClub(state, user, parent.id); addNews(state, 'transfer', `${user.displayName} returns from loan`, `Your loan spell has ended and you are back at ${parent.name}.`, { clubId: parent.id }); }
  }
  // offers made during the old season do not carry over; clubs reassess the squad that is about to start
  for (const o of state.transfers.offers) {
    if (o.status === 'open' || o.status === 'negotiating') o.status = 'expired';
  }
  if (user.contract && user.contract.endDay <= plan.end && !state.career.retired && !state.flags.abroadClub) {
    const clubIdOld = user.clubId;
    const finished = user.contract;
    // completing a contract earns the loyalty bonus written into it (paid once)
    if (finished.bonuses.loyalty > 0 && clubIdOld) {
      payOnce(state, `loyalty:${finished.id}`, 'loyalty', `Loyalty bonus: contract at ${clubName(state, clubIdOld)} completed`, finished.bonuses.loyalty);
    }
    releasePlayer(state, user);
    if (completePreContract(state, season + 1)) {
      addNews(state, 'contract', `${user.displayName} leaves ${clubName(state, clubIdOld)} as his contract expires`,
        `His pre-contract agreement takes effect and he joins ${clubName(state, user.clubId)}.`, { important: true });
    } else {
      addNews(state, 'contract', `${user.displayName} leaves ${clubName(state, clubIdOld)} as his contract expires`,
        'You are a free agent. Your agent will look for a new club. Offers can arrive at any time, even outside the transfer window.', { important: true });
      state.decisions.push({
        id: uid(state, 'dec'), kind: 'free_agent', title: 'You are a free agent', day: dayNow, expiresDay: null,
        body: 'Your contract has expired. Check the Transfers screen for offers from clubs, or ask your agent to look for opportunities. You can keep training while you wait.',
        options: [{ id: 'ok', label: 'Understood' }],
      });
    }
  }

  // 6. squads: youth intake, size limits, positional needs
  setUpNextSeason(state, rng, season);
  for (const club of Object.values(state.clubs)) {
    youthIntake(state, rng, club, season + 1, startDay);
    // trim oversized squads from the bottom
    let sq = squadOf(state, club.id);
    while (sq.length > 33) {
      const cand = sq.filter((p) => p.id !== state.userId).sort((a, b) => marketValue(a, startDay) - marketValue(b, startDay))[0];
      if (!cand) break;
      releasePlayer(state, cand);
      sq = squadOf(state, club.id);
    }
    refillPositions(state, rng, club, season + 1, startDay);
    assignShirtsKeepUser(state, club.id);
    state.clubs[club.id].wageBudget = Math.round(state.clubs[club.id].income * 0.95);
    state.clubs[club.id].transferBudget = transferBudgetFor(
      state.clubs[club.id].balance, squadOf(state, club.id).reduce((s, p) => s + marketValue(p, startDay), 0), state.clubs[club.id].reputation,
    );
  }
  // top the free-agent pool back up
  topUpFreeAgents(state, rng, startDay);
  rolloverInternational(state, rng, (p) => developAnnual(p, { coaching: 8, youthFacilities: 8, playingShare: 0.5, rng: new Rng(seedFrom(state.seed, 'abroad', season, p.id)), day: dayNow }));
  state.international.calledUpNow = false;
  state.international.callUps = state.international.callUps.slice(-40);
  setupInternational(state, rng);
  refreshPools(state);

  // 7. the user's new season: retirement conversation, or the summary season abroad
  retirementRollover(state, rng, season);
  state.career.seasonStartAttrs = { ...user.attrs };
  state.career.seasonStartOverall = Math.round(overall(user));
  if (userManagerChanged) {
    state.career.managerTrust = 45;
    const rel2 = state.relationships.find((r) => r.kind === 'manager');
    if (rel2 && user.clubId) { rel2.name = state.clubs[user.clubId].manager.name; rel2.value = 45; rel2.note = 'A new manager who does not know you yet.'; }
  }
  if (user.clubId) state.career.clubSpellStart[user.clubId] ??= startDay;
  for (const c of Object.values(state.clubs)) c.lastLineup = [];

  // 8. summary and clean-up
  const goals = state.career.seasons.filter((s) => s.season === season).reduce((a, s) => a + s.league.goals + s.cup.goals, 0);
  const assists = state.career.seasons.filter((s) => s.season === season).reduce((a, s) => a + s.league.assists + s.cup.assists, 0);
  const apps = state.career.seasons.filter((s) => s.season === season).reduce((a, s) => a + s.league.apps + s.cup.apps, 0);
  const ratingSum = state.career.seasons.filter((s) => s.season === season).reduce((a, s) => a + s.league.ratingSum + s.cup.ratingSum, 0);
  const champ = t1[0] ? clubName(state, t1[0].clubId) : '';
  const summary: SeasonSummary = {
    season, leaguePos, leagueName: userLeagueId === 'L2' ? 'Challenge Division' : 'Elite Division', promoted: userPromoted, relegated: userRelegated,
    champion: champ, cupWinner: cup?.winnerId ? clubName(state, cup.winnerId) : null, awards: mine,
    userLines: [], ovrChange: Math.round(overall(user)) - state.career.seasonStartOverall, goals, assists, apps, avgRating: apps ? ratingSum / apps : 0,
  };
  state.lastSeasonSummary = summary;
  pruneOldSeasons(state, season);
  addNews(state, 'league', `${seasonLabel(season)} season review`,
    `${champ} won the Elite Division. ${cup?.winnerId ? `${clubName(state, cup.winnerId)} lifted the cup. ` : ''}${userPromoted ? `${clubName(state, oldClubId)} were promoted. ` : ''}${userRelegated ? `${clubName(state, oldClubId)} were relegated. ` : ''}`.trim(), { important: true });
  return summary;
}

function assignShirtsKeepUser(state: GameState, clubId: string): void {
  const squad = squadOf(state, clubId);
  const u = squad.find((p) => p.id === state.userId);
  const others = squad.filter((p) => p.id !== state.userId);
  const taken = new Set<number>();
  for (const p of others) {
    if (p.shirt && !taken.has(p.shirt) && (!u || p.shirt !== u.shirt)) taken.add(p.shirt);
    else p.shirt = 0;
  }
  for (const p of others) {
    if (!p.shirt) {
      let n = 1;
      while (taken.has(n) || (u && u.shirt === n)) n++;
      p.shirt = n; taken.add(n);
    }
  }
}

function topUpFreeAgents(state: GameState, rng: Rng, day: number): void {
  const need = 30 - state.transfers.freeAgentIds.length;
  for (let i = 0; i < need; i++) {
    const pos = rng.pick(['GK', 'CB', 'RB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'] as Position[]);
    const p = generatePlayer(rng, { id: uid(state, 'p'), position: pos, ovr: rng.int(40, 62), age: rng.int(18, 33), nationality: randomNationality(rng), clubId: null, clubRep: 30, day });
    state.players[p.id] = p;
    state.transfers.freeAgentIds.push(p.id);
  }
}

function setUpNextSeason(state: GameState, rng: Rng, season: number): void {
  state.season = season + 1;
  setupSeason(state, rng);
}

/** Drop competitions and fixtures that are more than one season old; the history and the user's records remain. */
function pruneOldSeasons(state: GameState, justEnded: number): void {
  for (const comp of Object.values(state.competitions)) {
    if (comp.season >= justEnded) continue;
    for (const id of comp.fixtureIds) delete state.fixtures[id];
    delete state.competitions[comp.id];
  }
  for (const rec of Object.values(state.matchRecords)) {
    if (rec.day < dayOf(justEnded, 7, 1)) compactRecord(rec, 2, state.userId);
  }
}
