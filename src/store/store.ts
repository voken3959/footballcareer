/**
 * The application store. The career itself (a large mutable GameState) lives outside React state: engine actions mutate it in
 * place and bump `rev`, and components re-read it when `rev` changes. This avoids cloning an 8 MB object on every action.
 */
import { create } from 'zustand';
import type { GameState, MatchRecord } from '../engine/types';
import { createCareer, type NewCareerOptions } from '../engine/career';
import { advanceDays, advanceToNextMatch, playUserMatch, type AdvanceResult, type PlayMode } from '../engine/game';
import { formatDate } from '../engine/dates';
import type { ActionResult } from '../engine/transfers';
import {
  deleteSlot as dbDeleteSlot, exportText, firstFreeSlot, importIntoSlot, isPersistent, lastSlot, listSlots, loadSlot as dbLoadSlot,
  loadBackup, rememberSlot, saveToSlot, type SlotInfo,
} from '../persistence/saves';

export type ScreenId =
  | 'home' | 'player' | 'matches' | 'club' | 'training' | 'transfers' | 'competitions' | 'national' | 'life' | 'news' | 'history'
  | 'settings' | 'matchday' | 'live';

export type AppView = 'menu' | 'wizard' | 'game';

export interface Toast { id: number; kind: 'ok' | 'err' | 'info'; text: string }

export interface MatchSession {
  record: MatchRecord;
  kind: 'club' | 'intl';
  devRecord: MatchRecord | null;
  mode: PlayMode;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Store {
  view: AppView;
  game: GameState | null;
  rev: number;
  slot: number | null;
  screen: ScreenId;
  params: Record<string, string>;
  busy: { label: string; detail?: string } | null;
  toasts: Toast[];
  save: { status: SaveStatus; at: number | null; error: string | null };
  persistent: boolean;
  session: MatchSession | null;
  confirm: ConfirmRequest | null;
  seasonReview: boolean;
  slots: SlotInfo[];
  lastAdvance: AdvanceResult | null;
  bootError: string | null;

  // navigation
  setView: (v: AppView) => void;
  go: (screen: ScreenId, params?: Record<string, string>) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  ask: (c: ConfirmRequest | null) => void;
  closeSeasonReview: () => void;

  // careers and saves
  refreshSlots: () => Promise<void>;
  newCareer: (o: NewCareerOptions, slot: number) => Promise<boolean>;
  loadCareer: (slot: number, backup?: boolean) => Promise<boolean>;
  continueLast: () => Promise<boolean>;
  saveNow: (why?: string) => Promise<boolean>;
  scheduleSave: () => void;
  deleteSlot: (slot: number) => Promise<void>;
  exportCareer: () => void;
  importCareer: (text: string, slot?: number) => Promise<boolean>;
  quitToMenu: () => Promise<void>;

  // play
  act: <T extends ActionResult>(fn: (g: GameState) => T, opts?: { quiet?: boolean; save?: boolean }) => T | null;
  touch: (save?: boolean) => void;
  advance: (kind: 'day' | 'week' | 'month' | 'match') => Promise<void>;
  playMatch: (mode: PlayMode) => void;
  finishMatch: () => void;
}

let toastId = 1;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export const useStore = create<Store>((set, get) => ({
  view: 'menu',
  game: null,
  rev: 0,
  slot: null,
  screen: 'home',
  params: {},
  busy: null,
  toasts: [],
  save: { status: 'idle', at: null, error: null },
  persistent: true,
  session: null,
  confirm: null,
  seasonReview: false,
  slots: [],
  lastAdvance: null,
  bootError: null,

  setView: (view) => set({ view }),
  go: (screen, params = {}) => {
    set({ screen, params });
    try { window.scrollTo({ top: 0 }); document.getElementById('main')?.scrollTo({ top: 0 }); } catch { /* no window */ }
  },
  toast: (kind, text) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'err' ? 8000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (confirm) => set({ confirm }),
  closeSeasonReview: () => set({ seasonReview: false }),

  /* ------------------------------------------------------------ careers and saves */

  refreshSlots: async () => {
    try { set({ slots: await listSlots(), persistent: isPersistent() }); } catch (e) { set({ bootError: e instanceof Error ? e.message : 'Could not read saves.' }); }
  },

  newCareer: async (o, slot) => {
    set({ busy: { label: 'Creating your career', detail: 'Building the world, the clubs and your footballer…' } });
    await tick();
    try {
      const game = createCareer(o);
      set({ game, rev: 1, slot, view: 'game', screen: 'home', params: {}, session: null, lastAdvance: null, seasonReview: false });
      rememberSlot(slot);
      await get().saveNow('new career');
      set({ busy: null });
      get().toast('ok', `Career started. Welcome to ${game.clubs[game.players[game.userId].clubId as string].name}.`);
      return true;
    } catch (e) {
      console.error(e);
      set({ busy: null });
      get().toast('err', `Could not create the career: ${e instanceof Error ? e.message : 'unknown error'}`);
      return false;
    }
  },

  loadCareer: async (slot, backup = false) => {
    set({ busy: { label: 'Loading career' } });
    await tick();
    try {
      const r = backup ? await loadBackup(slot) : await dbLoadSlot(slot);
      set({ game: r.state, rev: 1, slot, view: 'game', screen: 'home', params: {}, session: null, lastAdvance: null, seasonReview: false, busy: null });
      rememberSlot(slot);
      for (const w of r.warnings) get().toast('info', w);
      if (r.migratedFrom !== null) get().toast('info', `Save upgraded from version ${r.migratedFrom}.`);
      return true;
    } catch (e) {
      set({ busy: null });
      get().toast('err', e instanceof Error ? e.message : 'The save could not be loaded.');
      return false;
    }
  },

  continueLast: async () => {
    await get().refreshSlots();
    const slots = get().slots.filter((s) => s.meta);
    const remembered = lastSlot();
    const pick = slots.find((s) => s.slot === remembered) ?? [...slots].sort((a, b) => (b.meta?.savedAt ?? 0) - (a.meta?.savedAt ?? 0))[0];
    if (!pick) { get().toast('info', 'There is no saved career yet.'); return false; }
    return get().loadCareer(pick.slot);
  },

  saveNow: async () => {
    const { game, slot } = get();
    if (!game || slot === null) return false;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    set((s) => ({ save: { ...s.save, status: 'saving', error: null } }));
    try {
      const meta = await saveToSlot(slot, game);
      set({ save: { status: 'saved', at: meta.savedAt, error: null }, persistent: isPersistent() });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Saving failed.';
      set((s) => ({ save: { ...s.save, status: 'error', error: msg } }));
      get().toast('err', `Could not save: ${msg} Export your career from Settings to keep a copy.`);
      return false;
    }
  },

  scheduleSave: () => {
    const { game } = get();
    if (!game || !game.settings.autosave) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void get().saveNow('autosave'); }, 1500);
  },

  deleteSlot: async (slot) => {
    await dbDeleteSlot(slot);
    await get().refreshSlots();
  },

  exportCareer: () => {
    const { game } = get();
    if (!game) return;
    try {
      const { text, fileName } = exportText(game);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      get().toast('ok', `Exported ${fileName}`);
    } catch (e) {
      get().toast('err', `Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  },

  importCareer: async (text, slot) => {
    try {
      const target = slot ?? (await firstFreeSlot()) ?? undefined;
      const r = await importIntoSlot(text, target);
      await get().refreshSlots();
      get().toast('ok', `Imported ${r.meta.playerName} into slot ${r.slot}.`);
      for (const w of r.warnings) get().toast('info', w);
      return true;
    } catch (e) {
      get().toast('err', e instanceof Error ? e.message : 'Import failed.');
      return false;
    }
  },

  quitToMenu: async () => {
    if (get().game) await get().saveNow('quit');
    set({ game: null, view: 'menu', slot: null, session: null, screen: 'home', params: {} });
    await get().refreshSlots();
  },

  /* ------------------------------------------------------------ play */

  touch: (save = true) => {
    set((s) => ({ rev: s.rev + 1 }));
    if (save) get().scheduleSave();
  },

  act: (fn, opts = {}) => {
    const { game } = get();
    if (!game) return null;
    try {
      const r = fn(game);
      get().touch(opts.save !== false && r.ok);
      if (!opts.quiet && r.message) get().toast(r.ok ? 'ok' : 'err', r.message);
      return r;
    } catch (e) {
      console.error(e);
      get().touch(false);
      get().toast('err', `Something went wrong: ${e instanceof Error ? e.message : 'unknown error'}`);
      return null;
    }
  },

  advance: async (kind) => {
    const { game, busy, session } = get();
    if (!game || busy || session) return;
    if (game.career.retired) { get().toast('info', 'Your playing career is over. See Career History for your legacy.'); return; }
    const label = kind === 'day' ? 'Advancing one day' : kind === 'week' ? 'Advancing a week' : kind === 'month' ? 'Advancing a month' : 'Advancing to your next match';
    set({ busy: { label, detail: formatDate(game.day) } });
    await tick();
    let total = 0;
    let last: AdvanceResult | null = null;
    let rolled = false;
    const goal = kind === 'day' ? 1 : kind === 'week' ? 7 : kind === 'month' ? 30 : 400;
    try {
      while (total < goal) {
        const chunk = Math.min(kind === 'match' ? 5 : 4, goal - total);
        const r = kind === 'match' ? advanceToNextMatch(game, chunk) : advanceDays(game, chunk);
        total += r.days;
        rolled = rolled || r.rolled;
        last = r;
        if (r.stop !== 'target') break;
        set({ busy: { label, detail: formatDate(game.day) } });
        await tick();
      }
    } catch (e) {
      console.error(e);
      get().toast('err', `The simulation hit a problem and stopped: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    set({ busy: null, lastAdvance: last });
    get().touch(false);
    if (rolled) set({ seasonReview: true });
    if (last) {
      if (last.stop === 'match') get().toast('info', last.message);
      else if (last.stop === 'offer') get().toast('info', 'You have a new offer. See Transfers.');
      else if (last.stop === 'retired') get().toast('info', last.message);
      else if (last.stop === 'decision') get().toast('info', last.message);
    }
    await get().saveNow('advance');
  },

  playMatch: (mode) => {
    const { game } = get();
    if (!game) return;
    try {
      const r = playUserMatch(game, mode);
      if (!r) { get().toast('err', 'There is no match to play today.'); get().touch(false); return; }
      set({ session: { record: r.record, kind: r.kind, devRecord: r.devRecord, mode }, screen: 'live', params: {} });
      get().touch(false);
      void get().saveNow('match');
    } catch (e) {
      console.error(e);
      get().touch(false);
      get().toast('err', `The match could not be played: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  },

  finishMatch: () => {
    set({ session: null, screen: 'home', params: {} });
    get().touch(true);
  },
}));

/** The live career. Components call this after subscribing to `rev` through `useGame`. */
export const getGame = (): GameState => {
  const g = useStore.getState().game;
  if (!g) throw new Error('No career is loaded.');
  return g;
};
