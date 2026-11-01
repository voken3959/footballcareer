/**
 * One day of world time: recovery for every player, the user's training, weekly money, calendar events (cup draws, windows),
 * international fixtures and every league/cup fixture that is not the user's. The user's own fixture is left pending so the
 * game can stop and let it be played.
 */
import type { Fixture, GameState } from './types';
import { Rng, clamp, seedFrom } from './rng';
import { dayOfWeek, formatShort } from './dates';
import { overall } from './attributes';
import { INTENSITY, dailyCondition, developUserDaily, healInjury, trainingInjuryChance, FOCUS_LABEL } from './progression';
import { makeInjury, rollInjuryType } from './injuries';
import { applyInjury, simulateAndApply } from './matchday';
import { drawCupRound, leagueTable } from './competitions';
import { competitionCompleted, checkRatingMilestones } from './awards';
import { clubWeekly, payWagesDue } from './finance';
import { addNews, userPlayer } from './util';
import { getPlan } from './season';
import { transferWindowOpenOn } from './calendar';
import { processInternationalDay, userIntlFixtureOn } from './international';
import { injuryNews, recoveryNews, matchdayRoundup } from './news';
import { assessRole } from './selection';

/* ------------------------------------------------------------------ fixtures */

export function clubFixturesOn(state: GameState, day: number): Fixture[] {
  const out: Fixture[] = [];
  for (const comp of Object.values(state.competitions)) {
    if (comp.type === 'intl' || comp.season !== state.season) continue;
    for (const id of comp.fixtureIds) {
      const f = state.fixtures[id];
      if (f && f.day === day && !f.played) out.push(f);
    }
  }
  return out;
}

export type PendingKind = 'club' | 'intl';
export interface PendingFixture { kind: PendingKind; fixture: Fixture }

export function pendingUserFixture(state: GameState): PendingFixture | null {
  const user = userPlayer(state);
  if (state.career.retired) return null;
  if (user.clubId) {
    for (const f of clubFixturesOn(state, state.day)) {
      if (f.homeId === user.clubId || f.awayId === user.clubId) return { kind: 'club', fixture: f };
    }
  }
  const intl = userIntlFixtureOn(state, state.day);
  if (intl) return { kind: 'intl', fixture: intl };
  return null;
}

/** Next fixture the user will be involved in (club first, then international), after today. */
export function nextUserFixture(state: GameState): PendingFixture | null {
  const user = userPlayer(state);
  let best: PendingFixture | null = null;
  const consider = (f: Fixture, kind: PendingKind) => {
    if (f.played || f.day < state.day) return;
    if (!best || f.day < best.fixture.day) best = { kind, fixture: f };
  };
  for (const comp of Object.values(state.competitions)) {
    if (comp.season !== state.season) continue;
    if (comp.type !== 'intl' && user.clubId) {
      for (const id of comp.fixtureIds) {
        const f = state.fixtures[id];
        if (f && (f.homeId === user.clubId || f.awayId === user.clubId)) consider(f, 'club');
      }
    } else if (comp.type === 'intl' && state.international.calledUpNow) {
      for (const id of comp.fixtureIds) {
        const f = state.fixtures[id];
        if (f && (f.homeId === state.international.nation || f.awayId === state.international.nation) && !f.played) {
          if (userIntlFixtureOn(state, f.day)?.id === f.id) consider(f, 'intl');
        }
      }
    }
  }
  return best;
}

/** Simulate every club fixture today except the user's. Detail is the same engine for all; only the user's is stored in full. */
export function playOtherClubFixtures(state: GameState): void {
  const user = userPlayer(state);
  const todays = clubFixturesOn(state, state.day).filter((f) => f.homeId !== user.clubId && f.awayId !== user.clubId);
  const leagues = new Set<string>();
  for (const f of todays) {
    simulateAndApply(state, f);
    leagues.add(f.compId);
  }
  finishDayCompetitions(state, todays);
}

/** After a day's club fixtures: league completion and matchday round-ups for the user's league. */
export function finishDayCompetitions(state: GameState, played: Fixture[]): void {
  const user = userPlayer(state);
  const seen = new Set<string>();
  for (const f of played) {
    if (seen.has(f.compId)) continue;
    seen.add(f.compId);
    const comp = state.competitions[f.compId];
    if (comp.type !== 'league') continue;
    const all = comp.fixtureIds.map((id) => state.fixtures[id]);
    if (all.every((x) => x.played) && !comp.completed) competitionCompleted(state, comp);
    const userComp = user.clubId ? state.clubs[user.clubId]?.leagueId : null;
    if (userComp && comp.id === `${userComp}-${state.season}`) {
      const md = f.matchday;
      const mdFx = all.filter((x) => x.matchday === md && x.played);
      if (mdFx.length === comp.clubIds.length / 2 && md % 3 === 0) {
        const table = leagueTable(state, comp.id);
        const lead = table[0];
        const big = [...mdFx].sort((a, b) => Math.abs((b.result?.hg ?? 0) - (b.result?.ag ?? 0)) - Math.abs((a.result?.hg ?? 0) - (a.result?.ag ?? 0)))[0];
        const lines = [`${state.clubs[lead.clubId].name} lead the table on ${lead.pts} points after ${lead.p} games.`];
        if (big?.result) lines.push(`Biggest result: ${state.clubs[big.homeId].name} ${big.result.hg}-${big.result.ag} ${state.clubs[big.awayId].name}.`);
        const last = table[table.length - 1];
        lines.push(`${state.clubs[last.clubId].name} are bottom with ${last.pts} points.`);
        matchdayRoundup(state, comp.name, md, lines);
      }
    }
  }
}

/* ----------------------------------------------------------------- training */

function trainUser(state: GameState, rng: Rng): void {
  const p = userPlayer(state);
  const plan = state.training.plan;
  const club = p.clubId ? state.clubs[p.clubId] : null;
  const dow = dayOfWeek(state.day);
  const xp = developUserDaily(state, p);
  const trainingDay = dow >= 1 && dow <= 5;
  if (!trainingDay) return;
  const cost = INTENSITY[plan.intensity].fatigue;
  const before = p.cond.fatigue;
  if (!p.injury) {
    if (plan.intensity === 'rest') {
      p.cond.fatigue = clamp(p.cond.fatigue - 3, 0, 100);
    } else {
      p.cond.fatigue = clamp(p.cond.fatigue + cost * (1 + p.cond.fatigue / 160) - (plan.focus === 'recovery' ? 4 : 0), 0, 100);
      p.cond.sharpness = clamp(p.cond.sharpness + 0.45 * INTENSITY[plan.intensity].growth, 0, 100);
      state.training.sessionsThisWeek++;
      const physio = 0.9 + 0.2 * ((club?.trainingFacilities ?? 8) / 20);
      const chance = trainingInjuryChance(p, plan.intensity, state, physio) * (plan.focus === 'recovery' ? 0.5 : 1);
      if (rng.next() < chance) {
        const type = rollInjuryType(rng, 'training', p);
        const inj = makeInjury(rng, type, state.day, 'training', physio);
        applyInjury(state, p, inj.type, inj.daysTotal, 'training');
        injuryNews(state, p, inj.type, inj.daysTotal, false);
      }
    }
  } else {
    p.cond.fatigue = clamp(p.cond.fatigue - 1, 0, 100);
  }
  // how the coaches rate your attitude in training
  const target = 50 + (p.attrs.workRate - 50) * 0.25 + (plan.intensity === 'intensive' ? 8 : plan.intensity === 'normal' ? 4 : plan.intensity === 'light' ? 0 : -7)
    + (p.personality === 'professional' ? 5 : p.personality === 'competitive' ? 3 : 0) - (p.cond.fatigue > 80 ? 6 : 0) + (p.injury ? -2 : 0);
  state.career.trainingPerformance = clamp(state.career.trainingPerformance + (target - state.career.trainingPerformance) * 0.04 + rng.normal(0, 0.8), 0, 100);
  state.training.log.push({
    day: state.day, focus: plan.focus, intensity: plan.intensity, xp: Math.round(xp * 100) / 100, fatigue: Math.round((p.cond.fatigue - before) * 10) / 10,
    note: p.injury ? 'Rehabilitation work' : `${FOCUS_LABEL[plan.focus]} session`,
  });
  if (state.training.log.length > 90) state.training.log.splice(0, state.training.log.length - 90);
  state.training.lastSessionDay = state.day;
}

/* ------------------------------------------------------------------ the day */

export interface DayReport {
  day: number;
  newsStart: number;
  events: string[];
}

/** Everything that happens at the start of `state.day`, before any match is played. */
export function beginDay(state: GameState, rng: Rng): DayReport {
  const report: DayReport = { day: state.day, newsStart: state.nextNewsId, events: [] };
  const user = userPlayer(state);
  const plan = getPlan(state);

  // recovery and healing for everyone
  for (const p of Object.values(state.players)) {
    if (p.retired) continue;
    const recent = p.lastMinutesDay !== undefined && state.day - p.lastMinutesDay <= 8;
    dailyCondition(p, recent);
    if (p.injury && healInjury(p)) {
      if (p.id === state.userId) { recoveryNews(state, p); report.events.push('injury_recovered'); }
    }
  }

  if (!state.career.retired) trainUser(state, rng);

  // calendar entries
  for (const e of state.calendar) {
    if (e.day !== state.day) continue;
    if (e.kind === 'cup_draw') {
      const comp = state.competitions[`CUP-${state.season}`];
      const idx = Number(e.ref);
      if (comp?.rounds && !comp.rounds[idx].drawn) {
        const round = drawCupRound(state, comp, idx, new Rng(seedFrom(state.seed, 'draw', state.season, idx)));
        const mine = round.ties.find((t) => t.a === user.clubId || t.b === user.clubId);
        const stillIn = !!mine;
        if (stillIn && mine) {
          const opp = mine.a === user.clubId ? mine.b : mine.a;
          addNews(state, 'cup', `Cup draw: ${round.name}`, opp ? `${state.clubs[user.clubId as string].name} will face ${state.clubs[opp].name}.` : `${state.clubs[user.clubId as string].name} receive a bye into the next round.`, { clubId: user.clubId ?? undefined, important: true });
        } else {
          addNews(state, 'cup', `Cup draw: ${round.name}`, `The ${round.name} ties have been drawn. ${round.ties.length} matches are scheduled for ${formatShort(round.day)}.`, {});
        }
        report.events.push('cup_draw');
      }
    } else if (e.kind === 'window_open') {
      addNews(state, 'transfer', e.label, 'Clubs can now sign and sell players. Check your agent for opportunities.', {});
    } else if (e.kind === 'window_close') {
      addNews(state, 'transfer', e.label, 'No more deals can be completed until the next window opens.', {});
    } else if (e.kind === 'awards') {
      report.events.push('awards');
    }
  }
  state.transfers.windowOpen = transferWindowOpenOn(plan, state.day);

  // international matches and call-ups
  processInternationalDay(state, rng, true);

  // weekly processes on Monday
  if (dayOfWeek(state.day) === 1) {
    state.training.sessionsThisWeek = 0;
    clubWeekly(state);
    state.career.ovrHistory.push({ day: state.day, ovr: Math.round(overall(user)) });
    if (state.career.ovrHistory.length > 900) state.career.ovrHistory.splice(0, state.career.ovrHistory.length - 900);
    checkRatingMilestones(state);
    if (user.clubId) state.career.squadRole = assessRole(state, state.clubs[user.clubId], user, state.day).role;
    const trust = state.career.managerTrust;
    state.career.managerTrust = clamp(trust + (state.career.trainingPerformance - 50) * 0.015, 0, 100);
    report.events.push('week_start');
  }
  if (!state.career.retired) payWagesDue(state);
  return report;
}
