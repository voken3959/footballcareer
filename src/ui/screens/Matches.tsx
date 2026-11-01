import { useState } from 'react';
import { useDerived, useGame } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Card, Chip, Empty, Modal, PageHeader, ScrollX, Tabs } from '../kit';
import { ClubTag, FixtureRow, FormPips, clubFixtures, resultFor, scoreText } from '../parts';
import { MatchReportView } from './MatchReportView';
import { clsx, formatDate, formatShort, inDaysText, matchRatingClass, weekday } from '../format';
import { userClub } from '../../engine/util';
import { nationName } from '../../engine/names';
import { pendingUserFixture, nextUserFixture } from '../../engine/daily';
import type { CalendarEntry, Fixture } from '../../engine/types';

type Tab = 'fixtures' | 'results' | 'calendar';

const CAL_LABEL: Record<CalendarEntry['kind'], string> = {
  preseason: 'Pre-season', matchday: 'Matchday', cup: 'Cup', intl_break: 'International break', window_open: 'Transfer window opens',
  window_close: 'Transfer window closes', awards: 'Awards', season_end: 'Season ends', new_season: 'New season', cup_draw: 'Cup draw',
  contract_deadline: 'Contract deadline', intl_tournament: 'International tournament',
};

export function Matches() {
  const g = useGame();
  const advance = useStore((s) => s.advance);
  const go = useStore((s) => s.go);
  const [tab, setTab] = useState<Tab>('fixtures');
  const [comp, setComp] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const club = userClub(g);
  const all = useDerived((s) => { const c = userClub(s); return c ? clubFixtures(s, c.id) : []; });
  const upcoming = all.filter((f) => !f.played && g.competitions[f.compId]?.season === g.season);
  const played = all.filter((f) => f.played).reverse();
  const intlPlayed: Fixture[] = useDerived((s) => s.userMatchLog.map((id) => s.fixtures[id]).filter((f): f is Fixture => !!f && s.competitions[f.compId]?.type === 'intl').reverse());
  const comps = [...new Set([...played, ...upcoming].map((f) => f.compId.replace(/-\d+$/, '')))];
  const matches = (f: Fixture) => comp === 'all' || f.compId.replace(/-\d+$/, '') === comp;
  const pending = pendingUserFixture(g);
  const next = nextUserFixture(g);
  const openRec = open ? g.matchRecords[open] : undefined;
  const openFx = open ? g.fixtures[open] : undefined;
  const calendar = g.calendar.filter((c) => c.day >= g.day).slice(0, 24);

  const results = played.filter(matches);
  const record = club ? results.reduce((a, f) => { const r = resultFor(f, club.id); if (r === 'W') a.w++; else if (r === 'D') a.d++; else if (r === 'L') a.l++; return a; }, { w: 0, d: 0, l: 0 }) : { w: 0, d: 0, l: 0 };
  const form = club ? played.slice(0, 5).reverse().map((f) => resultFor(f, club.id)).filter((r): r is 'W' | 'D' | 'L' => !!r) : [];

  return (
    <>
      <PageHeader
        title="Matches"
        subtitle={club ? `${club.name} · fixtures, results and the calendar` : 'You are not attached to a club'}
        actions={pending ? <button className="btn btn-primary" onClick={() => go('matchday')}>Go to match day</button> : next ? <button className="btn btn-primary" onClick={() => void advance('match')}>Continue to match</button> : undefined}
      />
      <Tabs<Tab> label="Match sections" value={tab} onChange={setTab} tabs={[{ id: 'fixtures', label: 'Fixtures', badge: upcoming.length || undefined }, { id: 'results', label: 'Results' }, { id: 'calendar', label: 'Calendar' }]} />

      {(tab === 'fixtures' || tab === 'results') && comps.length > 1 && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs text-ink-300" htmlFor="compf">Competition</label>
          <select id="compf" className="field !w-auto py-1" value={comp} onChange={(e) => setComp(e.target.value)}>
            <option value="all">All</option>
            {comps.map((c) => <option key={c} value={c}>{g.competitions[Object.keys(g.competitions).find((k) => k.startsWith(c)) ?? '']?.name ?? c}</option>)}
          </select>
        </div>
      )}

      {tab === 'fixtures' && (
        <Card pad={false}>
          {!club || upcoming.filter(matches).length === 0 ? (
            <div className="p-4"><Empty title="No fixtures left this season" body={g.career.retired ? 'Your playing career is over.' : 'The season’s matches are done. Advance to start the next one.'} /></div>
          ) : (
            <ScrollX>
              <table className="tbl">
                <thead><tr><th>Date</th><th>Comp</th><th>Opponent</th><th>When</th></tr></thead>
                <tbody>
                  {upcoming.filter(matches).slice(0, 40).map((f) => {
                    const home = f.homeId === club.id;
                    const opp = g.clubs[home ? f.awayId : f.homeId];
                    const tie = f.compId.startsWith('CUP');
                    return (
                      <tr key={f.id}>
                        <td className="whitespace-nowrap text-ink-300">{weekday(f.day)} {formatShort(f.day)}</td>
                        <td className="text-ink-300">{g.competitions[f.compId]?.short}{tie ? ` · ${f.round}` : f.matchday ? ` · MD${f.matchday}` : ''}</td>
                        <td><span className="mr-1 text-[10px] text-ink-400">{home ? 'H' : 'A'}</span><ClubTag club={opp} size={16} /></td>
                        <td className={clsx('whitespace-nowrap', f.day === g.day ? 'font-semibold text-pitch-400' : 'text-ink-300')}>{inDaysText(f.day - g.day)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          )}
          {g.international.calledUpNow && next?.kind === 'intl' && (
            <div className="border-t border-ink-700 px-4 py-3 text-sm text-ink-200">Your next fixture is for {nationName(g.international.nation)}: {nationName(next.fixture.homeId)} v {nationName(next.fixture.awayId)}, {formatDate(next.fixture.day)}.</div>
          )}
        </Card>
      )}

      {tab === 'results' && (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <span><span className="font-semibold text-pitch-400">{record.w}</span> won</span>
              <span><span className="font-semibold text-ink-50">{record.d}</span> drawn</span>
              <span><span className="font-semibold text-bad-400">{record.l}</span> lost</span>
              {form.length > 0 && <span className="flex items-center gap-2 text-xs text-ink-300">Form <FormPips form={form} /></span>}
              <span className="text-xs text-ink-400">Select a match for its full report.</span>
            </div>
          </Card>
          <Card pad={false}>
            {results.length === 0 ? <div className="p-4"><Empty title="No matches played yet" /></div> : (
              <ScrollX>
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Comp</th><th>Opponent</th><th>Result</th><th className="num">Your rating</th></tr></thead>
                  <tbody>{results.slice(0, 80).map((f) => <FixtureRow key={f.id} g={g} fx={f} clubId={club!.id} onClick={() => setOpen(f.id)} />)}</tbody>
                </table>
              </ScrollX>
            )}
          </Card>
          {intlPlayed.length > 0 && (
            <Card title="International matches" pad={false}>
              <ScrollX>
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Competition</th><th>Match</th><th>Score</th><th className="num">Your rating</th></tr></thead>
                  <tbody>
                    {intlPlayed.map((f) => {
                      const r = g.matchRecords[f.id]?.userSummary?.rating ?? null;
                      return (
                        <tr key={f.id} className="cursor-pointer" onClick={() => setOpen(f.id)}>
                          <td className="whitespace-nowrap text-ink-300">{formatShort(f.day)}</td>
                          <td className="text-ink-300">{g.competitions[f.compId]?.short}</td>
                          <td>{nationName(f.homeId)} v {nationName(f.awayId)}</td>
                          <td className="font-medium text-ink-50">{scoreText(f)}</td>
                          <td className={clsx('num', matchRatingClass(r))}>{r !== null ? r.toFixed(1) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollX>
            </Card>
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <Card pad={false}>
          <ul className="divide-y divide-ink-800">
            {calendar.map((c, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-28 shrink-0 text-ink-300">{weekday(c.day)} {formatShort(c.day)}</span>
                <Chip>{CAL_LABEL[c.kind]}</Chip>
                <span className="text-ink-100">{c.label}</span>
                <span className="ml-auto text-xs text-ink-400">{inDaysText(c.day - g.day)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={!!open} wide title={openFx ? `${nameOf(g, openFx.homeId)} v ${nameOf(g, openFx.awayId)}` : 'Match'} onClose={() => setOpen(null)}>
        {openRec ? <MatchReportView g={g} rec={openRec} /> : openFx?.result ? (
          <div className="text-sm text-ink-200">
            <p className="mb-2 text-lg font-semibold text-ink-50">{nameOf(g, openFx.homeId)} {scoreText(openFx)} {nameOf(g, openFx.awayId)}</p>
            <p>The detailed report for this match is no longer stored. Goals: {openFx.result.scorers.length ? openFx.result.scorers.map((s) => `${s.min}' ${g.players[s.p]?.displayName ?? 'a player'}`).join(', ') : 'none'}.</p>
          </div>
        ) : <Empty title="No report available" />}
      </Modal>
    </>
  );
}

function nameOf(g: ReturnType<typeof useGame>, id: string): string {
  return g.clubs[id]?.name ?? g.nations[id]?.name ?? id;
}
