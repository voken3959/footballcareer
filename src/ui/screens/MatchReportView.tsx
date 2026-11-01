import { useMemo, useState } from 'react';
import type { GameState, MatchRecord, PlayerMatchStats } from '../../engine/types';
import { commentaryFor, matchReport } from '../../engine/commentary';
import { Card, Chip, Empty, ScrollX, Tabs } from '../kit';
import { ClubTag } from '../parts';
import { clsx, formatDate, matchRatingClass } from '../format';

type Tab = 'summary' | 'stats' | 'players' | 'events';

function StatBar({ label, home, away, homeText, awayText }: { label: string; home: number; away: number; homeText: string; awayText: string }) {
  const total = home + away || 1;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="w-16 font-semibold text-ink-50">{homeText}</span>
        <span className="text-xs text-ink-300">{label}</span>
        <span className="w-16 text-right font-semibold text-ink-50">{awayText}</span>
      </div>
      <div className="flex h-1.5 gap-0.5">
        <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-ink-700"><div className="h-full bg-pitch-500" style={{ width: `${(home / total) * 100}%` }} /></div>
        <div className="flex-1 overflow-hidden rounded-r-full bg-ink-700"><div className="h-full bg-info-400" style={{ width: `${(away / total) * 100}%` }} /></div>
      </div>
    </div>
  );
}

function PlayersTable({ rec, side, userId }: { rec: MatchRecord; side: 0 | 1; userId: string }) {
  const rows = Object.values(rec.result.players).filter((p) => p.side === side && (p.started || p.minutes > 0)).sort((a, b) => Number(b.started) - Number(a.started) || b.rating - a.rating);
  return (
    <ScrollX>
      <table className="tbl">
        <thead><tr><th>Player</th><th>Pos</th><th className="num">Min</th><th className="num">G</th><th className="num">A</th><th className="num">Shots</th><th className="num">Pass</th><th className="num">Tkl</th><th className="num">Rating</th></tr></thead>
        <tbody>
          {rows.map((p: PlayerMatchStats) => (
            <tr key={p.id} className={p.id === userId ? 'me' : ''}>
              <td className="whitespace-nowrap">
                {rec.playerNames[p.id] ?? '?'}
                {rec.result.motm === p.id && <span className="ml-1.5 text-gold-400" title="Man of the match">★</span>}
                {p.yellow > 0 && <span className="ml-1 inline-block h-3 w-2 rounded-[1px] bg-warn-400 align-middle" title="Yellow card" />}
                {p.red > 0 && <span className="ml-1 inline-block h-3 w-2 rounded-[1px] bg-bad-500 align-middle" title="Red card" />}
                {p.injured && <span className="ml-1 text-bad-400" title="Injured">✚</span>}
              </td>
              <td className="text-ink-300">{p.slot}</td>
              <td className="num">{p.minutes}</td>
              <td className="num">{p.goals || ''}</td>
              <td className="num">{p.assists || ''}</td>
              <td className="num">{p.shots ? `${p.shotsOnTarget}/${p.shots}` : ''}</td>
              <td className="num">{p.passes ? `${p.passesCompleted}/${p.passes}` : ''}</td>
              <td className="num">{p.tackles ? `${p.tacklesWon}/${p.tackles}` : ''}</td>
              <td className={clsx('num font-semibold', matchRatingClass(p.rating))}>{p.rating.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

export function MatchReportView({ g, rec, hideScore }: { g: GameState; rec: MatchRecord; hideScore?: boolean }) {
  const [tab, setTab] = useState<Tab>('summary');
  const report = useMemo(() => matchReport(rec), [rec]);
  const lines = useMemo(() => commentaryFor(rec, 'key'), [rec]);
  const r = rec.result;
  const u = rec.userSummary;
  const home = g.clubs[rec.homeId];
  const away = g.clubs[rec.awayId];
  const [hs, as] = r.team;
  const detailed = r.events.length > 0;
  const key = lines.filter((l) => ['goal', 'card', 'sub', 'injury'].includes(l.kind) || l.emphasis);
  const statRows: { label: string; h: number; a: number; fmt?: (v: number) => string }[] = [
    { label: 'Possession', h: hs.possession, a: as.possession, fmt: (v) => `${Math.round(v)}%` },
    { label: 'Shots', h: hs.shots, a: as.shots },
    { label: 'Shots on target', h: hs.shotsOnTarget, a: as.shotsOnTarget },
    { label: 'Expected goals', h: hs.xg, a: as.xg, fmt: (v) => v.toFixed(2) },
    { label: 'Big chances', h: hs.bigChances, a: as.bigChances },
    { label: 'Passes completed', h: hs.passesCompleted, a: as.passesCompleted },
    { label: 'Corners', h: hs.corners, a: as.corners },
    { label: 'Fouls', h: hs.fouls, a: as.fouls },
    { label: 'Tackles', h: hs.tackles, a: as.tackles },
    { label: 'Interceptions', h: hs.interceptions, a: as.interceptions },
    { label: 'Saves', h: hs.saves, a: as.saves },
    { label: 'Yellow cards', h: hs.yellow, a: as.yellow },
    { label: 'Red cards', h: hs.red, a: as.red },
    { label: 'Offsides', h: hs.offsides, a: as.offsides },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
          <div className="flex flex-col items-center gap-1"><ClubTag club={home} size={36} className="flex-col" bold /></div>
          <div>
            <div className="text-3xl font-bold tabular-nums text-ink-50">{hideScore ? '? – ?' : `${r.hg} – ${r.ag}`}</div>
            {!hideScore && (r.pens ? <div className="text-xs text-ink-300">Penalties {r.pens[0]}–{r.pens[1]}</div> : r.et ? <div className="text-xs text-ink-300">After extra time</div> : null)}
          </div>
          <div className="flex flex-col items-center gap-1"><ClubTag club={away} size={36} className="flex-col" bold /></div>
        </div>
        <div className="mt-2 text-center text-xs text-ink-300">{rec.compName}{rec.round ? ` · ${rec.round}` : ''} · {formatDate(rec.day)}</div>
      </Card>

      {u && (
        <Card title="Your game">
          {u.selected === 'start' || u.selected === 'bench' ? (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div><div className="stat-label">Role</div><div className="text-sm font-medium text-ink-50">{u.selected === 'start' ? 'Started' : 'Used from the bench'}{u.subbedOff ? ' · substituted' : ''}</div></div>
              <div><div className="stat-label">Minutes</div><div className="text-sm font-medium text-ink-50">{u.minutes}</div></div>
              <div><div className="stat-label">Rating</div><div className={clsx('text-xl font-bold', matchRatingClass(u.rating))}>{u.rating !== null ? u.rating.toFixed(1) : '–'}</div></div>
              <div><div className="stat-label">Goals / assists</div><div className="text-sm font-medium text-ink-50">{u.goals} / {u.assists}</div></div>
            </div>
          ) : (
            <p className="text-sm text-ink-200">
              {u.selected === 'unused' ? 'You were an unused substitute.' : u.selected === 'injured' ? 'You were injured and did not play.' : u.selected === 'suspended' ? 'You were suspended.' : 'You were not in the matchday squad.'}
            </p>
          )}
          {u.managerReaction && <p className="mt-3 text-sm text-ink-200"><span className="text-ink-400">Manager: </span>{u.managerReaction}</p>}
          {u.analysis.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-200">{u.analysis.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </Card>
      )}

      <Tabs<Tab> label="Match report" value={tab} onChange={setTab} tabs={[{ id: 'summary', label: 'Report' }, { id: 'stats', label: 'Team stats' }, { id: 'players', label: 'Players' }, { id: 'events', label: 'Key moments' }]} />

      {tab === 'summary' && (
        <Card title={report.headline}>
          <div className="space-y-2 text-sm text-ink-200">{report.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
          {report.scorers.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              {report.scorers.map((s, i) => <li key={i} className={clsx('flex gap-2', s.side === 1 && 'sm:col-start-2')}><span className="w-12 text-ink-400">{s.minute}</span><span className="text-ink-50">{s.text}</span></li>)}
            </ul>
          )}
        </Card>
      )}

      {tab === 'stats' && (
        <Card>
          {statRows.map((s) => <StatBar key={s.label} label={s.label} home={s.h} away={s.a} homeText={s.fmt ? s.fmt(s.h) : String(s.h)} awayText={s.fmt ? s.fmt(s.a) : String(s.a)} />)}
        </Card>
      )}

      {tab === 'players' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={rec.homeName} pad={false}><PlayersTable rec={rec} side={0} userId={g.userId} /></Card>
          <Card title={rec.awayName} pad={false}><PlayersTable rec={rec} side={1} userId={g.userId} /></Card>
        </div>
      )}

      {tab === 'events' && (
        <Card>
          {!detailed ? (
            <Empty title="Details are no longer stored" body="To keep a long career's save small, only the key moments are kept for older matches, and only goals, cards and substitutions for the oldest." />
          ) : key.length === 0 ? <p className="text-sm text-ink-300">A quiet game with nothing major to report.</p> : (
            <ul className="divide-y divide-ink-800">
              {key.map((l) => (
                <li key={l.i} className="flex items-start gap-3 py-1.5 text-sm">
                  <span className="w-12 shrink-0 text-xs text-ink-400">{l.minute}</span>
                  <span className={clsx(l.kind === 'goal' ? 'font-semibold text-ink-50' : 'text-ink-200')}>{l.text}</span>
                  {l.kind === 'goal' && <Chip tone="good">{l.score[0]}–{l.score[1]}</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
