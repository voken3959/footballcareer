/**
 * The save format. A save is an envelope around the game state: format tag, schema and simulation versions, a checksum, and
 * a small metadata block the menus can show without loading the whole career. Parsing validates structure and references,
 * then runs any migrations needed to bring an older save up to the current schema. Nothing in this file touches the browser,
 * so it is tested directly.
 */
import type { GameState } from '../engine/types';
import { SCHEMA_VERSION, SIM_VERSION } from '../engine/types';
import { ALL_ATTRS, ageAt, overall } from '../engine/attributes';
import { formatDate } from '../engine/dates';

export const SAVE_FORMAT = 'pitchside-save';
export const APP_VERSION = '1.0.0';

export interface SaveMeta {
  careerId: string;
  careerName: string;
  playerName: string;
  position: string;
  age: number;
  overall: number;
  clubName: string;
  season: number;
  dateLabel: string;
  day: number;
  retired: boolean;
  appearances: number;
  goals: number;
  difficulty: string;
  savedAt: number;
}

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  schema: number;
  simVersion: number;
  appVersion: string;
  savedAt: number;
  checksum: string;
  meta: SaveMeta;
  state: GameState;
}

export class SaveError extends Error {
  constructor(message: string, readonly code: 'not_json' | 'wrong_format' | 'newer_version' | 'corrupt' | 'invalid' | 'checksum') {
    super(message);
    this.name = 'SaveError';
  }
}

/** 32-bit FNV-1a over a string. Not cryptographic: it catches truncation and accidental edits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function metaOf(state: GameState, savedAt = Date.now()): SaveMeta {
  const user = state.players[state.userId];
  return {
    careerId: state.id,
    careerName: state.name,
    playerName: user.displayName,
    position: user.position,
    age: ageAt(user.birthDay, state.day),
    overall: Math.round(overall(user)),
    clubName: user.clubId ? state.clubs[user.clubId]?.name ?? '' : state.flags.abroadClub ? String(state.flags.abroadClub) : state.career.retired ? 'Retired' : 'Free agent',
    season: state.season,
    dateLabel: formatDate(state.day),
    day: state.day,
    retired: state.career.retired,
    appearances: state.career.appearances.apps,
    goals: state.career.appearances.goals,
    difficulty: state.settings.difficulty,
    savedAt,
  };
}

/** Serialise to the exact text that is stored and exported. */
export function serialize(state: GameState, savedAt = Date.now()): { text: string; meta: SaveMeta } {
  state.updatedAt = savedAt;
  const stateJson = JSON.stringify(state);
  const meta = metaOf(state, savedAt);
  const text = `{"format":"${SAVE_FORMAT}","schema":${state.schema},"simVersion":${state.simVersion},"appVersion":"${APP_VERSION}","savedAt":${savedAt},"checksum":"${fnv1a(stateJson)}","meta":${JSON.stringify(meta)},"state":${stateJson}}`;
  return { text, meta };
}

/* ------------------------------------------------------------------ validation */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Structural and referential checks. Returns every problem found (empty when the state is sound). */
export function validateState(s: unknown): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) errs.push(msg); };
  if (!isObj(s)) return ['The save does not contain a career.'];
  for (const k of ['players', 'clubs', 'squads', 'competitions', 'fixtures', 'nations', 'matchRecords', 'flags'] as const) need(isObj(s[k]), `Missing section: ${k}.`);
  for (const k of ['calendar', 'history', 'relationships', 'news', 'awards', 'decisions', 'userMatchLog'] as const) need(Array.isArray(s[k]), `Missing list: ${k}.`);
  for (const k of ['day', 'season', 'seed', 'rngState', 'nextId', 'nextNewsId'] as const) need(isNum(s[k]), `Missing number: ${k}.`);
  need(typeof s.userId === 'string', 'Missing player id.');
  for (const k of ['career', 'finance', 'reputation', 'training', 'transfers', 'international', 'settings'] as const) need(isObj(s[k]), `Missing section: ${k}.`);
  if (errs.length) return errs;

  const st = s as unknown as GameState;
  const user = st.players[st.userId];
  need(!!user, 'The player is missing from the save.');
  if (user) {
    need(isObj(user.attrs) && isObj(user.cond), 'The player has no attributes.');
    if (isObj(user.attrs)) {
      for (const k of ALL_ATTRS) {
        const v = (user.attrs as unknown as Record<string, number>)[k];
        if (!isNum(v) || v < 0 || v > 100) { errs.push(`Attribute ${k} is invalid.`); break; }
      }
    }
    need(isNum(user.potential) && user.potential >= 1 && user.potential <= 100, 'The player potential is invalid.');
    need(user.clubId === null || !!st.clubs[user.clubId as string], 'The player belongs to a club that does not exist.');
  }
  for (const [clubId, ids] of Object.entries(st.squads)) {
    if (!st.clubs[clubId]) { errs.push(`A squad belongs to an unknown club (${clubId}).`); break; }
    if (!Array.isArray(ids) || ids.some((id) => !st.players[id])) { errs.push(`The squad of ${st.clubs[clubId].name} lists a player who does not exist.`); break; }
  }
  for (const f of Object.values(st.fixtures)) {
    if (!st.competitions[f.compId]) { errs.push('A fixture belongs to an unknown competition.'); break; }
  }
  for (const c of Object.values(st.competitions)) {
    if (c.fixtureIds.some((id) => !st.fixtures[id])) { errs.push(`Competition ${c.name} lists a fixture that does not exist.`); break; }
  }
  need(isNum(st.finance.balance) && Array.isArray(st.finance.ledger) && Array.isArray(st.finance.purchases) && Array.isArray(st.finance.investments), 'The finances are damaged.');
  need(Array.isArray(st.transfers.offers) && isObj(st.transfers.agent), 'The transfer state is damaged.');
  for (const k of ['professional', 'fans', 'media', 'club', 'national'] as const) need(isNum(st.reputation[k]), `Reputation ${k} is invalid.`);
  need(isNum(st.career.highestOverall) && Array.isArray(st.career.seasons), 'The career history is damaged.');
  // simple sanity on money: a balance that is not a finite number would poison every later calculation
  need(Math.abs(st.finance.balance) < 1e13, 'The balance is out of range.');
  return errs;
}

/* ------------------------------------------------------------------ migrations */

type Raw = Record<string, any>;

/**
 * Each entry upgrades a state from schema `n` to `n + 1`. Schema 0 is the shape written by development builds before the
 * life and retirement systems existed; migrating it fills in everything those systems need.
 */
export const MIGRATIONS: Record<number, (s: Raw) => void> = {
  0: (s) => {
    s.finance ??= {};
    s.finance.sponsorships ??= [];
    s.finance.paidBonusKeys ??= [];
    s.finance.housing ??= 'home_family';
    s.career ??= {};
    s.career.legacy ??= null;
    s.career.retirementDecision ??= null;
    s.transfers ??= {};
    s.transfers.marketNews ??= [];
    s.transfers.scoutReports ??= [];
    s.transfers.rumours ??= [];
    s.transfers.history ??= [];
    s.lifeEventDay ??= (s.day ?? 0) + 24;
    s.flags ??= {};
    s.userMatchLog ??= [];
    s.decisions ??= [];
    s.settings ??= {};
    const d = { difficulty: 'standard', commentarySpeed: 1, sound: true, volume: 0.6, reducedMotion: false, largeText: false, highContrast: false, autosave: true, simPreference: 'ask' };
    for (const [k, v] of Object.entries(d)) s.settings[k] ??= v;
    s.international ??= {};
    s.international.callUps ??= [];
    for (const c of Object.values<Raw>(s.clubs ?? {})) {
      c.signingsThisWindow ??= 0;
      c.lastLineup ??= [];
    }
  },
};

export function migrate(raw: Raw, fromSchema: number): GameState {
  if (fromSchema > SCHEMA_VERSION) {
    throw new SaveError(`This save was made by a newer version of the game (schema ${fromSchema}). Update the game to open it.`, 'newer_version');
  }
  let v = fromSchema;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new SaveError(`No upgrade path from save version ${v}.`, 'invalid');
    step(raw);
    v++;
  }
  raw.schema = SCHEMA_VERSION;
  return raw as unknown as GameState;
}

/* ------------------------------------------------------------------ parsing */

export interface ParsedSave {
  state: GameState;
  meta: SaveMeta;
  migratedFrom: number | null;
  warnings: string[];
}

/** Parse, verify and upgrade save text. Throws SaveError with a message safe to show to the player. */
export function parseSave(text: string): ParsedSave {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new SaveError('That file is not valid JSON, so it cannot be a save.', 'not_json'); }
  if (!isObj(obj) || obj.format !== SAVE_FORMAT) throw new SaveError('That file is not a Pitchside save.', 'wrong_format');
  if (!isNum(obj.schema)) throw new SaveError('The save has no version number.', 'corrupt');
  if (!isObj(obj.state)) throw new SaveError('The save has no career inside it.', 'corrupt');
  const warnings: string[] = [];
  const check = typeof obj.checksum === 'string' ? obj.checksum : null;
  if (check) {
    const actual = fnv1a(JSON.stringify(obj.state));
    if (actual !== check) throw new SaveError('The save failed its integrity check: it has been edited or damaged.', 'checksum');
  } else warnings.push('The save has no checksum, so its integrity could not be checked.');
  const fromSchema = obj.schema;
  const state = migrate(obj.state as Raw, fromSchema);
  const errs = validateState(state);
  if (errs.length) throw new SaveError(`The save is not usable: ${errs.slice(0, 3).join(' ')}`, 'invalid');
  if (typeof obj.simVersion === 'number' && obj.simVersion !== SIM_VERSION) warnings.push('This save was made with a different simulation version; results from here on may differ from the original.');
  return { state, meta: metaOf(state, typeof obj.savedAt === 'number' ? obj.savedAt : Date.now()), migratedFrom: fromSchema < SCHEMA_VERSION ? fromSchema : null, warnings };
}
