/** Small building blocks shared by several screens. */
import type { Club, Fixture, GameState, NewsItem, Player, TableRow } from '../engine/types';
import { Crest } from './art';
import { Bar, Chip } from './kit';
import { badBar, clsx, formatShort, goodBar, matchRatingClass, moodWord } from './format';
import { formValue } from '../engine/condition';
import { leagueTable } from '../engine/competitions';
import { nationName } from '../engine/names';

export function ClubTag({ club, size = 18, bold, className }: { club: Club | undefined; size?: number; bold?: boolean; className?: string }) {
  if (!club) return <span className="text-ink-400">–</span>;
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Crest crest={club.crest} size={size} title={club.name} />
      <span className={clsx('truncate', bold && 'font-semibold text-ink-50')}>{club.name}</span>
    </span>
  );
}

export function NationTag({ code }: { code: string }) {
  return <span title={nationName(code)} className="rounded bg-ink-700 px-1 py-0.5 font-mono text-[10px] font-semibold text-ink-200">{code}</span>;
}

export function FormPips({ form }: { form: ('W' | 'D' | 'L')[] }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`Form ${form.slice(-5).join(' ')}`}>
      {form.slice(-5).map((r, i) => (
        <span key={i} className={clsx('flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold', r === 'W' ? 'bg-pitch-600 text-white' : r === 'D' ? 'bg-ink-500 text-ink-50' : 'bg-bad-500 text-ink-950')}>{r}</span>
      ))}
    </span>
  );
}

/** The six condition measures the player cares about. */
export function ConditionMeters({ p, compact }: { p: Player; compact?: boolean }) {
  const form = Math.round(formValue(p));
  const rows: { label: string; value: number; color: string; text?: string }[] = [
    { label: 'Fatigue', value: p.cond.fatigue, color: badBar(p.cond.fatigue), text: `${Math.round(p.cond.fatigue)}` },
    { label: 'Match fitness', value: p.cond.matchFitness, color: goodBar(p.cond.matchFitness) },
    { label: 'Sharpness', value: p.cond.sharpness, color: goodBar(p.cond.sharpness) },
    { label: 'Morale', value: p.cond.morale, color: goodBar(p.cond.morale), text: `${Math.round(p.cond.morale)} · ${moodWord(p.cond.morale)}` },
    { label: 'Confidence', value: p.cond.confidence, color: goodBar(p.cond.confidence) },
    { label: 'Form', value: form, color: goodBar(form), text: p.recentRatings.length ? `${form} · last ${p.recentRatings.slice(-1)[0].toFixed(1)}` : 'No games yet' },
  ];
  return (
    <div className={clsx('grid gap-x-6 gap-y-2.5', compact ? 'grid-cols-2' : 'sm:grid-cols-2')}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-300">{r.label}</span>
            <span className="font-medium text-ink-100">{r.text ?? Math.round(r.value)}</span>
          </div>
          <Bar value={r.value} color={r.color} label={r.label} />
        </div>
      ))}
    </div>
  );
}

export function MiniTable({ g, compId, clubId, span = 2, full }: { g: GameState; compId: string; clubId: string; span?: number; full?: boolean }) {
  const table = leagueTable(g, compId);
  const idx = table.findIndex((r) => r.clubId === clubId);
  const rows: { r: TableRow; pos: number }[] = table.map((r, i) => ({ r, pos: i + 1 }));
  const shown = full || idx < 0 ? rows : rows.slice(Math.max(0, Math.min(idx - span, rows.length - (span * 2 + 1))), Math.max(0, Math.min(idx - span, rows.length - (span * 2 + 1))) + span * 2 + 1);
  return (
    <table className="tbl">
      <thead><tr><th className="w-6">#</th><th>Club</th><th className="num">P</th><th className="num">GD</th><th className="num">Pts</th></tr></thead>
      <tbody>
        {shown.map(({ r, pos }) => (
          <tr key={r.clubId} className={r.clubId === clubId ? 'me' : ''}>
            <td className="text-ink-300">{pos}</td>
            <td><ClubTag club={g.clubs[r.clubId]} size={16} bold={r.clubId === clubId} /></td>
            <td className="num">{r.p}</td>
            <td className="num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
            <td className="num font-semibold">{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function resultFor(fx: Fixture, clubId: string): 'W' | 'D' | 'L' | null {
  const r = fx.result;
  if (!r) return null;
  const home = fx.homeId === clubId;
  let mine = home ? r.hg : r.ag;
  let theirs = home ? r.ag : r.hg;
  if (r.pens) { mine += home ? r.pens[0] / 100 : r.pens[1] / 100; theirs += home ? r.pens[1] / 100 : r.pens[0] / 100; }
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

export function scoreText(fx: Fixture): string {
  const r = fx.result;
  if (!r) return 'v';
  return `${r.hg}–${r.ag}${r.pens ? ` (${r.pens[0]}–${r.pens[1]} pens)` : r.et ? ' aet' : ''}`;
}

/** Every fixture a club has played or will play, across all seasons still held in the save. */
export function clubFixtures(g: GameState, clubId: string): Fixture[] {
  const out: Fixture[] = [];
  for (const f of Object.values(g.fixtures)) if (f.homeId === clubId || f.awayId === clubId) out.push(f);
  return out.sort((a, b) => a.day - b.day);
}

export function FixtureRow({ g, fx, clubId, onClick }: { g: GameState; fx: Fixture; clubId: string; onClick?: () => void }) {
  const home = fx.homeId === clubId;
  const opp = g.clubs[home ? fx.awayId : fx.homeId];
  const res = resultFor(fx, clubId);
  const comp = g.competitions[fx.compId];
  const rec = g.matchRecords[fx.id];
  const rating = rec?.userSummary?.rating ?? null;
  return (
    <tr className={onClick ? 'cursor-pointer' : ''} onClick={onClick}>
      <td className="whitespace-nowrap text-ink-300">{formatShort(fx.day)}</td>
      <td className="text-ink-300">{comp?.short}{fx.round && fx.compId.startsWith('CUP') ? ` · ${fx.round}` : ''}</td>
      <td><span className="mr-1 text-[10px] text-ink-400">{home ? 'H' : 'A'}</span><ClubTag club={opp} size={16} /></td>
      <td className="whitespace-nowrap">
        {res ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={clsx('flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold', res === 'W' ? 'bg-pitch-600 text-white' : res === 'D' ? 'bg-ink-500 text-ink-50' : 'bg-bad-500 text-ink-950')}>{res}</span>
            <span className="font-medium text-ink-50">{scoreText(fx)}</span>
          </span>
        ) : <span className="text-ink-400">–</span>}
      </td>
      <td className={clsx('num', matchRatingClass(rating))}>{rating !== null ? rating.toFixed(1) : ''}</td>
    </tr>
  );
}

export function NewsRow({ n, club }: { n: NewsItem; club?: Club }) {
  return (
    <li className="flex gap-3 border-b border-ink-800 py-2 last:border-b-0">
      <span className="w-14 shrink-0 text-xs text-ink-400">{formatShort(n.day)}</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink-50">{n.headline}{n.important && <Chip tone="good">Important</Chip>}</span>
        {n.body && <span className="block text-xs text-ink-300">{n.body}</span>}
        {club && <span className="mt-0.5 block text-[11px] text-ink-400">{club.name}</span>}
      </span>
    </li>
  );
}

/** A small line chart for a series of numbers (the x positions are given so uneven dates stay honest). */
export function Spark({ points, height = 90, min, max, label, color = '#34d399' }: { points: { x: number; y: number }[]; height?: number; min?: number; max?: number; label: string; color?: string }) {
  if (points.length < 2) return <p className="text-xs text-ink-400">Not enough history yet.</p>;
  const W = 400;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = min ?? Math.min(...ys) - 1;
  const y1 = max ?? Math.max(...ys) + 1;
  const px = (x: number) => 4 + ((x - x0) / Math.max(1, x1 - x0)) * (W - 8);
  const py = (y: number) => height - 6 - ((y - y0) / Math.max(1, y1 - y0)) * (height - 12);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <path d={`${d} L${px(x1)} ${height} L${px(x0)} ${height} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={px(points[points.length - 1].x)} cy={py(points[points.length - 1].y)} r="3" fill={color} />
    </svg>
  );
}
