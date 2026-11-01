import type { Club, Contract, DefLine, FormationId, Manager, Player, Position, TacticStyle } from './types';
import { Rng, clamp, lerp } from './rng';
import { NATIONS, HOME_COUNTRY } from './names';
import { genName, generatePlayer } from './playerGen';
import { DIVISION_1, DIVISION_2, STADIUM_SUFFIX, makeCrest } from './clubData';
import { FORMATION_IDS } from './formations';
import { academyWage, defaultBonuses, fairWage, marketValue, roundWage, transferBudgetFor } from './economy';
import { overall } from './attributes';
import { dayOf, seasonEndDay } from './dates';

export interface IdGen { next: number }
export const newId = (g: IdGen, prefix: string) => `${prefix}${(g.next++).toString(36)}`;

type Tier = 'starter' | 'backup' | 'youth';
const SQUAD_PLAN: [Position, Tier[]][] = [
  ['GK', ['starter', 'backup', 'youth']],
  ['CB', ['starter', 'starter', 'backup', 'youth']],
  ['RB', ['starter', 'backup']],
  ['LB', ['starter', 'backup']],
  ['DM', ['starter', 'backup']],
  ['CM', ['starter', 'starter', 'backup']],
  ['AM', ['starter', 'backup']],
  ['RW', ['starter', 'backup']],
  ['LW', ['starter', 'backup']],
  ['ST', ['starter', 'starter', 'backup']],
];

export function randomNationality(rng: Rng): string {
  if (rng.chance(0.62)) return HOME_COUNTRY;
  return rng.weighted(NATIONS.map((n) => n.code), NATIONS.map((n) => (n.code === HOME_COUNTRY ? 0 : 1 + n.strength / 80)));
}

function ageFor(rng: Rng, tier: Tier): number {
  if (tier === 'youth') return rng.int(17, 20);
  if (tier === 'backup') return rng.weighted([19, 21, 23, 25, 27, 29, 31, 33], [8, 14, 16, 16, 15, 12, 10, 6]) + rng.int(0, 1);
  return rng.weighted([20, 22, 24, 26, 28, 30, 32, 34], [5, 12, 18, 20, 18, 14, 8, 3]) + rng.int(0, 1);
}

export function makeManager(rng: Rng, g: IdGen, rep: number): Manager {
  const nation = rng.chance(0.55) ? HOME_COUNTRY : rng.pick(NATIONS).code;
  const { first, last } = genName(rng, nation);
  const big = rep > 72;
  const style: TacticStyle = rng.weighted(
    ['possession', 'direct', 'counter', 'highPress', 'lowBlock', 'balanced'] as TacticStyle[],
    big ? [22, 6, 12, 26, 2, 14] : rep > 50 ? [12, 14, 16, 12, 12, 20] : [6, 22, 18, 4, 24, 16],
  );
  const line: DefLine = style === 'highPress' || style === 'possession' ? (rng.chance(0.65) ? 'high' : 'normal')
    : style === 'lowBlock' ? 'deep' : rng.weighted(['high', 'normal', 'deep'] as DefLine[], [1, 3, 2]);
  const formation: FormationId = style === 'lowBlock'
    ? rng.weighted(['532', '442', '4141'] as FormationId[], [3, 3, 2])
    : style === 'possession' || style === 'highPress'
      ? rng.weighted(['433', '4231', '442', '352'] as FormationId[], [4, 4, 1, 1])
      : rng.pick(FORMATION_IDS);
  return {
    id: newId(g, 'm'),
    name: `${first[0]}. ${last}`,
    nationality: nation,
    formation,
    tactics: { style, line },
    youthBias: clamp(rng.normal(0.4, 0.22), 0.05, 0.95),
    rotation: clamp(rng.normal(0.4, 0.2), 0.05, 0.9),
    loyaltyToVeterans: clamp(rng.normal(0.5, 0.2), 0.1, 0.95),
    coaching: clamp(Math.round(rng.normal(8 + rep / 12, 2.5)), 3, 20),
    strictness: clamp(rng.normal(0.5, 0.2), 0.1, 0.95),
    temperament: clamp(rng.normal(0.5, 0.2), 0.05, 0.95),
  };
}

export function clubLevel(rep: number): number {
  return 40 + rep * 0.38;
}

export interface WorldParts {
  players: Record<string, Player>;
  clubs: Record<string, Club>;
  squads: Record<string, string[]>;
  freeAgents: string[];
}

export function genContract(rng: Rng, p: Player, club: Club, day: number, season: number, age: number): Contract {
  const yrs = age >= 32 ? rng.int(1, 2) : age <= 20 ? rng.int(2, 4) : rng.weighted([1, 2, 3, 4, 5], [14, 24, 28, 22, 12]);
  const endDay = seasonEndDay(season + yrs - 1);
  const ovr = overall(p);
  const wage = fairWage(ovr, p.potential, age, club.reputation, p.reputation) * rng.range(0.9, 1.1);
  return {
    id: `c${p.id}`,
    clubId: club.id,
    wage: roundWage(wage),
    startDay: Math.min(day - 30, endDay - rng.int(2, 4) * 365),
    endDay,
    role: 'Rotation option',
    bonuses: defaultBonuses(wage, 'Regular starter'),
    releaseClause: null,
    type: 'professional',
  };
}

export function generateWorld(rng: Rng, g: IdGen, day: number, season: number): WorldParts {
  const players: Record<string, Player> = {};
  const clubs: Record<string, Club> = {};
  const squads: Record<string, string[]> = {};

  const divs: [typeof DIVISION_1, number, string][] = [[DIVISION_1, 1, 'L1'], [DIVISION_2, 2, 'L2']];
  let crestIdx = 0;
  for (const [list, division, leagueId] of divs) {
    const n = list.length;
    // rank-based reputation with some noise so the table is not perfectly predictable
    const order = rng.shuffle(list.map((_, i) => i));
    order.forEach((idx, rank) => {
      const seed = list[idx];
      const t = rank / (n - 1);
      const rep = Math.round(division === 1 ? lerp(88, 58, t) + rng.normal(0, 2) : lerp(56, 33, t) + rng.normal(0, 2));
      const id = newId(g, 'c');
      const stadiumName = `${seed.place} ${rng.pick(STADIUM_SUFFIX)}`;
      const club: Club = {
        id,
        name: seed.name,
        shortName: seed.short,
        country: HOME_COUNTRY,
        stadium: stadiumName,
        capacity: Math.round((6000 + rep * 620 + rng.int(-1500, 1500)) / 100) * 100,
        crest: makeCrest(seed.short, crestIdx++ + rng.int(0, 3), rng.int(0, 3), rng.int(0, 3)),
        reputation: clamp(rep, 20, 95),
        leagueId,
        division,
        balance: 0,
        wageBudget: 0,
        transferBudget: 0,
        income: 0,
        trainingFacilities: clamp(Math.round(rep / 6 + rng.normal(0, 1.8)), 2, 20),
        youthFacilities: clamp(Math.round(rep / 6.5 + rng.normal(0, 2.2)), 2, 20),
        ambition: clamp(rng.normal(rep / 100, 0.15), 0.1, 0.98),
        manager: makeManager(rng, g, rep),
        chemistry: rng.int(60, 80),
        lastLineup: [],
        signingsThisWindow: 0,
      };
      clubs[id] = club;
      squads[id] = [];
      const level = clubLevel(club.reputation);
      for (const [pos, tiers] of SQUAD_PLAN) {
        for (const tier of tiers) {
          const age = ageFor(rng, tier);
          const base = tier === 'starter' ? level + rng.normal(0, 3.2) : tier === 'backup' ? level - 5.5 + rng.normal(0, 3) : level - 12 + rng.normal(0, 3.5);
          const nat = randomNationality(rng);
          const p = generatePlayer(rng, {
            id: newId(g, 'p'), position: pos, ovr: clamp(Math.round(base - (pos === 'GK' ? 0 : 0)), 28, 90), age, nationality: nat,
            clubId: id, clubRep: club.reputation, day,
          });
          p.contract = tier === 'youth' && age <= 18
            ? { ...genContract(rng, p, club, day, season, age), wage: academyWage(club.reputation), role: 'Youth prospect', type: 'academy', endDay: seasonEndDay(season + rng.int(0, 1)) }
            : genContract(rng, p, club, day, season, age);
          players[p.id] = p;
          squads[id].push(p.id);
        }
      }
      assignShirts(squads[id].map((pid) => players[pid]));
      economyFor(club, squads[id].map((pid) => players[pid]), rng, day);
    });
  }

  // free agents
  const freeAgents: string[] = [];
  for (let i = 0; i < 40; i++) {
    const pos = rng.pick(['GK', 'CB', 'RB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'] as Position[]);
    const age = rng.int(18, 34);
    const p = generatePlayer(rng, { id: newId(g, 'p'), position: pos, ovr: rng.int(40, 60), age, nationality: randomNationality(rng), clubId: null, clubRep: 30, day });
    players[p.id] = p;
    freeAgents.push(p.id);
  }
  return { players, clubs, squads, freeAgents };
}

export function economyFor(club: Club, squad: Player[], rng: Rng, day = 0): void {
  const wageBill = squad.reduce((s, p) => s + (p.contract?.wage ?? 0), 0);
  club.wageBudget = Math.round(wageBill * 1.1);
  club.income = Math.round(wageBill * 1.22);
  club.balance = Math.round(club.income * rng.int(6, 14));
  club.transferBudget = transferBudgetFor(club.balance, squad.reduce((s, p) => s + marketValue(p, day), 0), club.reputation);
}

const STD_NUMBERS: Partial<Record<Position, number[]>> = {
  GK: [1, 13, 31], RB: [2, 12, 22], LB: [3, 15, 23], CB: [5, 4, 6, 14, 24], DM: [6, 4, 16, 25], CM: [8, 14, 16, 18],
  AM: [10, 17, 21], RW: [7, 17, 19], LW: [11, 19, 20], ST: [9, 18, 21, 29],
};

export function assignShirts(squad: Player[]): void {
  const used = new Set<number>();
  const byPos: Record<string, Player[]> = {};
  for (const p of squad) (byPos[p.position] ||= []).push(p);
  for (const pos of Object.keys(byPos)) {
    const list = byPos[pos].sort((a, b) => overall(b) - overall(a));
    list.forEach((p) => {
      p.shirt = 0;
      for (const n of STD_NUMBERS[pos as Position] ?? []) {
        if (!used.has(n)) { p.shirt = n; used.add(n); break; }
      }
    });
  }
  let n = 32;
  for (const p of squad) {
    if (!p.shirt) {
      while (used.has(n)) n++;
      p.shirt = n; used.add(n);
    }
  }
}

export function freeShirt(squad: Player[], preferred: number): number {
  const used = new Set(squad.map((p) => p.shirt));
  if (preferred >= 1 && preferred <= 99 && !used.has(preferred)) return preferred;
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 99;
}

export const START_DAY = (season: number) => dayOf(season, 7, 1);
