/* Core data model. Everything the game knows lives in GameState (plain JSON, versioned). */

export const SCHEMA_VERSION = 1;
export const SIM_VERSION = 1;

/* ----------------------------- Players ----------------------------- */

export type Position = 'GK' | 'RB' | 'LB' | 'CB' | 'DM' | 'CM' | 'AM' | 'RW' | 'LW' | 'ST';
export const POSITIONS: Position[] = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST', 'LW'];

export type AttrKey =
  // technical
  | 'finishing' | 'longShots' | 'shortPassing' | 'longPassing' | 'crossing' | 'dribbling' | 'firstTouch'
  | 'ballControl' | 'tackling' | 'heading' | 'marking' | 'reflexes' | 'handling' | 'oneOnOnes'
  // physical
  | 'acceleration' | 'sprintSpeed' | 'agility' | 'balance' | 'strength' | 'jumping' | 'stamina' | 'naturalFitness'
  // mental
  | 'positioning' | 'vision' | 'decisions' | 'composure' | 'anticipation' | 'concentration' | 'workRate'
  | 'offTheBall' | 'defensiveAwareness' | 'leadership';

export type Attrs = Record<AttrKey, number>;
export type AttrGroup = 'technical' | 'physical' | 'mental';

export type Foot = 'left' | 'right' | 'both';
export type Personality =
  | 'ambitious' | 'loyal' | 'professional' | 'competitive' | 'reserved' | 'charismatic' | 'risk-taking';

export interface Appearance {
  skin: number; // 0..5
  hair: number; // colour 0..5
  style: number; // 0..5
  kit?: number;
}

export interface PlayerCondition {
  fatigue: number; // 0 fresh .. 100 exhausted
  matchFitness: number; // 0..100 conditioning
  sharpness: number; // 0..100 match readiness
  morale: number; // 0..100 satisfaction
  confidence: number; // 0..100
}

export type InjurySeverity = 'minor' | 'moderate' | 'serious' | 'major';
export interface Injury {
  type: string;
  severity: InjurySeverity;
  startDay: number;
  daysTotal: number;
  daysLeft: number;
  source: 'match' | 'training';
}

export interface StatLine {
  apps: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
  cleanSheets: number;
  conceded: number;
  ratingSum: number;
  motm: number;
  shots: number;
  ownGoals: number;
}

export type CompKind = 'league' | 'cup' | 'intl' | 'dev';

export type SquadRole =
  | 'Youth prospect' | 'Fringe player' | 'Rotation option' | 'Important player' | 'Regular starter' | 'Key player';

export interface Bonuses {
  appearance: number; // per match played
  goal: number; // per goal
  cleanSheet: number; // per clean sheet (GK/DF/DM only)
  signing: number; // one-off at signing
  signingPaid: boolean;
  loyalty: number; // one-off paid on completing contract
}

export interface Contract {
  id: string;
  clubId: string;
  wage: number; // weekly, GBP
  startDay: number;
  endDay: number;
  role: SquadRole;
  bonuses: Bonuses;
  releaseClause: number | null;
  type: 'academy' | 'professional';
}

export interface LoanInfo {
  parentClubId: string;
  endDay: number;
  wageSharePct: number; // % of wage the loan club pays
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  nationality: string;
  birthDay: number;
  foot: Foot;
  height: number; // cm
  weight: number; // kg
  position: Position;
  secondary: Position | null;
  shirt: number;
  attrs: Attrs;
  caps: Attrs; // per-attribute ceilings derived from potential
  potential: number; // potential overall rating
  xp: Partial<Record<AttrKey, number>>; // fractional progress towards +1
  personality: Personality;
  appearance: Appearance;
  clubId: string | null; // null = free agent / retired
  contract: Contract | null;
  loan: LoanInfo | null;
  cond: PlayerCondition;
  injury: Injury | null;
  injuryProne: number; // 0.7 .. 1.4
  yellowsSeason: number;
  suspension: number; // matches remaining
  recentRatings: number[]; // newest last, max 8
  stats: Partial<Record<CompKind, StatLine>>; // current season
  reputation: number; // 1..100
  retired: boolean;
  nationalPool?: string; // nation code if this is an "abroad" international-pool player
  lastMinutesDay?: number;
}

/* ----------------------------- Clubs ----------------------------- */

export type TacticStyle = 'possession' | 'direct' | 'counter' | 'highPress' | 'lowBlock' | 'balanced';
export type DefLine = 'high' | 'normal' | 'deep';
export type FormationId = '442' | '433' | '4231' | '352' | '532' | '4141';

export interface Tactics {
  style: TacticStyle;
  line: DefLine;
}

export interface Manager {
  id: string;
  name: string;
  nationality: string;
  formation: FormationId;
  tactics: Tactics;
  youthBias: number; // 0..1 willingness to play youngsters
  rotation: number; // 0..1 tendency to rotate
  loyaltyToVeterans: number; // 0..1
  coaching: number; // 1..20 coaching quality
  strictness: number; // 0..1 (demanding managers punish poor form)
  temperament: number; // 0..1 volatility in team talks
}

export interface Crest {
  primary: string;
  secondary: string;
  shape: number; // 0..3
  initials: string;
  pattern: number; // 0..3
}

export interface Club {
  id: string;
  name: string;
  shortName: string;
  country: string;
  stadium: string;
  capacity: number;
  crest: Crest;
  reputation: number; // 1..100
  leagueId: string; // current league competition template id (e.g. "L1")
  division: number; // 1 = top
  balance: number;
  wageBudget: number; // weekly
  transferBudget: number;
  income: number; // weekly baseline income
  trainingFacilities: number; // 1..20
  youthFacilities: number; // 1..20
  ambition: number; // 0..1
  manager: Manager;
  chemistry: number; // 0..100
  lastLineup: string[];
  signingsThisWindow: number;
  isUserClub?: boolean;
}

/* ----------------------------- Competitions ----------------------------- */

export interface FixtureResult {
  hg: number;
  ag: number;
  et?: boolean;
  pens?: [number, number];
  scorers: { p: string; min: number; side: 0 | 1; og?: boolean; pen?: boolean }[];
  cards: { p: string; min: number; side: 0 | 1; red: boolean }[];
  attendance?: number;
}

export interface Fixture {
  id: string;
  compId: string;
  round: string;
  matchday: number; // 0 for cups
  day: number;
  homeId: string;
  awayId: string;
  tieId?: string;
  leg?: 1 | 2;
  neutral?: boolean;
  knockout?: boolean;
  played: boolean;
  result?: FixtureResult;
  detail?: 'full' | 'standard' | 'light';
}

export interface CupTie {
  id: string;
  a: string;
  b: string | null; // null => bye
  fixtureIds: string[];
  winner?: string;
  agg?: [number, number];
  decidedBy?: 'normal' | 'aggregate' | 'extraTime' | 'penalties' | 'bye';
}

export interface CupRound {
  name: string;
  legs: 1 | 2;
  day: number; // first leg day
  day2?: number;
  ties: CupTie[];
  drawn: boolean;
  completed: boolean;
}

export interface Competition {
  id: string;
  name: string;
  short: string;
  type: 'league' | 'cup' | 'intl' | 'dev';
  season: number;
  level: number; // 1 = top division, cup = 0
  clubIds: string[];
  fixtureIds: string[];
  rounds?: CupRound[];
  completed: boolean;
  winnerId?: string;
  runnerUpId?: string;
  /** format description for UI */
  format: string;
  /** international tournament groups */
  groups?: { name: string; teams: string[] }[];
}

export interface TableRow {
  clubId: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: ('W' | 'D' | 'L')[];
}

export interface HistoricWinner {
  season: number;
  compId: string;
  name: string;
  winnerId: string;
  runnerUpId?: string;
}

export type CalendarKind =
  | 'preseason' | 'matchday' | 'cup' | 'intl_break' | 'window_open' | 'window_close' | 'awards' | 'season_end'
  | 'new_season' | 'cup_draw' | 'contract_deadline' | 'intl_tournament';

export interface CalendarEntry {
  day: number;
  kind: CalendarKind;
  label: string;
  ref?: string;
}

/* ----------------------------- Match model ----------------------------- */

export type EventType =
  | 'kickoff' | 'half_time' | 'second_half' | 'full_time' | 'et_start' | 'et_half' | 'et_end' | 'shootout_start'
  | 'pass' | 'key_pass' | 'through_ball' | 'cross' | 'dribble' | 'tackle' | 'interception' | 'clearance'
  | 'shot' | 'save' | 'goal' | 'own_goal' | 'foul' | 'yellow' | 'red' | 'offside' | 'corner' | 'free_kick'
  | 'penalty_awarded' | 'injury' | 'substitution' | 'tactic' | 'shootout_kick' | 'shootout_end' | 'claim'
  | 'woodwork' | 'turnover' | 'counter' | 'block' | 'big_chance';

export type ShotType = 'placed' | 'header' | 'long' | 'volley' | 'oneOnOne' | 'penalty' | 'freeKick' | 'tapIn';
export type ShotOutcome = 'goal' | 'saved' | 'off' | 'blocked' | 'post';

export interface EventData {
  outcome?: ShotOutcome;
  xg?: number;
  shotType?: ShotType;
  dist?: number;
  pressure?: number;
  success?: boolean;
  assist?: string; // player id credited with the assist
  keyPass?: string;
  kind?: string; // sub-type label (e.g. 'safe', 'progressive', 'long', 'direct', 'corner')
  injury?: string;
  severity?: InjurySeverity;
  days?: number;
  on?: string; // sub: player on
  off?: string; // sub: player off
  reason?: string;
  score?: [number, number];
  secondYellow?: boolean;
  pen?: boolean;
  gk?: string;
  style?: TacticStyle;
  line?: DefLine;
  formation?: FormationId;
  taken?: number; // shootout kick number
  pens?: [number, number];
  counter?: boolean;
  fatigue?: boolean;
}

export interface MatchEvent {
  i: number;
  t: number; // seconds since kickoff of the match (continuous, includes stoppage)
  period: 1 | 2 | 3 | 4 | 5; // 3,4 = extra time halves, 5 = shootout
  min: number; // minute of play displayed (base)
  add: number; // stoppage minutes displayed (0 if none)
  side: 0 | 1; // acting team (0 home, 1 away)
  type: EventType;
  p?: string;
  p2?: string;
  x: number; // ball position absolute 0..1 (home attacks towards x=1)
  y: number; // 0..1
  d?: EventData;
}

export interface PlayerMatchStats {
  id: string;
  side: 0 | 1;
  slot: Position;
  started: boolean;
  minutes: number;
  onMin: number | null;
  offMin: number | null;
  goals: number;
  assists: number;
  ownGoals: number;
  shots: number;
  shotsOnTarget: number;
  xg: number;
  keyPasses: number;
  passes: number;
  passesCompleted: number;
  dribbles: number;
  dribblesWon: number;
  tackles: number;
  tacklesWon: number;
  interceptions: number;
  clearances: number;
  blocks: number;
  saves: number;
  conceded: number;
  fouls: number;
  fouled: number;
  yellow: number;
  red: number;
  offsides: number;
  turnovers: number;
  errors: number;
  crosses: number;
  crossesCompleted: number;
  rating: number;
  injured: boolean;
}

export interface TeamMatchStats {
  possession: number; // 0..100
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passesCompleted: number;
  corners: number;
  fouls: number;
  yellow: number;
  red: number;
  offsides: number;
  tackles: number;
  interceptions: number;
  saves: number;
  dribblesWon: number;
  bigChances: number;
  possessionSeconds: number;
}

export interface MatchLineupEntry {
  playerId: string;
  slot: Position;
  started: boolean;
}

export interface MatchResult {
  hg: number;
  ag: number;
  et: boolean;
  pens: [number, number] | null;
  winnerSide: 0 | 1 | null; // null only for a drawn match where a draw is permitted
  events: MatchEvent[];
  team: [TeamMatchStats, TeamMatchStats];
  players: Record<string, PlayerMatchStats>;
  lineups: [MatchLineupEntry[], MatchLineupEntry[]];
  motm: string;
  injuries: { playerId: string; type: string; severity: InjurySeverity; days: number; min: number }[];
  durationSeconds: number;
  formations: [FormationId, FormationId];
}

export interface MatchRecord {
  fixtureId: string;
  compId: string;
  compName: string;
  round: string;
  day: number;
  homeId: string;
  awayId: string;
  result: MatchResult;
  /** the user's player: did he feature, rating, role in match */
  userSummary?: {
    selected: 'start' | 'bench' | 'unused' | 'notInSquad' | 'injured' | 'suspended';
    minutes: number;
    rating: number | null;
    goals: number;
    assists: number;
    subbedOff: boolean;
    managerReaction: string;
    analysis: string[];
  };
  isDev?: boolean;
  homeName: string;
  awayName: string;
  playerNames: Record<string, string>;
}

/* ----------------------------- Career, finance, life ----------------------------- */

export type Difficulty = 'casual' | 'standard' | 'simulation';

export interface Settings {
  difficulty: Difficulty;
  commentarySpeed: number; // ms per tick factor
  sound: boolean;
  volume: number;
  reducedMotion: boolean;
  largeText: boolean;
  highContrast: boolean;
  autosave: boolean;
  simPreference: 'ask' | 'instant' | 'commentary' | 'visual';
}

export interface AttrChange {
  day: number;
  attr: AttrKey;
  from: number;
  to: number;
  reason: string;
}

export interface TrainingPlan {
  focus: TrainingFocus;
  intensity: 'rest' | 'light' | 'normal' | 'intensive';
  matchInstruction: PlayerInstruction;
}
export type TrainingFocus =
  | 'finishing' | 'passing' | 'dribbling' | 'defending' | 'physical' | 'tactical' | 'position' | 'recovery' | 'goalkeeping';
export type PlayerInstruction = 'default' | 'shoot_more' | 'pass_more' | 'dribble_more' | 'stay_back';

export interface SeasonRecord {
  season: number;
  clubId: string;
  clubName: string;
  league: StatLine;
  cup: StatLine;
  intl: StatLine;
  dev: StatLine;
  endOverall: number;
  endPotential: number;
  leaguePos: number | null;
  leagueName: string;
  trophies: string[];
  awards: string[];
}

export interface TransferRecord {
  day: number;
  season: number;
  fromClubId: string | null;
  toClubId: string | null;
  /** name of a club outside the simulated league (a move abroad) */
  toName?: string;
  fee: number;
  kind: 'academy' | 'permanent' | 'loan' | 'free' | 'loan_return' | 'release';
}

export interface ContractRecord {
  day: number;
  clubId: string;
  wage: number;
  years: number;
  role: SquadRole;
  kind: 'signed' | 'extended' | 'academy';
}

export interface Trophy {
  season: number;
  compId: string;
  name: string;
  clubId: string;
  day: number;
}

export interface Milestone {
  id: string;
  day: number;
  season: number;
  title: string;
  detail: string;
  kind: 'debut' | 'goal' | 'hattrick' | 'trophy' | 'transfer' | 'cap' | 'apps' | 'goals' | 'rating' | 'award' | 'injury' | 'contract' | 'life' | 'retirement' | 'other';
}

export interface InjuryRecord {
  day: number;
  type: string;
  severity: InjurySeverity;
  days: number;
  source: 'match' | 'training';
}

export interface AwardRecord {
  season: number;
  award: string;
  playerId: string;
  clubId: string;
  value?: string;
  leagueId?: string;
}

export interface InternationalState {
  nation: string; // nation the user can represent
  eligible: string[]; // eligible nation codes
  youthCaps: number;
  caps: number;
  goals: number;
  assists: number;
  tournaments: { season: number; name: string; result: string }[];
  trophies: { season: number; name: string }[];
  calledUpNow: boolean;
  lastCallUpDay: number | null;
  squadStatus: 'none' | 'youth' | 'senior_watchlist' | 'senior_squad';
  managerOpinion: number; // 0..100
  callUps: { day: number; label: string; level: 'youth' | 'senior'; played: boolean }[];
}

export interface LegacyClubSpell {
  clubId: string;
  clubName: string;
  firstSeason: number;
  lastSeason: number;
  apps: number;
  goals: number;
  assists: number;
  trophies: number;
  score: number;
}

export interface LegacySummary {
  retiredDay: number;
  retiredAge: number;
  reason: string;
  apps: number;
  goals: number;
  assists: number;
  motm: number;
  avgRating: number;
  cleanSheets: number;
  caps: number;
  intlGoals: number;
  highestOverall: number;
  startOverall: number;
  endOverall: number;
  careerEarnings: number;
  netWorth: number;
  clubs: LegacyClubSpell[];
  trophies: { season: number; name: string; clubName: string }[];
  awards: { season: number; award: string }[];
  bestSeason: { season: number; clubName: string; line: string } | null;
  bestSpell: LegacyClubSpell | null;
  timeline: { day: number; season: number; title: string; detail: string; kind: string }[];
  verdict: string;
  verdictDetail: string;
}

export interface CareerState {
  legacy: LegacySummary | null;
  appearances: StatLine; // career totals first-team (league+cup+intl club-level excluded)
  seasons: SeasonRecord[];
  transfers: TransferRecord[];
  contracts: ContractRecord[];
  trophies: Trophy[];
  milestones: Milestone[];
  injuries: InjuryRecord[];
  attrChanges: AttrChange[]; // rolling log (last 400)
  weeklyChange: AttrChange[]; // since last viewed
  highestOverall: number;
  startOverall: number;
  startDay: number;
  startAge: number;
  ovrHistory: { day: number; ovr: number }[];
  records: {
    mostGoalsSeason: { season: number; value: number } | null;
    mostAssistsSeason: { season: number; value: number } | null;
    mostAppsClub: Record<string, number>;
    firstTo: Record<string, number>; // rating milestone -> day first reached
  };
  achievements: Record<string, number>; // id -> day unlocked
  retired: boolean;
  retiredDay: number | null;
  trainingPerformance: number; // 0..100 coach impression
  managerTrust: number; // 0..100
  squadRole: SquadRole;
  retirementDecision: null | { offeredDay: number; choice?: string };
  startPathway: string;
  clubSpellStart: Record<string, number>; // clubId -> day
  hatTricks: number;
  /** where each attribute's recent progress came from, used to explain every change */
  xpSrc: Partial<Record<AttrKey, { t: number; m: number; b: number }>>;
  seasonStartAttrs: Attrs;
  seasonStartOverall: number;
}

export interface LedgerEntry {
  id: number;
  day: number;
  category:
    | 'wage' | 'bonus' | 'signing_bonus' | 'agent_fee' | 'tax' | 'purchase' | 'living' | 'investment'
    | 'investment_return' | 'sponsorship' | 'transfer' | 'gift' | 'other' | 'loyalty';
  description: string;
  amount: number; // signed effect on balance
  balanceAfter: number;
}

export interface Purchase {
  id: string;
  catalogId: string;
  name: string;
  category: string;
  day: number;
  price: number;
  upkeep: number; // weekly
}

export interface Investment {
  id: string;
  catalogId: string;
  name: string;
  type: 'property' | 'business' | 'venture';
  cost: number;
  startDay: number;
  risk: number; // 0..1
  expectedAnnual: number; // expected yearly return fraction
  value: number; // current value
  incomeTotal: number;
  lastReviewDay: number;
  status: 'active' | 'failed' | 'sold';
  history: { day: number; change: number; note: string }[];
}

export interface Sponsorship {
  id: string;
  brand: string;
  category: 'boots' | 'apparel' | 'drink' | 'local' | 'watch' | 'tech' | 'car' | 'charity';
  weekly: number;
  startDay: number;
  endDay: number;
  status: 'active' | 'ended' | 'cancelled';
  paid: number;
}

export interface FinanceState {
  balance: number;
  sponsorships: Sponsorship[];
  careerEarnings: number;
  ledger: LedgerEntry[];
  nextLedgerId: number;
  purchases: Purchase[];
  investments: Investment[];
  lastWagePaidDay: number;
  lastLivingDay: number;
  housing: string; // purchase catalog id of current housing
  paidBonusKeys: string[]; // idempotency keys for one-off payments
}

export interface Relationship {
  id: string;
  name: string;
  kind: 'family' | 'friend' | 'teammate' | 'manager' | 'agent' | 'partner';
  value: number; // 0..100
  note: string;
  playerId?: string;
  /** last day an event or decision involved this person; relationships fade when ignored */
  lastEventDay?: number;
}

export interface Reputation {
  professional: number;
  fans: number;
  media: number;
  club: number;
  national: number;
}

export interface Agent {
  id: string;
  name: string;
  quality: number; // 1..20
  feePct: number; // % of wages
  relationship: number;
  hiredDay: number;
  lastCanvassDay: number;
}

export interface DecisionOption {
  id: string;
  label: string;
  detail?: string;
}

export interface PendingDecision {
  id: string;
  kind: string;
  title: string;
  body: string;
  day: number;
  expiresDay: number | null;
  options: DecisionOption[];
  payload?: Record<string, unknown>;
}

export interface TransferOffer {
  id: string;
  kind: 'permanent' | 'loan' | 'extension' | 'free';
  fromClubId: string; // the club making the offer (or current club for extensions)
  fee: number;
  sellerAgreed: boolean;
  wage: number;
  years: number;
  role: SquadRole;
  bonuses: Bonuses;
  releaseClause: number | null;
  signingBonus: number;
  createdDay: number;
  expiresDay: number;
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn' | 'expired' | 'negotiating';
  patience: number; // negotiation rounds left
  note: string;
  loanEndDay?: number;
  maxWage: number; // hidden ceiling the club will pay
  minYears: number;
  maxYears: number;
  /** a pre-contract: the move happens when the current contract expires on this day */
  preContract?: boolean;
  startDay?: number;
  /** negotiation log shown to the player */
  log?: { day: number; by: 'club' | 'you' | 'agent'; text: string }[];
  /** why the club wants the player (shown in the offer) */
  reason?: string;
  /** the role the club projects for the player in its squad */
  projectedRole?: SquadRole;
  bidRounds?: number;
}

export interface TransferState {
  offers: TransferOffer[];
  history: { day: number; text: string; offerId?: string; result: string }[];
  rumours: { day: number; clubId: string; strength: number }[];
  agent: Agent;
  windowOpen: boolean;
  scoutReports: { day: number; clubId: string; summary: string }[];
  lastInterestDay: number;
  nextOfferId: number;
  freeAgentIds: string[];
  marketNews: { day: number; text: string }[];
}

export interface NewsItem {
  id: number;
  day: number;
  type:
    | 'match' | 'transfer' | 'rumour' | 'injury' | 'award' | 'club' | 'league' | 'international' | 'contract'
    | 'milestone' | 'life' | 'cup' | 'manager';
  headline: string;
  body: string;
  clubId?: string;
  important?: boolean;
  read?: boolean;
}

export interface TrainingState {
  plan: TrainingPlan;
  log: { day: number; focus: TrainingFocus; intensity: string; xp: number; fatigue: number; note: string }[];
  lastSessionDay: number;
  sessionsThisWeek: number;
  weeklyLoad: number[]; // fatigue load for last days (rolling)
}

/* ----------------------------- Game state ----------------------------- */

export interface GameState {
  schema: number;
  simVersion: number;
  id: string;
  name: string; // career label
  createdAt: number;
  updatedAt: number;
  seed: number;
  rngState: number;
  settings: Settings;
  day: number; // current date (days since 2000-01-01)
  season: number; // starting calendar year of the current season
  userId: string;
  players: Record<string, Player>;
  clubs: Record<string, Club>;
  squads: Record<string, string[]>; // clubId -> player ids
  competitions: Record<string, Competition>;
  fixtures: Record<string, Fixture>;
  calendar: CalendarEntry[];
  history: HistoricWinner[];
  career: CareerState;
  finance: FinanceState;
  relationships: Relationship[];
  reputation: Reputation;
  training: TrainingState;
  transfers: TransferState;
  news: NewsItem[];
  nextNewsId: number;
  awards: AwardRecord[];
  matchRecords: Record<string, MatchRecord>;
  decisions: PendingDecision[];
  nextId: number;
  international: InternationalState;
  nations: Record<string, NationalTeam>;
  userMatchLog: string[]; // fixture ids in the order the user played them
  lifeEventDay: number;
  lastSeasonSummary: SeasonSummary | null;
  flags: Record<string, number | string | boolean>;
}

export interface NationalTeam {
  code: string;
  name: string;
  strength: number; // 40..85 baseline
  poolIds: string[]; // players eligible/in pool (world players + abroad players)
  manager: Manager;
  crest: Crest;
}

export interface SeasonSummary {
  season: number;
  leaguePos: number | null;
  leagueName: string;
  promoted: boolean;
  relegated: boolean;
  champion: string;
  cupWinner: string | null;
  awards: AwardRecord[];
  userLines: string[];
  ovrChange: number;
  goals: number;
  assists: number;
  apps: number;
  avgRating: number;
}

/* ----------------------------- Helpers ----------------------------- */

export const emptyStatLine = (): StatLine => ({
  apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellows: 0, reds: 0, cleanSheets: 0, conceded: 0,
  ratingSum: 0, motm: 0, shots: 0, ownGoals: 0,
});

export function addStatLine(a: StatLine, b: StatLine): StatLine {
  return {
    apps: a.apps + b.apps, starts: a.starts + b.starts, minutes: a.minutes + b.minutes, goals: a.goals + b.goals,
    assists: a.assists + b.assists, yellows: a.yellows + b.yellows, reds: a.reds + b.reds,
    cleanSheets: a.cleanSheets + b.cleanSheets, conceded: a.conceded + b.conceded, ratingSum: a.ratingSum + b.ratingSum,
    motm: a.motm + b.motm, shots: a.shots + b.shots, ownGoals: a.ownGoals + b.ownGoals,
  };
}
