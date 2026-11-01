import { useGame, useDerived } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Card, Chip, Empty, PageHeader, Row, ScrollX, Stat } from '../kit';
import { ConditionMeters, FixtureRow, MiniTable, NewsRow, clubFixtures } from '../parts';
import { Portrait } from '../art';
import { clsx, dateWithOffset, formatDate, goodBar, money, ordinal, plural, ratingClass, statAvg, potentialEstimate } from '../format';
import { previewMatch, upcomingFixture } from '../../engine/game';
import { clubLeague } from '../../engine/season';
import { overall, ageAt, ATTR_LABEL, POSITION_LABEL } from '../../engine/attributes';
import { userClub } from '../../engine/util';
import { openOffers, windowInfo } from '../../engine/transfers';
import { yearsLeft } from '../../engine/economy';
import { leagueTable, positionIn } from '../../engine/competitions';
import { pendingUserFixture } from '../../engine/daily';
import { assessRole } from '../../engine/selection';
import { seasonLabel } from '../../engine/dates';
import { readiness } from '../../engine/condition';

function NextMatch() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const advance = useStore((s) => s.advance);
  const busy = useStore((s) => !!s.busy);
  const up = useDerived((gg) => upcomingFixture(gg));
  const pv = useDerived((gg) => (up ? previewMatch(gg, up.pending) : null), [up?.pending.fixture.id]);
  const pending = pendingUserFixture(g);
  if (!up || !pv) {
    return (
      <Card title="Next match">
        <Empty title="No fixture scheduled" body={g.career.retired ? 'Your playing career is over.' : 'There is nothing left to play this season. Skip ahead to the next one.'} action={!g.career.retired ? <button className="btn btn-primary" disabled={busy} onClick={() => void advance('match')}>Skip ahead</button> : undefined} />
      </Card>
    );
  }
  const f = up.pending.fixture;
  const isClub = up.pending.kind === 'club';
  const mySide = pv.userClubSide;
  const strengthTxt = pv.strength[0] && pv.strength[1] ? (() => {
    const my = pv.strength[mySide as 0 | 1]!.overall;
    const their = pv.strength[(1 - (mySide as number)) as 0 | 1]!.overall;
    const d = my - their;
    return d >= 4 ? 'You are clear favourites.' : d >= 1.5 ? 'You are slight favourites.' : d > -1.5 ? 'An even contest.' : d > -4 ? 'The opposition are slight favourites.' : 'You are the underdogs.';
  })() : null;
  return (
    <Card
      title={pending ? 'Match day' : 'Next match'}
      actions={<Chip tone={pending ? 'good' : undefined}>{pending ? 'Today' : dateWithOffset(g, f.day)}</Chip>}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-ink-300">{pv.competition}{pv.round ? ` · ${pv.round}` : ''}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-lg font-semibold text-ink-50">
            <span>{pv.homeName}</span><span className="text-ink-400">v</span><span>{pv.awayName}</span>
          </div>
          {pv.table && <div className="mt-1 text-xs text-ink-300">League positions: {ordinal(pv.table.home)} and {ordinal(pv.table.away)}</div>}
          {strengthTxt && <div className="mt-1 text-xs text-ink-300">{strengthTxt}</div>}
        </div>
        <div className="flex flex-col items-end gap-2">
          {pv.status && (
            <Chip tone={pv.status === 'start' ? 'good' : pv.status === 'bench' ? 'warn' : 'bad'}>
              {pv.status === 'start' ? 'Expected to start' : pv.status === 'bench' ? 'Expected on the bench' : 'Not in the squad'}
            </Chip>
          )}
          {pending ? <button className="btn btn-primary btn-lg" onClick={() => go('matchday')}>Go to match day</button> : <button className="btn" onClick={() => void advance('match')} disabled={busy}>Continue to match</button>}
        </div>
      </div>
      {pv.reasons.length > 0 && isClub && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-ink-300">{pv.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}</ul>
      )}
    </Card>
  );
}

function PlayerCard() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const user = g.players[g.userId];
  const club = userClub(g);
  const age = ageAt(user.birthDay, g.day);
  const est = potentialEstimate(g, user, club?.manager.coaching ?? 12);
  const ovr = Math.round(overall(user));
  return (
    <Card title="Your player" actions={<button className="btn btn-ghost btn-sm" onClick={() => go('player')}>Details</button>}>
      <div className="flex items-center gap-3">
        <Portrait look={user.appearance} kit={club?.crest.primary} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-ink-50">{user.displayName}</div>
          <div className="text-xs text-ink-300">{POSITION_LABEL[user.position]} · age {age}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip>{g.career.squadRole}</Chip>
            {user.injury && <Chip tone="bad">Injured · {user.injury.type} · {user.injury.daysLeft}d</Chip>}
            {user.suspension > 0 && <Chip tone="bad">Suspended · {user.suspension}</Chip>}
            {!user.injury && !user.suspension && <Chip tone="good">Available</Chip>}
          </div>
        </div>
        <div className="text-right">
          <div className={clsx('text-3xl font-bold leading-none', ratingClass(ovr))}>{ovr}</div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">overall</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink-300">
        <span>Coaches' view of your ceiling</span>
        <span className="font-medium text-ink-100">{est.atPeak ? est.label : `${est.label} (${est.lo}–${est.hi})`}</span>
      </div>
      <div className="mt-4"><ConditionMeters p={user} compact /></div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink-300">
        <span>Ready to play</span>
        <span className="font-medium text-ink-100">{Math.round(readiness(user))}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700"><div className={clsx('h-full', goodBar(readiness(user)))} style={{ width: `${readiness(user)}%` }} /></div>
    </Card>
  );
}

function Attention() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const user = g.players[g.userId];
  const offers = openOffers(g);
  const win = windowInfo(g);
  const items: { key: string; tone?: 'good' | 'warn' | 'bad' | 'info'; text: string; action?: { label: string; to: Parameters<typeof go>[0] } }[] = [];
  if (g.career.retired) items.push({ key: 'ret', tone: 'warn', text: 'Your playing career is over.', action: { label: 'See your legacy', to: 'history' } });
  if (!user.clubId && !g.career.retired) items.push({ key: 'fa', tone: 'warn', text: 'You are without a club. Clubs may approach you; your agent can also canvass the market.', action: { label: 'Open transfers', to: 'transfers' } });
  if (offers.length) items.push({ key: 'off', tone: 'good', text: `You have ${plural(offers.length, 'open offer')}.`, action: { label: 'Review', to: 'transfers' } });
  const nDec = g.decisions.filter((d) => d.kind !== 'retirement' && d.kind !== 'free_agent').length;
  if (nDec) items.push({ key: 'dec', tone: 'info', text: `${plural(nDec, 'decision')} waiting for you.`, action: { label: 'Open Life', to: 'life' } });
  if (user.contract && !g.career.retired) {
    const yl = yearsLeft(user.contract, g.day);
    if (yl < 1) items.push({ key: 'con', tone: yl < 0.5 ? 'warn' : 'info', text: `Your contract runs out ${formatDate(user.contract.endDay)} (${Math.max(1, Math.round(yl * 12))} months).`, action: { label: 'Contract talks', to: 'transfers' } });
  }
  if (user.injury) items.push({ key: 'inj', tone: 'bad', text: `${user.injury.type}: about ${user.injury.daysLeft} days to go.`, action: { label: 'Training', to: 'training' } });
  else if (user.cond.fatigue >= 70) items.push({ key: 'fat', tone: 'warn', text: 'You are very tired. Consider lighter training before the next game.', action: { label: 'Training', to: 'training' } });
  if (g.international.calledUpNow) items.push({ key: 'nat', tone: 'good', text: 'You are in the international squad.', action: { label: 'National team', to: 'national' } });
  if (win.open && win.closesIn !== null && win.closesIn <= 7 && !g.career.retired) items.push({ key: 'win', tone: 'info', text: `${win.label} closes in ${plural(win.closesIn, 'day')}.` });
  return (
    <Card title="Needs attention">
      {items.length === 0 ? <p className="text-sm text-ink-300">Nothing urgent. Train, rest and play.</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-start justify-between gap-3 text-sm">
              <span className="flex items-start gap-2"><span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', i.tone === 'good' ? 'bg-pitch-400' : i.tone === 'bad' ? 'bg-bad-400' : i.tone === 'warn' ? 'bg-warn-400' : 'bg-info-400')} /><span className="text-ink-100">{i.text}</span></span>
              {i.action && <button className="btn btn-sm shrink-0" onClick={() => go(i.action!.to)}>{i.action.label}</button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Development() {
  const g = useGame();
  const act = useStore((s) => s.act);
  const changes = g.career.weeklyChange;
  if (!changes.length) return null;
  return (
    <Card title="Development since you last looked" actions={<button className="btn btn-sm" onClick={() => act(() => { g.career.weeklyChange = []; return { ok: true, message: '' }; }, { quiet: true })}>Mark as seen</button>}>
      <ul className="divide-y divide-ink-800">
        {changes.slice(-8).reverse().map((c, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span><span className="font-medium text-ink-50">{ATTR_LABEL[c.attr]}</span> <span className={c.to > c.from ? 'text-pitch-400' : 'text-bad-400'}>{c.from} → {c.to}</span></span>
            <span className="max-w-[60%] text-right text-xs text-ink-300">{c.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Home() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const user = g.players[g.userId];
  const club = userClub(g);
  const league = club ? clubLeague(g, club.id) : undefined;
  const recent = useDerived((gg) => (club ? clubFixtures(gg, club.id).filter((f) => f.played).slice(-5).reverse() : []));
  const role = club ? assessRole(g, club, user, g.day) : null;
  const s = user.stats;
  const apps = (s.league?.apps ?? 0) + (s.cup?.apps ?? 0) + (s.intl?.apps ?? 0);
  const goals = (s.league?.goals ?? 0) + (s.cup?.goals ?? 0) + (s.intl?.goals ?? 0);
  const assists = (s.league?.assists ?? 0) + (s.cup?.assists ?? 0) + (s.intl?.assists ?? 0);
  const rs = (s.league?.ratingSum ?? 0) + (s.cup?.ratingSum ?? 0) + (s.intl?.ratingSum ?? 0);
  const news = g.news.slice(0, 6);
  const table = league ? leagueTable(g, league.id) : [];
  const pos = club && table.some((r) => r.clubId === club.id && r.p > 0) ? positionIn(table, club.id) : null;
  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.displayName}`}
        subtitle={club ? `${club.name} · ${league?.name ?? ''}${pos ? ` · ${ordinal(pos)}` : ''} · season ${seasonLabel(g.season)}` : `Season ${seasonLabel(g.season)}`}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <NextMatch />
          <Development />
          <Card title="This season" actions={<button className="btn btn-ghost btn-sm" onClick={() => go('matches')}>All matches</button>}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Stat label="Appearances" value={apps} sub={`${(s.league?.starts ?? 0) + (s.cup?.starts ?? 0)} starts`} />
              <Stat label="Goals" value={goals} />
              <Stat label="Assists" value={assists} />
              <Stat label="Avg rating" value={statAvg(rs, apps)} />
              <Stat label="Squad role" value={<span className="text-base">{g.career.squadRole}</span>} sub={role ? `#${role.rank} of ${role.competitors} in position` : undefined} />
            </div>
            {recent.length > 0 && club && (
              <ScrollX className="mt-4">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Comp</th><th>Opponent</th><th>Result</th><th className="num">Rating</th></tr></thead>
                  <tbody>{recent.map((f) => <FixtureRow key={f.id} g={g} fx={f} clubId={club.id} />)}</tbody>
                </table>
              </ScrollX>
            )}
          </Card>
          <Card title="Latest news" actions={<button className="btn btn-ghost btn-sm" onClick={() => go('news')}>All news</button>}>
            {news.length ? <ul>{news.map((n) => <NewsRow key={n.id} n={n} />)}</ul> : <p className="text-sm text-ink-300">No news yet.</p>}
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <PlayerCard />
          <Attention />
          {league && club && (
            <Card title={league.name} pad={false} actions={<button className="btn btn-ghost btn-sm" onClick={() => go('competitions')}>Full table</button>}>
              <ScrollX className="px-2 pb-2"><MiniTable g={g} compId={league.id} clubId={club.id} /></ScrollX>
            </Card>
          )}
          <Card title="Money">
            <Row label="Balance">{money(g.finance.balance)}</Row>
            <Row label="Wage">{user.contract ? `${money(user.contract.wage)} a week` : '–'}</Row>
            <Row label="Contract until">{user.contract ? formatDate(user.contract.endDay) : '–'}</Row>
          </Card>
        </div>
      </div>
    </>
  );
}
