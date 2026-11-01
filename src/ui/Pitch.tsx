/**
 * 2D replay of a recorded match. Nothing here is simulated: the ball follows the recorded events, and each player sits at their
 * formation slot, drifting up with the team that has the ball and towards the ball itself. Substitutions and red cards are applied
 * from the recorded events so the right eleven are on the pitch at every moment.
 */
import { useMemo } from 'react';
import type { GameState, MatchEvent, MatchRecord } from '../engine/types';
import { FORMATIONS } from '../engine/formations';

const W = 105;
const H = 68;

interface Snapshot {
  ball: { x: number; y: number };
  holder: string | null;
  possession: 0 | 1;
  slots: [(string | null)[], (string | null)[]];
  sentOff: Set<string>;
}

interface Timeline { starters: [string[], string[]]; changes: MatchEvent[]; events: MatchEvent[] }

function buildTimeline(rec: MatchRecord): Timeline {
  const starters: [string[], string[]] = [[], []];
  for (const side of [0, 1] as const) starters[side] = rec.result.lineups[side].filter((l) => l.started).map((l) => l.playerId);
  const changes = rec.result.events.filter((e) => e.type === 'substitution' || e.type === 'red');
  return { starters, changes, events: rec.result.events };
}

function snapshotAt(tl: Timeline, t: number): Snapshot {
  const ev = tl.events;
  let lo = 0;
  let hi = ev.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ev[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const slots: Snapshot['slots'] = [[...tl.starters[0]], [...tl.starters[1]]];
  const sentOff = new Set<string>();
  for (const c of tl.changes) {
    if (c.t > t) break;
    const side = c.side;
    if (c.type === 'substitution' && c.d?.off && c.d?.on) {
      const i = slots[side].indexOf(c.d.off);
      if (i >= 0) slots[side][i] = c.d.on;
    } else if (c.type === 'red' && c.p) {
      const i = slots[side].indexOf(c.p);
      if (i >= 0) slots[side][i] = null;
      sentOff.add(c.p);
    }
  }
  let ball = { x: 0.5, y: 0.5 };
  let holder: string | null = null;
  let possession: 0 | 1 = 0;
  for (let i = idx; i >= 0; i--) {
    const e = ev[i];
    if (e.x === undefined) continue;
    ball = { x: e.x, y: e.y };
    possession = e.side;
    if (e.p && !['foul', 'yellow', 'red', 'injury', 'substitution', 'tactic', 'offside'].includes(e.type)) holder = e.p;
    if (holder || i < idx - 6) break;
  }
  return { ball, holder, possession, slots, sentOff };
}

function lum(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function Markings() {
  const line = 'rgba(255,255,255,0.28)';
  return (
    <g fill="none" stroke={line} strokeWidth="0.3">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} />
      <line x1={W / 2} y1="0.5" x2={W / 2} y2={H - 0.5} />
      <circle cx={W / 2} cy={H / 2} r="9.15" />
      <circle cx={W / 2} cy={H / 2} r="0.5" fill={line} />
      <rect x="0.5" y={H / 2 - 20.15} width="16.5" height="40.3" />
      <rect x="0.5" y={H / 2 - 9.15} width="5.5" height="18.3" />
      <rect x={W - 17} y={H / 2 - 20.15} width="16.5" height="40.3" />
      <rect x={W - 6} y={H / 2 - 9.15} width="5.5" height="18.3" />
      <path d={`M17 ${H / 2 - 7.3} A9.15 9.15 0 0 1 17 ${H / 2 + 7.3}`} />
      <path d={`M${W - 17} ${H / 2 - 7.3} A9.15 9.15 0 0 0 ${W - 17} ${H / 2 + 7.3}`} />
      <rect x="-1.2" y={H / 2 - 3.66} width="1.7" height="7.32" />
      <rect x={W - 0.5} y={H / 2 - 3.66} width="1.7" height="7.32" />
    </g>
  );
}

export function PitchView({ g, rec, t }: { g: GameState; rec: MatchRecord; t: number }) {
  const tl = useMemo(() => buildTimeline(rec), [rec]);
  const snap = useMemo(() => snapshotAt(tl, t), [tl, t]);
  const home = g.clubs[rec.homeId] ?? g.nations[rec.homeId];
  const away = g.clubs[rec.awayId] ?? g.nations[rec.awayId];
  const hc = home?.crest.primary ?? '#10b981';
  let ac = away?.crest.primary ?? '#60a5fa';
  if (Math.abs(lum(hc) - lum(ac)) < 0.18) ac = away?.crest.secondary ?? '#f5f5f5';
  const colours = [hc, ac];
  const forms = rec.result.formations;

  const dots: { id: string; side: 0 | 1; x: number; y: number; slotPos: string }[] = [];
  for (const side of [0, 1] as const) {
    const f = FORMATIONS[forms[side]];
    const has = snap.possession === side;
    const dir = side === 0 ? 1 : -1;
    snap.slots[side].forEach((id, i) => {
      if (!id) return;
      const s = f.slots[i];
      if (!s) return;
      let ax = side === 0 ? s.x : 1 - s.x;
      let ay = side === 0 ? s.y : 1 - s.y;
      const w = s.line === 'gk' ? 0.1 : s.line === 'def' ? 0.8 : s.line === 'mid' ? 1 : 1.1;
      const pull = s.line === 'gk' ? 0.03 : s.line === 'def' ? 0.12 : s.line === 'mid' ? 0.22 : 0.2;
      ax += (has ? 0.1 : -0.04) * dir * w;
      ax += (snap.ball.x - ax) * pull;
      ay += (snap.ball.y - ay) * pull * 0.8;
      if (id === snap.holder) { ax = snap.ball.x; ay = snap.ball.y; }
      dots.push({ id, side, x: clampN(ax, 0.02, 0.98) * W, y: clampN(ay, 0.04, 0.96) * H, slotPos: s.pos });
    });
  }
  return (
    <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} className="w-full rounded-lg" role="img" aria-label="2D replay of the match" style={{ background: 'linear-gradient(90deg,#14532d 0%,#166534 50%,#14532d 100%)' }}>
      {Array.from({ length: 10 }, (_, i) => <rect key={i} x={(W / 10) * i} y="0" width={W / 10} height={H} fill={i % 2 ? 'rgba(0,0,0,0.07)' : 'transparent'} />)}
      <Markings />
      {dots.map((d) => {
        const p = g.players[d.id];
        const mine = d.id === g.userId;
        const hold = d.id === snap.holder;
        return (
          <g key={`${d.side}-${d.id}`} className="pitch-dot" style={{ transform: `translate(${d.x}px, ${d.y}px)` }}>
            {mine && <circle r="3.4" fill="none" stroke="#f5c451" strokeWidth="0.5" />}
            {hold && !mine && <circle r="3" fill="none" stroke="#fff" strokeWidth="0.35" opacity="0.8" />}
            <circle r="2.2" fill={colours[d.side]} stroke="rgba(0,0,0,0.65)" strokeWidth="0.3" />
            <text y="0.75" textAnchor="middle" fontSize="2.1" fontWeight="700" fill={lum(colours[d.side]) > 0.6 ? '#111' : '#fff'} fontFamily="system-ui,sans-serif">{p?.shirt ?? ''}</text>
            {(mine || hold) && <text y="-4" textAnchor="middle" fontSize="2.4" fontWeight="600" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.35" paintOrder="stroke" fontFamily="system-ui,sans-serif">{rec.playerNames[d.id]?.split(' ').slice(-1)[0] ?? ''}</text>}
          </g>
        );
      })}
      <g className="pitch-dot" style={{ transform: `translate(${snap.ball.x * W}px, ${snap.ball.y * H}px)` }}>
        <circle r="1" fill="#fff" stroke="#111" strokeWidth="0.3" />
      </g>
    </svg>
  );
}
