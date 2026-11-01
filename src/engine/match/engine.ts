/**
 * Event-driven football match engine.
 *
 * The match is a sequence of possession actions (pass, through ball, cross, dribble, shot, clearance...). Every action
 * is chosen from the carrier's situation (zone, pressure from the real positions of nearby opponents, space, tactics,
 * scoreline, time) and resolved with contested probabilities built from the players' attributes. The engine is pure:
 * it never touches the UI and never mutates Player objects, and the result depends only on (input, seed).
 */
import type {
  DefLine, EventData, EventType, FormationId, InjurySeverity, MatchEvent, MatchLineupEntry, MatchResult, Manager,
  Player, PlayerInstruction, PlayerMatchStats, Position, ShotOutcome, ShotType, Tactics, TeamMatchStats, TacticStyle,
} from '../types';
import { Rng, clamp } from '../rng';
import { FORMATIONS, LINE_PARAMS, STYLES, type Formation, type Slot, type StyleParams } from '../formations';
import { positionFit, slotRating } from '../attributes';
import { conditionFactor } from '../condition';
import {
  PITCH_L, computeSkills, distM, distToSegment, duelProbability, expectedGoals, goalProbability, shotGeometry,
  type Skills,
} from './model';
import { ratePlayer } from './ratings';
import { makeInjury, matchInjuryHazard, rollInjuryType } from '../injuries';

export interface MatchSideInput {
  clubId: string;
  name: string;
  shortName: string;
  formation: FormationId;
  tactics: Tactics;
  lineup: Player[]; // exactly 11, index == formation slot index
  bench: Player[];
  chemistry: number; // 0..100
  manager: Pick<Manager, 'strictness' | 'rotation' | 'temperament'>;
  instruction?: { playerId: string; instruction: PlayerInstruction };
}

export interface MatchInput {
  seed: number;
  home: MatchSideInput;
  away: MatchSideInput;
  neutral?: boolean;
  /** Needs a winner: extra time then penalties if level (taking `aggregate` into account). */
  knockout?: boolean;
  /** Goals already scored in the first leg by [home side of this match, away side of this match]. */
  aggregate?: [number, number];
  maxSubs?: number;
  importance?: number; // 0..1
  /** Store every pass/tackle event (live/visual modes). Does not change the simulated outcome. */
  recordAll?: boolean;
  homeAdvantage?: number; // default 1
  injuryFactor?: number; // difficulty scaling for match injury hazard
}

type Side = 0 | 1;

interface PS {
  p: Player;
  id: string;
  side: Side;
  slotIdx: number;
  slot: Slot;
  sk: Skills;
  cf: number;
  fam: number;
  energy: number;
  drain: number;
  e: number;
  on: boolean;
  sentOff: boolean;
  yellows: number;
  onSec: number;
  offSec: number | null;
  knock: boolean;
  fatigueStart: number;
  st: PlayerMatchStats;
  instr: PlayerInstruction;
  x: number;
  y: number;
}

interface SideState {
  idx: Side;
  inp: MatchSideInput;
  all: PS[];
  on: PS[];
  bench: PS[];
  tactics: Tactics;
  baseTactics: Tactics;
  style: StyleParams;
  formation: Formation;
  subsUsed: number;
  windowsUsed: number;
  tacticChanges: number;
  lastTacticMinute: number;
  chem: number;
}

export const TUNE = {
  baseDrain: 0.005,
  shotWeight: 10.5,
  homeBoost: 0.062,
  challengeBase: 0.007,
  challengeP: 0.05,
  offBallFoul: 0.019,
};

const NOMINAL: [number, number][] = [[0, 2700], [2700, 5400], [5400, 6300], [6300, 7200]];

function emptyStats(id: string, side: Side, slot: Position, started: boolean): PlayerMatchStats {
  return {
    id, side, slot, started, minutes: 0, onMin: started ? 0 : null, offMin: null, goals: 0, assists: 0, ownGoals: 0,
    shots: 0, shotsOnTarget: 0, xg: 0, keyPasses: 0, passes: 0, passesCompleted: 0, dribbles: 0, dribblesWon: 0,
    tackles: 0, tacklesWon: 0, interceptions: 0, clearances: 0, blocks: 0, saves: 0, conceded: 0, fouls: 0, fouled: 0,
    yellow: 0, red: 0, offsides: 0, turnovers: 0, errors: 0, crosses: 0, crossesCompleted: 0, rating: 0, injured: false,
  };
}

function emptyTeam(): TeamMatchStats {
  return {
    possession: 50, shots: 0, shotsOnTarget: 0, xg: 0, passes: 0, passesCompleted: 0, corners: 0, fouls: 0, yellow: 0,
    red: 0, offsides: 0, tackles: 0, interceptions: 0, saves: 0, dribblesWon: 0, bigChances: 0, possessionSeconds: 0,
  };
}

const isDefPos = (p: Position) => p === 'CB' || p === 'RB' || p === 'LB';

class Sim {
  rng: Rng;
  inp: MatchInput;
  sides: [SideState, SideState];
  byId = new Map<string, PS>();
  events: MatchEvent[] = [];
  team: [TeamMatchStats, TeamMatchStats] = [emptyTeam(), emptyTeam()];
  goals: [number, number] = [0, 0];
  t = 0;
  period: 1 | 2 | 3 | 4 | 5 = 1;
  poss: Side = 0;
  bx = 0.5;
  by = 0.5;
  carrier!: PS;
  actionNo = 0;
  beaten = false;
  inBehind = false;
  counterLeft = 0;
  lastPass: { passer: PS; receiver: PS; actionNo: number } | null = null;
  errorWatch: { ps: PS; side: Side; actionNo: number } | null = null;
  injuries: MatchResult['injuries'] = [];
  tickMinute = 0;
  pCount = { goals: 0, subs: 0, cards: 0, injuries: 0 };
  recordAll: boolean;
  maxSubs: number;
  homeAdv: number;
  userSkew = 1;
  pens: [number, number] | null = null;
  etPlayed = false;
  drainMult = 1;
  pendingStop: number | null = null;
  evNo = 0;
  shootoutWinner: Side | null = null;

  constructor(inp: MatchInput) {
    this.inp = inp;
    this.rng = new Rng(inp.seed);
    this.recordAll = !!inp.recordAll;
    this.maxSubs = inp.maxSubs ?? 5;
    this.homeAdv = inp.neutral ? 0 : inp.homeAdvantage ?? 1;
    this.sides = [this.buildSide(0, inp.home), this.buildSide(1, inp.away)];
  }

  /* ------------------------------------------------------------------ setup */

  private buildSide(idx: Side, s: MatchSideInput): SideState {
    const formation = FORMATIONS[s.formation];
    const state: SideState = {
      idx, inp: s, all: [], on: [], bench: [], tactics: { ...s.tactics }, baseTactics: { ...s.tactics },
      style: STYLES[s.tactics.style], formation, subsUsed: 0, windowsUsed: 0, tacticChanges: 0, lastTacticMinute: -99, chem: s.chemistry,
    };
    const mk = (p: Player, slotIdx: number, started: boolean): PS => {
      const slot = formation.slots[Math.min(slotIdx, formation.slots.length - 1)];
      const fam = positionFit(p, slot.pos);
      const stam = p.attrs.stamina;
      const roleF = slot.pos === 'GK' ? 0.2 : slot.line === 'mid' ? 1.15 : slot.line === 'def' ? 0.9 : 0.98;
      const tacF = 0.75 + STYLES[s.tactics.style].press * 0.55 + STYLES[s.tactics.style].tempo * 0.15;
      const drain = TUNE.baseDrain * (1.55 - (stam / 100) * 0.95) * roleF * tacF * (0.9 + p.attrs.workRate / 500);
      const fatigueStart = p.cond.fatigue;
      const energy = clamp(1 - (fatigueStart / 100) * 0.5 - ((100 - p.cond.matchFitness) / 100) * 0.2, 0.3, 1);
      const home = idx === 0 ? 1 + TUNE.homeBoost * this.homeAdv : 1;
      const ps: PS = {
        p, id: p.id, side: idx, slotIdx, slot, sk: computeSkills(p.attrs), cf: conditionFactor(p) * home, fam, energy, drain,
        e: 1, on: started, sentOff: false, yellows: 0, onSec: 0, offSec: null, knock: false, fatigueStart,
        st: emptyStats(p.id, idx, slot.pos, started), instr: 'default', x: 0.5, y: 0.5,
      };
      ps.e = this.effective(ps);
      if (s.instruction && s.instruction.playerId === p.id) ps.instr = s.instruction.instruction;
      this.byId.set(p.id, ps);
      state.all.push(ps);
      return ps;
    };
    s.lineup.forEach((p, i) => state.on.push(mk(p, i, true)));
    s.bench.forEach((p, i) => state.bench.push(mk(p, 100 + i, false)));
    return state;
  }

  private effective(ps: PS): number {
    return ps.cf * (0.8 + 0.2 * ps.energy) * (0.93 + 0.07 * ps.fam) * (ps.knock ? 0.9 : 1);
  }

  /* ----------------------------------------------------------------- clock */

  private clock(t: number): { min: number; add: number } {
    const per = Math.min(this.period, 4) - 1;
    const [start, end] = NOMINAL[per];
    const len = (end - start) / 60;
    if (t >= end) return { min: end / 60, add: Math.floor((t - end) / 60) + 1 };
    return { min: start / 60 + Math.min(Math.floor((t - start) / 60) + 1, len), add: 0 };
  }

  /* ----------------------------------------------------------------- events */

  private emit(
    type: EventType, side: Side, p: PS | null | undefined, p2: PS | null | undefined, x: number, y: number, d: EventData = {},
  ): void {
    this.evNo++;
    const tm = this.team[side];
    switch (type) {
      case 'pass':
      case 'through_ball':
        p!.st.passes++; tm.passes++;
        if (d.success) { p!.st.passesCompleted++; tm.passesCompleted++; } else p!.st.turnovers++;
        break;
      case 'cross':
        p!.st.crosses++;
        if (d.success) p!.st.crossesCompleted++;
        break;
      case 'dribble':
        p!.st.dribbles++;
        if (d.success) { p!.st.dribblesWon++; tm.dribblesWon++; } else p!.st.turnovers++;
        break;
      case 'tackle':
        p!.st.tackles++;
        if (d.success) { p!.st.tacklesWon++; tm.tackles++; if (p2) p2.st.turnovers++; }
        break;
      case 'interception': p!.st.interceptions++; tm.interceptions++; break;
      case 'clearance': p!.st.clearances++; break;
      case 'block': p!.st.blocks++; break;
      case 'shot': {
        p!.st.shots++; tm.shots++;
        const o = d.outcome;
        if (o === 'goal' || o === 'saved') { p!.st.shotsOnTarget++; tm.shotsOnTarget++; }
        p!.st.xg += d.xg ?? 0; tm.xg += d.xg ?? 0;
        if ((d.xg ?? 0) >= 0.3) tm.bigChances++;
        if (d.keyPass) this.byId.get(d.keyPass)!.st.keyPasses++;
        break;
      }
      case 'goal': {
        p!.st.goals++;
        if (d.assist) this.byId.get(d.assist)!.st.assists++;
        break;
      }
      case 'own_goal': p!.st.ownGoals++; break;
      case 'save': p!.st.saves++; tm.saves++; break;
      case 'foul': p!.st.fouls++; tm.fouls++; if (p2) p2.st.fouled++; break;
      case 'yellow': p!.st.yellow++; tm.yellow++; break;
      case 'red': p!.st.red++; tm.red++; break;
      case 'offside': p!.st.offsides++; tm.offsides++; break;
      case 'corner': tm.corners++; break;
      default: break;
    }
    const store = this.recordAll || (type !== 'pass' && !(type === 'tackle' && !d.success) && !(type === 'dribble' && !d.success && false));
    if (!store) return;
    const { min, add } = this.clock(this.t);
    this.events.push({
      i: this.events.length, t: Math.round(this.t), period: this.period, min, add, side, type,
      p: p?.id, p2: p2?.id, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, d: Object.keys(d).length ? d : undefined,
    });
  }

  /* --------------------------------------------------------------- geometry */

  private ownX(ps: PS): number { return ps.side === 0 ? ps.x : 1 - ps.x; }
  private ownY(ps: PS): number { return ps.side === 0 ? ps.y : 1 - ps.y; }
  private toAbsX(side: Side, xOwn: number): number { return side === 0 ? xOwn : 1 - xOwn; }
  private toAbsY(side: Side, yOwn: number): number { return side === 0 ? yOwn : 1 - yOwn; }

  /** Positions are a function of formation slot, ball location, possession phase and tactics. */
  private layout(): void {
    for (const s of [0, 1] as Side[]) {
      const side = this.sides[s];
      const inPoss = this.poss === s;
      const bx = this.toAbsX(s, this.bx);
      const by = this.toAbsY(s, this.by);
      // bx/by above convert the absolute ball to this side's own perspective (the mapping is its own inverse)
      const ls = LINE_PARAMS[side.tactics.line].x;
      const press = side.style.press;
      for (const ps of side.on) {
        const { x: sx, y: sy, line } = ps.slot;
        let pull = line === 'gk' ? 0.06 : line === 'def' ? 0.3 : line === 'mid' ? 0.42 : 0.34;
        let fwd: number;
        if (inPoss) {
          pull *= 0.65;
          fwd = line === 'gk' ? 0.02 : line === 'def' ? 0.08 : line === 'mid' ? 0.1 : 0.02;
          fwd += (side.style.possession - 0.5) * 0.05;
        } else {
          fwd = line === 'att' ? -0.1 : line === 'mid' ? -0.03 : 0;
          fwd += (press - 0.5) * 0.08;
        }
        const lineShift = line === 'gk' ? 0 : line === 'def' ? ls : ls * 0.6;
        let x = sx + (bx - sx) * pull + fwd + lineShift;
        if (ps.instr === 'stay_back') x -= 0.07;
        const wide = Math.abs(sy - 0.5) > 0.3;
        let y = sy + (by - sy) * (wide ? 0.16 : 0.24);
        x = line === 'gk' ? clamp(x, 0.02, 0.14) : clamp(x, 0.04, 0.97);
        y = clamp(y, 0.04, 0.96);
        ps.x = s === 0 ? x : 1 - x;
        ps.y = s === 0 ? y : 1 - y;
      }
    }
    // the ball carrier is at the ball
    if (this.carrier && this.carrier.on) { this.carrier.x = this.bx; this.carrier.y = this.by; }
  }

  private pressureOn(c: PS): { P: number; def: PS | null; nd: number } {
    const os = this.sides[1 - c.side as Side];
    const k = 1.12 - 0.35 * os.style.press;
    let prod = 1;
    let best: PS | null = null;
    let bd = 1e9;
    for (const d of os.on) {
      const dm = distM(c.x, c.y, d.x, d.y);
      if (d.slot.line === 'gk' && dm > 12) continue;
      if (dm < bd) { bd = dm; best = d; }
      const q = Math.max(0, 1 - (dm * k) / 9) * 0.78;
      prod *= 1 - q;
    }
    let P = 1 - prod + this.rng.normal(0, 0.07);
    if (this.beaten) P *= 0.45;
    return { P: clamp(P, 0, 1), def: best, nd: bd };
  }

  private nearestOpp(x: number, y: number, side: Side): number {
    let m = 1e9;
    for (const d of this.sides[1 - side as Side].on) {
      const dm = distM(x, y, d.x, d.y);
      if (dm < m) m = dm;
    }
    return m;
  }

  private laneRisk(from: PS, tx: number, ty: number): { risk: number; interceptor: PS | null } {
    const os = this.sides[1 - from.side as Side];
    let prod = 1;
    let best: PS | null = null;
    let bq = 0;
    for (const d of os.on) {
      const dseg = distToSegment(d.x, d.y, from.x, from.y, tx, ty);
      if (dseg > 4.5) continue;
      const q = 0.35 * (1 - dseg / 4.5);
      prod *= 1 - q;
      if (q > bq) { bq = q; best = d; }
    }
    return { risk: 1 - prod, interceptor: best };
  }

  private oppDeepestOwn(side: Side): number {
    // deepest outfield opponent in this side's own perspective (offside line)
    let m = 0;
    for (const d of this.sides[1 - side as Side].on) {
      if (d.slot.line === 'gk') continue;
      const ox = side === 0 ? d.x : 1 - d.x;
      if (ox > m) m = ox;
    }
    return m;
  }

  /* ------------------------------------------------------------ possession */

  private chooseCarrier(side: Side, xOwn: number, yOwn: number, preferGK = false): PS {
    const s = this.sides[side];
    if (preferGK) { const gk = s.on.find((p) => p.slot.line === 'gk'); if (gk) return gk; }
    this.poss = side;
    this.bx = this.toAbsX(side, xOwn);
    this.by = this.toAbsY(side, yOwn);
    this.carrier = s.on[0];
    this.layout();
    let best: PS = s.on[0];
    let bw = -1;
    for (const ps of s.on) {
      if (ps.slot.line === 'gk' && xOwn > 0.12) continue;
      const d = distM(ps.x, ps.y, this.bx, this.by);
      const w = 1 / (4 + d * d / 40) * (0.8 + 0.4 * this.rng.next());
      if (w > bw) { bw = w; best = ps; }
    }
    return best;
  }

  private gain(side: Side, xOwn: number, yOwn: number, delay = 0, preferGK = false, counter = false): void {
    this.poss = side;
    this.beaten = false;
    this.inBehind = false;
    this.lastPass = null;
    this.counterLeft = counter ? 3 : 0;
    this.bx = this.toAbsX(side, xOwn);
    this.by = this.toAbsY(side, yOwn);
    this.carrier = this.chooseCarrier(side, xOwn, yOwn, preferGK);
    this.bx = this.toAbsX(side, xOwn);
    this.by = this.toAbsY(side, yOwn);
    this.t += delay;
    this.team[side].possessionSeconds += 0;
  }

  private gk(side: Side): PS {
    return this.sides[side].on.find((p) => p.slot.line === 'gk') ?? this.sides[side].on[0];
  }

  private spend(a: number, b: number): void {
    const dt = this.rng.range(a, b);
    this.t += dt;
    this.team[this.poss].possessionSeconds += dt;
  }

  /* ------------------------------------------------------------------ main */

  run(): MatchResult {
    this.kickoff(0);
    this.playPeriod(1);
    this.halfTime();
    this.playPeriod(2);
    const aggH = this.inp.aggregate ? this.inp.aggregate[0] : 0;
    const aggA = this.inp.aggregate ? this.inp.aggregate[1] : 0;
    const level = () => this.goals[0] + aggH === this.goals[1] + aggA;
    let et = false;
    if (this.inp.knockout && level()) {
      et = true;
      this.etPlayed = true;
      this.emit('et_start', 0, null, null, 0.5, 0.5);
      this.drainMult = 1.25;
      this.maxSubs += 1;
      this.sides.forEach((s) => (s.windowsUsed = Math.max(0, s.windowsUsed - 1)));
      this.kickoff(this.rng.next() < 0.5 ? 0 : 1);
      this.playPeriod(3);
      this.emit('et_half', 0, null, null, 0.5, 0.5);
      this.kickoff(this.rng.next() < 0.5 ? 0 : 1);
      this.playPeriod(4);
      this.emit('et_end', 0, null, null, 0.5, 0.5);
    }
    this.finish(true);
    let pens: [number, number] | null = null;
    if (this.inp.knockout && level()) pens = this.shootout();
    return this.result(et, pens);
  }

  private kickoff(side: Side): void {
    this.poss = side;
    this.bx = 0.5; this.by = 0.5;
    this.carrier = this.sides[side].on[0];
    this.beaten = false; this.inBehind = false; this.lastPass = null; this.counterLeft = 0;
    this.layout();
    let best = this.sides[side].on[0];
    let bd = 1e9;
    for (const p of this.sides[side].on) {
      if (p.slot.line === 'gk') continue;
      const d = distM(p.x, p.y, 0.5, 0.5);
      if (d < bd) { bd = d; best = p; }
    }
    this.carrier = best;
    this.carrier.x = 0.5; this.carrier.y = 0.5;
    this.emit('kickoff', side, best, null, 0.5, 0.5);
  }

  private playPeriod(period: 1 | 2 | 3 | 4): void {
    this.period = period;
    this.pCount = { goals: 0, subs: 0, cards: 0, injuries: 0 };
    const [start, end] = NOMINAL[period - 1];
    if (this.t < start) this.t = start;
    if (period === 2) this.emit('second_half', 0, null, null, 0.5, 0.5);
    let stop: number | null = null;
    let guard = 0;
    while (guard++ < 6000) {
      if (this.t >= end) {
        if (stop === null) stop = this.stoppage(period);
        if (this.t >= end + stop * 60) break;
      }
      // minute ticks
      while (this.t >= (this.tickMinute + 1) * 60) {
        this.tickMinute++;
        this.minuteTick(this.tickMinute);
      }
      this.step();
    }
    this.t = Math.max(this.t, end + (stop ?? 0) * 60 * 0);
  }

  private stoppage(period: number): number {
    const c = this.pCount;
    const base = period === 2 ? 2.2 : period === 1 ? 0.9 : 0.5;
    const v = base + c.injuries * 0.9 + c.subs * 0.3 + c.goals * 0.4 + c.cards * 0.25 + this.rng.range(0, 1.2);
    return clamp(Math.round(v), 1, period === 2 ? 8 : 5);
  }

  private halfTime(): void {
    this.emit('half_time', 0, null, null, 0.5, 0.5, { score: [this.goals[0], this.goals[1]] });
    // half-time recovery and substitutions
    for (const s of this.sides) for (const ps of s.on) ps.energy = Math.min(1, ps.energy + 0.045);
    this.t = Math.max(this.t, 2700);
    for (const s of [0, 1] as Side[]) this.aiSubs(s, 46, true);
    for (const s of [0, 1] as Side[]) this.aiTactics(s, 46);
    this.kickoff(1);
  }

  private finish(regular: boolean): void {
    this.emit('full_time', 0, null, null, 0.5, 0.5, { score: [this.goals[0], this.goals[1]] });
    for (const s of this.sides) for (const ps of s.on) if (ps.offSec === null) ps.offSec = this.t;
  }

  /* --------------------------------------------------------------- minutes */

  private minuteTick(m: number): void {
    for (const s of this.sides) {
      for (const ps of s.on) {
        ps.energy = Math.max(0.12, ps.energy - ps.drain * this.drainMult * (this.poss === s.idx ? 1 : 1.04));
        ps.e = this.effective(ps);
        const h = matchInjuryHazard(ps.p, ps.energy, ps.fatigueStart, this.inp.injuryFactor ?? 1);
        if (this.rng.next() < h) this.injure(ps);
      }
    }
    const minute = Math.floor(this.t / 60);
    const subMins = this.period >= 3 ? [96, 111] : [58, 67, 75, 82, 87];
    if (this.period >= 2 && subMins.includes(minute)) {
      for (const s of [0, 1] as Side[]) this.aiSubs(s, minute, false);
    }
    if (this.period >= 2 && [60, 70, 78, 85, 95, 110].includes(minute)) {
      for (const s of [0, 1] as Side[]) this.aiTactics(s, minute);
    }
  }

  private injure(ps: PS): void {
    if (!ps.on || ps.st.injured) return;
    const type = rollInjuryType(this.rng, 'match', ps.p);
    const inj = makeInjury(this.rng, type, 0, 'match');
    ps.st.injured = true;
    this.pCount.injuries++;
    this.emit('injury', ps.side, ps, null, ps.x, ps.y, { injury: inj.type, severity: inj.severity, days: inj.daysTotal });
    this.injuries.push({ playerId: ps.id, type: inj.type, severity: inj.severity as InjurySeverity, days: inj.daysTotal, min: Math.floor(this.t / 60) + 1 });
    const side = this.sides[ps.side];
    const canSub = side.subsUsed < this.maxSubs && side.bench.length > 0;
    if (canSub) {
      this.substitute(side, ps, this.pickReplacement(side, ps, 'injury'), 'injury');
    } else if (inj.severity === 'minor') {
      ps.knock = true;
      ps.e = this.effective(ps);
    } else {
      this.removeFromPitch(ps);
    }
  }

  /* ------------------------------------------------------------ substitutions */

  private liveRating(ps: PS): number {
    const mins = (this.t - ps.onSec) / 60;
    if (mins < 8) return 6.2;
    const g = this.goals;
    const my = g[ps.side];
    const opp = g[1 - ps.side as Side];
    return ratePlayer({ ...ps.st, minutes: mins }, { teamGoals: my, oppGoals: opp, won: null, matchMinutes: 90 });
  }

  private pickReplacement(side: SideState, off: PS, reason: 'injury' | 'tired' | 'tactical-att' | 'tactical-def' | 'card'): PS {
    let best: PS | null = null;
    let bs = -1e9;
    const slotPos = off.slot.pos;
    for (const b of side.bench) {
      if (b.sentOff || b.on || b.offSec !== null) continue;
      if (slotPos === 'GK' && b.p.position !== 'GK') continue;
      if (slotPos !== 'GK' && b.p.position === 'GK') continue;
      let s = slotRating(b.p, slotPos) + (1 - b.fatigueStart / 100) * 3;
      if (reason === 'tactical-att' && (b.p.position === 'ST' || b.p.position === 'AM' || b.p.position === 'RW' || b.p.position === 'LW')) s += 4;
      if (reason === 'tactical-def' && (isDefPos(b.p.position) || b.p.position === 'DM')) s += 4;
      if (s > bs) { bs = s; best = b; }
    }
    return best ?? side.bench.find((b) => !b.on && b.offSec === null)!;
  }

  private substitute(side: SideState, off: PS, on: PS | undefined, reason: string): void {
    if (!on) { this.removeFromPitch(off); return; }
    const idx = side.on.indexOf(off);
    if (idx < 0) return;
    side.on[idx] = on;
    const bi = side.bench.indexOf(on);
    if (bi >= 0) side.bench.splice(bi, 1);
    off.on = false;
    off.offSec = this.t;
    off.st.offMin = Math.floor(this.t / 60) + 1;
    on.on = true;
    on.onSec = this.t;
    on.slot = off.slot;
    on.slotIdx = off.slotIdx;
    on.st.slot = off.slot.pos;
    on.st.onMin = Math.floor(this.t / 60) + 1;
    on.fam = positionFit(on.p, off.slot.pos);
    on.energy = clamp(1 - (on.fatigueStart / 100) * 0.5 - ((100 - on.p.cond.matchFitness) / 100) * 0.2, 0.3, 1);
    on.e = this.effective(on);
    side.subsUsed++;
    this.pCount.subs++;
    if (this.carrier === off) this.carrier = on;
    this.emit('substitution', side.idx, on, off, off.x, off.y, { on: on.id, off: off.id, reason });
  }

  private removeFromPitch(ps: PS): void {
    const side = this.sides[ps.side];
    const i = side.on.indexOf(ps);
    if (i >= 0) side.on.splice(i, 1);
    ps.on = false;
    ps.offSec = this.t;
    ps.st.offMin = Math.floor(this.t / 60) + 1;
  }

  private aiSubs(sideIdx: Side, minute: number, halftime: boolean): void {
    const side = this.sides[sideIdx];
    if (side.subsUsed >= this.maxSubs || side.bench.length === 0) return;
    if (!halftime && side.windowsUsed >= 3) return;
    const diff = this.goals[sideIdx] - this.goals[1 - sideIdx as Side];
    const late = minute >= 70;
    const cand: { ps: PS; pr: number; reason: 'tired' | 'tactical-att' | 'tactical-def' | 'card' }[] = [];
    for (const ps of side.on) {
      if (ps.slot.line === 'gk') continue;
      let pr = (1 - ps.energy) * 85;
      let reason: 'tired' | 'tactical-att' | 'tactical-def' | 'card' = 'tired';
      const lr = this.liveRating(ps);
      pr += Math.max(0, 6.3 - lr) * (28 + side.inp.manager.strictness * 22);
      if (ps.yellows > 0 && (isDefPos(ps.slot.pos) || ps.slot.pos === 'DM') && minute >= 55) { pr += 14; reason = 'card'; }
      if (diff < 0 && minute >= 58 && (isDefPos(ps.slot.pos) || ps.slot.pos === 'DM')) { pr += 16; reason = 'tactical-att'; }
      if (diff > 0 && minute >= 72 && ps.slot.line === 'att') { pr += 14; reason = 'tactical-def'; }
      if (ps.knock) pr += 60;
      cand.push({ ps, pr, reason });
    }
    cand.sort((a, b) => b.pr - a.pr);
    const threshold = halftime ? 34 : minute < 62 ? 36 : minute < 72 ? 28 : minute < 80 ? 22 : 14;
    const maxThisWindow = halftime ? 2 : minute >= 75 ? 2 : 1;
    let n = 0;
    for (const c of cand) {
      if (n >= maxThisWindow || side.subsUsed >= this.maxSubs) break;
      if (c.pr < threshold) break;
      if (late && n === 0 && this.rng.next() > 0.85 && c.pr < 40) break;
      this.substitute(side, c.ps, this.pickReplacement(side, c.ps, c.reason), c.reason);
      n++;
    }
    if (n > 0 && !halftime) side.windowsUsed++;
  }

  /* ------------------------------------------------------------ tactics AI */

  private aiTactics(sideIdx: Side, minute: number): void {
    const side = this.sides[sideIdx];
    if (side.tacticChanges >= 3 || minute - side.lastTacticMinute < 8) return;
    const diff = this.goals[sideIdx] - this.goals[1 - sideIdx as Side];
    const down = 11 - side.on.length;
    const oppDown = 11 - this.sides[1 - sideIdx as Side].on.length;
    const imp = this.inp.importance ?? 0.5;
    let target: Tactics | null = null;
    if (down > oppDown && down > 0) target = { style: 'lowBlock', line: 'deep' };
    else if (oppDown > down && diff <= 0) target = { style: 'possession', line: 'high' };
    else if (diff < 0 && minute >= 60) {
      const base = side.baseTactics.style;
      const style: TacticStyle = base === 'lowBlock' || base === 'counter' ? 'direct' : base === 'balanced' ? 'highPress' : base;
      target = { style, line: diff <= -2 || imp > 0.7 ? 'high' : 'normal' };
    } else if (diff > 0 && minute >= (imp > 0.6 ? 70 : 76)) {
      target = { style: diff >= 2 ? 'balanced' : 'lowBlock', line: diff >= 2 ? 'normal' : 'deep' };
    } else if (diff === 0 && minute >= 80 && imp > 0.7) {
      target = { style: 'direct', line: 'high' };
    }
    if (!target) return;
    if (target.style === side.tactics.style && target.line === side.tactics.line) return;
    side.tactics = target;
    side.style = STYLES[target.style];
    side.tacticChanges++;
    side.lastTacticMinute = minute;
    this.emit('tactic', sideIdx, null, null, 0.5, 0.5, { style: target.style, line: target.line as DefLine });
  }

  /* ------------------------------------------------------------- actions */

  private step(): void {
    this.actionNo++;
    if (!this.carrier || !this.carrier.on) {
      this.carrier = this.chooseCarrier(this.poss, this.toAbsX(this.poss, this.bx), this.toAbsY(this.poss, this.by));
    }
    this.layout();
    const c = this.carrier;
    const cs = this.sides[c.side];
    const os = this.sides[1 - c.side as Side];
    const xo = this.ownX(c);
    const yo = this.ownY(c);
    const { P, def, nd } = this.pressureOn(c);

    // spontaneous fouls (shirt pulls, late tackles) by the defending side
    if (def && this.rng.next() < TUNE.offBallFoul * (0.6 + 0.8 * os.style.press) * this.boxDamp(c) && !this.inBehind) {
      const fouler = this.pickFouler(os, def);
      this.spend(2, 4);
      this.doFoul(fouler, c, 'jostle');
      return;
    }
    // defensive challenge
    if (def && nd < 9) {
      const pc = TUNE.challengeBase + TUNE.challengeP * P * (0.7 + 0.6 * os.style.press);
      if (this.rng.next() < pc * (this.inBehind ? 0.6 : 1)) {
        if (this.doChallenge(c, def, P)) return;
      }
    }

    // counterattack flag
    const counter = this.counterLeft > 0;
    if (counter) this.counterLeft--;

    const act = this.chooseAction(c, cs, os, xo, yo, P, counter);
    switch (act) {
      case 'safe': this.doPass(c, 'safe', P); break;
      case 'prog': this.doPass(c, 'prog', P); break;
      case 'long': this.doPass(c, 'long', P); break;
      case 'through': this.doPass(c, 'through', P); break;
      case 'cross': this.doCross(c, 'open', P); break;
      case 'dribble': this.doDribble(c, def, P, nd); break;
      case 'shot': this.doShot(c, this.inBehind ? 'oneOnOne' : this.pickShotType(xo, yo), P); break;
      case 'clear': this.doClearance(c, P); break;
    }
    if (this.errorWatch && this.actionNo - this.errorWatch.actionNo > 3) this.errorWatch = null;
  }

  private chooseAction(c: PS, cs: SideState, os: SideState, xo: number, yo: number, P: number, counter: boolean):
    'safe' | 'prog' | 'long' | 'through' | 'cross' | 'dribble' | 'shot' | 'clear' {
    const style = cs.style;
    const e = c.e;
    const isGK = c.slot.line === 'gk';
    const wide = Math.abs(yo - 0.5) > 0.27;
    const diff = this.goals[c.side] - this.goals[1 - c.side as Side];
    const minute = this.t / 60;
    const late = minute > 70;
    const vis = (c.p.attrs.vision + c.p.attrs.decisions) / 130;
    const comp = c.p.attrs.composure / 100;

    let wSafe = (34 + 26 * P * (1.2 - comp * 0.5)) * (0.75 + 0.5 * style.possession) * (1 - 0.35 * style.directness);
    let wProg = 24 * (0.6 + 0.8 * vis) * (0.7 + 0.6 * style.tempo) * (xo < 0.15 ? 0.7 : 1);
    let wLong = xo < 0.5 ? (3 + 24 * style.directness) * (c.sk.passLong * e / 65) * (isGK ? 1.6 : xo < 0.3 ? 1 : 0.5) : 0;
    let wThrough = 0;
    if (xo > 0.42 && !isGK) {
      const run = this.bestRunner(c);
      wThrough = 4.5 * (c.sk.through * e / 60) * (0.6 + 0.8 * style.risk) * run * LINE_PARAMS[os.tactics.line].spaceBehind;
    }
    let wCross = 0;
    if (wide && xo > 0.66) wCross = 24 * (c.sk.cross * e / 62) * (0.6 + 0.8 * style.width);
    else if (Math.abs(yo - 0.5) > 0.22 && xo > 0.6) wCross = 6 * (c.sk.cross * e / 62) * style.width;
    let wDribble = isGK ? 0 : (4.0 + (c.slot.pos === 'RW' || c.slot.pos === 'LW' ? 3 : 0)) * (c.sk.dribble * e / 62) * (1.25 - 0.7 * P) * (0.7 + 0.6 * style.risk) * (wide ? 1.15 : 1) * (xo < 0.3 ? 0.35 : 1);
    let wShot = 0;
    if (xo > 0.62 && !isGK) {
      const g = shotGeometry(xo, yo);
      const base = expectedGoals(g.dist, g.angle, g.dist > 21 ? 'long' : 'placed', P);
      const role = c.slot.pos === 'ST' ? 1.3 : c.slot.pos === 'AM' ? 1.1 : c.slot.pos === 'RW' || c.slot.pos === 'LW' ? 1.0 : c.slot.pos === 'CM' ? 0.8 : c.slot.pos === 'DM' ? 0.5 : 0.35;
      const lust = 0.7 + 0.6 * clamp(c.p.attrs.finishing / 70, 0.3, 1.4);
      wShot = TUNE.shotWeight * Math.pow(base, 0.5) * role * lust * (g.dist > 21 ? 0.7 + 0.6 * (c.p.attrs.longShots / 70) : 1);
    }
    let wClear = xo < 0.22 && !isGK ? 38 * P * (0.5 + 0.8 * (1 - comp)) + (P > 0.55 && xo < 0.15 ? 22 : 0) : 0;
    if (isGK) { wSafe *= 1.3; wDribble = 0; wClear = 0; }

    // situational modifiers
    if (this.inBehind) { wShot = Math.max(wShot, 230) * 1.4; wDribble *= 0.4; wSafe *= 0.35; wProg *= 0.15; wThrough = 0; wCross = 0; wLong = 0; wClear = 0; }
    if (counter) { wSafe *= 0.5; wThrough *= 1.7; wProg *= 1.5; wDribble *= 1.4; }
    if (diff < 0 && late) { wShot *= 1 + Math.min(0.3, -diff * 0.12); wLong *= 1.25; wCross *= 1.2; }
    if (diff > 0 && late) { wSafe *= 1.25; wDribble *= 0.8; wShot *= 0.85; wProg *= 0.9; }
    switch (c.instr) {
      case 'shoot_more': wShot *= 1.5; wDribble *= 1.1; break;
      case 'pass_more': wSafe *= 1.25; wProg *= 1.2; wShot *= 0.7; break;
      case 'dribble_more': wDribble *= 1.7; break;
      case 'stay_back': wShot *= 0.55; wDribble *= 0.6; wSafe *= 1.2; break;
      default: break;
    }
    const acts = ['safe', 'prog', 'long', 'through', 'cross', 'dribble', 'shot', 'clear'] as const;
    return this.rng.weighted(acts, [wSafe, wProg, wLong, wThrough, wCross, wDribble, wShot, wClear]);
  }

  private bestRunner(c: PS): number {
    let best = 0;
    for (const t of this.sides[c.side].on) {
      if (t === c || t.slot.line === 'gk' || t.slot.line === 'def') continue;
      const dx = this.ownX(t) - this.ownX(c);
      if (dx < 0.1) continue;
      const q = Math.pow(t.sk.run * t.e / 60, 1.5);
      if (q > best) best = q;
    }
    return clamp(best, 0, 1.6);
  }

  private pickFouler(os: SideState, nearest: PS): PS {
    const cands = os.on.filter((p) => p.slot.line !== 'gk' && distM(p.x, p.y, this.bx, this.by) < 18);
    if (!cands.length) return nearest;
    const w = cands.map((p) => (p === nearest ? 3 : 1) * (0.5 + p.sk.aggression / 60) * (p.yellows > 0 ? 0.55 : 1));
    return this.rng.weighted(cands, w);
  }

  /* --------------------------------------------------------------- passing */

  private pickTarget(c: PS, kind: 'safe' | 'prog' | 'long' | 'through'): PS | null {
    const s = this.sides[c.side];
    const cx = this.ownX(c);
    const cands: PS[] = [];
    const w: number[] = [];
    const isGK = c.slot.line === 'gk';
    for (const t of s.on) {
      if (t === c) continue;
      const tx = this.ownX(t);
      const dx = tx - cx;
      const dist = distM(c.x, c.y, t.x, t.y);
      let wt = 0;
      if (t.slot.line === 'gk') {
        wt = kind === 'safe' && cx < 0.3 ? 0.25 : 0;
      } else if (kind === 'safe') {
        if (dist > 38) continue;
        wt = Math.exp(-dist / 18) * (dx >= -0.02 ? 1 : 0.5) * (1 + 0.5 * clamp(dx * 5, 0, 1));
        if (isGK) wt *= t.slot.line === 'def' ? 2 : 0.6;
      } else if (kind === 'prog') {
        if (dx < 0.06) continue;
        wt = Math.exp(-Math.abs(dx - 0.2) / 0.12) * (t.slot.line === 'def' ? 0.5 : 1.2);
      } else if (kind === 'through') {
        if (dx < 0.1 || tx < 0.45 || t.slot.line === 'def') continue;
        wt = Math.pow(t.sk.run * t.e / 60, 2) * (tx > 0.6 ? 1.3 : 1);
      } else {
        if (dx < 0.22) continue;
        wt = (t.slot.line === 'att' ? 2 : 1) * Math.exp(-Math.abs(dx - 0.4) / 0.22) * (0.6 + (t.sk.aerialAtt * t.e) / 100);
      }
      if (wt > 0) { cands.push(t); w.push(wt); }
    }
    if (!cands.length) return null;
    // look at two options and prefer the safer one in proportion to decision quality
    const a = this.rng.weighted(cands, w);
    if (cands.length < 2) return a;
    const b = this.rng.weighted(cands, w);
    if (a === b) return a;
    const q = clamp((c.p.attrs.decisions + c.p.attrs.vision) / 200, 0.2, 0.9);
    if (this.rng.next() > q) return a;
    const ra = this.laneRisk(c, a.x, a.y).risk + 0.01 * this.nearestOpp(a.x, a.y, c.side) * -1;
    const rb = this.laneRisk(c, b.x, b.y).risk + 0.01 * this.nearestOpp(b.x, b.y, c.side) * -1;
    return ra <= rb ? a : b;
  }

  private doPass(c: PS, kind: 'safe' | 'prog' | 'long' | 'through', P: number): void {
    const cs = this.sides[c.side];
    const os = this.sides[1 - c.side as Side];
    let tgt = this.pickTarget(c, kind);
    let k = kind;
    if (!tgt && kind !== 'safe') { tgt = this.pickTarget(c, 'safe'); k = 'safe'; }
    if (!tgt) { this.doClearance(c, P); return; }
    const cx = this.ownX(c);
    const tx = this.ownX(tgt);
    const ty = this.ownY(tgt);
    const dist = distM(c.x, c.y, tgt.x, tgt.y);

    // offside check for passes into the channel
    if ((k === 'through' || k === 'long') && tx > 0.6 && tgt.slot.line === 'att') {
      const lineX = this.oppDeepestOwn(c.side);
      if (tx > lineX - 0.015) {
        const trap = LINE_PARAMS[os.tactics.line].offsideTrap;
        const awareness = os.on.reduce((s, p) => s + (p.slot.line === 'def' ? p.p.attrs.defensiveAwareness : 0), 0) / Math.max(1, os.on.filter((p) => p.slot.line === 'def').length);
        const pOff = clamp(0.04 + 0.2 * trap + 0.0035 * (70 - tgt.sk.run) + 0.0025 * (awareness - 60), 0.02, 0.5);
        if (this.rng.next() < pOff) {
          this.spend(5, 8);
          this.emit('offside', tgt.side, tgt, c, tgt.x, tgt.y);
          this.restartFreeKick(os.idx === 0 ? 0 : 1, this.bx, this.by, true);
          return;
        }
      }
    }

    const skill = (k === 'long' ? c.sk.passLong : k === 'through' ? c.sk.through : c.sk.passShort) * c.e;
    const lane = this.laneRisk(c, tgt.x, tgt.y);
    const base = { safe: 0.975, prog: 0.865, through: 0.6, long: 0.68 }[k];
    const space = k === 'through' ? LINE_PARAMS[os.tactics.line].spaceBehind : 1;
    let p = base * (k === 'through' ? 0.5 + 0.5 * space : 1)
      + (k === 'through' ? 0.005 : 0.004) * (skill - 60)
      + 0.0015 * (tgt.sk.recv * tgt.e - 60)
      - 0.14 * P
      - lane.risk * { safe: 0.25, prog: 0.4, through: 0.45, long: 0.3 }[k]
      - 0.0016 * Math.max(0, dist - 20) * (k === 'long' ? 0.3 : 1)
      + 0.0003 * (cs.chem - 70)
      + (k === 'safe' || k === 'prog' ? (cs.style.possession - 0.5) * 0.012 : 0);
    p = clamp(p, 0.03, 0.985);
    this.spend(k === 'long' ? 5.5 : 3.0, k === 'long' ? 9 : 5.6);

    if (this.rng.next() < p) {
      // completed
      const nx = clamp(tx, 0.03, 0.97);
      const ny = clamp(ty, 0.04, 0.96);
      const evType: EventType = k === 'through' ? 'through_ball' : 'pass';
      this.emit(evType, c.side, c, tgt, this.bx, this.by, { success: true, kind: k });
      this.lastPass = { passer: c, receiver: tgt, actionNo: this.actionNo };
      this.bx = this.toAbsX(c.side, nx);
      this.by = this.toAbsY(c.side, ny);
      this.carrier = tgt;
      this.beaten = false;
      if (k === 'through') {
        this.inBehind = tx > 0.55 && this.rng.next() < clamp(0.08 + 0.14 * space, 0.06, 0.35);
        if (this.inBehind) { this.bx = this.toAbsX(c.side, clamp(Math.max(tx, cx + 0.2), 0.78, 0.93)); this.by = this.toAbsY(c.side, clamp(ty, 0.3, 0.7)); }
      } else this.inBehind = false;
    } else {
      this.emit(k === 'through' ? 'through_ball' : 'pass', c.side, c, tgt, this.bx, this.by, { success: false, kind: k });
      this.lastPass = null;
      this.inBehind = false;
      const intercept = lane.interceptor && lane.risk > 0.15 && this.rng.next() < 0.42;
      if (intercept && lane.interceptor) {
        const d = lane.interceptor;
        const ok = this.rng.next() < clamp(0.42 + 0.004 * (d.sk.intercept * d.e - 60), 0.15, 0.9);
        if (ok) {
          this.emit('interception', d.side, d, c, d.x, d.y, {});
          this.turnover(c, d.side, this.ownX(d), this.ownY(d), true);
          return;
        }
      }
      // misplaced: loose ball picked up by the other team near where it ends
      const lx = clamp(cx + (tx - cx) * this.rng.range(0.7, 1.15), 0.02, 0.98);
      const ly = clamp(ty + this.rng.normal(0, 0.05), 0.04, 0.96);
      this.errorWatch = { ps: c, side: c.side, actionNo: this.actionNo };
      this.turnover(c, os.idx, 1 - lx, 1 - ly, false);
    }
  }

  /** Possession changes to `side` at that side's own-perspective coordinates. */
  private turnover(loser: PS, side: Side, xOwn: number, yOwn: number, win: boolean): void {
    const prevPossAdvanced = this.ownX(loser) > 0.6;
    const counter = this.sides[side].style.counter > 0.55 && prevPossAdvanced && this.rng.next() < this.sides[side].style.counter * 0.3;
    const gk = xOwn < 0.06;
    this.gain(side, clamp(xOwn, 0.03, 0.97), clamp(yOwn, 0.05, 0.95), 0, gk, counter);
    if (counter) this.emit('counter', side, this.carrier, null, this.bx, this.by);
  }

  /* ------------------------------------------------------------- dribbling */

  private doDribble(c: PS, def: PS | null, P: number, nd: number): void {
    this.spend(5, 9);
    const xo = this.ownX(c);
    if (!def || nd > 9) {
      // open space: carry the ball
      const gain = this.rng.range(0.05, 0.14) * (0.8 + c.sk.pace * c.e / 150);
      this.advance(c, gain);
      return;
    }
    const att = c.sk.dribble * c.e;
    const dfn = def.sk.defend * def.e;
    const speed = 0.012 * (c.sk.pace * c.e - def.sk.pace * def.e);
    const space = 0.6 * (0.5 - P) * 0.5;
    const pWin = duelProbability(att, dfn, speed + space);
    if (this.rng.next() < pWin) {
      this.emit('dribble', c.side, c, def, this.bx, this.by, { success: true });
      this.beaten = true;
      this.advance(c, this.rng.range(0.06, 0.18) * (0.8 + c.sk.pace * c.e / 150));
      if (this.rng.next() < 0.07 * (1 - def.p.attrs.composure / 140) * this.boxDamp(c)) {
        this.doFoul(def, c, 'beaten');
      }
    } else {
      if (this.rng.next() < 0.15 * this.boxDamp(c)) {
        this.emit('dribble', c.side, c, def, this.bx, this.by, { success: false });
        this.doFoul(def, c, 'tackle');
      } else {
        this.emit('dribble', c.side, c, def, this.bx, this.by, { success: false });
        this.emit('tackle', def.side, def, c, this.bx, this.by, { success: true });
        this.errorWatch = xo < 0.4 ? { ps: c, side: c.side, actionNo: this.actionNo } : null;
        this.turnover(c, def.side, 1 - this.ownX(c) + 0, 1 - this.ownY(c), true);
      }
    }
  }

  /** Referees give far fewer fouls inside the box than elsewhere (penalties are rare events). */
  private boxDamp(c: PS): number {
    return this.ownX(c) > 0.835 && Math.abs(this.ownY(c) - 0.5) < 0.3 ? 0.22 : 1;
  }

  private advance(c: PS, dx: number): void {
    const xo = clamp(this.ownX(c) + dx, 0.03, 0.96);
    const yo = clamp(this.ownY(c) + this.rng.normal(0, 0.05), 0.05, 0.95);
    this.bx = this.toAbsX(c.side, xo);
    this.by = this.toAbsY(c.side, yo);
  }

  private doChallenge(c: PS, def: PS, P: number): boolean {
    this.spend(3, 6);
    const att = c.sk.retention * c.e * (this.beaten ? 1.08 : 1);
    const dfn = def.sk.tackle * def.e;
    const pDef = 1 / (1 + Math.exp(-((dfn - att) / 10 - 0.4)));
    const r = this.rng.next();
    if (r < pDef) {
      if (this.rng.next() < (0.09 + 0.15 * (1 - def.p.attrs.tackling / 100)) * this.boxDamp(c)) {
        this.doFoul(def, c, 'tackle');
        return true;
      }
      this.emit('tackle', def.side, def, c, this.bx, this.by, { success: true });
      this.errorWatch = null;
      this.turnover(c, def.side, 1 - this.ownX(c), 1 - this.ownY(c), true);
      return true;
    }
    this.emit('tackle', def.side, def, c, this.bx, this.by, { success: false });
    this.beaten = true;
    if (this.rng.next() < 0.07 * this.boxDamp(c)) { this.doFoul(def, c, 'tackle'); return true; }
    return false;
  }

  /* ----------------------------------------------------------------- fouls */

  private doFoul(fouler: PS, victim: PS, kind: 'tackle' | 'jostle' | 'beaten'): void {
    this.spend(3, 8);
    const vxo = this.ownX(victim);
    const vyo = this.ownY(victim);
    this.emit('foul', fouler.side, fouler, victim, this.bx, this.by, { kind });
    this.pCount.cards += 0;
    const denial = this.inBehind;
    let pRed = denial ? 0.09 : kind === 'tackle' ? 0.0025 : 0.0008;
    pRed *= 0.7 + fouler.sk.aggression / 100;
    let pYellow = 0.135 + (vxo > 0.7 ? 0.05 : 0) + (denial ? 0.25 : 0) + (kind === 'tackle' ? 0.04 : 0) + (fouler.sk.aggression > 55 ? 0.03 : 0) + (fouler.yellows > 0 ? -0.1 : 0);
    const r = this.rng.next();
    if (r < pRed) this.sendOff(fouler, false);
    else if (r < pRed + pYellow) this.book(fouler);
    this.inBehind = false;
    // restart
    const sideV = victim.side;
    const inBox = vxo > 0.835 && Math.abs(vyo - 0.5) < 0.3;
    if (inBox && fouler.on !== undefined) this.doPenalty(sideV, victim, fouler);
    else this.restartFreeKick(sideV, this.bx, this.by, false);
  }

  private book(ps: PS): void {
    ps.yellows++;
    this.pCount.cards++;
    if (ps.yellows >= 2) {
      this.emit('yellow', ps.side, ps, null, ps.x, ps.y, { secondYellow: true });
      this.sendOff(ps, true);
    } else this.emit('yellow', ps.side, ps, null, ps.x, ps.y);
  }

  private sendOff(ps: PS, second: boolean): void {
    this.pCount.cards++;
    this.emit('red', ps.side, ps, null, ps.x, ps.y, { secondYellow: second });
    ps.sentOff = true;
    this.removeFromPitch(ps);
    if (this.carrier === ps) this.carrier = this.sides[this.poss].on[0];
    this.aiTactics(ps.side, Math.floor(this.t / 60) + 100);
  }

  private restartFreeKick(side: Side, ax: number, ay: number, offside: boolean): void {
    // side = team awarded the free kick; (ax, ay) absolute location
    const xo = this.toAbsX(side, ax);
    const yo = this.toAbsY(side, ay);
    this.poss = side;
    this.bx = ax; this.by = ay;
    this.beaten = false; this.inBehind = false; this.lastPass = null;
    const s = this.sides[side];
    this.carrier = s.on[0];
    this.layout();
    const takers = s.on.filter((p) => p.slot.line !== 'gk');
    const taker = xo > 0.55
      ? takers.reduce((b, p) => (p.sk.setPiece * p.e > b.sk.setPiece * b.e ? p : b), takers[0])
      : this.chooseCarrier(side, xo, yo);
    this.carrier = taker;
    this.t += this.rng.range(8, 18);
    const dxm = (1 - xo) * PITCH_L;
    if (xo >= 0.7 && Math.abs(yo - 0.5) <= 0.3 && dxm <= 32) {
      const r = this.rng.next();
      if (r < 0.36) { this.doShot(taker, 'freeKick', 0.3); return; }
      if (r < 0.88) { this.doCross(taker, 'freekick', 0.1); return; }
    } else if (xo >= 0.55 && Math.abs(yo - 0.5) > 0.2 && this.rng.next() < 0.45) {
      this.doCross(taker, 'freekick', 0.1);
      return;
    }
    // short / quick restart: play continues with the taker
    this.bx = ax; this.by = ay;
  }

  /* ------------------------------------------------------------- crossing */

  private doCross(c: PS, kind: 'open' | 'corner' | 'freekick', P: number): void {
    const cs = this.sides[c.side];
    const os = this.sides[1 - c.side as Side];
    this.spend(kind === 'open' ? 5 : 3, kind === 'open' ? 8 : 6);
    const bonus = kind === 'corner' ? 0.12 : kind === 'freekick' ? 0.14 : 0;
    const attackers = cs.on.filter((p) => p !== c && p.slot.line !== 'gk' && this.ownX(p) > 0.74 && Math.abs(this.ownY(p) - 0.5) < 0.3);
    const boxAtt = attackers.length + (kind === 'corner' || kind === 'freekick' ? 2 : 0);
    const pDeliver = clamp(0.3 + 0.0055 * (c.sk.cross * c.e - 62) - 0.16 * P + bonus + 0.025 * (boxAtt - 2), 0.08, 0.78);
    const cyo = kind === 'open' ? this.ownY(c) : 0.5;
    if (this.rng.next() >= pDeliver) {
      this.emit('cross', c.side, c, null, this.bx, this.by, { success: false, kind });
      this.lastPass = null;
      const defs = os.on.filter((d) => d.slot.line !== 'gk');
      const d = this.rng.weighted(defs, defs.map((x) => Math.pow(x.sk.aerialDef * x.e / 60, 2) * (x.slot.line === 'def' ? 1.5 : 0.7)));
      if (kind === 'open' && this.rng.next() < 0.4) {
        this.emit('clearance', d.side, d, null, d.x, d.y, { kind: 'cross' });
        this.doCorner(c.side, cyo > 0.5 ? 1 : 0);
        return;
      }
      this.emit('clearance', d.side, d, null, d.x, d.y, { kind: 'cross' });
      this.errorWatch = null;
      this.gain(os.idx, this.rng.range(0.14, 0.3), this.rng.range(0.25, 0.75), 0, false, false);
      return;
    }
    // delivered into the box
    this.emit('cross', c.side, c, null, this.bx, this.by, { success: true, kind });
    const gk = this.gk(os.idx);
    const pClaim = kind === 'corner' ? 0.13 : 0.1 + 0.002 * (gk.p.attrs.handling - 60);
    if (this.rng.next() < clamp(pClaim, 0.04, 0.2) && gk.on) {
      this.emit('claim', gk.side, gk, c, gk.x, gk.y, {});
      this.gain(os.idx, 0.05, 0.5, this.rng.range(4, 9), true, false);
      return;
    }
    const pool = attackers.length ? attackers : cs.on.filter((p) => p !== c && p.slot.line !== 'gk');
    const target = this.rng.weighted(pool, pool.map((p) => Math.pow(p.sk.aerialAtt * p.e / 60, 2) * (p.slot.line === 'att' ? 1.6 : 1)));
    const defs = os.on.filter((d) => d.slot.line !== 'gk');
    const marker = this.rng.weighted(defs, defs.map((x) => Math.pow(x.sk.aerialDef * x.e / 60, 2) * (x.slot.line === 'def' ? 1.8 : 0.6)));
    const pAtt = duelProbability(target.sk.aerialAtt * target.e, marker.sk.aerialDef * marker.e, -0.35 + 0.08 * (boxAtt - 3));
    this.lastPass = { passer: c, receiver: target, actionNo: this.actionNo };
    if (this.rng.next() < pAtt) {
      this.carrier = target;
      this.bx = this.toAbsX(c.side, this.rng.range(0.9, 0.96));
      this.by = this.toAbsY(c.side, 0.5 + this.rng.normal(0, 0.08));
      this.doShot(target, 'header', clamp(0.55 - (pAtt - 0.4) * 0.8, 0.15, 0.7));
    } else {
      // defender wins the aerial duel
      this.lastPass = null;
      this.emit('clearance', marker.side, marker, target, marker.x, marker.y, { kind: 'aerial' });
      const og = this.rng.next() < 0.006 * (1 + (100 - marker.p.attrs.composure) / 80);
      if (og) { this.ownGoal(marker); return; }
      const r = this.rng.next();
      if (r < 0.24) this.doCorner(c.side, cyo > 0.5 ? 1 : 0);
      else if (r < 0.46) this.gain(c.side, this.rng.range(0.62, 0.74), this.rng.range(0.25, 0.75), 0, false, false);
      else this.gain(os.idx, this.rng.range(0.2, 0.34), this.rng.range(0.25, 0.75), 0, false, this.sides[os.idx].style.counter > 0.6);
    }
  }

  private doCorner(side: Side, flank: 0 | 1): void {
    const s = this.sides[side];
    this.emit('corner', side, null, null, side === 0 ? 1 : 0, flank === 1 ? 0.97 : 0.03, {});
    this.poss = side;
    this.bx = side === 0 ? 0.995 : 0.005;
    this.by = (side === 0) === (flank === 1) ? 0.99 : 0.01;
    this.layout();
    const takers = s.on.filter((p) => p.slot.line !== 'gk');
    const taker = takers.reduce((b, p) => (p.sk.setPiece * p.e > b.sk.setPiece * b.e ? p : b), takers[0]);
    this.carrier = taker;
    taker.x = this.bx; taker.y = this.by;
    this.inBehind = false; this.beaten = false;
    this.t += this.rng.range(12, 25);
    this.doCross(taker, 'corner', 0.12);
  }

  /* --------------------------------------------------------------- shooting */

  private pickShotType(xo: number, yo: number): ShotType {
    const g = shotGeometry(xo, yo);
    if (g.dist > 21) return 'long';
    if (this.rng.next() < 0.05) return 'volley';
    return 'placed';
  }

  private doShot(c: PS, type: ShotType, P: number): void {
    const cs = this.sides[c.side];
    const os = this.sides[1 - c.side as Side];
    this.spend(2, 4);
    const gk = this.gk(os.idx);
    const xo = this.ownX(c);
    const yo = this.ownY(c);
    const geo = shotGeometry(xo, yo);
    const isPen = type === 'penalty';
    const xg = expectedGoals(geo.dist, geo.angle, type, P);
    const shooterSkill = (type === 'header' ? c.sk.headShot : type === 'long' || (type === 'freeKick' && geo.dist > 24) ? c.sk.longShot
      : type === 'freeKick' ? c.sk.setPiece * 0.5 + c.sk.longShot * 0.5 : type === 'penalty' ? c.sk.penalty : c.sk.shoot) * c.e;
    const keeperSkill = (type === 'oneOnOne' ? gk.sk.gk1v1 : gk.sk.gkSave) * gk.e;

    // assist / key pass bookkeeping
    let keyPass: string | undefined;
    if (this.lastPass && this.lastPass.receiver === c && this.actionNo - this.lastPass.actionNo <= 2 && !isPen && type !== 'freeKick') {
      keyPass = this.lastPass.passer.id;
    }
    // error watch: the side that lost the ball now shoots
    if (this.errorWatch && this.errorWatch.side !== c.side && xg >= 0.08 && this.actionNo - this.errorWatch.actionNo <= 3) {
      this.errorWatch.ps.st.errors++;
      this.errorWatch = null;
    }
    const base: EventData = { xg: Math.round(xg * 1000) / 1000, shotType: type, dist: Math.round(geo.dist), pressure: Math.round(P * 100) / 100, gk: gk.id };
    if (keyPass) base.keyPass = keyPass;
    if ((xg >= 0.3 || type === 'oneOnOne') && !isPen) this.emit('big_chance', c.side, c, null, this.bx, this.by, {});

    let outcome: ShotOutcome;
    if (isPen) {
      const pGoal = clamp(0.76 + 0.003 * (shooterSkill - 62) - 0.0022 * (keeperSkill - 62), 0.55, 0.92);
      const r = this.rng.next();
      outcome = r < pGoal ? 'goal' : r < pGoal + (1 - pGoal) * 0.55 ? 'saved' : r < pGoal + (1 - pGoal) * 0.85 ? 'off' : 'post';
    } else {
      const pGoalRaw = goalProbability(xg, shooterSkill, keeperSkill);
      const pBlock = type === 'header' ? 0.04 : type === 'freeKick' ? 0.1 : type === 'oneOnOne' ? 0.03 + 0.1 * P
        : clamp(0.13 + 0.3 * P + (geo.dist > 20 ? 0.05 : 0) - 0.1 * (c.e - 1), 0.04, 0.5);
      const pOff = type === 'oneOnOne' ? clamp(0.16 + 0.15 * P - 0.003 * (shooterSkill - 60), 0.05, 0.5)
        : clamp(0.36 + 0.011 * (geo.dist - 12) + 0.2 * P - 0.0035 * (shooterSkill - 60) + (type === 'header' ? 0.1 : 0), 0.1, 0.85);
      const onTarget = (1 - pBlock) * (1 - pOff);
      const pGoalGivenOT = clamp(pGoalRaw / onTarget, 0.02, 0.97);
      const r1 = this.rng.next();
      if (r1 < pBlock) outcome = 'blocked';
      else if (this.rng.next() < pOff) outcome = this.rng.next() < 0.06 ? 'post' : 'off';
      else outcome = this.rng.next() < pGoalGivenOT ? 'goal' : 'saved';
    }

    const dataBase = { ...base, outcome, pen: isPen || undefined };
    this.emit('shot', c.side, c, null, this.bx, this.by, dataBase);
    this.lastPass = null;

    if (outcome === 'goal') {
      this.scoreGoal(c, keyPass, isPen, type);
      return;
    }
    if (outcome === 'saved') {
      this.emit('save', gk.side, gk, c, gk.x, gk.y, {});
      this.afterSave(c, gk, isPen, type);
      return;
    }
    if (outcome === 'post') {
      this.emit('woodwork', c.side, c, null, this.bx, this.by, {});
      if (!isPen && this.rng.next() < 0.4) { this.rebound(c); return; }
      this.gain(os.idx, this.rng.range(0.15, 0.3), this.rng.range(0.3, 0.7), 2, false, false);
      return;
    }
    if (outcome === 'blocked') {
      const defs = os.on.filter((d) => d.slot.line !== 'gk');
      const b = this.rng.weighted(defs, defs.map((d) => 1 / (1 + distM(d.x, d.y, c.x, c.y) / 6)));
      this.emit('block', b.side, b, c, b.x, b.y, {});
      const r = this.rng.next();
      if (r < 0.36) this.doCorner(c.side, yo > 0.5 ? 1 : 0);
      else if (r < 0.63) this.gain(c.side, clamp(xo - 0.06, 0.55, 0.9), this.rng.range(0.25, 0.75), 2, false, false);
      else this.gain(os.idx, this.rng.range(0.15, 0.32), this.rng.range(0.25, 0.75), 2, false, os.style.counter > 0.6);
      return;
    }
    // off target: goal kick
    this.gain(os.idx, 0.05, 0.5, this.rng.range(10, 20), true, false);
    cs.chem += 0;
  }

  private afterSave(c: PS, gk: PS, isPen: boolean, type: ShotType): void {
    const os = this.sides[gk.side];
    if (isPen) { this.gain(os.idx, 0.05, 0.5, 8, true, false); return; }
    const pHeld = clamp(0.5 + 0.004 * (gk.p.attrs.handling - 60), 0.3, 0.8);
    if (this.rng.next() < pHeld) {
      this.gain(os.idx, 0.05, 0.5, this.rng.range(5, 10), true, os.style.counter > 0.6);
      return;
    }
    const r = this.rng.next();
    if (r < 0.34) this.doCorner(c.side, this.ownY(c) > 0.5 ? 1 : 0);
    else if (r < 0.52) this.rebound(c);
    else this.gain(os.idx, this.rng.range(0.15, 0.3), this.rng.range(0.25, 0.75), 2, false, false);
  }

  private rebound(c: PS): void {
    const cs = this.sides[c.side];
    const cands = cs.on.filter((p) => p.slot.line !== 'gk' && this.ownX(p) > 0.6);
    const shooter = cands.length ? this.rng.weighted(cands, cands.map((p) => Math.pow(p.sk.run * p.e / 60, 1.5) + 0.2)) : c;
    this.carrier = shooter;
    this.bx = this.toAbsX(c.side, this.rng.range(0.9, 0.95));
    this.by = this.toAbsY(c.side, 0.5 + this.rng.normal(0, 0.1));
    this.lastPass = null;
    this.doShot(shooter, 'tapIn', 0.35);
  }

  private scoreGoal(shooter: PS, assister: string | undefined, isPen: boolean, type: ShotType): void {
    const side = shooter.side;
    this.goals[side]++;
    this.pCount.goals++;
    const d: EventData = { score: [this.goals[0], this.goals[1]], pen: isPen || undefined, shotType: type };
    if (assister && assister !== shooter.id) d.assist = assister;
    this.emit('goal', side, shooter, assister ? this.byId.get(assister) : null, this.bx, this.by, d);
    for (const p of this.sides[1 - side as Side].on) p.st.conceded++;
    this.restartAfterGoal(1 - side as Side);
  }

  private ownGoal(defender: PS): void {
    const conceding = defender.side;
    const scoringSide = (1 - conceding) as Side;
    this.goals[scoringSide]++;
    this.pCount.goals++;
    this.emit('own_goal', conceding, defender, null, defender.x, defender.y, { score: [this.goals[0], this.goals[1]] });
    for (const p of this.sides[conceding].on) p.st.conceded++;
    this.restartAfterGoal(conceding);
  }

  private restartAfterGoal(kickingOff: Side): void {
    this.t += this.rng.range(35, 55);
    this.kickoff(kickingOff);
  }

  /* ---------------------------------------------------------- clearances */

  private doClearance(c: PS, P: number): void {
    this.spend(3, 6);
    const os = this.sides[1 - c.side as Side];
    this.emit('clearance', c.side, c, null, this.bx, this.by, { kind: 'defensive' });
    const og = this.ownX(c) < 0.12 && this.rng.next() < 0.004 * (1 + P) * (1 + (100 - c.p.attrs.composure) / 100);
    if (og) { this.ownGoal(c); return; }
    const r = this.rng.next();
    this.lastPass = null;
    if (r < 0.22) {
      // out for a throw-in: opposing throw deep in their own half
      this.gain(os.idx, this.rng.range(0.55, 0.7), this.rng.range(0.05, 0.95), this.rng.range(8, 15), false, false);
    } else if (r < 0.5) {
      this.gain(c.side, this.rng.range(0.38, 0.55), this.rng.range(0.2, 0.8), 0, false, false);
    } else {
      this.gain(os.idx, 1 - this.rng.range(0.4, 0.55), this.rng.range(0.2, 0.8), 0, false, false);
    }
    this.errorWatch = null;
  }

  /* ---------------------------------------------------------------- penalty */

  private doPenalty(side: Side, victim: PS, fouler: PS): void {
    const s = this.sides[side];
    this.emit('penalty_awarded', side, victim, fouler, this.toAbsX(side, 0.94), 0.5, {});
    const takers = s.on.filter((p) => p.slot.line !== 'gk');
    const taker = takers.reduce((b, p) => (p.sk.penalty * p.e > b.sk.penalty * b.e ? p : b), takers[0]);
    this.t += this.rng.range(35, 70);
    this.poss = side;
    this.carrier = taker;
    this.bx = this.toAbsX(side, 0.895);
    this.by = 0.5;
    this.layout();
    this.doShot(taker, 'penalty', 0);
  }

  /* --------------------------------------------------------------- shootout */

  private shootout(): [number, number] {
    this.period = 5;
    this.emit('shootout_start', 0, null, null, 0.5, 0.5);
    const pens: [number, number] = [0, 0];
    const order: PS[][] = [0, 1].map((i) => {
      const s = this.sides[i];
      const outfield = s.on.filter((p) => p.slot.line !== 'gk').sort((a, b) => b.sk.penalty * b.e - a.sk.penalty * a.e);
      return [...outfield, ...s.on.filter((p) => p.slot.line === 'gk')];
    });
    let taken = 0;
    const kick = (sideIdx: Side, n: number): boolean => {
      const list = order[sideIdx];
      const taker = list[n % list.length];
      const gkp = this.gk((1 - sideIdx) as Side);
      const pressure = n >= 4 ? 0.03 : 0;
      const pGoal = clamp(0.76 + 0.003 * (taker.sk.penalty * taker.e - 62) - 0.002 * (gkp.sk.gkSave * gkp.e - 62) - pressure * (taker.p.attrs.composure < 55 ? 1.5 : 0.5), 0.5, 0.92);
      const r = this.rng.next();
      const scored = r < pGoal;
      if (scored) pens[sideIdx]++;
      taken++;
      this.emit('shootout_kick', sideIdx, taker, gkp, 0.9, 0.5, {
        outcome: scored ? 'goal' : r < pGoal + (1 - pGoal) * 0.6 ? 'saved' : 'off', taken: taken, pens: [pens[0], pens[1]],
      });
      return scored;
    };
    const first: Side = this.rng.next() < 0.5 ? 0 : 1;
    const second = (1 - first) as Side;
    const done = (n: number): boolean => {
      // n = kicks taken by each side so far (after the second side's kick of round n)
      if (n <= 5) {
        const remA = 5 - n;
        return pens[first] > pens[second] + remA || pens[second] > pens[first] + remA;
      }
      return pens[0] !== pens[1];
    };
    let round = 0;
    for (; round < 5; round++) {
      kick(first, round);
      // early termination check after first kick of the round
      if (pens[second] + (5 - round) < pens[first] || pens[first] + (5 - round - 1) < pens[second]) { if (pens[second] + (5 - round) < pens[first] || pens[first] + (5 - round - 1) < pens[second]) break; }
      kick(second, round);
      if (done(round + 1)) { round++; break; }
    }
    if (pens[0] === pens[1]) {
      for (let n = 5; n < 40; n++) {
        kick(first, n);
        kick(second, n);
        if (pens[0] !== pens[1]) break;
      }
    }
    if (pens[0] === pens[1]) { // astronomically unlikely; keep the match valid
      pens[this.rng.next() < 0.5 ? 0 : 1]++;
    }
    this.shootoutWinner = pens[0] > pens[1] ? 0 : 1;
    this.emit('shootout_end', this.shootoutWinner, null, null, 0.5, 0.5, { pens: [pens[0], pens[1]] });
    return pens;
  }

  /* ----------------------------------------------------------------- result */

  private result(et: boolean, pens: [number, number] | null): MatchResult {
    const end = this.t;
    const players: Record<string, PlayerMatchStats> = {};
    const lineups: [MatchLineupEntry[], MatchLineupEntry[]] = [[], []];
    const matchMin = et ? 120 : 90;
    const hg = this.goals[0];
    const ag = this.goals[1];
    for (const s of this.sides) {
      for (const ps of s.all) {
        if (ps.st.started || ps.st.onMin !== null) {
          const off = ps.offSec ?? end;
          const mins = Math.max(0, (off - ps.onSec) / 60);
          ps.st.minutes = Math.min(matchMin + 8, Math.round(mins));
          if (ps.st.minutes === 0 && ps.st.onMin !== null) ps.st.minutes = 1;
        }
        players[ps.id] = ps.st;
        lineups[s.idx].push({ playerId: ps.id, slot: ps.st.slot, started: ps.st.started });
      }
    }
    const winnerByScore = hg > ag ? 0 : ag > hg ? 1 : null;
    const winnerSide: 0 | 1 | null = pens ? (pens[0] > pens[1] ? 0 : 1) : winnerByScore;
    // knockout second legs: winner is determined by aggregate, not this match alone; callers decide the tie.
    for (const s of this.sides) {
      for (const ps of s.all) {
        if (ps.st.minutes <= 0) continue;
        const my = this.goals[s.idx];
        const opp = this.goals[1 - s.idx];
        ps.st.rating = ratePlayer(ps.st, { teamGoals: my, oppGoals: opp, won: my > opp ? true : my < opp ? false : (winnerSide === null ? null : winnerSide === s.idx), matchMinutes: matchMin });
      }
    }
    const totalPoss = this.team[0].possessionSeconds + this.team[1].possessionSeconds || 1;
    this.team[0].possession = Math.round((this.team[0].possessionSeconds / totalPoss) * 100);
    this.team[1].possession = 100 - this.team[0].possession;
    // man of the match
    let motm = '';
    let best = -1;
    for (const id of Object.keys(players)) {
      const st = players[id];
      if (st.minutes <= 0) continue;
      const score = st.rating + (this.goals[st.side] > this.goals[1 - st.side as Side] ? 0.15 : 0) + st.goals * 0.01;
      if (score > best) { best = score; motm = id; }
    }
    return {
      hg, ag, et, pens, winnerSide, events: this.events, team: this.team, players, lineups, motm,
      injuries: this.injuries, durationSeconds: Math.round(end), formations: [this.sides[0].inp.formation, this.sides[1].inp.formation],
    };
  }
}

export function simulateMatch(input: MatchInput): MatchResult {
  return new Sim(input).run();
}

/** Pre-match strength summary (also used by the club AI and the match preview). */
export interface TeamStrength {
  attack: number; midfield: number; defence: number; keeper: number; balance: number; fitness: number; overall: number;
}

export function teamStrength(lineup: Player[], formation: FormationId, chemistry = 70): TeamStrength {
  const f = FORMATIONS[formation];
  const rate = (i: number) => slotRating(lineup[i], f.slots[i].pos) * (0.9 + 0.1 * conditionFactor(lineup[i]));
  const groups: Record<string, number[]> = { gk: [], def: [], mid: [], att: [] };
  f.slots.forEach((s, i) => { if (lineup[i]) groups[s.line].push(rate(i)); });
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const defence = 0.6 * avg(groups.def) + 0.4 * Math.min(...(groups.def.length ? groups.def : [0]));
  const attack = avg(groups.att);
  const midfield = avg(groups.mid);
  const keeper = avg(groups.gk);
  const outOfPos = lineup.reduce((s, p, i) => s + (1 - positionFit(p, f.slots[i].pos)), 0);
  const balance = clamp(100 - outOfPos * 12, 0, 100);
  const fitness = avg(lineup.map((p) => 100 - p.cond.fatigue));
  const overall = (0.28 * attack + 0.3 * midfield + 0.24 * defence + 0.18 * keeper) * (0.97 + 0.03 * (chemistry / 100)) - (100 - balance) * 0.05;
  return { attack, midfield, defence, keeper, balance, fitness, overall };
}
