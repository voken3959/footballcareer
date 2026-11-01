/* Calibration harness: simulate many matches and compare aggregate statistics with real-football norms. */
import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/world';
import { slotRating, overall } from '../src/engine/attributes';
import { FORMATIONS } from '../src/engine/formations';
import { simulateMatch, type MatchSideInput } from '../src/engine/match/engine';
import { dayOf } from '../src/engine/dates';
import type { Club, Player } from '../src/engine/types';

const N = Number(process.argv[2] ?? 300);
const w = generateWorld(new Rng(11), { next: 1 }, dayOf(2026, 7, 1), 2026);

function side(club: Club): MatchSideInput {
  const f = FORMATIONS[club.manager.formation];
  const squad = w.squads[club.id].map((id) => w.players[id]);
  const used = new Set<string>();
  const lineup: Player[] = [];
  for (const slot of f.slots) {
    let best: Player | null = null; let bs = -1;
    for (const p of squad) { if (used.has(p.id)) continue; const s = slotRating(p, slot.pos); if (s > bs) { bs = s; best = p; } }
    used.add(best!.id); lineup.push(best!);
  }
  const bench = squad.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a)).slice(0, 7);
  return { clubId: club.id, name: club.name, shortName: club.shortName, formation: club.manager.formation, tactics: club.manager.tactics, lineup, bench, chemistry: club.chemistry, manager: club.manager };
}

const clubs = Object.values(w.clubs);
const rng = new Rng(5);
const acc: Record<string, number> = {};
const add = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);
const goalsDist: number[] = [];
const ratings: number[] = [];
let wins = 0, draws = 0;
let t0 = Date.now();
let favWins = 0, favGames = 0, strongHomeGoals = 0;
for (let i = 0; i < N; i++) {
  const h = rng.pick(clubs); let a = rng.pick(clubs); while (a === h) a = rng.pick(clubs);
  const r = simulateMatch({ seed: rng.int(1, 1e9), home: side(h), away: side(a), recordAll: false });
  const [T0, T1] = r.team;
  add('goals', r.hg + r.ag); add('homeGoals', r.hg); add('awayGoals', r.ag);
  add('shots', T0.shots + T1.shots); add('sot', T0.shotsOnTarget + T1.shotsOnTarget); add('xg', T0.xg + T1.xg);
  add('passes', T0.passes + T1.passes); add('passesC', T0.passesCompleted + T1.passesCompleted);
  add('corners', T0.corners + T1.corners); add('fouls', T0.fouls + T1.fouls); add('yellow', T0.yellow + T1.yellow); add('red', T0.red + T1.red);
  add('offsides', T0.offsides + T1.offsides); add('tackles', T0.tackles + T1.tackles); add('inter', T0.interceptions + T1.interceptions);
  add('saves', T0.saves + T1.saves); add('dribbles', T0.dribblesWon + T1.dribblesWon); add('big', T0.bigChances + T1.bigChances);
  add('poss0', T0.possession); add('subs', r.events.filter((e) => e.type === 'substitution').length); add('inj', r.injuries.length);
  add('events', r.events.length); add('dur', r.durationSeconds);
  goalsDist.push(r.hg + r.ag);
  if (r.hg > r.ag) wins++; else if (r.hg === r.ag) draws++;
  for (const st of Object.values(r.players)) if (st.minutes >= 60) ratings.push(st.rating);
  const fav = h.reputation > a.reputation + 10 ? 0 : a.reputation > h.reputation + 10 ? 1 : -1;
  if (fav >= 0) { favGames++; if ((fav === 0 && r.hg > r.ag) || (fav === 1 && r.ag > r.hg)) favWins++; }
  void strongHomeGoals;
}
const ms = Date.now() - t0;
const per = (k: string) => (acc[k] / N).toFixed(2);
console.log(`matches ${N}  ms/match ${(ms / N).toFixed(1)}`);
console.log(`goals/match ${per('goals')} (home ${per('homeGoals')} away ${per('awayGoals')})  [real ~2.6-2.9; home adv ~+0.3]`);
console.log(`shots ${per('shots')} [~25] on target ${per('sot')} [~8.5-9.5] xG total ${per('xg')} [~2.7] conv ${(acc.goals / acc.shots * 100).toFixed(1)}% [~10-11%] big chances ${per('big')}`);
console.log(`passes ${per('passes')} [~800-900] completion ${(acc.passesC / acc.passes * 100).toFixed(1)}% [~80-85]`);
console.log(`corners ${per('corners')} [~10] fouls ${per('fouls')} [~22-24] yellow ${per('yellow')} [~3.5-4] red ${per('red')} [~0.1] offsides ${per('offsides')} [~3.5-4.5]`);
console.log(`tackles won ${per('tackles')} [~22] interceptions ${per('inter')} [~20] saves ${per('saves')} [~6] dribbles won ${per('dribbles')} [~18] subs ${per('subs')} [~7-9] injuries ${per('inj')} [~0.3-0.5]`);
console.log(`home poss avg ${per('poss0')} stored events/match ${per('events')} duration s ${per('dur')}`);
const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
const sd = Math.sqrt(ratings.reduce((a, b) => a + (b - mean) ** 2, 0) / ratings.length);
console.log(`ratings mean ${mean.toFixed(2)} [~6.4-6.6] sd ${sd.toFixed(2)} min ${Math.min(...ratings).toFixed(1)} max ${Math.max(...ratings).toFixed(1)}`);
console.log(`home win ${(wins / N * 100).toFixed(0)}% draw ${(draws / N * 100).toFixed(0)}% away ${((N - wins - draws) / N * 100).toFixed(0)}% [~45/25/30]; clearly stronger side wins ${(favWins / Math.max(1, favGames) * 100).toFixed(0)}% (n=${favGames}) [~60-70]`);
const hist: Record<number, number> = {};
for (const g of goalsDist) hist[Math.min(g, 7)] = (hist[Math.min(g, 7)] ?? 0) + 1;
console.log('total goals distribution', Object.entries(hist).map(([k, v]) => `${k}${Number(k) === 7 ? '+' : ''}:${(v / N * 100).toFixed(0)}%`).join(' '));
