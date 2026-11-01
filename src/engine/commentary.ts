/**
 * Live-text commentary and match reports, generated from the recorded events of a match. Nothing here changes a result:
 * wording is chosen by a generator seeded from the fixture id and the event index, so the same match always reads the same.
 */
import type { MatchEvent, MatchRecord } from './types';
import { Rng, seedFrom } from './rng';

export type CommentaryKind = 'goal' | 'chance' | 'save' | 'card' | 'sub' | 'injury' | 'info' | 'play';

export interface CommentaryLine {
  i: number;
  t: number;
  minute: string;
  text: string;
  kind: CommentaryKind;
  side: 0 | 1 | null;
  emphasis: boolean;
  score: [number, number];
}

export function minuteLabel(ev: Pick<MatchEvent, 'min' | 'add' | 'period'>): string {
  if (ev.period === 5) return 'Pens';
  return ev.add > 0 ? `${ev.min}+${ev.add}'` : `${ev.min}'`;
}

const KEY_TYPES = new Set([
  'kickoff', 'half_time', 'second_half', 'full_time', 'et_start', 'et_half', 'et_end', 'shootout_start', 'shootout_kick', 'shootout_end',
  'goal', 'own_goal', 'save', 'block', 'woodwork', 'big_chance', 'yellow', 'red', 'penalty_awarded', 'injury', 'substitution', 'tactic',
  'corner', 'offside', 'claim', 'counter',
]);
const FILLER_TYPES = new Set(['foul', 'tackle', 'interception', 'dribble', 'clearance', 'cross', 'turnover']);

const poss = (n: string) => (n.endsWith('s') ? `${n}'` : `${n}'s`);
const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng.next() * arr.length)];

function surname(full: string | undefined): string {
  if (!full) return 'a player';
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}

interface Ctx {
  rec: MatchRecord;
  name: (id?: string) => string;
  team: (side: 0 | 1) => string;
}

function ctxOf(rec: MatchRecord): Ctx {
  return {
    rec,
    name: (id) => (id ? surname(rec.playerNames[id]) : 'a player'),
    team: (side) => (side === 0 ? rec.homeName : rec.awayName),
  };
}

function shotWord(type: string | undefined, rng: Rng): string {
  switch (type) {
    case 'header': return pick(rng, ['rises and heads', 'meets it with a firm header', 'nods']);
    case 'long': return pick(rng, ['lets fly from distance', 'tries his luck from long range', 'hits it from outside the area']);
    case 'volley': return pick(rng, ['strikes it on the volley', 'catches it sweetly on the volley']);
    case 'oneOnOne': return pick(rng, ['is clean through and shoots', 'goes one on one']);
    case 'penalty': return 'steps up and takes the penalty';
    case 'freeKick': return pick(rng, ['curls the free kick', 'bends the set piece']);
    case 'tapIn': return pick(rng, ['is at the far post and sweeps it', 'gets there first and pokes it']);
    default: return pick(rng, ['takes aim', 'shoots first time', 'picks his spot', 'cuts inside and shoots']);
  }
}

/** The line for one event, or null when the event is not worth a line. */
export function describeEvent(c: Ctx, ev: MatchEvent, score: [number, number], rng: Rng): { text: string; kind: CommentaryKind; emphasis: boolean } | null {
  const me = c.name(ev.p);
  const other = c.name(ev.p2);
  const side = ev.side;
  const team = c.team(side);
  const opp = c.team((1 - side) as 0 | 1);
  const d = ev.d ?? {};
  switch (ev.type) {
    case 'kickoff': return { text: pick(rng, [`We are under way at ${c.rec.homeName}.`, `${team} get the game started.`, `The referee blows and ${c.rec.homeName} v ${c.rec.awayName} begins.`]), kind: 'info', emphasis: false };
    case 'half_time': return { text: `Half-time: ${c.rec.homeName} ${d.score?.[0] ?? score[0]}-${d.score?.[1] ?? score[1]} ${c.rec.awayName}.`, kind: 'info', emphasis: true };
    case 'second_half': return { text: 'The second half is under way.', kind: 'info', emphasis: false };
    case 'full_time': return { text: `Full-time: ${c.rec.homeName} ${d.score?.[0] ?? score[0]}-${d.score?.[1] ?? score[1]} ${c.rec.awayName}.`, kind: 'info', emphasis: true };
    case 'et_start': return { text: 'It stays level after 90 minutes, so extra time will be played.', kind: 'info', emphasis: true };
    case 'et_half': return { text: 'Half-time in extra time.', kind: 'info', emphasis: false };
    case 'et_end': return { text: 'Extra time is over.', kind: 'info', emphasis: true };
    case 'shootout_start': return { text: 'Penalties will decide it.', kind: 'info', emphasis: true };
    case 'shootout_kick': {
      const scored = d.outcome === 'goal';
      return { text: scored ? `${me} scores for ${team}.` : `${me} misses for ${team}! ${d.outcome === 'saved' ? `${other} makes the save.` : 'It does not go in.'}`, kind: scored ? 'goal' : 'save', emphasis: true };
    }
    case 'shootout_end': return { text: `${team} win the shoot-out ${d.pens?.[0] ?? 0}-${d.pens?.[1] ?? 0}.`, kind: 'info', emphasis: true };
    case 'goal': {
      const how = d.pen ? 'from the penalty spot' : d.shotType === 'header' ? 'with a header' : d.shotType === 'long' ? 'from distance' : d.shotType === 'freeKick' ? 'from a free kick' : d.shotType === 'volley' ? 'with a volley' : d.shotType === 'tapIn' ? 'from close range' : '';
      const a = ev.p2 ? ` ${pick(rng, ['Assisted by', 'Set up by', 'The ball came from'])} ${other}.` : '';
      const s = d.score ?? score;
      return { text: `GOAL! ${me} scores for ${team}${how ? ` ${how}` : ''}!${a} ${c.rec.homeName} ${s[0]}-${s[1]} ${c.rec.awayName}.`, kind: 'goal', emphasis: true };
    }
    case 'own_goal': return { text: `Own goal! ${me} turns it into his own net. ${c.rec.homeName} ${d.score?.[0] ?? score[0]}-${d.score?.[1] ?? score[1]} ${c.rec.awayName}.`, kind: 'goal', emphasis: true };
    case 'big_chance': return { text: pick(rng, [`Big chance for ${team}! ${me} has space in the box.`, `${me} is in a great position here for ${team}.`, `What an opening for ${me}!`]), kind: 'chance', emphasis: true };
    case 'shot': {
      if (d.outcome !== 'off') return null; // saved, blocked, post and goal are described by the event that follows
      return { text: pick(rng, [`${me} ${shotWord(d.shotType, rng)}, but it flies wide.`, `${me} shoots and drags it wide of the post.`, `${me} sends it over the bar.`, `${me} ${shotWord(d.shotType, rng)} and misses the target.`]), kind: 'chance', emphasis: false };
    }
    case 'save': return { text: pick(rng, [`${me} makes a good save to deny ${other}.`, `Saved! ${me} gets down well to stop ${poss(other)} effort.`, `${other} tests ${me}, who holds firm.`, `${me} tips ${poss(other)} shot away.`]), kind: 'save', emphasis: false };
    case 'block': return { text: pick(rng, [`${me} throws himself in the way and blocks ${poss(other)} shot.`, `Blocked! ${me} gets in front of ${poss(other)} effort.`]), kind: 'chance', emphasis: false };
    case 'woodwork': return { text: pick(rng, [`The post! ${me} hits the woodwork for ${team}.`, `${me} rattles the frame of the goal!`]), kind: 'chance', emphasis: true };
    case 'yellow': return { text: `${me} (${team}) is shown a ${d.secondYellow ? 'second yellow card' : 'yellow card'}.`, kind: 'card', emphasis: d.secondYellow === true };
    case 'red': return { text: `Red card! ${me} is sent off for ${team}${d.secondYellow ? ' after a second booking' : ''}.`, kind: 'card', emphasis: true };
    case 'penalty_awarded': return { text: `Penalty to ${team}! ${other} brings down ${me}.`, kind: 'chance', emphasis: true };
    case 'injury': return { text: `${me} (${team}) is down injured${d.injury ? ` with a ${d.injury.toLowerCase()}` : ''}.`, kind: 'injury', emphasis: false };
    case 'substitution': return { text: `Substitution for ${team}: ${me} replaces ${other}.`, kind: 'sub', emphasis: false };
    case 'tactic': return { text: `${team} change their approach and play ${d.style ? `a ${d.style} style` : 'differently'}.`, kind: 'info', emphasis: false };
    case 'corner': return { text: pick(rng, [`Corner to ${team}.`, `${team} win a corner.`]), kind: 'play', emphasis: false };
    case 'offside': return { text: `${me} is flagged offside.`, kind: 'play', emphasis: false };
    case 'claim': return { text: `${me} comes out and claims the cross.`, kind: 'play', emphasis: false };
    case 'counter': return { text: pick(rng, [`${team} break quickly through ${me}.`, `A counter-attack from ${team} with ${me} carrying it.`]), kind: 'play', emphasis: false };
    case 'foul': return { text: pick(rng, [`${me} fouls ${other}.`, `Free kick to ${opp} after a foul by ${me}.`]), kind: 'play', emphasis: false };
    case 'tackle': return d.success === false ? null : { text: pick(rng, [`${me} wins the ball cleanly from ${other}.`, `Good tackle by ${me}.`]), kind: 'play', emphasis: false };
    case 'interception': return { text: pick(rng, [`${me} reads it and intercepts.`, `${me} steps in to cut out the pass.`]), kind: 'play', emphasis: false };
    case 'dribble': return d.success === false ? null : { text: pick(rng, [`${me} skips past ${other}.`, `${me} beats his man and drives on.`]), kind: 'play', emphasis: false };
    case 'clearance': return { text: pick(rng, [`${me} clears the danger.`, `${me} heads it away for ${team}.`]), kind: 'play', emphasis: false };
    case 'cross': return d.success === false ? { text: `${poss(me)} cross is cleared.`, kind: 'play', emphasis: false } : { text: `${me} swings a cross into the box.`, kind: 'play', emphasis: false };
    case 'turnover': return { text: `${me} gives the ball away.`, kind: 'play', emphasis: false };
    default: return null;
  }
}

export type CommentaryLevel = 'key' | 'full';

/** All lines for a match. `key` shows the moments that matter; `full` adds a thinned layer of general play. */
export function commentaryFor(rec: MatchRecord, level: CommentaryLevel = 'full'): CommentaryLine[] {
  const c = ctxOf(rec);
  const out: CommentaryLine[] = [];
  const score: [number, number] = [0, 0];
  let lastFiller = -999;
  for (const ev of rec.result.events) {
    if (ev.type === 'goal') score[ev.side]++;
    else if (ev.type === 'own_goal') score[(1 - ev.side) as 0 | 1]++;
    const rng = new Rng(seedFrom(rec.fixtureId, ev.i));
    if (!KEY_TYPES.has(ev.type) && !(ev.type === 'shot') && !FILLER_TYPES.has(ev.type)) continue;
    if (FILLER_TYPES.has(ev.type)) {
      if (level === 'key') continue;
      // keep the text flowing without drowning the moments that matter
      if (ev.t - lastFiller < 75 || rng.next() > 0.55) continue;
      lastFiller = ev.t;
    }
    const line = describeEvent(c, ev, [score[0], score[1]], rng);
    if (!line) continue;
    out.push({ i: ev.i, t: ev.t, minute: minuteLabel(ev), text: line.text, kind: line.kind, side: ev.side, emphasis: line.emphasis, score: [score[0], score[1]] });
  }
  return out;
}

/* ------------------------------------------------------------------ match report */

export interface MatchReport {
  headline: string;
  paragraphs: string[];
  scorers: { minute: string; side: 0 | 1; text: string }[];
  keyStats: { label: string; home: string; away: string }[];
}

export function matchReport(rec: MatchRecord): MatchReport {
  const r = rec.result;
  const [hg, ag] = [r.hg, r.ag];
  const [hs, as] = r.team;
  const winner = r.winnerSide === 0 ? rec.homeName : r.winnerSide === 1 ? rec.awayName : null;
  const nm = (id?: string) => (id ? rec.playerNames[id] ?? 'a player' : 'a player');
  const scorers: MatchReport['scorers'] = [];
  for (const ev of r.events) {
    if (ev.type === 'goal') scorers.push({ minute: minuteLabel(ev), side: ev.side, text: `${nm(ev.p)}${ev.d?.pen ? ' (pen)' : ''}${ev.p2 ? `, assisted by ${nm(ev.p2)}` : ''}` });
    else if (ev.type === 'own_goal') scorers.push({ minute: minuteLabel(ev), side: (1 - ev.side) as 0 | 1, text: `${nm(ev.p)} (own goal)` });
  }
  const diff = Math.abs(hg - ag);
  let headline: string;
  if (winner) {
    const loser = winner === rec.homeName ? rec.awayName : rec.homeName;
    const score = `${Math.max(hg, ag)}-${Math.min(hg, ag)}`;
    headline = r.pens ? `${winner} win on penalties against ${loser}` : diff >= 4 ? `${winner} thrash ${loser} ${score}` : diff >= 2 ? `${winner} beat ${loser} ${score}` : `${winner} edge ${loser} ${score}${r.et ? ' after extra time' : ''}`;
  } else headline = hg === 0 ? `Goalless draw between ${rec.homeName} and ${rec.awayName}` : `${rec.homeName} and ${rec.awayName} share the points, ${hg}-${ag}`;
  const paragraphs: string[] = [];
  const xgDiff = hs.xg - as.xg;
  const control = hs.possession >= 56 ? rec.homeName : as.possession >= 56 ? rec.awayName : null;
  paragraphs.push(`${rec.homeName} ${hg}-${ag} ${rec.awayName} in the ${rec.compName}${rec.round ? ` (${rec.round})` : ''}. ${control ? `${control} had most of the ball (${Math.round(Math.max(hs.possession, as.possession))}% possession). ` : 'Possession was fairly even. '}${hs.shots + as.shots} shots were taken, ${hs.shotsOnTarget + as.shotsOnTarget} of them on target.`);
  if (Math.abs(xgDiff) >= 0.6 || (winner && ((r.winnerSide === 0 && xgDiff < -0.6) || (r.winnerSide === 1 && xgDiff > 0.6)))) {
    const better = xgDiff > 0 ? rec.homeName : rec.awayName;
    const result = winner && winner !== better ? `, but it was ${winner} who took the points` : '';
    paragraphs.push(`${better} created the better chances (expected goals ${hs.xg.toFixed(1)} to ${as.xg.toFixed(1)})${result}.`);
  }
  if (scorers.length) paragraphs.push(`Goals: ${scorers.map((s) => `${s.minute} ${s.text}`).join('; ')}.`);
  const reds = r.events.filter((e) => e.type === 'red');
  if (reds.length) paragraphs.push(`${reds.map((e) => `${nm(e.p)} (${e.side === 0 ? rec.homeName : rec.awayName}) was sent off in the ${minuteLabel(e)}`).join(' and ')}.`);
  if (r.pens) paragraphs.push(`The shoot-out finished ${r.pens[0]}-${r.pens[1]}.`);
  const bad = r.injuries.filter((i) => i.severity !== 'minor');
  if (bad.length) paragraphs.push(`Injury news: ${bad.map((i) => `${nm(i.playerId)} (${i.type.toLowerCase()}, about ${i.days} days)`).join(', ')}.`);
  if (r.motm) paragraphs.push(`Man of the match: ${nm(r.motm)}.`);
  if (rec.userSummary) {
    const u = rec.userSummary;
    if (u.selected === 'start' || u.selected === 'bench') {
      paragraphs.push(`Your match: ${u.selected === 'start' ? 'started' : 'came off the bench'}, ${u.minutes} minutes${u.rating !== null ? `, rating ${u.rating.toFixed(1)}` : ''}${u.goals ? `, ${u.goals} goal${u.goals === 1 ? '' : 's'}` : ''}${u.assists ? `, ${u.assists} assist${u.assists === 1 ? '' : 's'}` : ''}.`);
    }
    if (u.managerReaction) paragraphs.push(`The manager: ${u.managerReaction}`);
  }
  const keyStats: MatchReport['keyStats'] = [
    { label: 'Possession', home: `${Math.round(hs.possession)}%`, away: `${Math.round(as.possession)}%` },
    { label: 'Shots', home: String(hs.shots), away: String(as.shots) },
    { label: 'On target', home: String(hs.shotsOnTarget), away: String(as.shotsOnTarget) },
    { label: 'Expected goals', home: hs.xg.toFixed(2), away: as.xg.toFixed(2) },
    { label: 'Passes', home: `${hs.passesCompleted}/${hs.passes}`, away: `${as.passesCompleted}/${as.passes}` },
    { label: 'Corners', home: String(hs.corners), away: String(as.corners) },
    { label: 'Fouls', home: String(hs.fouls), away: String(as.fouls) },
    { label: 'Yellow cards', home: String(hs.yellow), away: String(as.yellow) },
    { label: 'Red cards', home: String(hs.red), away: String(as.red) },
    { label: 'Offsides', home: String(hs.offsides), away: String(as.offsides) },
  ];
  return { headline, paragraphs, scorers, keyStats };
}
