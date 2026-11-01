import { useMemo } from 'react';
import type { GameState } from '../engine/types';
import { getGame, useStore } from './store';

/** Subscribe to the career: the calling component re-renders whenever the engine changes anything. */
export function useGame(): GameState {
  useStore((s) => s.rev);
  return getGame();
}

/** A value derived from the career, recomputed only when the career changes or `deps` do. */
export function useDerived<T>(fn: (g: GameState) => T, deps: readonly unknown[] = []): T {
  const rev = useStore((s) => s.rev);
  const game = useStore((s) => s.game);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(game as GameState), [rev, game, ...deps]);
}

export const useAct = () => useStore((s) => s.act);
export const useGo = () => useStore((s) => s.go);
export const useToast = () => useStore((s) => s.toast);
export const useAsk = () => useStore((s) => s.ask);
