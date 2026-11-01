import { useMemo, useState } from 'react';
import { useAct, useAsk, useDerived, useGame } from '../../store/hooks';
import { Bar, Card, Chip, Empty, PageHeader, Row, ScrollX, Stat, Tabs } from '../kit';
import { NationTag, scoreText } from '../parts';
import { clsx, formatDate, formatShort, inDaysText, seasonLabel } from '../format';
import { ageAt } from '../../engine/attributes';
import { computeTable } from '../../engine/competitions';
import { assessCallUp, canSwitchNation, nationStrength, pickSquad, seasonInternationalLabel, switchNation, SENIOR_SQUAD } from '../../engine/international';
import { nationName } from '../../engine/names';
import type { Competition, Fixture, GameState } from '../../engine/types';

type Tab = 'status' | 'squad' | 'competitions' | 'nation';

const STATUS_TEXT: Record<GameState['international']['squadStatus'], { label: string; tone?: 'good' | 'warn' | 'info' }> = {
  none: { label: 'Not in contention' },
  youth: { label: 'In the U21 squad', tone: 'info' },
  senior_watchlist: { label: 'On the senior watchlist', tone: 'warn' },
  senior_squad: { label: 'In the senior squad', tone: 'good' },
};

export function NationalTeam() {
  const g = useGame();
  const [tab, setTab] = useState<Tab>('status');
  const i = g.international;
  const status = STATUS_TEXT[i.squadStatus];
  return (
    <>
      <PageHeader
        title={nationName(i.nation)}
        subtitle={`${seasonInternationalLabel(g)} · ${i.caps} senior cap${i.caps === 1 ? '' : 's'}, ${i.goals} goal${i.goals === 1 ? '' : 's'}`}
        actions={<>{i.calledUpNow && <Chip tone="good">Called up now</Chip>}<Chip tone={status.tone}>{status.label}</Chip></>}
      />
      <Tabs<Tab> label="National team sections" value={tab} onChange={setTab} tabs={[
        { id: 'status', label: 'Call-up status' }, { id: 'squad', label: 'Squad' }, { id: 'competitions', label: 'Fixtures & tables' }, { id: 'nation', label: 'Nation & honours' },
      ]} />
      {tab === 'status' && <Status />}
      {tab === 'squad' && <Squad />}
      {tab === 'competitions' && <Fixtures />}
      {tab === 'nation' && <Nation />}
    </>
  );
}

/* ------------------------------------------------------------------ status */

function Status() {
  const g = useGame();
  const user = g.players[g.userId];
  const i = g.international;
  const age = ageAt(user.birthDay, g.day);
  const senior = useDerived((s) => assessCallUp(s, false));
  const youth = useDerived((s) => (ageAt(s.players[s.userId].birthDay, s.day) <= 21 ? assessCallUp(s, true) : null));
  const upcoming = mineFixtures(g, i.nation).filter((f) => !f.played).slice(0, 3);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Card title="Where you stand">
          <p className="text-sm text-ink-100">{senior.reason}</p>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs"><span className="text-ink-300">Manager’s opinion of you</span><span className="text-ink-100">{Math.round(i.managerOpinion)} / 100</span></div>
            <Bar value={i.managerOpinion} color={i.managerOpinion >= 60 ? 'bg-pitch-500' : i.managerOpinion >= 40 ? 'bg-warn-500' : 'bg-bad-500'} label="Manager's opinion" />
            <p className="mt-1 text-xs text-ink-400">Rises when you play well and outperform the others in your position. {nationName(i.nation)}’s manager is {g.nations[i.nation]?.manager.name}.</p>
          </div>
          {youth && age <= 21 && (
            <div className="mt-4 border-t border-ink-800 pt-3">
              <p className="text-sm text-ink-100"><span className="font-medium">U21: </span>{youth.reason}</p>
            </div>
          )}
        </Card>
        <Card title={`Rivals for a ${user.position} place`} pad={false}>
          {senior.rivals.length === 0 ? <div className="p-4"><Empty title="No one in the pool yet" /></div> : (
            <table className="tbl">
              <thead><tr><th className="w-8">#</th><th>Player</th><th>Club</th><th className="num">Age</th><th className="num">OVR</th></tr></thead>
              <tbody>
                {senior.rivals.map((r, k) => (
                  <tr key={r.id} className={r.id === g.userId ? 'me' : ''}><td className="text-ink-400">{k + 1}</td><td>{r.name}</td><td className="text-ink-300">{r.clubName}</td><td className="num">{r.age}</td><td className="num font-semibold">{r.ovr}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t border-ink-800 px-4 py-2 text-xs text-ink-400">The manager takes {senior.needed} {user.position}s in the squad. You rank {senior.rank > 0 ? senior.rank : 'outside the pool'} in your position.</p>
        </Card>
        <Card title="Your call-ups" pad={false}>
          {i.callUps.length === 0 ? <div className="p-4"><Empty title="No call-ups yet" body="Call-ups are announced before each international break." /></div> : (
            <ul className="divide-y divide-ink-800">
              {[...i.callUps].reverse().slice(0, 10).map((c, k) => (
                <li key={k} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span><span className="mr-2 text-xs text-ink-400">{formatShort(c.day)}</span>{c.label}</span>
                  <Chip tone={c.played ? 'good' : undefined}>{c.played ? 'Played' : c.day > g.day ? 'Upcoming' : 'Did not play'}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="Your record">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Senior caps" value={i.caps} />
            <Stat label="Goals" value={i.goals} />
            <Stat label="Assists" value={i.assists} />
            <Stat label="Youth caps" value={i.youthCaps} />
          </div>
        </Card>
        <Card title="Next matches">
          {upcoming.length === 0 ? <p className="text-sm text-ink-300">No fixtures are scheduled for {nationName(i.nation)} right now.</p> : (
            <ul className="flex flex-col gap-2 text-sm">
              {upcoming.map((f) => (
                <li key={f.id}>
                  <span className="block text-xs text-ink-400">{formatDate(f.day)} · {inDaysText(f.day - g.day)}</span>
                  <span>{nationName(f.homeId)} v {nationName(f.awayId)}</span>
                  <span className="block text-xs text-ink-300">{g.competitions[f.compId]?.name}{f.round ? ` · ${f.round}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {i.calledUpNow && <p className="mt-3 text-xs text-pitch-400">You are in the squad for the current break.</p>}
        </Card>
      </div>
    </div>
  );
}

function mineFixtures(g: GameState, nation: string): Fixture[] {
  return Object.values(g.fixtures)
    .filter((f) => (f.homeId === nation || f.awayId === nation) && g.competitions[f.compId]?.type === 'intl')
    .sort((a, b) => a.day - b.day);
}

/* ------------------------------------------------------------------- squad */

function Squad() {
  const g = useGame();
  const user = g.players[g.userId];
  const [youth, setYouth] = useState(false);
  const code = g.international.nation;
  const canYouth = ageAt(user.birthDay, g.day) <= 21;
  const sq = useDerived((s) => pickSquad(s, code, youth && canYouth), [code, youth, canYouth]);
  const strength = useDerived((s) => nationStrength(s, code), [code]);
  const rank = useDerived((s) => rankOf(s, code), [code]);
  const team = g.nations[code];
  const inXI = (id: string) => sq.lineup.some((p) => p?.id === id);
  const onBench = (id: string) => sq.bench.some((p) => p.id === id);
  const rows = sq.squad.filter(Boolean);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card title={`${youth && canYouth ? 'U21' : 'Senior'} squad · ${rows.length} of ${SENIOR_SQUAD}`} pad={false} actions={canYouth ? (
        <div role="radiogroup" aria-label="Squad level" className="inline-flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
          {[false, true].map((y) => <button key={String(y)} role="radio" aria-checked={youth === y} onClick={() => setYouth(y)} className={clsx('rounded-md px-2 py-0.5 text-xs font-medium', youth === y ? 'bg-pitch-600 text-white' : 'text-ink-200 hover:bg-ink-800')}>{y ? 'U21' : 'Senior'}</button>)}
        </div>
      ) : undefined}>
        <ScrollX>
          <table className="tbl">
            <thead><tr><th>Pos</th><th>Player</th><th>Club</th><th className="num">Age</th><th>Role</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.id === g.userId ? 'me' : ''}>
                  <td className="font-mono text-xs text-ink-300">{p.position}</td>
                  <td>{p.displayName}</td>
                  <td className="text-ink-300">{p.clubId ? g.clubs[p.clubId]?.shortName : 'Abroad'}</td>
                  <td className="num">{ageAt(p.birthDay, g.day)}</td>
                  <td>{inXI(p.id) ? <Chip tone="good">Starting XI</Chip> : onBench(p.id) ? <Chip>Bench</Chip> : <span className="text-xs text-ink-400">Reserve</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        {!rows.some((p) => p.id === g.userId) && <p className="border-t border-ink-800 px-4 py-2 text-xs text-ink-300">You are not in this squad. It is the one {team?.manager.name} would pick today.</p>}
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Team">
          <Row label="Manager">{team?.manager.name}</Row>
          <Row label="Style">{team?.manager.tactics.style}</Row>
          <Row label="Strength">{strength.toFixed(1)}</Row>
          <Row label="World rank">{rank}</Row>
        </Card>
      </div>
    </div>
  );
}

function rankOf(g: GameState, code: string): string {
  const all = Object.keys(g.nations).map((c) => ({ c, s: nationStrength(g, c) })).sort((a, b) => b.s - a.s);
  const idx = all.findIndex((x) => x.c === code);
  return idx < 0 ? '–' : `${idx + 1} of ${all.length}`;
}

/* ------------------------------------------------------------- competitions */

function Fixtures() {
  const g = useGame();
  const nation = g.international.nation;
  const comps = useMemo(
    () => Object.values(g.competitions).filter((c) => c.type === 'intl' && (c.groups || c.id.startsWith('FINALS') || c.id.startsWith('QUAL'))).sort((a, b) => b.season - a.season || a.id.localeCompare(b.id)),
    [g.competitions, g.day], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mine = mineFixtures(g, nation);
  const played = mine.filter((f) => f.played).reverse().slice(0, 12);
  return (
    <div className="flex flex-col gap-4">
      {comps.length === 0 ? <Empty title="No tournament this season" body={`This is a friendlies-only season. ${seasonInternationalLabel(g)}. Qualifying starts in the season before a finals tournament.`} /> : comps.slice(0, 3).map((c) => <CompGroups key={c.id} comp={c} nation={nation} />)}
      <Card title="Your nation’s results" pad={false}>
        {played.length === 0 ? <div className="p-4"><Empty title="No international matches played yet" /></div> : (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Competition</th><th>Match</th><th>Score</th></tr></thead>
            <tbody>
              {played.map((f) => (
                <tr key={f.id}><td className="whitespace-nowrap text-ink-300">{formatShort(f.day)}</td><td className="text-ink-300">{g.competitions[f.compId]?.short}</td><td>{nationName(f.homeId)} v {nationName(f.awayId)}</td><td className="font-medium text-ink-50">{scoreText(f)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function CompGroups({ comp, nation }: { comp: Competition; nation: string }) {
  const g = useGame();
  const fixtures = comp.fixtureIds.map((id) => g.fixtures[id]).filter(Boolean);
  const knockouts = fixtures.filter((f) => f.knockout);
  return (
    <Card title={`${comp.name} · ${seasonLabel(comp.season)}`} actions={comp.winnerId ? <Chip tone="good">Won by {nationName(comp.winnerId)}</Chip> : comp.completed ? <Chip>Complete</Chip> : undefined}>
      <p className="mb-3 text-xs text-ink-300">{comp.format}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(comp.groups ?? []).map((grp) => {
          const t = computeTable(grp.teams, fixtures.filter((f) => grp.teams.includes(f.homeId) && f.round.startsWith('Group')), (id) => nationName(id));
          return (
            <ScrollX key={grp.name}>
              <p className="mb-1 text-xs font-semibold text-ink-200">{grp.name}</p>
              <table className="tbl">
                <thead><tr><th className="w-6">#</th><th>Nation</th><th className="num">P</th><th className="num">GD</th><th className="num">Pts</th></tr></thead>
                <tbody>
                  {t.map((r, i) => (
                    <tr key={r.clubId} className={r.clubId === nation ? 'me' : ''}>
                      <td className="text-ink-300"><span className={clsx('mr-1 inline-block h-3 w-1 rounded-sm align-middle', i < 2 ? 'bg-pitch-500' : 'bg-transparent')} aria-hidden />{i + 1}</td>
                      <td><span className="inline-flex items-center gap-1.5"><NationTag code={r.clubId} />{nationName(r.clubId)}</span></td>
                      <td className="num">{r.p}</td><td className="num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td><td className="num font-semibold">{r.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          );
        })}
      </div>
      {knockouts.length > 0 && (
        <div className="mt-4 border-t border-ink-800 pt-3">
          <p className="mb-2 text-xs font-semibold text-ink-200">Knockout stage</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {knockouts.map((f) => (
              <li key={f.id} className={clsx('flex items-center justify-between gap-3 rounded px-2 py-1', (f.homeId === nation || f.awayId === nation) && 'bg-pitch-900/30')}>
                <span><span className="mr-2 text-xs text-ink-400">{f.round}</span>{nationName(f.homeId)} v {nationName(f.awayId)}</span>
                <span className="text-xs text-ink-200">{f.played ? scoreText(f) : formatShort(f.day)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ nation */

function Nation() {
  const g = useGame();
  const act = useAct();
  const ask = useAsk();
  const i = g.international;
  const others = i.eligible.filter((c) => c !== i.nation);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Represent a different nation">
        <p className="mb-3 text-sm text-ink-200">You are eligible for {i.eligible.map((c) => nationName(c)).join(', ')}. You may change nation only while you have no senior caps.</p>
        {others.length === 0 ? <Empty title="You are only eligible for one nation" /> : (
          <ul className="flex flex-col gap-3">
            {others.map((c) => {
              const check = canSwitchNation(g, c);
              return (
                <li key={c} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-700 px-3 py-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-ink-50"><NationTag code={c} />{nationName(c)}</p>
                    <p className="text-xs text-ink-300">{check.reason}</p>
                  </div>
                  <button
                    className="btn"
                    disabled={!check.ok}
                    onClick={() => ask({
                      title: `Represent ${nationName(c)}?`,
                      body: `You will leave the ${nationName(i.nation)} pool and start again with ${nationName(c)}'s manager, who does not yet know you. This is a major decision.`,
                      confirmLabel: 'Switch nation',
                      danger: true,
                      onConfirm: () => act((gg) => { const ok = switchNation(gg, c); return { ok, message: ok ? `You now represent ${nationName(c)}.` : 'The switch was not allowed.' }; }),
                    })}
                  >Switch</button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card title="Tournaments">
          {i.tournaments.length === 0 ? <Empty title="No tournaments yet" body="A major tournament is held every second summer." /> : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...i.tournaments].reverse().map((t, k) => <li key={k} className="flex items-center justify-between gap-3"><span>{t.season} {t.name}</span><Chip tone={t.result.startsWith('Winners') ? 'good' : undefined}>{t.result}</Chip></li>)}
            </ul>
          )}
        </Card>
        <Card title="International honours">
          {i.trophies.length === 0 ? <p className="text-sm text-ink-300">No international trophies yet.</p> : (
            <ul className="flex flex-col gap-1 text-sm">{i.trophies.map((t, k) => <li key={k}>{t.season} {t.name}</li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
