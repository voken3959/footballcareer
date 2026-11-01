/**
 * IndexedDB storage for saves. Rows hold gzip-compressed save text where the browser can compress, plain text otherwise.
 * When IndexedDB is unavailable (some private modes) an in-memory store keeps the session working and `isPersistent()`
 * reports false so the interface can warn the player to export their career.
 */
import type { SaveMeta } from './envelope';

const DB_NAME = 'pitchside';
const DB_VERSION = 1;
const STORE = 'saves';

export interface SaveRow {
  key: string; // slot:N | bak:N
  slot: number;
  kind: 'primary' | 'backup';
  meta: SaveMeta;
  gz: boolean;
  data: Uint8Array | string;
  bytes: number;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let memory: Map<string, SaveRow> | null = null;

function hasIdb(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

export function isPersistent(): boolean {
  return hasIdb() && memory === null;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the save database.'));
      req.onblocked = () => reject(new Error('The save database is blocked by another tab.'));
    } catch (e) { reject(e); }
  });
  return dbPromise;
}

async function useMemory(): Promise<Map<string, SaveRow>> {
  if (!memory) memory = new Map();
  return memory;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Database request failed.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Database transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Database transaction aborted (the browser may be out of space).'));
  });
  const value = await wrap(fn(tx.objectStore(STORE)));
  await done;
  return value;
}

export async function putRow(row: SaveRow): Promise<void> {
  if (!hasIdb() || memory) { (await useMemory()).set(row.key, row); return; }
  try { await withStore('readwrite', (s) => s.put(row)); } catch (e) {
    if (!memory && (e as Error)?.name !== 'QuotaExceededError') { memory = new Map(); memory.set(row.key, row); return; }
    throw e;
  }
}

export async function getRow(key: string): Promise<SaveRow | undefined> {
  if (!hasIdb() || memory) return (await useMemory()).get(key);
  try { return (await withStore('readonly', (s) => s.get(key))) as SaveRow | undefined; } catch { return undefined; }
}

export async function deleteRow(key: string): Promise<void> {
  if (!hasIdb() || memory) { (await useMemory()).delete(key); return; }
  await withStore('readwrite', (s) => s.delete(key));
}

export async function allRows(): Promise<SaveRow[]> {
  if (!hasIdb() || memory) return [...(await useMemory()).values()];
  try { return (await withStore('readonly', (s) => s.getAll())) as SaveRow[]; } catch { return []; }
}

/** Close the connection and forget it (also used by tests so a fresh database can be created). */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  memory = null;
  if (pending) {
    try { (await pending).close(); } catch { /* it never opened */ }
  }
}

/** Test helper: close the connection and delete the whole database. */
export async function resetDbForTests(): Promise<void> {
  await closeDb();
  if (!hasIdb()) return;
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
    r.onblocked = () => resolve();
  });
}

/* ------------------------------------------------------------------ compression */

export async function compress(text: string): Promise<{ gz: boolean; data: Uint8Array | string }> {
  try {
    if (typeof CompressionStream === 'undefined') return { gz: false, data: text };
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    void writer.write(new TextEncoder().encode(text));
    void writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return { gz: true, data: new Uint8Array(buf) };
  } catch {
    return { gz: false, data: text };
  }
}

export async function decompress(row: Pick<SaveRow, 'gz' | 'data'>): Promise<string> {
  if (!row.gz) return row.data as string;
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(new Uint8Array(row.data as Uint8Array));
  void writer.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}
