import { useMemo, useState } from 'react';
import { useDerived, useGame } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Bar, Card, Chip, Empty, Help, PageHeader, Row, ScrollX, Stat, Tabs } from '../kit';
import { ConditionMeters, NationTag, Spark } from '../parts';
import { Portrait } from '../art';
import { clsx, formatDate, formatShort, money, potentialEstimate, ratingClass, statAvg, seasonLabel } from '../format';
import {
  ATTR_LABEL, POSITION_LABEL, TECHNICAL, PHYSICAL, MENTAL, ageAt, derived, overall, positionWeights,
} from '../../engine/attributes';
import { assessRole } from '../../engine/selection';
import { userClub } from '../../engine/util';
import { growthContext } from '../../engine/progression';
import { reputationLabel } from '../../engine/life';
import { yearsLeft } from '../../engine/economy';
import { nationName } from '../../engine/names';
import { SEVERITY_LABEL } from '../../engine/injuries';
import type { AttrKey, StatLine } from '../../engine/types';

type Tab = 'overview' | 'attributes' | 'development' | 'stats' | 'contract';

function Overview() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const user = g.players[g.userId];
  const club = userClub(g);
  const age = ageAt(user.birthDay, g.day);
  const ovr = Math.round(overall(user));
  const est = potentialEstimate(g, user, club?.manager.coaching ?? 12);
  const d = derived(user.attrs);
  const role = club ? assessRole(g, club, user, g.day) : null;
  const tiles: [string, number][] = user.position === 'GK'
    ? [['Goalkeeping', d.gk], ['Mentality', d.mentality], ['Physical', d.physicality], ['Passing', d.passing], ['Aerial', d.aerial], ['Work ethic', d.workEthic]]
    : [['Pace', d.pace], ['Shooting', d.shooting], ['Passing', d.passing], ['Ball skills', d.ballSkills], ['Defending', d.defending], ['Physical', d.physicality]];
  const rep = g.reputation;
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center gap-4">
            <Portrait look={user.appearance} kit={club?.crest.primary} size={96} />
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold text-ink-50">{user.displayName}</div>
              <div className="text-sm text-ink-300">{user.firstName} {user.lastName}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5"><NationTag code={user.nationality} /><Chip>{user.position}</Chip>{user.secondary && <Chip>also {user.secondary}</Chip>}<Chip>#{user.shirt}</Chip></div>
            </div>
          </div>
          <div className="mt-4">
            <Row label="Position">{POSITION_LABEL[user.position]}</Row>
            <Row label="Age">{age} · born {formatDate(user.birthDay)}</Row>
            <Row label="Nationality">{nationName(user.nationality)}</Row>
            <Row label="Height / weight">{user.height} cm · {user.weight} kg</Row>
            <Row label="Preferred foot"><span className="capitalize">{user.foot}</span></Row>
            <Row label="Personality"><span className="capitalize">{user.personality}</span></Row>
            <Row label="Club">{club?.name ?? 'No club'}</Row>
          </div>
        </Card>
        <Card title="Reputation">
          <div className="flex flex-col gap-3">
            {([['professional', 'Professional'], ['fans', 'Fans'], ['media', 'Media'], ['club', 'Within the club'], ['national', 'National']] as const).map(([k, label]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">{label}</span><span className="font-medium text-ink-100">{reputationLabel(rep[k])} · {Math.round(rep[k])}</span></div>
                <Bar value={rep[k]} label={label} />
              </div>
            ))}
          </div>
          <Help>Reputation moves with performances, trophies, how you behave and how you live. It decides what clubs and sponsors offer you.</Help>
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Ability">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="stat-label">Overall</div>
              <div className={clsx('text-5xl font-bold leading-none', ratingClass(ovr))}>{ovr}</div>
              <div className="mt-1 text-xs text-ink-300">as a {POSITION_LABEL[user.position].toLowerCase()}</div>
            </div>
            <div className="min-w-[12rem] flex-1">
              <div className="stat-label">Coaches’ view of your ceiling</div>
              <div className="text-lg font-semibold text-ink-50">{est.label}</div>
              {!est.atPeak && <div className="text-sm text-ink-200">Probably peaking somewhere between {est.lo} and {est.hi}</div>}
              <p className="mt-1 text-xs text-ink-400">An estimate, not a promise. Your real potential is hidden, and the coaches’ range narrows as you get older.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {tiles.map(([label, v]) => (
              <div key={label} className="rounded-md border border-ink-700 bg-ink-900 px-2 py-2 text-center">
                <div className={clsx('text-lg font-bold', ratingClass(v))}>{Math.round(v)}</div>
                <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Condition">
          <ConditionMeters p={user} />
          {user.injury ? (
            <div className="mt-4 rounded-md border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-ink-100">
              <span className="font-semibold text-bad-400">{user.injury.type}</span> · {SEVERITY_LABEL[user.injury.severity]} · {user.injury.daysLeft} of {user.injury.daysTotal} days left
              <div className="mt-0.5 text-xs text-ink-300">Caused {user.injury.source === 'match' ? 'in a match' : 'in training'} on {formatDate(user.injury.startDay)}. You will return after {formatDate(g.day + user.injury.daysLeft)}.</div>
            </div>
          ) : user.suspension > 0 ? (
            <div className="mt-4 rounded-md border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-ink-100">Suspended for {user.suspension} more {user.suspension === 1 ? 'match' : 'matches'}.</div>
          ) : <p className="mt-4 text-sm text-ink-300">No injuries or suspensions. {user.yellowsSeason > 0 ? `${user.yellowsSeason} yellow ${user.yellowsSeason === 1 ? 'card' : 'cards'} this season.` : ''}</p>}
          <p className="mt-2 text-xs text-ink-400">Injury proneness: {user.injuryProne < 0.85 ? 'resilient' : user.injuryProne > 1.15 ? 'fragile' : 'average'}.</p>
        </Card>
        <Card title="Your place in the squad" actions={<button className="btn btn-ghost btn-sm" onClick={() => go('club')}>Squad</button>}>
          {role ? (
            <>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                <Stat label="Role" value={<span className="text-base">{g.career.squadRole}</span>} />
                <Stat label="Rank in position" value={`${role.rank} of ${role.competitors}`} />
                <Stat label="Gap to a starter" value={role.gapToStarter > 0 ? `${role.gapToStarter} pts` : 'None'} />
                <Stat label="Manager’s trust" value={`${Math.round(g.career.managerTrust)}`} sub="out of 100" />
                <Stat label="Training impression" value={`${Math.round(g.career.trainingPerformance)}`} sub="out of 100" />
              </div>
              <p className="mt-3 text-sm text-ink-200">{role.note}{role.starterName ? ` The player to overtake at ${user.position} is ${role.starterName}.` : ''}</p>
            </>
          ) : <p className="text-sm text-ink-300">You are not attached to a club.</p>}
        </Card>
        {g.career.injuries.length > 0 && (
          <Card title="Injury history">
            <ul className="divide-y divide-ink-800 text-sm">
              {[...g.career.injuries].reverse().slice(0, 8).map((i, k) => (
                <li key={k} className="flex justify-between py-1.5"><span>{i.type} <span className="text-ink-400">· {SEVERITY_LABEL[i.severity]}</span></span><span className="text-ink-300">{formatShort(i.day)} · {i.days} days</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Attributes() {
  const g = useGame();
  const user = g.players[g.userId];
  const start = g.career.seasonStartAttrs;
  const weights = positionWeights(user.position);
  const key = new Set(weights.slice().sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k));
  const top = weights.slice().sort((a, b) => b[1] - a[1]).slice(0, 6);
  const groups: { name: string; keys: AttrKey[] }[] = [{ name: 'Technical', keys: TECHNICAL }, { name: 'Physical', keys: PHYSICAL }, { name: 'Mental', keys: MENTAL }];
  return (
    <div className="flex flex-col gap-4">
      <Card title={`What matters for a ${POSITION_LABEL[user.position].toLowerCase()}`}>
        <div className="flex flex-wrap gap-2">
          {top.map(([k, w]) => <Chip key={k} tone="info">{ATTR_LABEL[k]} · {Math.round(w * 100)}%</Chip>)}
        </div>
        <Help>Your overall rating is a weighted average of all 32 attributes, with the weights set by your position. Attributes marked ★ count most. The arrows show change since the season began.</Help>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((gr) => (
          <Card key={gr.name} title={gr.name}>
            <ul className="flex flex-col gap-2.5">
              {gr.keys.map((k) => {
                const v = user.attrs[k];
                const dv = v - (start?.[k] ?? v);
                const irrelevant = user.position !== 'GK' && ['reflexes', 'handling', 'oneOnOnes'].includes(k);
                return (
                  <li key={k} className={irrelevant ? 'opacity-80' : ''}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-ink-200">{key.has(k) && <span className="mr-1 text-gold-400" title="Key attribute for your position">★</span>}{ATTR_LABEL[k]}</span>
                      <span className="flex items-center gap-1.5">
                        {dv !== 0 && <span className={dv > 0 ? 'text-pitch-400' : 'text-bad-400'}>{dv > 0 ? '▲' : '▼'}{Math.abs(dv)}</span>}
                        <span className={clsx('w-6 text-right text-sm font-semibold', ratingClass(v))}>{v}</span>
                      </span>
                    </div>
                    <Bar value={v} color={v >= 80 ? 'bg-gold-400' : v >= 70 ? 'bg-pitch-400' : v >= 48 ? 'bg-pitch-600' : 'bg-bad-500'} label={ATTR_LABEL[k]} />
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Development() {
  const g = useGame();
  const user = g.players[g.userId];
  const [filter, setFilter] = useState<AttrKey | 'all'>('all');
  const ctx = useDerived((s) => growthContext(s, s.players[s.userId], s.training.plan));
  const age = ageAt(user.birthDay, g.day);
  const history = g.career.ovrHistory.map((h) => ({ x: h.day, y: h.ovr }));
  const log = g.career.attrChanges.filter((c) => filter === 'all' || c.attr === filter).slice().reverse().slice(0, 60);
  const changed = useMemo(() => [...new Set(g.career.attrChanges.map((c) => c.attr))], [g.career.attrChanges]);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Overall rating over time">
          <Spark points={history} label="Overall rating history" min={Math.max(0, Math.min(...history.map((h) => h.y), 40) - 2)} />
          <div className="mt-2 flex justify-between text-xs text-ink-300">
            <span>Started at {g.career.startOverall}</span><span>Peak so far {g.career.highestOverall}</span>
          </div>
        </Card>
        <Card title="Every change, and why" actions={
          <select className="field !w-auto py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as AttrKey | 'all')} aria-label="Filter by attribute">
            <option value="all">All attributes</option>
            {changed.map((k) => <option key={k} value={k}>{ATTR_LABEL[k]}</option>)}
          </select>
        }>
          {log.length === 0 ? <Empty title="No changes yet" body="Attributes change in small steps as you train, play and age. Each step will be listed here with its reason." /> : (
            <ul className="divide-y divide-ink-800">
              {log.map((c, i) => (
                <li key={i} className="flex items-start gap-3 py-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-ink-400">{formatShort(c.day)}</span>
                  <span className="w-36 shrink-0 font-medium text-ink-50">{ATTR_LABEL[c.attr]}</span>
                  <span className={clsx('w-16 shrink-0 font-semibold', c.to > c.from ? 'text-pitch-400' : 'text-bad-400')}>{c.from} → {c.to}</span>
                  <span className="text-ink-300">{c.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title={age < 28 ? 'What drives your growth' : 'What drives your decline'}>
          <ul className="flex flex-col gap-2 text-sm">
            {ctx.parts.map((p) => (
              <li key={p.label} className="flex items-center justify-between gap-2">
                <span className="text-ink-200">{p.label}</span>
                <span className={clsx('font-semibold tabular-nums', (age < 28 ? p.value >= 1 : p.value <= 1) ? 'text-pitch-400' : 'text-warn-400')}>×{p.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-ink-700 pt-3 text-sm">
            <span className="text-ink-100">Combined</span>
            <span className="text-lg font-bold text-ink-50">×{ctx.multiplier.toFixed(2)}</span>
          </div>
          <Help>{age < 28 ? 'Multipliers above 1.00 speed your development up; below 1.00 slow it. Playing time, good coaching and training intensity matter most.' : 'At your age attributes drift down. A multiplier below 1.00 slows the decline.'} How far you can eventually go is capped by hidden potential.</Help>
        </Card>
      </div>
    </div>
  );
}

function sumLines(...ls: (StatLine | undefined)[]): StatLine {
  const o: StatLine = { apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, yellows: 0, reds: 0, cleanSheets: 0, conceded: 0, ratingSum: 0, motm: 0, shots: 0, ownGoals: 0 };
  for (const l of ls) if (l) for (const k of Object.keys(o) as (keyof StatLine)[]) o[k] += l[k];
  return o;
}

function StatRow({ label, s, hl }: { label: string; s: StatLine; hl?: boolean }) {
  return (
    <tr className={hl ? 'me' : ''}>
      <td className="whitespace-nowrap">{label}</td>
      <td className="num">{s.apps}</td><td className="num">{s.starts}</td><td className="num">{s.minutes}</td><td className="num">{s.goals}</td><td className="num">{s.assists}</td>
      <td className="num">{statAvg(s.ratingSum, s.apps)}</td><td className="num">{s.motm}</td><td className="num">{s.yellows}</td><td className="num">{s.reds}</td><td className="num">{s.cleanSheets}</td>
    </tr>
  );
}

function Stats() {
  const g = useGame();
  const user = g.players[g.userId];
  const st = user.stats;
  const head = (
    <thead><tr><th>&nbsp;</th><th className="num">Apps</th><th className="num">Starts</th><th className="num">Mins</th><th className="num">Goals</th><th className="num">Assists</th><th className="num">Avg</th><th className="num">MOTM</th><th className="num">YC</th><th className="num">RC</th><th className="num">CS</th></tr></thead>
  );
  const rec = g.career.records;
  return (
    <div className="flex flex-col gap-4">
      <Card title={`This season · ${seasonLabel(g.season)}`} pad={false}>
        <ScrollX>
          <table className="tbl">{head}<tbody>
            <StatRow label="League" s={st.league ?? sumLines()} />
            <StatRow label="Cup" s={st.cup ?? sumLines()} />
            <StatRow label="International" s={st.intl ?? sumLines()} />
            <StatRow label="Reserves / youth" s={st.dev ?? sumLines()} />
            <StatRow label="First team total" s={sumLines(st.league, st.cup, st.intl)} hl />
          </tbody></table>
        </ScrollX>
      </Card>
      <Card title="Career, season by season" pad={false}>
        {g.career.seasons.length === 0 ? <div className="p-4"><Empty title="No completed seasons yet" /></div> : (
          <ScrollX>
            <table className="tbl">
              <thead><tr><th>Season</th><th>Club</th><th className="num">Apps</th><th className="num">Goals</th><th className="num">Assists</th><th className="num">Avg</th><th className="num">OVR</th><th>League</th><th>Honours</th></tr></thead>
              <tbody>
                {g.career.seasons.map((s) => {
                  const t = sumLines(s.league, s.cup, s.intl);
                  return (
                    <tr key={`${s.season}${s.clubId}`}>
                      <td>{seasonLabel(s.season)}</td><td className="whitespace-nowrap">{s.clubName}</td>
                      <td className="num">{t.apps}</td><td className="num">{t.goals}</td><td className="num">{t.assists}</td><td className="num">{statAvg(t.ratingSum, t.apps)}</td>
                      <td className={clsx('num font-semibold', ratingClass(s.endOverall))}>{s.endOverall}</td>
                      <td className="text-ink-300">{s.leaguePos ? `${s.leagueName}: ${s.leaguePos}` : '–'}</td>
                      <td className="text-xs text-ink-200">{[...s.trophies, ...s.awards].join(', ') || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Career totals (first team)">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Appearances" value={g.career.appearances.apps} />
            <Stat label="Goals" value={g.career.appearances.goals} />
            <Stat label="Assists" value={g.career.appearances.assists} />
            <Stat label="Hat-tricks" value={g.career.hatTricks} />
            <Stat label="Man of the match" value={g.career.appearances.motm} />
            <Stat label="Clean sheets" value={g.career.appearances.cleanSheets} />
            <Stat label="Avg rating" value={statAvg(g.career.appearances.ratingSum, g.career.appearances.apps)} />
            <Stat label="Caps" value={g.international.caps} />
          </div>
        </Card>
        <Card title="Records">
          <Row label="Most goals in a season">{rec.mostGoalsSeason ? `${rec.mostGoalsSeason.value} (${seasonLabel(rec.mostGoalsSeason.season)})` : '–'}</Row>
          <Row label="Most assists in a season">{rec.mostAssistsSeason ? `${rec.mostAssistsSeason.value} (${seasonLabel(rec.mostAssistsSeason.season)})` : '–'}</Row>
          <Row label="Highest overall">{g.career.highestOverall}</Row>
          <Row label="Most appearances for a club">{Object.keys(rec.mostAppsClub).length ? (() => { const [id, n] = Object.entries(rec.mostAppsClub).sort((a, b) => b[1] - a[1])[0]; return `${n} for ${g.clubs[id]?.name ?? id}`; })() : '–'}</Row>
        </Card>
      </div>
    </div>
  );
}

function Contract() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const user = g.players[g.userId];
  const c = user.contract;
  if (g.career.retired) return <Empty title="You have retired" body="There is no contract to show." />;
  if (!c) return <Empty title="You have no contract" body="You are a free agent. Clubs will approach you, and your agent can look for one." action={<button className="btn btn-primary" onClick={() => go('transfers')}>Open transfers</button>} />;
  const yl = yearsLeft(c, g.day);
  const club = g.clubs[c.clubId];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Current contract" actions={<button className="btn btn-sm" onClick={() => go('transfers')}>Contract talks</button>}>
        <Row label="Club">{club?.name}</Row>
        <Row label="Type"><span className="capitalize">{c.type}</span></Row>
        <Row label="Wage">{money(c.wage)} a week · {money(c.wage * 52)} a year</Row>
        <Row label="Signed">{formatDate(c.startDay)}</Row>
        <Row label="Expires">{formatDate(c.endDay)} ({yl < 1 ? `${Math.max(1, Math.round(yl * 12))} months` : `${yl.toFixed(1)} years`} left)</Row>
        <Row label="Role promised">{c.role}</Row>
        <Row label="Release clause">{c.releaseClause ? money(c.releaseClause) : 'None'}</Row>
        {user.loan && <Row label="On loan from">{g.clubs[user.loan.parentClubId]?.name} until {formatDate(user.loan.endDay)}</Row>}
      </Card>
      <Card title="Bonuses">
        <Row label="Per appearance">{money(c.bonuses.appearance)}</Row>
        <Row label="Per goal">{money(c.bonuses.goal)}</Row>
        {['GK', 'CB', 'RB', 'LB', 'DM'].includes(user.position) && <Row label="Per clean sheet">{money(c.bonuses.cleanSheet)}</Row>}
        <Row label="Signing bonus">{money(c.bonuses.signing)} {c.bonuses.signingPaid ? '(paid)' : '(due)'}</Row>
        <Row label="Loyalty bonus">{money(c.bonuses.loyalty)} on completing the contract</Row>
        <Help>Appearance and goal bonuses are paid with your weekly wage after the match. Your agent takes {g.transfers.agent.feePct}% of everything you earn from the club.</Help>
      </Card>
    </div>
  );
}

export function MyPlayer() {
  const g = useGame();
  const [tab, setTab] = useState<Tab>('overview');
  const user = g.players[g.userId];
  return (
    <>
      <PageHeader title="My Player" subtitle={`${user.displayName} · ${POSITION_LABEL[user.position]} · ${ageAt(user.birthDay, g.day)} years old`} />
      <Tabs<Tab> label="Player sections" value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'attributes', label: 'Attributes' }, { id: 'development', label: 'Development' }, { id: 'stats', label: 'Statistics' }, { id: 'contract', label: 'Contract' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'attributes' && <Attributes />}
      {tab === 'development' && <Development />}
      {tab === 'stats' && <Stats />}
      {tab === 'contract' && <Contract />}
    </>
  );
}
