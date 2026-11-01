import type { FormationId, Position } from './types';

export interface Slot {
  pos: Position;
  /** own-perspective pitch coordinates: x towards the opponent goal (0..1), y 0 = left touchline, 1 = right */
  x: number;
  y: number;
  line: 'gk' | 'def' | 'mid' | 'att';
}

export interface Formation {
  id: FormationId;
  name: string;
  slots: Slot[];
}

const S = (pos: Position, x: number, y: number, line: Slot['line']): Slot => ({ pos, x, y, line });
const GK = S('GK', 0.04, 0.5, 'gk');

export const FORMATIONS: Record<FormationId, Formation> = {
  '442': {
    id: '442', name: '4-4-2',
    slots: [GK, S('RB', 0.24, 0.85, 'def'), S('CB', 0.2, 0.62, 'def'), S('CB', 0.2, 0.38, 'def'), S('LB', 0.24, 0.15, 'def'),
      S('RW', 0.5, 0.88, 'mid'), S('CM', 0.46, 0.62, 'mid'), S('CM', 0.46, 0.38, 'mid'), S('LW', 0.5, 0.12, 'mid'),
      S('ST', 0.78, 0.6, 'att'), S('ST', 0.78, 0.4, 'att')],
  },
  '433': {
    id: '433', name: '4-3-3',
    slots: [GK, S('RB', 0.24, 0.85, 'def'), S('CB', 0.2, 0.62, 'def'), S('CB', 0.2, 0.38, 'def'), S('LB', 0.24, 0.15, 'def'),
      S('DM', 0.4, 0.5, 'mid'), S('CM', 0.52, 0.68, 'mid'), S('CM', 0.52, 0.32, 'mid'),
      S('RW', 0.78, 0.86, 'att'), S('ST', 0.86, 0.5, 'att'), S('LW', 0.78, 0.14, 'att')],
  },
  '4231': {
    id: '4231', name: '4-2-3-1',
    slots: [GK, S('RB', 0.24, 0.85, 'def'), S('CB', 0.2, 0.62, 'def'), S('CB', 0.2, 0.38, 'def'), S('LB', 0.24, 0.15, 'def'),
      S('DM', 0.4, 0.62, 'mid'), S('DM', 0.4, 0.38, 'mid'),
      S('RW', 0.68, 0.86, 'att'), S('AM', 0.66, 0.5, 'att'), S('LW', 0.68, 0.14, 'att'), S('ST', 0.86, 0.5, 'att')],
  },
  '352': {
    id: '352', name: '3-5-2',
    slots: [GK, S('CB', 0.2, 0.75, 'def'), S('CB', 0.18, 0.5, 'def'), S('CB', 0.2, 0.25, 'def'),
      S('RB', 0.46, 0.93, 'mid'), S('CM', 0.5, 0.64, 'mid'), S('DM', 0.4, 0.5, 'mid'), S('CM', 0.5, 0.36, 'mid'), S('LB', 0.46, 0.07, 'mid'),
      S('ST', 0.8, 0.6, 'att'), S('ST', 0.8, 0.4, 'att')],
  },
  '532': {
    id: '532', name: '5-3-2',
    slots: [GK, S('RB', 0.32, 0.92, 'def'), S('CB', 0.2, 0.7, 'def'), S('CB', 0.18, 0.5, 'def'), S('CB', 0.2, 0.3, 'def'), S('LB', 0.32, 0.08, 'def'),
      S('CM', 0.48, 0.68, 'mid'), S('DM', 0.42, 0.5, 'mid'), S('CM', 0.48, 0.32, 'mid'),
      S('ST', 0.8, 0.6, 'att'), S('ST', 0.8, 0.4, 'att')],
  },
  '4141': {
    id: '4141', name: '4-1-4-1',
    slots: [GK, S('RB', 0.24, 0.85, 'def'), S('CB', 0.2, 0.62, 'def'), S('CB', 0.2, 0.38, 'def'), S('LB', 0.24, 0.15, 'def'),
      S('DM', 0.38, 0.5, 'mid'), S('RW', 0.6, 0.86, 'mid'), S('CM', 0.56, 0.62, 'mid'), S('CM', 0.56, 0.38, 'mid'), S('LW', 0.6, 0.14, 'mid'),
      S('ST', 0.86, 0.5, 'att')],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];
export const formationOf = (id: FormationId) => FORMATIONS[id];

export interface StyleParams {
  press: number; // 0..1 how aggressively the ball is contested high up
  directness: number; // 0..1 preference for long/progressive balls
  width: number; // 0..1 use of the flanks
  tempo: number; // 0..1
  counter: number; // 0..1 speed of transitions
  risk: number; // 0..1
  possession: number; // 0..1 patience in possession
  label: string;
  blurb: string;
}

export const STYLES: Record<string, StyleParams> = {
  possession: { press: 0.55, directness: 0.2, width: 0.45, tempo: 0.4, counter: 0.3, risk: 0.35, possession: 0.9, label: 'Possession football', blurb: 'Patient build-up, short passing, controls the tempo.' },
  direct: { press: 0.4, directness: 0.85, width: 0.55, tempo: 0.7, counter: 0.5, risk: 0.55, possession: 0.3, label: 'Direct football', blurb: 'Long balls, early crosses and second-ball pressure.' },
  counter: { press: 0.35, directness: 0.6, width: 0.5, tempo: 0.8, counter: 0.95, risk: 0.5, possession: 0.35, label: 'Counterattacking', blurb: 'Absorbs pressure, then breaks at speed.' },
  highPress: { press: 0.95, directness: 0.5, width: 0.55, tempo: 0.85, counter: 0.7, risk: 0.65, possession: 0.6, label: 'High pressing', blurb: 'Hunts the ball high up the pitch. Demanding on stamina.' },
  lowBlock: { press: 0.15, directness: 0.6, width: 0.4, tempo: 0.5, counter: 0.7, risk: 0.2, possession: 0.25, label: 'Low block', blurb: 'Deep, compact and hard to break down.' },
  balanced: { press: 0.5, directness: 0.45, width: 0.5, tempo: 0.55, counter: 0.5, risk: 0.45, possession: 0.55, label: 'Balanced approach', blurb: 'Flexible shape with no extreme tendencies.' },
};

export const LINE_PARAMS = {
  high: { x: 0.022, offsideTrap: 0.45, spaceBehind: 1.12 },
  normal: { x: 0, offsideTrap: 0.25, spaceBehind: 1.0 },
  deep: { x: -0.018, offsideTrap: 0.1, spaceBehind: 0.9 },
} as const;
