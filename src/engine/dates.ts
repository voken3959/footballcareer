/** Calendar math. A "day" is an integer count of days since 2000-01-01 (UTC). The calendar is the single source of dates. */
const EPOCH = Date.UTC(2000, 0, 1);
const MS = 86400000;

export function dayOf(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / MS);
}

export interface YMD { y: number; m: number; d: number; dow: number }

export function dateOf(day: number): YMD {
  const dt = new Date(EPOCH + day * MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

/** 0 = Sunday .. 6 = Saturday */
export function dayOfWeek(day: number): number {
  return (((day + 6) % 7) + 7) % 7;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(day: number, withDow = false): string {
  const { y, m, d, dow } = dateOf(day);
  return `${withDow ? DOW[dow] + ' ' : ''}${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatShort(day: number): string {
  const { m, d } = dateOf(day);
  return `${d} ${MONTHS[m - 1]}`;
}

export function monthName(day: number): string {
  return MONTHS[dateOf(day).m - 1];
}

export const seasonStartDay = (season: number) => dayOf(season, 7, 1);
export const seasonEndDay = (season: number) => dayOf(season + 1, 6, 30);
export const seasonLabel = (season: number) => `${season}/${String((season + 1) % 100).padStart(2, '0')}`;

/** Season (start calendar year) a given day belongs to. */
export function seasonOfDay(day: number): number {
  const { y, m } = dateOf(day);
  return m >= 7 ? y : y - 1;
}
