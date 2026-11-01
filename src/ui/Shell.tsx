import { useMemo, useState, type ReactNode } from 'react';
import { useStore, type ScreenId } from '../store/store';
import { useGame } from '../store/hooks';
import { Crest } from './art';
import { Chip, Modal } from './kit';
import { clsx, formatDate, money, plural, seasonLabel, weekday } from './format';
import { pendingUserFixture } from '../engine/daily';
import { upcomingFixture, resolveDecision } from '../engine/game';
import { windowInfo, openOffers } from '../engine/transfers';
import { overall } from '../engine/attributes';
import { userClub } from '../engine/util';
import type { PendingDecision } from '../engine/types';

const ICONS: Record<string, string> = {
  home: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z',
  player: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9c0-4 4-6 8-6s8 2 8 6z',
  matches: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5 4 3-1.5 5h-5L8 11z',
  club: 'M4 4h16v9c0 4-4 7-8 8-4-1-8-4-8-8z',
  training: 'M3 10h2v4H3zm3-2h2v8H6zm3 3h6v2H9zm7-3h2v8h-2zm3 2h2v4h-2z',
  transfers: 'M7 7h11l-3-3 1.4-1.4L22 8l-5.6 5.4L15 12l3-3H7zm10 10H6l3 3-1.4 1.4L2 16l5.6-5.4L9 12l-3 3h11z',
  competitions: 'M7 4h10v3a5 5 0 0 1-3 4.6V14h3v2H7v-2h3v-2.4A5 5 0 0 1 7 7zM4 5h2v2a2 2 0 0 1-2-2zm14 0h2a2 2 0 0 1-2 2zM8 18h8v2H8z',
  national: 'M5 3h2v18H5zm3 1h11l-2 4 2 4H8z',
  life: 'M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zm15 3h1v9a2 2 0 0 1-2 2h-1V8zM7 8h7v2H7zm0 4h7v2H7z',
  history: 'M12 4a8 8 0 1 1-7.5 5.3L2.6 8.6 6 6l2.4 3.4-1.8-.6A6 6 0 1 0 12 6zm-1 3h2v5l3 1.6-1 1.7-4-2.3z',
  settings: 'M4 6h10v2H4zm12-1.5h4v5h-4zM4 11h4v2H4zm6-1.5h10v5H10zM4 16h10v2H4zm12-1.5h4v5h-4z',
};

function Icon({ id, className }: { id: string; className?: string }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden className={className}><path d={ICONS[id]} /></svg>;
}

export const NAV: { id: ScreenId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'player', label: 'My Player' },
  { id: 'matches', label: 'Matches' },
  { id: 'club', label: 'Club' },
  { id: 'training', label: 'Training' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'competitions', label: 'Competitions' },
  { id: 'national', label: 'National Team' },
  { id: 'life', label: 'Life' },
  { id: 'news', label: 'News' },
  { id: 'history', label: 'Career History' },
  { id: 'settings', label: 'Settings' },
];

function useBadges(): Partial<Record<ScreenId, number>> {
  const g = useGame();
  return {
    transfers: openOffers(g).length,
    life: g.decisions.filter((d) => d.kind !== 'retirement' && d.kind !== 'free_agent').length,
    news: g.news.filter((n) => !n.read && n.important).length,
  };
}

function SaveIndicator() {
  const save = useStore((s) => s.save);
  const persistent = useStore((s) => s.persistent);
  const saveNow = useStore((s) => s.saveNow);
  const text = save.status === 'saving' ? 'Saving…' : save.status === 'error' ? 'Save failed' : save.status === 'saved' ? 'Saved' : 'Not saved yet';
  return (
    <button
      className={clsx('btn btn-ghost btn-sm gap-1.5', save.status === 'error' && 'text-bad-400')}
      onClick={() => void saveNow('manual')}
      title={save.error ?? (persistent ? 'Save now' : 'Browser storage is unavailable: export your career to keep it')}
    >
      <span className={clsx('h-2 w-2 rounded-full', save.status === 'error' ? 'bg-bad-400' : save.status === 'saving' ? 'bg-warn-400' : persistent ? 'bg-pitch-400' : 'bg-warn-400')} />
      {text}
    </button>
  );
}

function AdvanceBar() {
  const g = useGame();
  const advance = useStore((s) => s.advance);
  const busy = useStore((s) => !!s.busy);
  const go = useStore((s) => s.go);
  const screen = useStore((s) => s.screen);
  if (g.career.retired) return <button className="btn btn-primary btn-sm" onClick={() => go('history')}>View legacy</button>;
  const pending = pendingUserFixture(g);
  const up = upcomingFixture(g);
  if (pending) {
    return (
      <button className="btn btn-primary" onClick={() => go('matchday')} disabled={screen === 'matchday'}>Match day · play</button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button className="btn btn-primary" disabled={busy} onClick={() => void advance('match')}>
        {up ? `Continue to match` : 'Skip ahead'}
      </button>
      <button className="btn btn-sm hidden sm:inline-flex" disabled={busy} onClick={() => void advance('day')}>+1 day</button>
      <button className="btn btn-sm hidden sm:inline-flex" disabled={busy} onClick={() => void advance('week')}>+1 week</button>
      <button className="btn btn-sm hidden md:inline-flex" disabled={busy} onClick={() => void advance('month')}>+1 month</button>
    </div>
  );
}

function TopBar() {
  const g = useGame();
  const club = userClub(g);
  const user = g.players[g.userId];
  const quit = useStore((s) => s.quitToMenu);
  const ask = useStore((s) => s.ask);
  const win = windowInfo(g);
  const abroad = typeof g.flags.abroadClub === 'string' ? g.flags.abroadClub : null;
  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-700 bg-ink-900/95 px-4 py-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        {club ? <Crest crest={club.crest} size={26} title={club.name} /> : <div className="h-6 w-6 rounded bg-ink-700" />}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-50">{club?.name ?? abroad ?? (g.career.retired ? 'Retired' : 'Free agent')}</div>
          <div className="truncate text-xs text-ink-300">
            {weekday(g.day)} {formatDate(g.day)} · {seasonLabel(g.season)}
          </div>
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          <Chip>{user.position}</Chip>
          <Chip tone="good">OVR {Math.round(overall(user))}</Chip>
          {user.injury && <Chip tone="bad">Injured · {user.injury.daysLeft}d</Chip>}
          {user.suspension > 0 && <Chip tone="bad">Suspended</Chip>}
          <Chip tone={win.open ? 'good' : undefined} title={win.open ? `Closes in ${win.closesIn} days` : `Opens in ${win.opensIn} days`}>{win.label}</Chip>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden text-xs text-ink-300 lg:inline">Balance <span className="font-semibold text-ink-50">{money(g.finance.balance)}</span></span>
        <SaveIndicator />
        <AdvanceBar />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => ask({ title: 'Return to the main menu?', body: 'Your career is saved first. You can continue from the menu at any time.', confirmLabel: 'Save and quit', onConfirm: () => void quit() })}
        >
          Menu
        </button>
      </div>
    </header>
  );
}

function SideNav() {
  const screen = useStore((s) => s.screen);
  const go = useStore((s) => s.go);
  const badges = useBadges();
  return (
    <nav aria-label="Main" className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-ink-700 bg-ink-900 p-3 lg:flex">
      <div className="mb-3 flex items-center gap-2 px-2 text-base font-bold tracking-tight text-ink-50">
        <svg width="22" height="22" viewBox="0 0 40 40" aria-hidden><rect width="40" height="40" rx="9" fill="#064e3b" /><circle cx="20" cy="20" r="10" fill="none" stroke="#34d399" strokeWidth="2.5" /><path d="M20 10v20M10 20h20" stroke="#34d399" strokeWidth="2.5" /></svg>
        Pitchside
      </div>
      {NAV.map((n) => (
        <button key={n.id} className="nav-item" aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
          <Icon id={n.id} />
          <span className="flex-1">{n.label}</span>
          {!!badges[n.id] && <span className="rounded-full bg-pitch-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{badges[n.id]}</span>}
        </button>
      ))}
    </nav>
  );
}

function BottomNav() {
  const screen = useStore((s) => s.screen);
  const go = useStore((s) => s.go);
  const badges = useBadges();
  const [more, setMore] = useState(false);
  const main = NAV.slice(0, 4);
  const rest = NAV.slice(4);
  const inMore = rest.some((n) => n.id === screen);
  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink-700 bg-ink-900/98 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {main.map((n) => (
          <button key={n.id} aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)} className={clsx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', screen === n.id ? 'text-pitch-400' : 'text-ink-300')}>
            <Icon id={n.id} />{n.label}
          </button>
        ))}
        <button onClick={() => setMore(true)} className={clsx('relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', inMore ? 'text-pitch-400' : 'text-ink-300')}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>More
          {(badges.transfers ?? 0) + (badges.life ?? 0) > 0 && <span className="absolute right-4 top-1 h-2 w-2 rounded-full bg-pitch-500" />}
        </button>
      </nav>
      <Modal open={more} title="Go to" onClose={() => setMore(false)}>
        <div className="grid grid-cols-2 gap-2">
          {rest.map((n) => (
            <button key={n.id} className="nav-item border border-ink-700" aria-current={screen === n.id ? 'page' : undefined} onClick={() => { go(n.id); setMore(false); }}>
              <Icon id={n.id} /><span className="flex-1">{n.label}</span>
              {!!badges[n.id] && <span className="rounded-full bg-pitch-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{badges[n.id]}</span>}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- decisions and season review */

export function DecisionHost() {
  const g = useGame();
  const act = useStore((s) => s.act);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const current: PendingDecision | undefined = useMemo(
    () => g.decisions.find((d) => (d.kind === 'retirement' || d.kind === 'free_agent' || !dismissed.has(d.id))),
    [g.decisions, dismissed],
  );
  if (!current || g.career.retired) return null;
  const blocking = current.kind === 'retirement' || current.kind === 'free_agent';
  return (
    <Modal
      open
      locked={blocking}
      title={current.title}
      onClose={() => setDismissed((s) => new Set(s).add(current.id))}
      footer={!blocking ? <button className="btn" onClick={() => setDismissed((s) => new Set(s).add(current.id))}>Decide later</button> : undefined}
    >
      <p className="mb-4 whitespace-pre-line text-sm text-ink-200">{current.body}</p>
      {current.expiresDay !== null && <p className="mb-3 text-xs text-warn-400">Answer by {formatDate(current.expiresDay)}.</p>}
      <div className="flex flex-col gap-2">
        {current.options.map((o) => (
          <button key={o.id} className="btn flex-col items-start gap-0.5 py-2.5 text-left" onClick={() => act((gg) => resolveDecision(gg, current.id, o.id))}>
            <span className="font-semibold">{o.label}</span>
            {o.detail && <span className="text-xs font-normal text-ink-300">{o.detail}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function SeasonReview() {
  const g = useGame();
  const open = useStore((s) => s.seasonReview);
  const close = useStore((s) => s.closeSeasonReview);
  const go = useStore((s) => s.go);
  const s = g.lastSeasonSummary;
  if (!open || !s) return null;
  const name = (id: string | null) => (id ? g.clubs[id]?.name ?? id : '–');
  return (
    <Modal
      open
      wide
      title={`Season ${seasonLabel(s.season)} review`}
      onClose={close}
      footer={<><button className="btn" onClick={() => { close(); go('history'); }}>Career history</button><button className="btn btn-primary" onClick={close}>On to {seasonLabel(s.season + 1)}</button></>}
    >
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div><div className="stat-label">{s.leagueName}</div><div className="text-ink-50">{s.leaguePos ? `Finished ${s.leaguePos}${s.promoted ? ' · promoted' : s.relegated ? ' · relegated' : ''}` : 'Did not play in the league'}</div></div>
        <div><div className="stat-label">Champions</div><div className="text-ink-50">{name(s.champion)}</div></div>
        <div><div className="stat-label">Cup winners</div><div className="text-ink-50">{name(s.cupWinner)}</div></div>
        <div><div className="stat-label">Your season</div><div className="text-ink-50">{plural(s.apps, 'app')}, {plural(s.goals, 'goal')}, {plural(s.assists, 'assist')}{s.apps ? ` · avg ${s.avgRating.toFixed(2)}` : ''}</div></div>
        <div><div className="stat-label">Overall change</div><div className={clsx('font-semibold', s.ovrChange > 0 ? 'text-pitch-400' : s.ovrChange < 0 ? 'text-bad-400' : 'text-ink-50')}>{s.ovrChange > 0 ? '+' : ''}{s.ovrChange}</div></div>
      </div>
      {s.userLines.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-200">{s.userLines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- shell */

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 lg:pb-8 lg:px-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
        <BottomNav />
      </div>
      <DecisionHost />
      <SeasonReview />
    </div>
  );
}
