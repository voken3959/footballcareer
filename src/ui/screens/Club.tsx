import { useMemo, useState } from 'react';
import { useDerived, useGame } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Bar, Card, Chip, Empty, Help, PageHeader, Row, ScrollX, Stat, Tabs } from '../kit';
import { ClubTag, MiniTable, NationTag } from '../parts';
import { clsx, formatDate, money, plural, ratingClass, statAvg, POSITION_ORDER } from '../format';
import { ageAt, overall, POSITION_LABEL } from '../../engine/attributes';
import { marketValue, yearsLeft } from '../../engine/economy';
import { availability, pickMatchSquad, squadOf } from '../../engine/selection';
import { FORMATIONS, STYLES, LINE_PARAMS } from '../../engine/formations';
import { clubLeague } from '../../engine/season';
import { leagueTable, positionIn } from '../../engine/competitions';
import { wageBill } from '../../engine/transfers';
import { userClub } from '../../engine/util';
import { nationName } from '../../engine/names';
import type { Club as ClubT, Player } from '../../engine/types';

type Tab = 'squad' | 'tactics' | 'club';
type SortKey = 'pos' | 'ovr' | 'age' | 'value' | 'wage' | 'goals' | 'apps';

const LINE_LABEL = { high: 'High line', normal: 'Standard line', deep: 'Deep line' } as const;

/** A 0..1 trait described in a few plain words. */
function trait(v: number, low: string, mid: string, high: string): string {
  return v < 0.38 ? low : v > 0.62 ? high : mid;
}

export function Club() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const club = userClub(g);
  const [tab, setTab] = useState<Tab>('squad');
  if (!club) {
    return (
      <>
        <PageHeader title="Club" />
        <Empty title="You are not attached to a club" body="Once you sign for a club, its squad, manager and finances appear here." action={<button className="btn btn-primary" onClick={() => go('transfers')}>Open Transfers</button>} />
      </>
    );
  }
  const league = clubLeague(g, club.id);
  const tbl = league ? leagueTable(g, league.id) : [];
  const pos = tbl.some((r) => r.clubId === club.id && r.p > 0) ? positionIn(tbl, club.id) : 0;
  return (
    <>
      <PageHeader
        title={club.name}
        subtitle={<>{club.stadium} · {league?.name ?? 'No league'}{pos ? ` · ${pos}${pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th'}` : ''}</>}
        actions={<ClubTag club={club} size={28} />}
      />
      <Tabs<Tab> label="Club sections" value={tab} onChange={setTab} tabs={[{ id: 'squad', label: 'Squad' }, { id: 'tactics', label: 'Manager & tactics' }, { id: 'club', label: 'Club & finances' }]} />
      {tab === 'squad' && <Squad club={club} />}
      {tab === 'tactics' && <Tactics club={club} />}
      {tab === 'club' && <ClubInfo club={club} />}
    </>
  );
}

function Squad({ club }: { club: ClubT }) {
  const g = useGame();
  const [sort, setSort] = useState<SortKey>('pos');
  const [dir, setDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState<'all' | 'GK' | 'DEF' | 'MID' | 'ATT'>('all');
  const squad = useDerived((s) => squadOf(s, club.id), [club.id]);
  const rows = useMemo(() => {
    const group = (p: Player) => (p.position === 'GK' ? 'GK' : ['CB', 'RB', 'LB'].includes(p.position) ? 'DEF' : ['DM', 'CM', 'AM'].includes(p.position) ? 'MID' : 'ATT');
    const list = squad.filter((p) => filter === 'all' || group(p) === filter).map((p) => ({
      p, ovr: Math.round(overall(p)), age: ageAt(p.birthDay, g.day), value: marketValue(p, g.day), wage: p.contract?.wage ?? 0,
      goals: (p.stats.league?.goals ?? 0) + (p.stats.cup?.goals ?? 0), apps: (p.stats.league?.apps ?? 0) + (p.stats.cup?.apps ?? 0),
    }));
    const val = (r: (typeof list)[number]) => (sort === 'pos' ? POSITION_ORDER.indexOf(r.p.position) * 1000 - r.ovr : r[sort]);
    return list.sort((a, b) => (val(a) - val(b)) * dir || b.ovr - a.ovr);
  }, [squad, sort, dir, filter, g]);

  const head = (key: SortKey, label: string, num = true) => (
    <th className={clsx(num && 'num')} aria-sort={sort === key ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="font-semibold uppercase tracking-wide hover:text-ink-50" onClick={() => { if (sort === key) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(key); setDir(key === 'pos' || key === 'age' ? 1 : -1); } }}>
        {label}{sort === key ? (dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );

  const out = squad.filter((p) => availability(p) !== 'available');
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-6">
            <Stat label="Players" value={squad.length} />
            <Stat label="Average age" value={(squad.reduce((s, p) => s + ageAt(p.birthDay, g.day), 0) / Math.max(1, squad.length)).toFixed(1)} />
            <Stat label="Average rating" value={(squad.reduce((s, p) => s + overall(p), 0) / Math.max(1, squad.length)).toFixed(1)} />
            <Stat label="Unavailable" value={out.length} sub={out.length ? out.slice(0, 3).map((p) => p.displayName).join(', ') : 'Everyone fit'} />
          </div>
          <div role="radiogroup" aria-label="Filter by line" className="inline-flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
            {(['all', 'GK', 'DEF', 'MID', 'ATT'] as const).map((f) => (
              <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={clsx('rounded-md px-2.5 py-1 text-xs font-medium', filter === f ? 'bg-pitch-600 text-white' : 'text-ink-200 hover:bg-ink-800')}>{f === 'all' ? 'All' : f}</button>
            ))}
          </div>
        </div>
      </Card>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-4"><Empty title="No players in this group" /></div> : (
          <ScrollX>
            <table className="tbl">
              <thead>
                <tr>
                  {head('pos', 'Pos', false)}
                  <th>Player</th>
                  {head('age', 'Age')}
                  {head('ovr', 'OVR')}
                  <th>Status</th>
                  {head('apps', 'Apps')}
                  {head('goals', 'G')}
                  <th className="num">Avg</th>
                  {head('value', 'Value')}
                  {head('wage', 'Wage/wk')}
                  <th className="num">Contract</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, ovr, age, value, wage, goals, apps }) => {
                  const a = availability(p);
                  const st = p.stats.league;
                  const me = p.id === g.userId;
                  return (
                    <tr key={p.id} className={me ? 'me' : ''}>
                      <td className="font-mono text-xs text-ink-300">{p.position}</td>
                      <td><span className="inline-flex items-center gap-1.5"><span className={clsx('truncate', me && 'font-semibold text-ink-50')}>{p.displayName}</span><NationTag code={p.nationality} />{p.loan && <Chip title="On loan">Loan</Chip>}</span></td>
                      <td className="num">{age}</td>
                      <td className={clsx('num font-semibold', ratingClass(ovr))}>{ovr}</td>
                      <td>
                        {a === 'injured' && p.injury ? <Chip tone="bad" title={`${p.injury.type}, ${p.injury.daysLeft} days left`}>Injured · {p.injury.daysLeft}d</Chip>
                          : a === 'suspended' ? <Chip tone="warn">Banned · {p.suspension}</Chip>
                            : p.cond.fatigue > 70 ? <Chip tone="warn">Tired</Chip> : <span className="text-xs text-ink-400">Fit</span>}
                      </td>
                      <td className="num">{apps}</td>
                      <td className="num">{goals}</td>
                      <td className="num">{st && st.apps ? statAvg(st.ratingSum, st.apps) : '–'}</td>
                      <td className="num">{money(value)}</td>
                      <td className="num">{wage ? money(wage) : '–'}</td>
                      <td className="num whitespace-nowrap">{p.contract ? `${yearsLeft(p.contract, g.day).toFixed(1)}y` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        )}
      </Card>
      <p className="text-xs text-ink-400">Ratings are the overall for each player’s listed position. Only your own player’s potential is tracked here.</p>
    </div>
  );
}

function Tactics({ club }: { club: ClubT }) {
  const g = useGame();
  const m = club.manager;
  const sel = useDerived((s) => pickMatchSquad(s, club.id, { day: s.day, importance: 0.6, competition: 'league' }), [club.id]);
  const f = FORMATIONS[sel.formation];
  const style = STYLES[m.tactics.style];
  const line = LINE_PARAMS[m.tactics.line];
  const userIdx = sel.lineup.findIndex((p) => p.id === g.userId);
  const onBench = sel.bench.some((p) => p.id === g.userId);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Card title={`Projected XI · ${f.name}`}>
          <div className="mb-3"><Help>The side the manager would pick today for a league match, from fitness, form, rotation habits and the manager’s own preferences. The real XI is confirmed on match day.</Help></div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-200">
            {userIdx >= 0 ? <Chip tone="good">You are in the XI</Chip> : onBench ? <Chip tone="warn">You are on the bench</Chip> : <Chip tone="bad">You are not in the squad</Chip>}
          </div>
          <ScrollX>
            <table className="tbl">
              <thead><tr><th>Slot</th><th>Player</th><th className="num">Fit</th><th className="num">Fatigue</th><th className="num">Form</th></tr></thead>
              <tbody>
                {sel.lineup.map((p, i) => p && (
                  <tr key={p.id} className={p.id === g.userId ? 'me' : ''}>
                    <td className="font-mono text-xs text-ink-300">{f.slots[i].pos}</td>
                    <td>{p.displayName}{p.position !== f.slots[i].pos && <span className="ml-1 text-xs text-ink-400">({p.position})</span>}</td>
                    <td className="num">{Math.round(overall({ ...p, position: f.slots[i].pos }))}</td>
                    <td className="num">{Math.round(p.cond.fatigue)}</td>
                    <td className="num">{p.recentRatings.length ? p.recentRatings[p.recentRatings.length - 1].toFixed(1) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
          {sel.bench.length > 0 && <p className="mt-3 text-xs text-ink-300"><span className="font-medium text-ink-200">Bench: </span>{sel.bench.map((p) => `${p.displayName} (${p.position})`).join(', ')}</p>}
          {sel.unavailable.length > 0 && <p className="mt-1 text-xs text-ink-300"><span className="font-medium text-ink-200">Unavailable: </span>{sel.unavailable.map((u) => `${g.players[u.id]?.displayName ?? u.id} (${u.reason})`).join(', ')}</p>}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Manager">
          <p className="text-base font-semibold text-ink-50">{m.name}</p>
          <p className="mb-3 text-xs text-ink-300">{nationName(m.nationality)}</p>
          <div className="flex flex-col gap-1.5 text-sm">
            <Row label="Formation">{FORMATIONS[m.formation].name}</Row>
            <Row label="Style">{style.label}</Row>
            <Row label="Defensive line">{LINE_LABEL[m.tactics.line]}</Row>
            <Row label="Coaching">{m.coaching.toFixed(0)} / 20</Row>
          </div>
          <p className="mt-3 text-xs text-ink-300">{style.blurb}</p>
        </Card>
        <Card title="Personality">
          <ul className="flex flex-col gap-2 text-sm text-ink-200">
            <li><span className="text-ink-300">Young players: </span>{trait(m.youthBias, 'prefers experience', 'balanced', 'gives youngsters a chance')}</li>
            <li><span className="text-ink-300">Rotation: </span>{trait(m.rotation, 'keeps a settled side', 'rotates when needed', 'rotates often')}</li>
            <li><span className="text-ink-300">Veterans: </span>{trait(m.loyaltyToVeterans, 'ruthless about age', 'fair', 'loyal to older players')}</li>
            <li><span className="text-ink-300">Standards: </span>{trait(m.strictness, 'patient with poor form', 'reasonable', 'demanding, punishes poor form')}</li>
            <li><span className="text-ink-300">Temperament: </span>{trait(m.temperament, 'calm', 'level-headed', 'volatile')}</li>
          </ul>
          <p className="mt-3 text-xs text-ink-400">Defensive line effect: {m.tactics.line === 'high' ? 'squeezes the pitch but risks balls in behind' : m.tactics.line === 'deep' ? 'harder to play through but invites pressure' : 'a standard shape'} (offside trap {Math.round(line.offsideTrap * 100)}%).</p>
        </Card>
      </div>
    </div>
  );
}

function ClubInfo({ club }: { club: ClubT }) {
  const g = useGame();
  const bill = wageBill(g, club.id);
  const sq = squadOf(g, club.id);
  const league = clubLeague(g, club.id);
  const scorers = [...sq].sort((a, b) => ((b.stats.league?.goals ?? 0) - (a.stats.league?.goals ?? 0)) || ((b.stats.league?.assists ?? 0) - (a.stats.league?.assists ?? 0))).filter((p) => (p.stats.league?.goals ?? 0) > 0).slice(0, 5);
  const bar = (v: number) => (v >= 14 ? 'bg-pitch-500' : v >= 8 ? 'bg-warn-500' : 'bg-bad-500');
  const rep = club.reputation;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Finances">
        <div className="mb-3 grid grid-cols-2 gap-4">
          <Stat label="Balance" value={money(club.balance)} tone={club.balance < 0 ? 'text-bad-400' : undefined} />
          <Stat label="Transfer budget" value={money(club.transferBudget)} />
          <Stat label="Weekly wage bill" value={money(bill)} sub={`Budget ${money(club.wageBudget)}`} />
          <Stat label="Weekly income" value={money(club.income)} />
        </div>
        <div className="mb-1 flex items-baseline justify-between text-xs"><span className="text-ink-300">Wage budget used</span><span className="font-medium text-ink-100">{Math.round((bill / Math.max(1, club.wageBudget)) * 100)}%</span></div>
        <Bar value={bill} max={club.wageBudget} color={bill > club.wageBudget ? 'bg-bad-500' : 'bg-pitch-500'} label="Wage budget used" />
        <p className="mt-3 text-xs text-ink-400">Clubs that spend beyond their wage budget cannot register new signings or offer new contracts until they clear room.</p>
      </Card>
      <Card title="Stadium & facilities">
        <Row label="Stadium">{club.stadium}</Row>
        <Row label="Capacity">{club.capacity.toLocaleString('en-GB')}</Row>
        <Row label="Reputation">{rep} / 100</Row>
        <Row label="Ambition">{trait(club.ambition, 'content with the status quo', 'steady ambition', 'driven to climb')}</Row>
        <Row label="Squad chemistry">{Math.round(club.chemistry)} / 100</Row>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">Training facilities</span><span className="font-medium text-ink-100">{club.trainingFacilities} / 20</span></div>
            <Bar value={club.trainingFacilities} max={20} color={bar(club.trainingFacilities)} label="Training facilities" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">Youth facilities</span><span className="font-medium text-ink-100">{club.youthFacilities} / 20</span></div>
            <Bar value={club.youthFacilities} max={20} color={bar(club.youthFacilities)} label="Youth facilities" />
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-400">Better training facilities and coaching speed up your development.</p>
      </Card>
      {league && (
        <Card title={league.name} pad={false} className="lg:col-span-1">
          <MiniTable g={g} compId={league.id} clubId={club.id} span={3} />
        </Card>
      )}
      <Card title="Club top scorers">
        {scorers.length === 0 ? <Empty title="No goals yet this season" /> : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {scorers.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span className={clsx(p.id === g.userId && 'font-semibold text-pitch-400')}>{p.displayName} <span className="text-xs text-ink-400">{POSITION_LABEL[p.position]}</span></span>
                <span className="text-ink-200">{plural(p.stats.league?.goals ?? 0, 'goal')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-400">Contract expiries: {sq.filter((p) => p.contract && p.contract.endDay - g.day < 180).length} players have under six months left{g.career.retired ? '' : ` (today is ${formatDate(g.day)})`}.</p>
      </Card>
    </div>
  );
}
