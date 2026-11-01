import { useMemo, useState } from 'react';
import { useDerived, useGame } from '../../store/hooks';
import { Card, Chip, Empty, PageHeader, ScrollX, Segmented } from '../kit';
import { ClubTag, FormPips, scoreText } from '../parts';
import { clsx, formatDate, formatShort, seasonLabel } from '../format';
import { clubCupStage, competitionFixtures, leagueTable } from '../../engine/competitions';
import { cupOf, leagueOf, LEAGUE_TEMPLATES } from '../../engine/season';
import { userClub } from '../../engine/util';
import type { Competition, CupTie, GameState } from '../../engine/types';

type View = 'L1' | 'L2' | 'CUP' | 'history';

const PROMOTED = 3;
const RELEGATED = 3;

export function Competitions() {
  const g = useGame();
  const club = userClub(g);
  const home = club ? (club.leagueId as View) : 'L1';
  const [view, setView] = useState<View>(home === 'L2' ? 'L2' : 'L1');
  const seasons = useMemo(
    () => [...new Set(Object.values(g.competitions).filter((c) => c.type === 'league').map((c) => c.season))].sort((a, b) => b - a),
    [g.competitions, g.season, g.day], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [season, setSeason] = useState<number>(g.season);
  const shown = seasons.includes(season) ? season : g.season;

  return (
    <>
      <PageHeader
        title="Competitions"
        subtitle={`${seasonLabel(shown)} · tables, the cup and past winners`}
        actions={seasons.length > 1 && view !== 'history' ? (
          <>
            <label htmlFor="season-sel" className="text-xs text-ink-300">Season</label>
            <select id="season-sel" className="field !w-auto py-1" value={shown} onChange={(e) => setSeason(Number(e.target.value))}>
              {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
            </select>
          </>
        ) : undefined}
      />
      <div className="mb-4">
        <Segmented<View> label="Competition" value={view} onChange={setView} options={[
          ...LEAGUE_TEMPLATES.map((t) => ({ id: t.id as View, label: t.name })),
          { id: 'CUP', label: 'National Cup' },
          { id: 'history', label: 'Past winners' },
        ]} />
      </div>
      {(view === 'L1' || view === 'L2') && <League template={view} season={shown} />}
      {view === 'CUP' && <Cup season={shown} />}
      {view === 'history' && <History />}
    </>
  );
}

/* ----------------------------------------------------------------- leagues */

function League({ template, season }: { template: 'L1' | 'L2'; season: number }) {
  const g = useGame();
  const club = userClub(g);
  const comp = leagueOf(g, template, season);
  const table = useDerived((s) => (comp ? leagueTable(s, comp.id) : []), [comp?.id]);
  const scorers = useDerived((s) => (comp ? topScorers(s, comp) : []), [comp?.id]);
  const assists = useDerived((s) => (comp && comp.season === s.season ? topAssists(s, comp) : []), [comp?.id]);
  if (!comp) return <Empty title="No table for this season" body="That season is no longer held in the save." />;
  const n = table.length;
  const level = comp.level;
  const done = comp.completed;
  const played = table[0]?.p ?? 0;
  const fixtures = competitionFixtures(g, comp.id);
  const nextDay = fixtures.filter((f) => !f.played).reduce<number | null>((m, f) => (m === null || f.day < m ? f.day : m), null);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <Card
        title={comp.name}
        pad={false}
        actions={done ? <Chip tone="good">Complete</Chip> : <Chip>{played} of {Math.max(0, (n - 1) * 2)} played{nextDay !== null ? ` · next ${formatShort(nextDay)}` : ''}</Chip>}
      >
        <ScrollX>
          <table className="tbl">
            <thead>
              <tr><th className="w-8">#</th><th>Club</th><th className="num">P</th><th className="num">W</th><th className="num">D</th><th className="num">L</th><th className="num">GF</th><th className="num">GA</th><th className="num">GD</th><th className="num">Pts</th><th>Form</th></tr>
            </thead>
            <tbody>
              {table.map((r, i) => {
                const pos = i + 1;
                const promo = level === 2 && pos <= PROMOTED;
                const rel = level === 1 && pos > n - RELEGATED;
                return (
                  <tr key={r.clubId} className={r.clubId === club?.id ? 'me' : ''}>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-ink-300">
                        <span className={clsx('h-3 w-1 rounded-sm', promo ? 'bg-pitch-500' : rel ? 'bg-bad-500' : pos === 1 && level === 1 ? 'bg-warn-400' : 'bg-transparent')} aria-hidden />
                        {pos}
                      </span>
                    </td>
                    <td><ClubTag club={g.clubs[r.clubId]} size={16} bold={r.clubId === club?.id} /></td>
                    <td className="num">{r.p}</td>
                    <td className="num">{r.w}</td>
                    <td className="num">{r.d}</td>
                    <td className="num">{r.l}</td>
                    <td className="num">{r.gf}</td>
                    <td className="num">{r.ga}</td>
                    <td className="num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="num font-semibold text-ink-50">{r.pts}</td>
                    <td><FormPips form={r.form} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
        <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-800 px-4 py-2 text-xs text-ink-400">
          {level === 1 && <><span><span className="mr-1 inline-block h-2.5 w-1 rounded-sm bg-warn-400 align-middle" />Champions</span><span><span className="mr-1 inline-block h-2.5 w-1 rounded-sm bg-bad-500 align-middle" />Relegation ({RELEGATED} go down)</span></>}
          {level === 2 && <span><span className="mr-1 inline-block h-2.5 w-1 rounded-sm bg-pitch-500 align-middle" />Promotion ({PROMOTED} go up)</span>}
          <span>Ties on points are split by goal difference, then goals scored.</span>
        </p>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Top scorers" pad={false}>
          {scorers.length === 0 ? <div className="p-4"><Empty title="No goals yet" /></div> : (
            <table className="tbl">
              <tbody>
                {scorers.map((s, i) => (
                  <tr key={s.id} className={s.id === g.userId ? 'me' : ''}>
                    <td className="w-6 text-ink-400">{i + 1}</td>
                    <td><span className="block truncate">{g.players[s.id]?.displayName ?? 'Unknown'}</span><span className="block text-[11px] text-ink-400">{g.clubs[s.clubId]?.shortName}</span></td>
                    <td className="num font-semibold text-ink-50">{s.goals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {assists.length > 0 && (
          <Card title="Most assists" pad={false}>
            <table className="tbl">
              <tbody>
                {assists.map((s, i) => (
                  <tr key={s.id} className={s.id === g.userId ? 'me' : ''}>
                    <td className="w-6 text-ink-400">{i + 1}</td>
                    <td><span className="block truncate">{g.players[s.id]?.displayName}</span><span className="block text-[11px] text-ink-400">{g.clubs[s.clubId]?.shortName}</span></td>
                    <td className="num font-semibold text-ink-50">{s.assists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        {comp.winnerId && (
          <Card title="Champions"><ClubTag club={g.clubs[comp.winnerId]} size={22} bold /></Card>
        )}
      </div>
    </div>
  );
}

function topScorers(g: GameState, comp: Competition): { id: string; clubId: string; goals: number }[] {
  const tally = new Map<string, { clubId: string; goals: number }>();
  for (const f of competitionFixtures(g, comp.id)) {
    if (!f.result) continue;
    for (const s of f.result.scorers) {
      if (s.og) continue;
      const clubId = s.side === 0 ? f.homeId : f.awayId;
      const t = tally.get(s.p) ?? { clubId, goals: 0 };
      t.goals++;
      tally.set(s.p, t);
    }
  }
  return [...tally.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.goals - a.goals).slice(0, 10);
}

function topAssists(g: GameState, comp: Competition): { id: string; clubId: string; assists: number }[] {
  const out: { id: string; clubId: string; assists: number }[] = [];
  for (const clubId of comp.clubIds) {
    for (const id of g.squads[clubId] ?? []) {
      const a = g.players[id]?.stats.league?.assists ?? 0;
      if (a > 0) out.push({ id, clubId, assists: a });
    }
  }
  return out.sort((a, b) => b.assists - a.assists).slice(0, 8);
}

/* --------------------------------------------------------------------- cup */

function Cup({ season }: { season: number }) {
  const g = useGame();
  const club = userClub(g);
  const cup = cupOf(g, season);
  if (!cup || !cup.rounds) return <Empty title="No cup for this season" />;
  const mine = club ? clubCupStage(cup, club.id) : null;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink-200">{cup.format}</p>
            {cup.winnerId && <p className="mt-1 text-sm text-ink-100">Winners: <span className="font-semibold">{g.clubs[cup.winnerId]?.name}</span>{cup.runnerUpId ? ` (beat ${g.clubs[cup.runnerUpId]?.name})` : ''}</p>}
          </div>
          {mine && <Chip tone={mine === 'Winner' ? 'good' : mine.startsWith('Out') ? 'bad' : 'info'}>Your club: {mine}</Chip>}
        </div>
      </Card>
      {cup.rounds.map((r) => (
        <Card key={r.name} title={r.name} pad={false} actions={<Chip tone={r.completed ? 'good' : undefined}>{r.completed ? 'Played' : r.drawn ? `Played ${formatShort(r.day)}` : `Draw before ${formatShort(r.day)}`}</Chip>}>
          {r.ties.length === 0 ? <p className="p-4 text-sm text-ink-300">The draw has not been made yet.</p> : (
            <ul className="grid divide-y divide-ink-800 sm:grid-cols-2 sm:divide-y-0">
              {r.ties.map((t) => <TieRow key={t.id} tie={t} userClubId={club?.id} />)}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

function TieRow({ tie, userClubId }: { tie: CupTie; userClubId?: string }) {
  const g = useGame();
  const a = g.clubs[tie.a];
  const b = tie.b ? g.clubs[tie.b] : null;
  const mine = tie.a === userClubId || tie.b === userClubId;
  const fixtures = tie.fixtureIds.map((id) => g.fixtures[id]).filter(Boolean);
  const scores = fixtures.filter((f) => f.played).map((f) => scoreText(f)).join(' · ');
  const when = fixtures.find((f) => !f.played)?.day;
  return (
    <li className={clsx('flex items-center justify-between gap-3 border-ink-800 px-4 py-2 text-sm sm:border-b', mine && 'bg-pitch-900/30')}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <ClubTag club={a} size={16} bold={tie.winner === tie.a} className={clsx(tie.winner && tie.winner !== tie.a && 'text-ink-400')} />
        {b ? <ClubTag club={b} size={16} bold={tie.winner === tie.b} className={clsx(tie.winner && tie.winner !== tie.b && 'text-ink-400')} /> : <span className="text-xs text-ink-400">Bye</span>}
      </span>
      <span className="shrink-0 text-right text-xs text-ink-300">
        {b ? (scores || (when ? formatDate(when) : 'To be played')) : 'Through'}
        {tie.agg && fixtures.length > 1 && <span className="block text-ink-400">Agg {tie.agg[0]}–{tie.agg[1]}</span>}
        {tie.decidedBy && !['normal', 'bye'].includes(tie.decidedBy) && <span className="block text-ink-400">{tie.decidedBy === 'penalties' ? 'On penalties' : tie.decidedBy === 'extraTime' ? 'After extra time' : 'On aggregate'}</span>}
      </span>
    </li>
  );
}

/* ----------------------------------------------------------------- history */

function History() {
  const g = useGame();
  const bySeason = useMemo(() => {
    const m = new Map<number, typeof g.history>();
    for (const h of g.history) m.set(h.season, [...(m.get(h.season) ?? []), h]);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [g.history]);
  const titles = useMemo(() => {
    const t = new Map<string, number>();
    for (const h of g.history) if (h.compId.startsWith('L1')) t.set(h.winnerId, (t.get(h.winnerId) ?? 0) + 1);
    return [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [g.history]);
  const club = userClub(g);
  if (bySeason.length === 0) return <Empty title="No completed seasons yet" body="Winners are recorded when each season ends." />;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <Card title="Winners by season" pad={false}>
        <ScrollX>
          <table className="tbl">
            <thead><tr><th>Season</th><th>Competition</th><th>Winner</th><th>Runner-up</th></tr></thead>
            <tbody>
              {bySeason.flatMap(([season, rows]) => rows.map((h, i) => (
                <tr key={`${season}-${h.compId}`} className={h.winnerId === club?.id ? 'me' : ''}>
                  <td className="text-ink-300">{i === 0 ? seasonLabel(season) : ''}</td>
                  <td>{h.name}</td>
                  <td><ClubTag club={g.clubs[h.winnerId]} size={16} bold /></td>
                  <td>{h.runnerUpId ? <ClubTag club={g.clubs[h.runnerUpId]} size={16} /> : '–'}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </ScrollX>
      </Card>
      <Card title="Most Elite Division titles">
        {titles.length === 0 ? <p className="text-sm text-ink-300">No champions yet.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {titles.map(([id, n]) => <li key={id} className="flex items-center justify-between"><ClubTag club={g.clubs[id]} size={16} /><span className="font-semibold text-ink-50">{n}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
