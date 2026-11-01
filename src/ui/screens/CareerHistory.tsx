import { useState } from 'react';
import { useAct, useAsk, useDerived, useGame } from '../../store/hooks';
import { Card, Chip, Empty, PageHeader, Row, ScrollX, Stat, Tabs } from '../kit';
import { Spark } from '../parts';
import { clsx, formatDate, formatShort, money, seasonLabel, statAvg } from '../format';
import { ACHIEVEMENTS, describeAward } from '../../engine/awards';
import { ageAt, overall } from '../../engine/attributes';
import { SEVERITY_LABEL } from '../../engine/injuries';
import { financeSummary } from '../../engine/life';
import { EARLIEST_VOLUNTARY_RETIREMENT, canRetireNow, retireNow, retirementSummaryText } from '../../engine/retirement';
import { emptyStatLine, type StatLine } from '../../engine/types';

type Tab = 'summary' | 'seasons' | 'honours' | 'timeline' | 'moves' | 'legacy';

export function CareerHistory() {
  const g = useGame();
  const [tab, setTab] = useState<Tab>('summary');
  const user = g.players[g.userId];
  const age = ageAt(user.birthDay, g.day);
  return (
    <>
      <PageHeader
        title="Career history"
        subtitle={`${user.displayName} · age ${age} · ${g.career.retired ? 'retired' : `career started aged ${g.career.startAge}`}`}
        actions={g.career.retired ? <Chip tone="info">Retired</Chip> : undefined}
      />
      <Tabs<Tab> label="Career sections" value={tab} onChange={setTab} tabs={[
        { id: 'summary', label: 'Summary' }, { id: 'seasons', label: 'Seasons' }, { id: 'honours', label: 'Honours & achievements' },
        { id: 'timeline', label: 'Milestones' }, { id: 'moves', label: 'Clubs & injuries' }, { id: 'legacy', label: g.career.retired ? 'Legacy' : 'Retirement' },
      ]} />
      {tab === 'summary' && <Summary />}
      {tab === 'seasons' && <Seasons />}
      {tab === 'honours' && <Honours />}
      {tab === 'timeline' && <Timeline />}
      {tab === 'moves' && <Moves />}
      {tab === 'legacy' && <Legacy />}
    </>
  );
}

/* ----------------------------------------------------------------- summary */

function Summary() {
  const g = useGame();
  const user = g.players[g.userId];
  const a = g.career.appearances;
  const fin = useDerived((s) => financeSummary(s));
  const r = g.career.records;
  const ovr = Math.round(overall(user));
  const history = g.career.ovrHistory.map((h) => ({ x: h.day, y: h.ovr }));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Card title="Career totals (league and cup)">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat label="Appearances" value={a.apps} sub={`${a.starts} starts`} />
            <Stat label="Goals" value={a.goals} sub={a.apps ? `${(a.goals / a.apps).toFixed(2)} a game` : undefined} />
            <Stat label="Assists" value={a.assists} />
            <Stat label="Average rating" value={a.apps ? statAvg(a.ratingSum, a.apps) : '–'} />
            <Stat label="Man of the match" value={a.motm} />
            <Stat label="Hat-tricks" value={g.career.hatTricks} />
            <Stat label="Clean sheets" value={a.cleanSheets} />
            <Stat label="Cards" value={`${a.yellows} / ${a.reds}`} sub="yellow / red" />
          </div>
        </Card>
        <Card title="Development">
          <div className="mb-3 flex flex-wrap gap-6">
            <Stat label="Now" value={ovr} />
            <Stat label="Highest" value={Math.max(g.career.highestOverall, ovr)} />
            <Stat label="When you started" value={g.career.startOverall} />
            <Stat label="Growth" value={`${ovr - g.career.startOverall >= 0 ? '+' : ''}${ovr - g.career.startOverall}`} tone={ovr >= g.career.startOverall ? 'text-pitch-400' : 'text-bad-400'} />
          </div>
          <Spark points={history} label="Overall rating over time" height={110} />
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="International">
          <Row label="Senior caps">{g.international.caps}</Row>
          <Row label="International goals">{g.international.goals}</Row>
          <Row label="Youth caps">{g.international.youthCaps}</Row>
          <Row label="Nation">{g.nations[g.international.nation]?.name ?? g.international.nation}</Row>
        </Card>
        <Card title="Records">
          <Row label="Most goals in a season">{r.mostGoalsSeason ? `${r.mostGoalsSeason.value} (${seasonLabel(r.mostGoalsSeason.season)})` : '–'}</Row>
          <Row label="Most assists in a season">{r.mostAssistsSeason ? `${r.mostAssistsSeason.value} (${seasonLabel(r.mostAssistsSeason.season)})` : '–'}</Row>
          <Row label="Trophies">{g.career.trophies.length}</Row>
          <Row label="Seasons played">{g.career.seasons.length || (a.apps ? 1 : 0)}</Row>
        </Card>
        <Card title="Money">
          <Row label="Career earnings">{money(fin.careerEarnings)}</Row>
          <Row label="Net worth">{money(fin.netWorth)}</Row>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- seasons */

const sumLine = (...ls: StatLine[]) => ls.reduce((s, l) => ({ ...s, apps: s.apps + l.apps, goals: s.goals + l.goals, assists: s.assists + l.assists, ratingSum: s.ratingSum + l.ratingSum }), { apps: 0, goals: 0, assists: 0, ratingSum: 0 });

function Seasons() {
  const g = useGame();
  const user = g.players[g.userId];
  const cur = sumLine(user.stats.league ?? emptyStatLine(), user.stats.cup ?? emptyStatLine());
  const rows = g.career.seasons;
  if (rows.length === 0 && cur.apps === 0) return <Empty title="No seasons recorded yet" body="Each season is written here when it ends or when you change club." />;
  return (
    <Card pad={false}>
      <ScrollX>
        <table className="tbl">
          <thead><tr><th>Season</th><th>Club</th><th>League</th><th className="num">Apps</th><th className="num">Goals</th><th className="num">Assists</th><th className="num">Avg</th><th className="num">OVR</th><th>Honours</th></tr></thead>
          <tbody>
            {rows.map((s, i) => {
              const t = sumLine(s.league, s.cup, s.dev);
              return (
                <tr key={i}>
                  <td className="whitespace-nowrap text-ink-300">{seasonLabel(s.season)}</td>
                  <td>{s.clubName}</td>
                  <td className="text-ink-300">{s.leagueName}{s.leaguePos ? ` · ${s.leaguePos}${s.leaguePos === 1 ? 'st' : s.leaguePos === 2 ? 'nd' : s.leaguePos === 3 ? 'rd' : 'th'}` : ''}</td>
                  <td className="num">{t.apps}</td><td className="num">{t.goals}</td><td className="num">{t.assists}</td>
                  <td className="num">{t.apps ? statAvg(t.ratingSum, t.apps) : '–'}</td>
                  <td className="num font-semibold">{s.endOverall}</td>
                  <td className="text-xs text-ink-200">{[...s.trophies, ...s.awards].join(', ') || '–'}</td>
                </tr>
              );
            })}
            {!g.career.retired && (
              <tr className="me">
                <td className="whitespace-nowrap">{seasonLabel(g.season)}</td>
                <td>{user.clubId ? g.clubs[user.clubId]?.name : 'No club'}</td>
                <td className="text-ink-300">In progress</td>
                <td className="num">{cur.apps}</td><td className="num">{cur.goals}</td><td className="num">{cur.assists}</td>
                <td className="num">{cur.apps ? statAvg(cur.ratingSum, cur.apps) : '–'}</td>
                <td className="num font-semibold">{Math.round(overall(user))}</td>
                <td className="text-xs text-ink-400">–</td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollX>
    </Card>
  );
}

/* ----------------------------------------------------------------- honours */

function Honours() {
  const g = useGame();
  const mine = g.awards.filter((a) => a.playerId === g.userId);
  const unlocked = ACHIEVEMENTS.filter((a) => g.career.achievements[a.id] !== undefined);
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-4">
        <Card title="Trophies">
          {g.career.trophies.length === 0 ? <Empty title="No trophies yet" /> : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...g.career.trophies].reverse().map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3"><span className="font-medium text-ink-50">{t.name}</span><span className="text-xs text-ink-300">{seasonLabel(t.season)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Individual awards">
          {mine.length === 0 ? <Empty title="No awards yet" body="Awards are decided when each season ends." /> : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...mine].reverse().map((a, i) => <li key={i}><span className="mr-2 text-xs text-ink-400">{seasonLabel(a.season)}</span>{describeAward(g, a)}</li>)}
            </ul>
          )}
        </Card>
      </div>
      <Card title={`Achievements · ${unlocked.length} of ${ACHIEVEMENTS.length}`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ACHIEVEMENTS.map((a) => {
            const day = g.career.achievements[a.id];
            const got = day !== undefined;
            return (
              <li key={a.id} className={clsx('rounded-md border px-3 py-2', got ? 'border-pitch-600/50 bg-pitch-900/20' : 'border-ink-700 border-dashed opacity-80')}>
                <p className="flex items-center justify-between gap-2 text-sm font-medium text-ink-50">{a.title}{got && <span className="text-[11px] font-normal text-ink-300">{formatShort(day)}</span>}</p>
                <p className="text-xs text-ink-300">{a.detail}</p>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- timeline */

function Timeline() {
  const g = useGame();
  const list = [...g.career.milestones].sort((a, b) => b.day - a.day);
  if (list.length === 0) return <Empty title="No milestones yet" body="Debuts, first goals, trophies and big moments are collected here." />;
  return (
    <Card pad={false}>
      <ol className="divide-y divide-ink-800">
        {list.map((m) => (
          <li key={m.id} className="flex gap-3 px-4 py-2.5">
            <span className="w-24 shrink-0 text-xs text-ink-400">{formatDate(m.day)}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink-50">{m.title}</span><span className="block text-xs text-ink-300">{m.detail}</span></span>
            <Chip>{m.kind}</Chip>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------------- moves */

function Moves() {
  const g = useGame();
  const name = (id: string | null, fallback?: string) => (id === null ? fallback ?? 'Free agent' : id === 'abroad' ? 'Overseas' : g.clubs[id]?.name ?? id);
  const KIND: Record<string, string> = { academy: 'Academy', permanent: 'Transfer', loan: 'Loan', free: 'Free', loan_return: 'Loan return', release: 'Released' };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Clubs" pad={false}>
        {g.career.transfers.length === 0 ? <div className="p-4"><Empty title="No moves yet" /></div> : (
          <ul className="divide-y divide-ink-800">
            {[...g.career.transfers].reverse().map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0"><span className="mr-2 text-xs text-ink-400">{formatShort(t.day)} {seasonLabel(t.season)}</span>{name(t.fromClubId, 'Youth')} → {name(t.toClubId, t.toName)}</span>
                <span className="shrink-0 text-xs text-ink-300">{KIND[t.kind]}{t.kind === 'permanent' && t.fee ? ` · ${money(t.fee)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Contracts" pad={false}>
        {g.career.contracts.length === 0 ? <div className="p-4"><Empty title="No contracts yet" /></div> : (
          <ul className="divide-y divide-ink-800">
            {[...g.career.contracts].reverse().map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span><span className="mr-2 text-xs text-ink-400">{formatShort(c.day)}</span>{name(c.clubId)} · {c.years} year{c.years === 1 ? '' : 's'} · {c.role}</span>
                <span className="shrink-0 text-xs text-ink-300">{money(c.wage)}/wk</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Injury record" className="lg:col-span-2" pad={false}>
        {g.career.injuries.length === 0 ? <div className="p-4"><Empty title="No injuries so far" /></div> : (
          <ScrollX>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Injury</th><th>Severity</th><th className="num">Days out</th><th>Cause</th></tr></thead>
              <tbody>
                {[...g.career.injuries].reverse().map((j, i) => (
                  <tr key={i}><td className="text-ink-300">{formatDate(j.day)}</td><td>{j.type}</td><td>{SEVERITY_LABEL[j.severity]}</td><td className="num">{j.days}</td><td className="text-ink-300">{j.source === 'match' ? 'In a match' : 'In training'}</td></tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ legacy */

function Legacy() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const legacy = g.career.legacy;
  const can = canRetireNow(g);
  if (!g.career.retired || !legacy) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Retire from football">
          <p className="text-sm text-ink-200">You can choose to hang up your boots from age {EARLIEST_VOLUNTARY_RETIREMENT}. Your career is then closed and judged as a whole. Players are forced to retire at 41, and a poor run of form or injuries in later years may bring the decision to you sooner.</p>
          <p className="mt-2 text-xs text-ink-400">Retirement cannot be undone, but the save remains so you can read your legacy any time.</p>
          <div className="mt-4">
            <button
              className="btn btn-danger"
              disabled={!can.ok}
              title={can.reason}
              onClick={() => ask({ title: 'Retire from football?', body: 'Your playing career will end now. This cannot be undone.', confirmLabel: 'Retire', danger: true, onConfirm: () => act((gg) => retireNow(gg)) })}
            >Retire now</button>
            {!can.ok && <p className="mt-2 text-xs text-ink-400">{can.reason}</p>}
          </div>
        </Card>
        <Card title="Your legacy so far">
          <p className="text-sm text-ink-200">A legacy summary is written when you retire: appearances, goals, trophies, awards, earnings, your best season and best spell, and a verdict on the career.</p>
        </Card>
      </div>
    );
  }
  const lines = retirementSummaryText(legacy);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-xl font-semibold text-ink-50">{legacy.verdict}</p>
          <p className="mt-1 text-sm text-ink-200">{legacy.verdictDetail}</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-200">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Card>
        {legacy.bestSeason && <Card title="Best season"><p className="text-sm text-ink-100">{seasonLabel(legacy.bestSeason.season)} at {legacy.bestSeason.clubName}</p><p className="text-xs text-ink-300">{legacy.bestSeason.line}</p></Card>}
        <Card title="Club career" pad={false}>
          <table className="tbl">
            <thead><tr><th>Club</th><th>Years</th><th className="num">Apps</th><th className="num">Goals</th><th className="num">Assists</th><th className="num">Trophies</th></tr></thead>
            <tbody>{legacy.clubs.map((c, i) => <tr key={i}><td>{c.clubName}</td><td className="text-ink-300">{seasonLabel(c.firstSeason)}{c.lastSeason !== c.firstSeason ? `–${seasonLabel(c.lastSeason).slice(-2)}` : ''}</td><td className="num">{c.apps}</td><td className="num">{c.goals}</td><td className="num">{c.assists}</td><td className="num">{c.trophies}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Final numbers">
          <Row label="Appearances">{legacy.apps}</Row><Row label="Goals">{legacy.goals}</Row><Row label="Assists">{legacy.assists}</Row>
          <Row label="Average rating">{legacy.avgRating.toFixed(2)}</Row><Row label="International caps">{legacy.caps}</Row>
          <Row label="Highest rating">{legacy.highestOverall}</Row><Row label="Career earnings">{money(legacy.careerEarnings)}</Row><Row label="Net worth">{money(legacy.netWorth)}</Row>
        </Card>
        <Card title="Honours">
          <p className="mb-1 text-xs font-semibold text-ink-300">Trophies ({legacy.trophies.length})</p>
          <ul className="mb-3 flex flex-col gap-1 text-sm">{legacy.trophies.length ? legacy.trophies.map((t, i) => <li key={i}>{seasonLabel(t.season)} {t.name} <span className="text-xs text-ink-400">{t.clubName}</span></li>) : <li className="text-ink-400">None</li>}</ul>
          <p className="mb-1 text-xs font-semibold text-ink-300">Awards ({legacy.awards.length})</p>
          <ul className="flex flex-col gap-1 text-sm">{legacy.awards.length ? legacy.awards.map((a, i) => <li key={i}>{seasonLabel(a.season)} {a.award}</li>) : <li className="text-ink-400">None</li>}</ul>
        </Card>
      </div>
    </div>
  );
}
