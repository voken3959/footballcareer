import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { useStore, type ScreenId } from './store/store';
import { Menu } from './ui/screens/Menu';
import { Shell } from './ui/Shell';
import { ConfirmHost, ToastHost, BusyOverlay, Spinner } from './ui/kit';
import { ErrorBoundary } from './ui/ErrorBoundary';

// each screen is its own chunk, so the first paint only needs the menu and the shell
const Wizard = lazy(() => import('./ui/screens/Wizard').then((m) => ({ default: m.Wizard })));
const Home = lazy(() => import('./ui/screens/Home').then((m) => ({ default: m.Home })));
const MatchDay = lazy(() => import('./ui/screens/MatchDay').then((m) => ({ default: m.MatchDay })));
const LiveMatch = lazy(() => import('./ui/screens/LiveMatch').then((m) => ({ default: m.LiveMatch })));
const MyPlayer = lazy(() => import('./ui/screens/MyPlayer').then((m) => ({ default: m.MyPlayer })));
const Matches = lazy(() => import('./ui/screens/Matches').then((m) => ({ default: m.Matches })));
const Club = lazy(() => import('./ui/screens/Club').then((m) => ({ default: m.Club })));
const Training = lazy(() => import('./ui/screens/Training').then((m) => ({ default: m.Training })));
const Transfers = lazy(() => import('./ui/screens/Transfers').then((m) => ({ default: m.Transfers })));
const Competitions = lazy(() => import('./ui/screens/Competitions').then((m) => ({ default: m.Competitions })));
const NationalTeam = lazy(() => import('./ui/screens/NationalTeam').then((m) => ({ default: m.NationalTeam })));
const Life = lazy(() => import('./ui/screens/Life').then((m) => ({ default: m.Life })));
const News = lazy(() => import('./ui/screens/News').then((m) => ({ default: m.News })));
const CareerHistory = lazy(() => import('./ui/screens/CareerHistory').then((m) => ({ default: m.CareerHistory })));
const Settings = lazy(() => import('./ui/screens/Settings').then((m) => ({ default: m.Settings })));

const SCREENS: Partial<Record<ScreenId, ComponentType>> = {
  home: Home,
  matchday: MatchDay,
  player: MyPlayer,
  matches: Matches,
  club: Club,
  training: Training,
  transfers: Transfers,
  competitions: Competitions,
  national: NationalTeam,
  life: Life,
  news: News,
  history: CareerHistory,
  settings: Settings,
};

function useRootAttributes() {
  // the game state is mutated in place, so subscribe to the plain values: a selector that returns the settings object itself
  // would never see a change and the switches would only take effect after a reload
  const large = useStore((s) => !!s.game?.settings.largeText);
  const contrast = useStore((s) => !!s.game?.settings.highContrast);
  const reduced = useStore((s) => !!s.game?.settings.reducedMotion);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.large = String(large);
    el.dataset.contrast = contrast ? 'high' : 'normal';
    el.dataset.motion = reduced ? 'reduced' : 'normal';
  }, [large, contrast, reduced]);
}

/** Save when the tab is hidden or closed so a career is never more than a few seconds behind. */
function useFlushOnLeave() {
  const saveNow = useStore((s) => s.saveNow);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && useStore.getState().game) void saveNow('hidden'); };
    const onUnload = () => { if (useStore.getState().game) void saveNow('unload'); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onUnload); };
  }, [saveNow]);
}

export function App() {
  const view = useStore((s) => s.view);
  const game = useStore((s) => s.game);
  const screen = useStore((s) => s.screen);
  const session = useStore((s) => s.session);
  useRootAttributes();
  useFlushOnLeave();

  let body: React.ReactNode;
  if (view === 'wizard') body = <Wizard />;
  else if (view === 'menu' || !game) body = <Menu />;
  else if (screen === 'live' && session) {
    body = <ErrorBoundary resetKey="live"><LiveMatch /></ErrorBoundary>;
  } else {
    const Screen = SCREENS[screen] ?? Home;
    body = (
      <Shell>
        <ErrorBoundary resetKey={`${screen}`}><Screen /></ErrorBoundary>
      </Shell>
    );
  }

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[80] focus:rounded focus:bg-pitch-600 focus:px-3 focus:py-2 focus:text-white">Skip to main content</a>
      <div className="h-full overflow-y-auto">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-ink-300" role="status" aria-label="Loading"><Spinner className="h-6 w-6" /></div>}>{body}</Suspense>
      </div>
      <ConfirmHost />
      <ToastHost />
      <BusyOverlay />
    </>
  );
}
