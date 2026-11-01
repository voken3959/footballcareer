/** The season calendar: the single authority for dates (windows, matchdays, cup rounds, breaks, awards). */
import type { CalendarEntry } from './types';
import { dayOf, dayOfWeek, formatShort, seasonLabel } from './dates';
import type { CupRoundPlan } from './competitions';

export const FIRST_LEAGUE_DAY_MONTH: [number, number] = [8, 8];

export function firstDowOnOrAfter(day: number, dow: number): number {
  return day + ((dow - dayOfWeek(day) + 7) % 7);
}

export interface SeasonPlan {
  season: number;
  start: number;
  end: number;
  leagueDays: number[];
  breakSaturdays: number[];
  intlDays: number[]; // international fixture days (Thursday of a break week)
  cupPlan: CupRoundPlan[];
  summerWindow: [number, number];
  winterWindow: [number, number];
  awardsDay: number;
  tournamentStart: number | null; // June, when a major tournament is held
  entries: CalendarEntry[];
}

const nearest = (days: number[], target: number) => days.reduce((b, d) => (Math.abs(d - target) < Math.abs(b - target) ? d : b), days[0]);

export function transferWindowOpenOn(plan: Pick<SeasonPlan, 'summerWindow' | 'winterWindow'>, day: number): boolean {
  return (day >= plan.summerWindow[0] && day <= plan.summerWindow[1]) || (day >= plan.winterWindow[0] && day <= plan.winterWindow[1]);
}

export function planSeason(season: number, matchdays: number, tournament: boolean): SeasonPlan {
  const start = dayOf(season, 7, 1);
  const end = dayOf(season + 1, 6, 30);
  const firstSat = firstDowOnOrAfter(dayOf(season, FIRST_LEAGUE_DAY_MONTH[0], FIRST_LEAGUE_DAY_MONTH[1]), 6);
  const sats: number[] = [];
  for (let d = firstSat; d <= dayOf(season + 1, 5, 16); d += 7) sats.push(d);
  const breakTargets = [dayOf(season, 9, 5), dayOf(season, 10, 10), dayOf(season, 11, 14), dayOf(season + 1, 3, 27)];
  const breakSaturdays = Array.from(new Set(breakTargets.map((t) => nearest(sats, t))));
  const leagueDays = sats.filter((d) => !breakSaturdays.includes(d)).slice(0, matchdays);
  if (leagueDays.length < matchdays) throw new Error('Not enough Saturdays for the league programme');
  const intlDays = breakSaturdays.map((s) => s - 2);

  const wed = (m: number, d: number, yearOffset = 0) => firstDowOnOrAfter(dayOf(season + yearOffset, m, d), 3);
  const r32 = wed(9, 23);
  const r16 = wed(10, 28);
  const qf = wed(1, 20, 1);
  const sf1 = wed(2, 24, 1);
  const sf2 = wed(3, 17, 1);
  const final = firstDowOnOrAfter(dayOf(season + 1, 5, 23), 6);
  const cupPlan: CupRoundPlan[] = [
    { name: 'Round of 32', legs: 1, day: r32, drawDay: r32 - 4 },
    { name: 'Round of 16', legs: 1, day: r16, drawDay: r16 - 4 },
    { name: 'Quarter-finals', legs: 1, day: qf, drawDay: qf - 4 },
    { name: 'Semi-finals', legs: 2, day: sf1, day2: sf2, drawDay: sf1 - 4 },
    { name: 'Final', legs: 1, day: final, drawDay: final - 10 },
  ];

  const summerWindow: [number, number] = [start, dayOf(season, 8, 31)];
  const winterWindow: [number, number] = [dayOf(season + 1, 1, 1), dayOf(season + 1, 1, 31)];
  const awardsDay = dayOf(season + 1, 5, 31);
  const label = seasonLabel(season);

  const entries: CalendarEntry[] = [
    { day: start, kind: 'new_season', label: `${label} season begins` },
    { day: start, kind: 'window_open', label: 'Summer transfer window opens' },
    { day: summerWindow[1], kind: 'window_close', label: 'Summer transfer window closes' },
    { day: winterWindow[0], kind: 'window_open', label: 'January transfer window opens' },
    { day: winterWindow[1], kind: 'window_close', label: 'January transfer window closes' },
    { day: firstSat - 8, kind: 'preseason', label: 'Pre-season ends' },
    ...leagueDays.map((d, i): CalendarEntry => ({ day: d, kind: 'matchday', label: `League matchday ${i + 1}`, ref: String(i + 1) })),
    ...cupPlan.flatMap((p, i): CalendarEntry[] => {
      const out: CalendarEntry[] = [
        { day: p.drawDay, kind: 'cup_draw', label: `Cup draw: ${p.name}`, ref: String(i) },
        { day: p.day, kind: 'cup', label: `Cup: ${p.name}${p.legs === 2 ? ' (1st leg)' : ''}`, ref: String(i) },
      ];
      if (p.day2) out.push({ day: p.day2, kind: 'cup', label: `Cup: ${p.name} (2nd leg)`, ref: String(i) });
      return out;
    }),
    ...breakSaturdays.map((s, i): CalendarEntry => ({ day: s - 9, kind: 'intl_break', label: `International squads named (${formatShort(intlDays[i])})`, ref: String(i) })),
    { day: awardsDay, kind: 'awards', label: 'End-of-season awards' },
    { day: end - 1, kind: 'contract_deadline', label: 'Contracts expire on 30 June' },
    { day: end, kind: 'season_end', label: `${label} season ends` },
  ];
  let tournamentStart: number | null = null;
  if (tournament) {
    tournamentStart = dayOf(season + 1, 6, 8);
    entries.push({ day: tournamentStart, kind: 'intl_tournament', label: 'International tournament begins' });
  }
  entries.sort((a, b) => a.day - b.day);
  return {
    season, start, end, leagueDays, breakSaturdays, intlDays, cupPlan, summerWindow, winterWindow, awardsDay,
    tournamentStart, entries,
  };
}

export const MATCHDAYS_PER_SEASON = 30;
