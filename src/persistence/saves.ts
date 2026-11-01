/**
 * The slot API the rest of the app uses: list, save, load, delete, export and import careers. Every write keeps the previous
 * version of the slot as a backup, and a load that finds the primary damaged falls back to that backup and says so.
 * Writes are queued so two autosaves can never interleave.
 */
import type { GameState } from '../engine/types';
import { SaveError, parseSave, serialize, type ParsedSave, type SaveMeta } from './envelope';
import { allRows, compress, decompress, deleteRow, getRow, isPersistent, putRow, type SaveRow } from './db';

export const MAX_SLOTS = 8;

export interface SlotInfo {
  slot: number;
  meta: SaveMeta | null;
  bytes: number;
  backupMeta: SaveMeta | null;
}

export interface LoadResult extends ParsedSave {
  slot: number;
  usedBackup: boolean;
}

const primaryKey = (slot: number) => `slot:${slot}`;
const backupKey = (slot: number) => `bak:${slot}`;

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

export { isPersistent };

export async function listSlots(): Promise<SlotInfo[]> {
  const rows = await allRows();
  const out: SlotInfo[] = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const p = rows.find((r) => r.key === primaryKey(slot));
    const b = rows.find((r) => r.key === backupKey(slot));
    out.push({ slot, meta: p?.meta ?? null, bytes: p?.bytes ?? 0, backupMeta: b?.meta ?? null });
  }
  return out;
}

export async function firstFreeSlot(): Promise<number | null> {
  const slots = await listSlots();
  return slots.find((s) => !s.meta)?.slot ?? null;
}

/** The slot most recently written, for the "Continue" button. */
export async function latestSlot(): Promise<SlotInfo | null> {
  const slots = (await listSlots()).filter((s) => s.meta);
  slots.sort((a, b) => (b.meta?.savedAt ?? 0) - (a.meta?.savedAt ?? 0));
  return slots[0] ?? null;
}

export function saveToSlot(slot: number, state: GameState): Promise<SaveMeta> {
  if (slot < 1 || slot > MAX_SLOTS) return Promise.reject(new SaveError(`There is no save slot ${slot}.`, 'invalid'));
  return enqueue(async () => {
    const { text, meta } = serialize(state);
    const packed = await compress(text);
    const previous = await getRow(primaryKey(slot));
    if (previous) await putRow({ ...previous, key: backupKey(slot), kind: 'backup' });
    const row: SaveRow = {
      key: primaryKey(slot),
      slot,
      kind: 'primary',
      meta,
      gz: packed.gz,
      data: packed.data,
      bytes: typeof packed.data === 'string' ? packed.data.length : packed.data.byteLength,
      savedAt: meta.savedAt,
    };
    await putRow(row);
    return meta;
  });
}

async function readRow(row: SaveRow): Promise<ParsedSave> {
  return parseSave(await decompress(row));
}

export async function loadSlot(slot: number): Promise<LoadResult> {
  const primary = await getRow(primaryKey(slot));
  if (!primary) throw new SaveError('That slot is empty.', 'invalid');
  try {
    const parsed = await readRow(primary);
    return { ...parsed, slot, usedBackup: false };
  } catch (e) {
    const backup = await getRow(backupKey(slot));
    if (backup) {
      try {
        const parsed = await readRow(backup);
        return { ...parsed, slot, usedBackup: true, warnings: ['The latest save was damaged, so the previous backup was loaded instead.', ...parsed.warnings] };
      } catch { /* fall through to the original error */ }
    }
    throw e instanceof SaveError ? e : new SaveError('The save could not be read.', 'corrupt');
  }
}

export function deleteSlot(slot: number): Promise<void> {
  return enqueue(async () => {
    await deleteRow(primaryKey(slot));
    await deleteRow(backupKey(slot));
  });
}

/** Load the backup copy on purpose (the Settings screen offers this after a bad autosave). */
export async function loadBackup(slot: number): Promise<LoadResult> {
  const backup = await getRow(backupKey(slot));
  if (!backup) throw new SaveError('There is no backup for that slot.', 'invalid');
  const parsed = await readRow(backup);
  return { ...parsed, slot, usedBackup: true };
}

/* ------------------------------------------------------------------ export / import */

export function exportFileName(state: GameState): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const p = state.players[state.userId];
  return `pitchside-${clean(p.displayName) || 'career'}-s${state.season}.json`;
}

export function exportText(state: GameState): { text: string; fileName: string } {
  return { text: serialize(state).text, fileName: exportFileName(state) };
}

/** Validate an imported file's text and store it in a slot (the first free one unless a slot is given). */
export async function importIntoSlot(text: string, slot?: number): Promise<{ slot: number; meta: SaveMeta; warnings: string[]; migratedFrom: number | null }> {
  const parsed = parseSave(text);
  const target = slot ?? (await firstFreeSlot());
  if (target === null) throw new SaveError('All save slots are full. Delete one first, or pick a slot to overwrite.', 'invalid');
  const meta = await saveToSlot(target, parsed.state);
  return { slot: target, meta, warnings: parsed.warnings, migratedFrom: parsed.migratedFrom };
}

/** Pure check used by the import dialog before anything is written. */
export function inspectImport(text: string): { ok: true; meta: SaveMeta; warnings: string[]; migratedFrom: number | null } | { ok: false; message: string } {
  try {
    const p = parseSave(text);
    return { ok: true, meta: p.meta, warnings: p.warnings, migratedFrom: p.migratedFrom };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' };
  }
}

/* ------------------------------------------------------------------ last-used slot */

const LAST_KEY = 'pitchside:lastSlot';
export function rememberSlot(slot: number): void {
  try { localStorage.setItem(LAST_KEY, String(slot)); } catch { /* storage unavailable */ }
}
export function lastSlot(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_KEY));
    return Number.isInteger(v) && v >= 1 && v <= MAX_SLOTS ? v : null;
  } catch { return null; }
}
