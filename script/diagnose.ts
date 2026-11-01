import { Rng } from '../src/engine/rng';
import { generateWorld } from '../src/engine/world';
import { slotRating, overall } from '../src/engine/attributes';
import { FORMATIONS } from '../src/engine/formations';
import { simulateMatch, type MatchSideInput } from '../src/engine/match/engine';
import { dayOf } from '../src/engine/dates';
import type { Club, Player } from '../src/engine/types';

const w = generateWorld(new Rng(11), { next: 1 }, dayOf(2026, 7, 1), 2026);
function side(club: Club): MatchSideInput {
  const f = FORMATIONS[club.manager.formation];
  const squad = w.squads[club.id].map((id) => w.players[id]);
  const used = new Set<string>(); const lineup: Player[] = [];
  for (const slot of f.slots) { let best: Player | null = null; let bs = -1; for (const p of squad) { if (used.has(p.id)) continue; const s = slotRating(p, slot.pos); if (s > bs) { bs = s; best = p; } } used.add(best!.id); lineup.push(best!); }
  const bench = squad.filter((p) => !used.has(p.id)).sort((a, b) => overall(b) - overall(a)).slice(0, 7);
  return { clubId: club.id, name: club.name, shortName: club.shortName, formation: club.manager.formation, tactics: club.manager.tactics, lineup, bench, chemistry: club.chemistry, manager: club.manager };
}
const clubs = Object.values(w.clubs);
const rng = new Rng(5);
const cnt: Record<string, number> = {};
const passKind: Record<string, [number, number]> = {};
let shotDist: number[] = []; let shotXg: number[] = []; let shotType: Record<string, number> = {}; let shotOutcome: Record<string, number> = {};
const N = 100;
for (let i = 0; i < N; i++) {
  const h = rng.pick(clubs); let a = rng.pick(clubs); while (a === h) a = rng.pick(clubs);
  const r = simulateMatch({ seed: rng.int(1, 1e9), home: side(h), away: side(a), recordAll: true });
  for (const e of r.events) {
    cnt[e.type] = (cnt[e.type] ?? 0) + 1;
    if ((e.type === 'pass' || e.type === 'through_ball') && e.d) { const k = e.d.kind ?? '?'; (passKind[k] ||= [0, 0])[e.d.success ? 0 : 1]++; }
    if (e.type === 'shot' && e.d) { shotDist.push(e.d.dist ?? 0); shotXg.push(e.d.xg ?? 0); shotType[e.d.shotType ?? '?'] = (shotType[e.d.shotType ?? '?'] ?? 0) + 1; shotOutcome[e.d.outcome ?? '?'] = (shotOutcome[e.d.outcome ?? '?'] ?? 0) + 1; }
  }
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('events per match by type:', Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / N).toFixed(1)}`).join(' '));
console.log('pass kinds [ok,fail] per match:', Object.entries(passKind).map(([k, v]) => `${k}: ${(v[0] / N).toFixed(0)}/${(v[1] / N).toFixed(0)} (${(v[0] / (v[0] + v[1]) * 100).toFixed(0)}%)`).join('  '));
console.log('shots', (shotDist.length / N).toFixed(1), 'avg dist', avg(shotDist).toFixed(1), 'avg xg', avg(shotXg).toFixed(3));
console.log('shot types', Object.entries(shotType).map(([k, v]) => `${k}:${(v / N).toFixed(1)}`).join(' '));
console.log('shot outcomes', Object.entries(shotOutcome).map(([k, v]) => `${k}:${(v / N).toFixed(1)}`).join(' '));
