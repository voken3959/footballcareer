import type { Crest } from './types';

export interface ClubSeed { name: string; short: string; place: string }

export const DIVISION_1: ClubSeed[] = [
  { name: 'Northgate United', short: 'NGU', place: 'Northgate' },
  { name: 'Harbourside Rovers', short: 'HBR', place: 'Harbourside' },
  { name: 'Kingsmere City', short: 'KMC', place: 'Kingsmere' },
  { name: 'Ashford Athletic', short: 'ASH', place: 'Ashford' },
  { name: 'Redcliffe Town', short: 'RCT', place: 'Redcliffe' },
  { name: 'Marlowe Wanderers', short: 'MLW', place: 'Marlowe' },
  { name: 'Stonebridge FC', short: 'STB', place: 'Stonebridge' },
  { name: 'Eastvale Albion', short: 'EVA', place: 'Eastvale' },
  { name: 'Thornbury Rangers', short: 'THB', place: 'Thornbury' },
  { name: 'Westhaven Park', short: 'WHP', place: 'Westhaven' },
  { name: 'Ironbridge Works', short: 'IBW', place: 'Ironbridge' },
  { name: 'Cresthill County', short: 'CHC', place: 'Cresthill' },
  { name: 'Bayfield Borough', short: 'BFB', place: 'Bayfield' },
  { name: 'Lakeshire Forest', short: 'LKF', place: 'Lakeshire' },
  { name: 'Oakhurst Dynamo', short: 'OAK', place: 'Oakhurst' },
  { name: 'Southmoor Vale', short: 'SMV', place: 'Southmoor' },
];

export const DIVISION_2: ClubSeed[] = [
  { name: 'Pennyfield Town', short: 'PNF', place: 'Pennyfield' },
  { name: 'Dunmore Athletic', short: 'DUN', place: 'Dunmore' },
  { name: 'Carrick Vale', short: 'CRV', place: 'Carrick' },
  { name: 'Brightwater FC', short: 'BRW', place: 'Brightwater' },
  { name: 'Hollowby United', short: 'HLB', place: 'Hollowby' },
  { name: 'Fenwick Rovers', short: 'FNW', place: 'Fenwick' },
  { name: 'Quarry Bank FC', short: 'QRB', place: 'Quarry Bank' },
  { name: 'Wexcombe City', short: 'WXC', place: 'Wexcombe' },
  { name: 'Alderley Park', short: 'ALD', place: 'Alderley' },
  { name: 'Tidemouth Town', short: 'TDM', place: 'Tidemouth' },
  { name: 'Greyfriars Athletic', short: 'GRF', place: 'Greyfriars' },
  { name: 'Saltmarsh United', short: 'SLT', place: 'Saltmarsh' },
  { name: 'Moorlands FC', short: 'MOR', place: 'Moorlands' },
  { name: 'Stanhope Albion', short: 'STN', place: 'Stanhope' },
  { name: 'Rookwood Rangers', short: 'RKW', place: 'Rookwood' },
  { name: 'Pinehurst County', short: 'PIN', place: 'Pinehurst' },
];

export const STADIUM_SUFFIX = ['Park', 'Road', 'Lane', 'Ground', 'Stadium', 'Arena', 'Gardens'];

export const CREST_COLOURS: [string, string][] = [
  ['#7a1f2b', '#e8d9a8'], ['#1f3f7a', '#f2f2f2'], ['#1f6b4a', '#f2f2f2'], ['#c9a227', '#1a1a1a'],
  ['#2b2b2b', '#e0e0e0'], ['#8a3b12', '#f0e0c0'], ['#3a2a6b', '#e6e0f5'], ['#0f6b78', '#f5f5f5'],
  ['#a31c1c', '#f5f5f5'], ['#2c4a1e', '#d8c26a'], ['#1b4f9c', '#f5c542'], ['#6b6b6b', '#c8102e'],
];

export function makeCrest(short: string, idx: number, rngPattern: number, rngShape: number): Crest {
  const [primary, secondary] = CREST_COLOURS[idx % CREST_COLOURS.length];
  return { primary, secondary, shape: rngShape, initials: short.slice(0, 3), pattern: rngPattern };
}
