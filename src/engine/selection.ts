/**
 * Manager team selection. Deterministic (no randomness): the same squad, fitness and context always give the same XI.
 * Selection depends on ability in the slot, positional fit, fitness, form, morale, rotation habits, youth/veteran bias,
 * competition importance and (for the user's player) training performance and the manager's trust.
 */
import type { Club, FormationId, GameState, Player, Position, SquadRole } from './types';
import { FORMATIONS, type Formation } from './formations';
import { ageAt, positionFit, slotRating, overall } from './attributes';
import { formValue } from './condition';

export type Availability = 'available' | 'injured' | 'suspended' | 'retired';

export function availability(p: Player): Availability {
  if (p.retired) return 'retired';
  if (p.injury) return 'injured';
  if (p.suspension > 0) return 'suspended';
  return 'available';
}

export interface SelectionContext {
  day: number;
  importance: number; // 0..1
  competition: 'league' | 'cup' | 'intl' | 'dev';
}

export function squadOf(state: GameState, clubId: string): Player[] {
  return (state.squads[clubId] ?? []).map((id) => state.players[id]).filter((p) => p && !p.retired);
}

export function selectionScore(state: GameState, club: Pick<Club, 'manager'>, p: Player, slotPos: Position, ctx: SelectionContext): number {
  const m = club.manager;
  const age = ageAt(p.birthDay, ctx.day);
  const base = slotRating(p, slotPos);
  const fat = p.cond.fatigue;
  const rest = Math.max(0, fat - 40) * (0.1 + 0.14 * m.rotation) * (1.3 - 0.6 * ctx.importance);
  const sharp = (p.cond.sharpness - 70) * 0.05;
  const form = (formValue(p) - 50) * 0.06;
  const morale = (p.cond.morale - 65) * 0.015;
  const youth = age <= 20 ? (m.youthBias - 0.4) * 5 - (ctx.importance > 0.8 ? 2 : 0) : 0;
  const vet = age >= 31 ? (m.loyaltyToVeterans - 0.5) * 3 : 0;
  let cupRotation = 0;
  if (ctx.competition === 'cup' && ctx.importance < 0.6) {
    const played = p.stats.league?.minutes ?? 0;
    cupRotation = (m.rotation - 0.3) * 6 * (played < 900 ? 1 : -0.4);
  }
  let user = 0;
  if (p.id === state.userId && ctx.competition !== 'intl') {
    user = (state.career.trainingPerformance - 50) * 0.05 + (state.career.managerTrust - 50) * 0.04;
    // a veteran who agreed a reduced role is used from the bench and in the cups rather than as an automatic starter
    if (state.flags.reducedRole === true) user -= 4;
  }
  return base - rest + sharp + form + morale + youth + vet + cupRotation + user;
}

const SLOT_PRIORITY: Position[] = ['GK', 'CB', 'ST', 'DM', 'CM', 'AM', 'RW', 'LW', 'RB', 'LB'];

export interface SquadSelection {
  formation: FormationId;
  lineup: Player[];
  bench: Player[];
  unavailable: { id: string; reason: string }[];
  score: number;
}

type ManagedTeam = Pick<Club, 'manager'>;

function assign(state: GameState, club: ManagedTeam, f: Formation, pool: Player[], ctx: SelectionContext): { lineup: Player[]; score: number } {
  const used = new Set<string>();
  const lineup: Player[] = new Array(f.slots.length);
  let total = 0;
  const order = f.slots.map((s, i) => ({ s, i })).sort((a, b) => SLOT_PRIORITY.indexOf(a.s.pos) - SLOT_PRIORITY.indexOf(b.s.pos));
  for (const { s, i } of order) {
    let best: Player | null = null;
    let bs = -1e9;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      if (s.pos === 'GK' && p.position !== 'GK') continue;
      if (s.pos !== 'GK' && p.position === 'GK') continue;
      const sc = selectionScore(state, club, p, s.pos, ctx);
      if (sc > bs) { bs = sc; best = p; }
    }
    if (!best) {
      // desperate: any unused player, including an outfielder in goal
      for (const p of pool) {
        if (used.has(p.id)) continue;
        const sc = selectionScore(state, club, p, s.pos, ctx) - 25;
        if (sc > bs) { bs = sc; best = p; }
      }
    }
    if (best) { used.add(best.id); lineup[i] = best; total += bs; }
  }
  return { lineup, score: total };
}

export function pickMatchSquad(state: GameState, clubId: string, ctx: SelectionContext, excludeIds?: ReadonlySet<string>): SquadSelection {
  return pickFromPool(state, state.clubs[clubId], squadOf(state, clubId), ctx, excludeIds);
}

/** Selection from any pool of players (a club squad or a national-team pool) for a team with a manager. */
export function pickFromPool(state: GameState, club: ManagedTeam, all: Player[], ctx: SelectionContext, excludeIds?: ReadonlySet<string>): SquadSelection {
  const unavailable: SquadSelection['unavailable'] = [];
  const pool: Player[] = [];
  for (const p of all) {
    if (excludeIds?.has(p.id)) continue;
    const a = availability(p);
    if (a === 'injured') unavailable.push({ id: p.id, reason: `Injured (${p.injury?.type}, ${p.injury?.daysLeft} days)` });
    else if (a === 'suspended') unavailable.push({ id: p.id, reason: 'Suspended' });
    else if (p.cond.fatigue >= 92) unavailable.push({ id: p.id, reason: 'Exhausted' });
    else pool.push(p);
  }
  // emergency: too few fit players, bring back the least-injured
  if (pool.length < 12) {
    const injured = all.filter((p) => p.injury && !pool.includes(p)).sort((a, b) => (a.injury?.daysLeft ?? 0) - (b.injury?.daysLeft ?? 0));
    for (const p of injured) { if (pool.length >= 14) break; pool.push(p); }
  }
  const candidates: FormationId[] = [club.manager.formation, ...(Object.keys(FORMATIONS) as FormationId[]).filter((x) => x !== club.manager.formation)];
  let best: { id: FormationId; lineup: Player[]; score: number } | null = null;
  for (const id of candidates) {
    const f = FORMATIONS[id];
    const { lineup, score } = assign(state, club, f, pool, ctx);
    if (lineup.some((x) => !x)) continue;
    const s = score + (id === club.manager.formation ? 4 : 0) * 11 / 11;
    if (!best || s > best.score) best = { id, lineup, score: s };
  }
  if (!best) {
    const f = FORMATIONS[club.manager.formation];
    const { lineup, score } = assign(state, club, f, all, ctx);
    best = { id: club.manager.formation, lineup, score };
  }
  const xi = new Set(best.lineup.map((p) => p.id));
  const rest = pool.filter((p) => !xi.has(p.id));
  const bench: Player[] = [];
  const gk = rest.filter((p) => p.position === 'GK').sort((a, b) => overall(b) - overall(a))[0];
  if (gk) bench.push(gk);
  const outfield = rest.filter((p) => p.position !== 'GK').map((p) => ({
    p,
    s: Math.max(...(['CB', 'DM', 'CM', 'AM', 'ST', 'RW'] as Position[]).filter((q) => positionFit(p, q) >= 0.96 || q === p.position).map((q) => slotRating(p, q)))
      + selectionScore(state, club, p, p.position, ctx) * 0.2,
  })).sort((a, b) => b.s - a.s);
  const need = { def: 2, mid: 2, att: 1 };
  const group = (p: Player) => (['CB', 'RB', 'LB'].includes(p.position) ? 'def' : ['DM', 'CM', 'AM'].includes(p.position) ? 'mid' : 'att');
  const chosen: Player[] = [];
  for (const g of ['def', 'mid', 'att'] as const) {
    for (const o of outfield.filter((x) => group(x.p) === g).slice(0, need[g])) chosen.push(o.p);
  }
  for (const o of outfield) { if (chosen.length >= 6) break; if (!chosen.includes(o.p)) chosen.push(o.p); }
  chosen.sort((a, b) => (outfield.find((o) => o.p === b)?.s ?? 0) - (outfield.find((o) => o.p === a)?.s ?? 0));
  bench.push(...chosen.slice(0, 6));
  return { formation: best.id, lineup: best.lineup, bench, unavailable, score: best.score };
}

/* ------------------------------ squad roles ------------------------------ */

export interface RoleAssessment {
  role: SquadRole;
  rank: number;
  competitors: number;
  gapToStarter: number;
  starterName: string | null;
  note: string;
}

const STARTERS_AT: Record<Position, number> = { GK: 1, CB: 2, RB: 1, LB: 1, DM: 1, CM: 2, AM: 1, RW: 1, LW: 1, ST: 2 };

export function assessRole(state: GameState, club: Club, p: Player, day: number): RoleAssessment {
  const age = ageAt(p.birthDay, day);
  const base = squadOf(state, club.id);
  const squad = base.some((q) => q.id === p.id) ? base : [...base, p]; // lets a prospective signing be assessed at another club
  const comps = squad.filter((q) => q.id === p.id || q.position === p.position || q.secondary === p.position || positionFit(q, p.position) >= 0.92);
  const rated = comps.map((q) => ({ q, r: slotRating(q, p.position) + (q.injury ? 0 : 0) })).sort((a, b) => b.r - a.r);
  const idx = rated.findIndex((x) => x.q.id === p.id);
  const rank = idx + 1;
  const starters = STARTERS_AT[p.position];
  const myR = rated[idx]?.r ?? 0;
  const lastStarter = rated[Math.min(starters, rated.length) - 1];
  const gap = Math.round(((lastStarter?.r ?? myR) - myR) * 10) / 10;
  const clubTop = squad.map((q) => overall(q)).sort((a, b) => b - a);
  const top3 = clubTop[Math.min(2, clubTop.length - 1)] ?? 0;
  let role: SquadRole;
  let note: string;
  if (rank <= starters) {
    if (overall(p) >= top3 && rank === 1) { role = 'Key player'; note = 'The manager builds the side around you.'; }
    else { role = 'Regular starter'; note = 'You are first choice in your position.'; }
  } else if (gap <= 3) { role = 'Important player'; note = 'Close to the starters; you will get regular minutes.'; }
  else if (gap <= 8) { role = 'Rotation option'; note = 'You are used to rest the starters and in cup games.'; }
  else if (age <= 19 && (p.contract?.type === 'academy' || gap > 8)) { role = 'Youth prospect'; note = 'The club sees you as one for the future.'; }
  else { role = 'Fringe player'; note = 'You are well behind the first team and need to improve.'; }
  const starterName = lastStarter && lastStarter.q.id !== p.id ? lastStarter.q.displayName : rated[0]?.q.id !== p.id ? rated[0]?.q.displayName ?? null : null;
  return { role, rank, competitors: comps.length, gapToStarter: Math.max(0, gap), starterName, note };
}

/** Plain-English reasons for the manager's decision about one player. */
export function explainSelection(state: GameState, clubId: string, playerId: string, ctx: SelectionContext, sel?: SquadSelection): { status: 'start' | 'bench' | 'out'; reasons: string[] } {
  const p = state.players[playerId];
  const club = state.clubs[clubId];
  const s = sel ?? pickMatchSquad(state, clubId, ctx);
  const reasons: string[] = [];
  if (s.lineup.some((x) => x.id === playerId)) {
    const slot = FORMATIONS[s.formation].slots[s.lineup.findIndex((x) => x.id === playerId)];
    return { status: 'start', reasons: [`Picked at ${slot.pos} in a ${FORMATIONS[s.formation].name}.`] };
  }
  const u = s.unavailable.find((x) => x.id === playerId);
  if (u) return { status: 'out', reasons: [u.reason] };
  const status: 'bench' | 'out' = s.bench.some((x) => x.id === playerId) ? 'bench' : 'out';
  const f = FORMATIONS[s.formation];
  const myRates = f.slots.map((slot, i) => ({ slot, i, mine: selectionScore(state, club, p, slot.pos, ctx), theirs: selectionScore(state, club, s.lineup[i], slot.pos, ctx) }));
  const nat = myRates.filter((x) => x.slot.pos === p.position || positionFit(p, x.slot.pos) >= 0.96);
  const target = (nat.length ? nat : myRates).sort((a, b) => (b.mine - b.theirs) - (a.mine - a.theirs))[0];
  if (target) {
    const rival = s.lineup[target.i];
    const diff = Math.round((target.theirs - target.mine) * 10) / 10;
    reasons.push(`${rival.displayName} was preferred at ${target.slot.pos}${diff > 0 ? ` (${diff} points ahead in the manager's assessment)` : ' (a very close call)'}.`);
    if (rival.cond.fatigue < p.cond.fatigue - 10) reasons.push('You looked more tired than your rival after recent games.');
    if (formValue(rival) > formValue(p) + 10) reasons.push('Your rival is in better recent form.');
  }
  if (p.cond.fatigue > 55) reasons.push(`You are carrying fatigue (${Math.round(p.cond.fatigue)}), which the manager takes into account.`);
  if (p.cond.sharpness < 55) reasons.push('Low match sharpness counts against you.');
  const age = ageAt(p.birthDay, ctx.day);
  if (age <= 19 && club.manager.youthBias < 0.35) reasons.push('The manager rarely trusts teenagers in important games.');
  if (ctx.competition === 'cup' && ctx.importance < 0.6 && club.manager.rotation > 0.4) reasons.push('The manager is rotating for the cup tie.');
  if (!reasons.length) reasons.push('The manager simply preferred other players this week.');
  return { status, reasons };
}
