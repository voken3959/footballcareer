/** Career creation: builds the world, the user's footballer, their club, contract, agent, calendar and initial state. */
import type {
  Appearance, Attrs, Club, Contract, Difficulty, Foot, GameState, Personality, Player, Position, Relationship, SquadRole,
} from './types';
import { SCHEMA_VERSION, SIM_VERSION, emptyStatLine } from './types';
import { Rng, clamp, seedFrom } from './rng';
import { ALL_ATTRS, ATTR_GROUP, ageAt, overall, overallFor } from './attributes';
import { generatePlayer, genCaps } from './playerGen';
import { NATIONS, nationName } from './names';
import { generateWorld, freeShirt, START_DAY, type IdGen, type WorldParts } from './world';
import { academyWage, fairWage, roundWage, defaultBonuses } from './economy';
import { seasonEndDay } from './dates';
import { setupSeason } from './season';
import { assessRole } from './selection';
import { genName } from './playerGen';
import { addNews } from './util';
import { initNations } from './international';
import { seasonOpenNews } from './news';
import { dateOf } from './dates';

export const START_SEASON = 2026;

export type Pathway = 'youth' | 'lower' | 'established' | 'custom';
export type ProfileFocus = 'balanced' | 'technical' | 'physical' | 'mental';
export type TalentBand = 'modest' | 'good' | 'great' | 'exceptional';

export const PATHWAYS: { id: Pathway; label: string; blurb: string }[] = [
  { id: 'youth', label: 'Youth prospect', blurb: 'Join the academy of a top-flight club. Real talent, but first-team football is a long way off.' },
  { id: 'lower', label: 'Lower-league prospect', blurb: 'A small professional club in the second tier. Early minutes are possible, the facilities are modest.' },
  { id: 'established', label: 'Established youngster', blurb: 'A stronger club with high expectations. You are talked about, but nothing is guaranteed.' },
  { id: 'custom', label: 'Custom career', blurb: 'Choose your club, starting age and current ability level.' },
];

export const TALENT_BANDS: Record<TalentBand, { label: string; range: [number, number] }> = {
  modest: { label: 'Modest', range: [58, 70] },
  good: { label: 'Good', range: [68, 80] },
  great: { label: 'Great', range: [78, 88] },
  exceptional: { label: 'Exceptional', range: [86, 95] },
};

export interface NewCareerOptions {
  seed: number;
  now?: number;
  careerName?: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  nationality: string;
  age: number;
  foot: Foot;
  height: number;
  weight: number;
  position: Position;
  secondary: Position | null;
  shirt?: number;
  appearance: Appearance;
  personality: Personality;
  pathway: Pathway;
  difficulty: Difficulty;
  focus: ProfileFocus;
  /** changes only the footballer's attribute distribution, not the world */
  profileSeed: number;
  clubId?: string;
  custom?: { ovr: number; talent: TalentBand };
}

export function defaultOptions(seed: number): NewCareerOptions {
  const rng = new Rng(seed);
  const nation = 'ENG';
  const { first, last } = genName(rng, nation);
  return {
    seed, firstName: first, lastName: last, nationality: nation, age: 16, foot: 'right', height: 178, weight: 70, position: 'ST', secondary: null,
    appearance: { skin: 1, hair: 1, style: 1 }, personality: 'professional', pathway: 'youth', difficulty: 'standard', focus: 'balanced',
    profileSeed: seed ^ 0x9e3779b9,
  };
}

/* ---------------------------------------------------------------- the world */

function worldFor(seed: number): { rng: Rng; g: IdGen; world: WorldParts; day: number } {
  const rng = new Rng(seed);
  const g: IdGen = { next: 1 };
  const day = START_DAY(START_SEASON);
  const world = generateWorld(rng, g, day, START_SEASON);
  return { rng, g, world, day };
}

export interface ClubChoice {
  club: Club;
  squadLevel: number;
  firstTeamLevel: number;
  competition: number;
}

/** Clubs offered for a pathway. The same seed always yields the same world, so the wizard preview matches the real career. */
export function previewClubs(seed: number, pathway: Pathway): { clubs: Club[]; world: WorldParts } {
  const { world } = worldFor(seed);
  return { clubs: clubsForPathway(world, pathway), world };
}

export function clubsForPathway(world: WorldParts, pathway: Pathway): Club[] {
  const all = Object.values(world.clubs);
  const d1 = all.filter((c) => c.division === 1).sort((a, b) => b.reputation - a.reputation);
  const d2 = all.filter((c) => c.division === 2).sort((a, b) => b.reputation - a.reputation);
  let clubs: Club[];
  if (pathway === 'youth') clubs = d1.filter((c) => c.reputation >= 60);
  else if (pathway === 'lower') clubs = d2.slice(Math.floor(d2.length / 2));
  else if (pathway === 'established') clubs = d1.filter((c) => c.reputation >= 56 && c.reputation <= 76);
  else clubs = [...d1, ...d2];
  if (!clubs.length) clubs = all;
  return clubs;
}

/* ------------------------------------------------------------- the footballer */

function startingOvr(o: NewCareerOptions, prng: Rng): number {
  const ageBonus = (o.age - 16) * 3.2;
  let base: number;
  if (o.pathway === 'youth') base = 41;
  else if (o.pathway === 'lower') base = 49;
  else if (o.pathway === 'established') base = 57;
  else base = o.custom?.ovr ?? 50;
  const ovr = o.pathway === 'custom' ? base : base + ageBonus;
  return Math.round(clamp(ovr + prng.normal(0, 2.2), 28, 90));
}

function startingPotential(o: NewCareerOptions, ovr: number, prng: Rng): number {
  let pot: number;
  if (o.pathway === 'custom') {
    const [lo, hi] = TALENT_BANDS[o.custom?.talent ?? 'good'].range;
    pot = prng.range(lo, hi);
  } else if (o.pathway === 'youth') pot = clamp(prng.normal(77, 6.5), 62, 92);
  else if (o.pathway === 'lower') pot = clamp(prng.normal(71, 6.5), 58, 86);
  else pot = clamp(prng.normal(80, 5.5), 68, 94);
  pot -= Math.max(0, o.age - 16) * 1.2;
  return Math.round(clamp(pot, ovr + 4, 96));
}

/** Nudge the attribute distribution towards a group the player is "known for", then re-centre on the target overall. */
function applyFocus(attrs: Attrs, pos: Position, focus: ProfileFocus, target: number): void {
  if (focus === 'balanced') return;
  for (const k of ALL_ATTRS) {
    attrs[k] = clamp(attrs[k] + (ATTR_GROUP[k] === focus ? 6 : -3), 1, 99);
  }
  for (let it = 0; it < 6; it++) {
    const diff = target - overallFor(attrs, pos);
    if (Math.abs(diff) < 0.4) break;
    for (const k of ALL_ATTRS) attrs[k] = clamp(attrs[k] + diff, 1, 99);
  }
  for (const k of ALL_ATTRS) attrs[k] = Math.round(attrs[k]);
}

export function buildUserPlayer(o: NewCareerOptions, day: number, clubRep: number, id = 'user'): Player {
  const prng = new Rng(seedFrom(o.profileSeed, o.position, o.age));
  const ovr = startingOvr(o, prng);
  const potential = startingPotential(o, ovr, prng);
  const displayName = (o.displayName ?? '').trim() || `${o.firstName[0]}. ${o.lastName}`;
  const p = generatePlayer(prng, {
    id, position: o.position, secondary: o.secondary, ovr, age: o.age, potential, nationality: o.nationality, clubId: null, clubRep,
    day, personality: o.personality, firstName: o.firstName, lastName: o.lastName, foot: o.foot, height: o.height, weight: o.weight,
    appearance: o.appearance, shirt: o.shirt,
  });
  if (o.focus !== 'balanced') {
    applyFocus(p.attrs, o.position, o.focus, ovr);
    p.caps = genCaps(prng, p.attrs, o.position, potential);
  }
  p.displayName = displayName;
  // an exact age at the start of the career
  p.birthDay = Math.round(day - o.age * 365.25 - prng.int(0, 300));
  p.potential = Math.max(potential, overall(p));
  p.reputation = clamp(Math.round(overall(p) * 0.4 + clubRep * 0.1), 3, 40);
  return p;
}

/** What a wizard preview shows for the footballer before the career is created. */
export function previewPlayer(o: NewCareerOptions, clubRep = 60): Player {
  return buildUserPlayer(o, START_DAY(START_SEASON), clubRep);
}

/* ------------------------------------------------------------- state creation */

function relationshipSet(state: GameState, rng: Rng, club: Club): Relationship[] {
  const squad = (state.squads[club.id] ?? []).map((id) => state.players[id]).filter((p) => p.id !== state.userId);
  const mates = squad.filter((p) => p.position === state.players[state.userId].position || p.secondary === state.players[state.userId].position);
  const mentor = [...(mates.length ? mates : squad)].sort((a, b) => ageAt(b.birthDay, state.day) - ageAt(a.birthDay, state.day))[0];
  const peer = squad.filter((p) => ageAt(p.birthDay, state.day) <= 20 && p.id !== mentor?.id)[0] ?? squad[0];
  const n = nationName(state.players[state.userId].nationality);
  const out: Relationship[] = [
    { id: 'rel_family', name: 'Your family', kind: 'family', value: 78, note: `Proud of you and never miss a match when they can make it. ${n} roots run deep.` },
    { id: 'rel_friend', name: `${genName(rng, state.players[state.userId].nationality).first} (childhood friend)`, kind: 'friend', value: 70, note: 'Kept you grounded long before the football started.' },
    { id: 'rel_manager', name: club.manager.name, kind: 'manager', value: 50, note: 'Will judge you on what you do in training and on the pitch.' },
    { id: 'rel_agent', name: state.transfers.agent.name, kind: 'agent', value: state.transfers.agent.relationship, note: 'Handles your contract talks and watches the market for you.' },
  ];
  if (mentor) out.push({ id: 'rel_mentor', name: mentor.displayName, kind: 'teammate', value: 52, note: 'An experienced team-mate in your area of the pitch.', playerId: mentor.id });
  if (peer) out.push({ id: 'rel_peer', name: peer.displayName, kind: 'teammate', value: 55, note: 'A young team-mate going through the same journey.', playerId: peer.id });
  return out;
}

export function createCareer(o: NewCareerOptions): GameState {
  const { rng, g, world, day } = worldFor(o.seed);
  const season = START_SEASON;
  const clubs = Object.values(world.clubs);
  const pool = clubsForPathway(world, o.pathway);
  let club = o.clubId ? world.clubs[o.clubId] : undefined;
  if (!club) club = pool[Math.floor(rng.next() * pool.length)] ?? clubs[0];
  const user = buildUserPlayer(o, day, club.reputation, 'user');
  const age = o.age;

  // make room in the squad: replace the weakest player in the same position group
  const squadIds = world.squads[club.id];
  const samePos = squadIds.map((id) => world.players[id]).filter((p) => p.position === user.position).sort((a, b) => overall(a) - overall(b));
  const out = samePos.length > 1 ? samePos[0] : squadIds.map((id) => world.players[id]).filter((p) => p.position !== 'GK').sort((a, b) => overall(a) - overall(b))[0];
  if (out) {
    world.squads[club.id] = squadIds.filter((id) => id !== out.id);
    delete world.players[out.id];
  }
  const players = world.players;
  players[user.id] = user;
  world.squads[club.id].push(user.id);
  user.clubId = club.id;
  const squadPlayers = world.squads[club.id].map((id) => players[id]);
  user.shirt = freeShirt(squadPlayers.filter((p) => p.id !== user.id), o.shirt ?? 0);

  const academy = o.pathway === 'youth' || (o.pathway === 'custom' && overall(user) < 45);
  const endDay = seasonEndDay(season + (academy ? 1 : 2));
  const ovr = overall(user);
  const wage = academy ? academyWage(club.reputation) : roundWage(fairWage(ovr, ovr, age, club.reputation, user.reputation) * 0.85);
  const contract: Contract = {
    id: `c${user.id}`, clubId: club.id, wage, startDay: day, endDay, role: academy ? 'Youth prospect' : 'Rotation option',
    bonuses: academy ? { appearance: 0, goal: 0, cleanSheet: 0, signing: 0, signingPaid: true, loyalty: 0 } : defaultBonuses(wage, 'Rotation option'),
    releaseClause: null, type: academy ? 'academy' : 'professional',
  };
  user.contract = contract;

  const agentQuality = o.pathway === 'established' ? rng.int(9, 14) : o.pathway === 'lower' ? rng.int(4, 9) : rng.int(6, 12);
  const agentName = genName(rng, rng.chance(0.7) ? 'ENG' : rng.pick(NATIONS).code);
  const eligible = [o.nationality];
  if (rng.chance(0.28)) {
    const other = rng.pick(NATIONS.filter((n) => n.code !== o.nationality));
    eligible.push(other.code);
  }

  const state: GameState = {
    schema: SCHEMA_VERSION, simVersion: SIM_VERSION,
    id: `career-${o.seed.toString(36)}-${(o.now ?? Date.now()).toString(36)}`,
    name: o.careerName?.trim() || `${user.displayName} at ${club.name}`,
    createdAt: o.now ?? Date.now(), updatedAt: o.now ?? Date.now(), seed: o.seed >>> 0, rngState: rng.state,
    settings: {
      difficulty: o.difficulty, commentarySpeed: 1, sound: true, volume: 0.6, reducedMotion: false, largeText: false,
      highContrast: false, autosave: true, simPreference: 'ask',
    },
    day, season, userId: user.id, players, clubs: world.clubs, squads: world.squads, competitions: {}, fixtures: {}, calendar: [], history: [],
    career: {
      legacy: null,
      appearances: emptyStatLine(), seasons: [],
      transfers: [{ day, season, fromClubId: null, toClubId: club.id, fee: 0, kind: academy ? 'academy' : 'free' }],
      contracts: [{ day, clubId: club.id, wage, years: academy ? 2 : 3, role: contract.role, kind: academy ? 'academy' : 'signed' }],
      trophies: [], milestones: [], injuries: [], attrChanges: [], weeklyChange: [], highestOverall: ovr, startOverall: ovr, startDay: day,
      startAge: age, ovrHistory: [{ day, ovr }],
      records: { mostGoalsSeason: null, mostAssistsSeason: null, mostAppsClub: {}, firstTo: {} },
      achievements: {}, retired: false, retiredDay: null, trainingPerformance: 55, managerTrust: 50, squadRole: 'Youth prospect',
      retirementDecision: null, startPathway: o.pathway, clubSpellStart: { [club.id]: day }, hatTricks: 0, xpSrc: {},
      seasonStartAttrs: { ...user.attrs }, seasonStartOverall: ovr,
    },
    finance: {
      balance: 0, sponsorships: [], careerEarnings: 0, ledger: [], nextLedgerId: 1, purchases: [], investments: [], lastWagePaidDay: day, lastLivingDay: day,
      housing: 'home_family', paidBonusKeys: [],
    },
    relationships: [],
    reputation: { professional: clamp(Math.round(ovr / 3), 5, 30), fans: 5, media: 4, club: 10, national: 2 },
    training: {
      plan: { focus: user.position === 'GK' ? 'goalkeeping' : 'position', intensity: 'normal', matchInstruction: 'default' },
      log: [], lastSessionDay: day, sessionsThisWeek: 0, weeklyLoad: [],
    },
    transfers: {
      offers: [], history: [], rumours: [],
      agent: {
        id: 'agent1', name: `${agentName.first[0]}. ${agentName.last}`, quality: agentQuality, feePct: 5, relationship: 60, hiredDay: day, lastCanvassDay: day - 60,
      },
      windowOpen: true, scoutReports: [], lastInterestDay: day, nextOfferId: 1, freeAgentIds: world.freeAgents.slice(), marketNews: [],
    },
    news: [], nextNewsId: 1, awards: [], matchRecords: {}, decisions: [], nextId: g.next,
    international: {
      nation: o.nationality, eligible, youthCaps: 0, caps: 0, goals: 0, assists: 0, tournaments: [], trophies: [], calledUpNow: false,
      lastCallUpDay: null, squadStatus: 'none', managerOpinion: 30, callUps: [],
    },
    nations: {}, userMatchLog: [], lifeEventDay: day + 24, lastSeasonSummary: null, flags: {},
  };
  const startBalance = o.pathway === 'established' ? 6000 : o.pathway === 'lower' ? 2500 : 1200;
  state.finance.balance = startBalance;
  state.finance.ledger.push({ id: state.finance.nextLedgerId++, day, category: 'gift', description: 'Savings at the start of your career', amount: startBalance, balanceAfter: startBalance });
  state.relationships = relationshipSet(state, rng, club);
  setupSeason(state, rng);
  state.nations = initNations(state, rng);
  const role = assessRole(state, club, user, day);
  state.career.squadRole = o.pathway === 'youth' && role.role === 'Fringe player' ? 'Youth prospect' : role.role;
  user.contract.role = academy ? 'Youth prospect' : state.career.squadRole;
  state.rngState = rng.state;
  const d = dateOf(day);
  addNews(state, 'club', `${user.displayName} joins ${club.name}`,
    `${user.firstName} ${user.lastName}, ${age}, ${nationName(user.nationality)}, has signed ${academy ? 'academy' : 'professional'} terms with ${club.name} (${d.d}/${d.m}/${d.y}). Manager ${club.manager.name} says the club will watch his progress closely.`,
    { clubId: club.id, important: true });
  seasonOpenNews(state);
  return state;
}

export const ROLE_ORDER: SquadRole[] = ['Youth prospect', 'Fringe player', 'Rotation option', 'Important player', 'Regular starter', 'Key player'];
