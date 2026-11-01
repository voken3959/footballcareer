import type { AttrKey, Injury, InjurySeverity, Player } from './types';
import { Rng, clamp } from './rng';

/** Fictional game events, not medical advice. */
export interface InjuryType {
  name: string;
  severity: InjurySeverity;
  days: [number, number];
  weight: number;
  /** permanent physical setback (attribute points) applied on a long injury */
  setbacks?: { attrs: AttrKey[]; points: [number, number] };
}

export const INJURY_TYPES: InjuryType[] = [
  { name: 'Minor knock', severity: 'minor', days: [1, 6], weight: 38 },
  { name: 'Bruised calf', severity: 'minor', days: [3, 9], weight: 14 },
  { name: 'Muscle strain', severity: 'moderate', days: [8, 22], weight: 16 },
  { name: 'Ankle sprain', severity: 'moderate', days: [10, 30], weight: 12 },
  { name: 'Groin strain', severity: 'moderate', days: [12, 32], weight: 6 },
  { name: 'Hamstring injury', severity: 'moderate', days: [16, 45], weight: 10 },
  { name: 'Torn hamstring', severity: 'serious', days: [45, 90], weight: 2.2, setbacks: { attrs: ['acceleration', 'sprintSpeed'], points: [1, 2] } },
  { name: 'Fractured metatarsal', severity: 'serious', days: [60, 100], weight: 1.2 },
  { name: 'Knee ligament injury', severity: 'major', days: [110, 260], weight: 1.5, setbacks: { attrs: ['acceleration', 'sprintSpeed', 'agility'], points: [1, 3] } },
];

export const SEVERITY_LABEL: Record<InjurySeverity, string> = {
  minor: 'Minor', moderate: 'Moderate', serious: 'Serious', major: 'Major',
};

/** Pick an injury type. `contact` scales the chance of a long-term problem (training injuries skew minor). */
export function rollInjuryType(rng: Rng, source: 'match' | 'training', p?: Pick<Player, 'injuryProne'>): InjuryType {
  const w = INJURY_TYPES.map((t) => {
    let x = t.weight;
    if (source === 'training' && (t.severity === 'serious' || t.severity === 'major')) x *= 0.3;
    if (p && (t.severity === 'serious' || t.severity === 'major')) x *= p.injuryProne;
    return x;
  });
  return rng.weighted(INJURY_TYPES, w);
}

export function makeInjury(rng: Rng, type: InjuryType, day: number, source: 'match' | 'training', physio = 1): Injury {
  const raw = rng.int(type.days[0], type.days[1]);
  const days = Math.max(1, Math.round(raw / clamp(physio, 0.8, 1.25)));
  return { type: type.name, severity: type.severity, startDay: day, daysTotal: days, daysLeft: days, source };
}

/** Hazard per player-minute in a match. Baseline ~1.25% per player per 90 minutes. */
export function matchInjuryHazard(p: Pick<Player, 'injuryProne' | 'attrs'>, energy: number, fatigueStart: number, factor = 1): number {
  const base = 0.0125 / 90;
  const fit = 1 + (60 - p.attrs.naturalFitness) / 200;
  return base * factor * p.injuryProne * fit * (1 + 1.1 * (fatigueStart / 100)) * (1 + 0.9 * (1 - energy));
}

export function injuryByName(name: string): InjuryType | undefined {
  return INJURY_TYPES.find((t) => t.name === name);
}
