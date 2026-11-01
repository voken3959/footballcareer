import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCareer, defaultOptions } from '../src/engine/career';
import { advanceToNextMatch, playUserMatch } from '../src/engine/game';
import type { GameState } from '../src/engine/types';
import { SCHEMA_VERSION } from '../src/engine/types';
import { SAVE_FORMAT, SaveError, fnv1a, parseSave, serialize, validateState } from '../src/persistence/envelope';
import { putRow, getRow, resetDbForTests } from '../src/persistence/db';
import {
  MAX_SLOTS, deleteSlot, exportText, importIntoSlot, inspectImport, listSlots, loadBackup, loadSlot, saveToSlot,
} from '../src/persistence/saves';

let base: GameState;

function play(state: GameState, matches: number): void {
  for (let i = 0; i < matches; i++) {
    const r = advanceToNextMatch(state);
    if (r.stop === 'match') playUserMatch(state, 'instant');
    else if (r.stop === 'retired') break;
  }
}

beforeAll(() => {
  const o = defaultOptions(777);
  base = createCareer(o);
  play(base, 4);
}, 120000);

beforeEach(async () => {
  await resetDbForTests();
});

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

describe('save envelope', () => {
  it('round-trips a career byte-for-byte', () => {
    const { text } = serialize(clone(base));
    const parsed = parseSave(text);
    expect(JSON.stringify(parsed.state)).toBe(JSON.stringify(JSON.parse(text).state));
    expect(parsed.migratedFrom).toBeNull();
    expect(parsed.meta.playerName).toBe(base.players[base.userId].displayName);
  });

  it('continues the simulation identically after a save and load', () => {
    const a = clone(base);
    const b = parseSave(serialize(clone(base)).text).state;
    play(a, 6);
    play(b, 6);
    expect(b.day).toBe(a.day);
    expect(b.rngState).toBe(a.rngState);
    expect(b.career.appearances).toEqual(a.career.appearances);
    expect(b.finance.balance).toBe(a.finance.balance);
    expect(JSON.stringify(b.players[b.userId].attrs)).toBe(JSON.stringify(a.players[a.userId].attrs));
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseSave('not json at all')).toThrowError(SaveError);
    try { parseSave('{{{'); } catch (e) { expect((e as SaveError).code).toBe('not_json'); }
  });

  it('rejects JSON that is not a Pitchside save', () => {
    try { parseSave('{"hello":"world"}'); expect.unreachable(); } catch (e) { expect((e as SaveError).code).toBe('wrong_format'); }
  });

  it('detects tampering through the checksum', () => {
    const obj = JSON.parse(serialize(clone(base)).text);
    obj.state.finance.balance += 1_000_000;
    try { parseSave(JSON.stringify(obj)); expect.unreachable(); } catch (e) { expect((e as SaveError).code).toBe('checksum'); }
  });

  it('detects truncation', () => {
    const { text } = serialize(clone(base));
    expect(() => parseSave(text.slice(0, text.length - 500))).toThrowError(SaveError);
  });

  it('refuses a save from a newer schema with a clear message', () => {
    const obj = JSON.parse(serialize(clone(base)).text);
    obj.schema = SCHEMA_VERSION + 1;
    try { parseSave(JSON.stringify(obj)); expect.unreachable(); } catch (e) {
      expect((e as SaveError).code).toBe('newer_version');
      expect((e as SaveError).message).toMatch(/newer version/);
    }
  });

  it('validates references: a squad naming a missing player is refused', () => {
    const s = clone(base);
    const clubId = Object.keys(s.squads)[0];
    s.squads[clubId].push('p_missing');
    expect(validateState(s).join(' ')).toMatch(/does not exist/);
    const stateJson = JSON.stringify(s);
    const env = { format: SAVE_FORMAT, schema: s.schema, simVersion: s.simVersion, savedAt: 1, checksum: fnv1a(stateJson), meta: {}, state: s };
    try { parseSave(JSON.stringify(env)); expect.unreachable(); } catch (e) { expect((e as SaveError).code).toBe('invalid'); }
  });

  it('validates attribute ranges', () => {
    const s = clone(base);
    (s.players[s.userId].attrs as unknown as Record<string, number>).finishing = 140;
    expect(validateState(s).join(' ')).toMatch(/Attribute finishing/);
  });

  it('migrates a schema 0 save by filling in the later systems', () => {
    const old = clone(base) as any;
    old.schema = 0;
    delete old.finance.sponsorships;
    delete old.career.legacy;
    delete old.lifeEventDay;
    delete old.settings.autosave;
    delete old.settings.simPreference;
    for (const c of Object.values<any>(old.clubs)) delete c.signingsThisWindow;
    const env = { format: SAVE_FORMAT, schema: 0, simVersion: old.simVersion, savedAt: 5, checksum: fnv1a(JSON.stringify(old)), meta: {}, state: old };
    const parsed = parseSave(JSON.stringify(env));
    expect(parsed.migratedFrom).toBe(0);
    expect(parsed.state.schema).toBe(SCHEMA_VERSION);
    expect(parsed.state.finance.sponsorships).toEqual([]);
    expect(parsed.state.career.legacy).toBeNull();
    expect(parsed.state.settings.autosave).toBe(true);
    expect(typeof parsed.state.lifeEventDay).toBe('number');
    // and the migrated career still plays
    play(parsed.state, 2);
    expect(parsed.state.day).toBeGreaterThan(base.day);
  });
});

describe('slots', () => {
  it('starts empty and lists every slot', async () => {
    const slots = await listSlots();
    expect(slots).toHaveLength(MAX_SLOTS);
    expect(slots.every((s) => s.meta === null)).toBe(true);
  });

  it('saves, lists and loads a career, with compression', async () => {
    const meta = await saveToSlot(2, clone(base));
    const slots = await listSlots();
    expect(slots[1].meta?.playerName).toBe(meta.playerName);
    expect(slots[1].bytes).toBeGreaterThan(0);
    const raw = JSON.stringify(base).length;
    expect(slots[1].bytes).toBeLessThan(raw); // gzip is working in this runtime
    const loaded = await loadSlot(2);
    expect(loaded.slot).toBe(2);
    expect(loaded.usedBackup).toBe(false);
    expect(loaded.state.day).toBe(base.day);
    expect(loaded.state.id).toBe(base.id);
  });

  it('keeps the previous save as a backup and can load it on purpose', async () => {
    const s = clone(base);
    await saveToSlot(1, s);
    s.finance.balance += 12345;
    await saveToSlot(1, s);
    const slots = await listSlots();
    expect(slots[0].backupMeta).not.toBeNull();
    const bak = await loadBackup(1);
    expect(bak.state.finance.balance).toBe(base.finance.balance);
    const cur = await loadSlot(1);
    expect(cur.state.finance.balance).toBe(base.finance.balance + 12345);
  });

  it('falls back to the backup when the latest save is damaged', async () => {
    const s = clone(base);
    await saveToSlot(3, s);
    s.finance.balance += 777;
    await saveToSlot(3, s);
    const row = (await getRow('slot:3'))!;
    await putRow({ ...row, gz: false, data: '{"format":"pitchside-save","schema":1,"state":{broken' });
    const loaded = await loadSlot(3);
    expect(loaded.usedBackup).toBe(true);
    expect(loaded.warnings.join(' ')).toMatch(/backup/);
    expect(loaded.state.finance.balance).toBe(base.finance.balance);
  });

  it('reports a damaged save with no backup', async () => {
    await saveToSlot(4, clone(base));
    const row = (await getRow('slot:4'))!;
    await putRow({ ...row, gz: false, data: 'garbage' });
    await expect(loadSlot(4)).rejects.toBeInstanceOf(SaveError);
  });

  it('deletes a slot and its backup', async () => {
    await saveToSlot(5, clone(base));
    await saveToSlot(5, clone(base));
    await deleteSlot(5);
    const slots = await listSlots();
    expect(slots[4].meta).toBeNull();
    expect(slots[4].backupMeta).toBeNull();
    await expect(loadSlot(5)).rejects.toBeInstanceOf(SaveError);
  });

  it('serialises overlapping saves without losing either', async () => {
    const a = clone(base);
    const b = clone(base);
    b.finance.balance += 1;
    await Promise.all([saveToSlot(6, a), saveToSlot(6, b)]);
    const loaded = await loadSlot(6);
    expect(loaded.state.finance.balance).toBe(b.finance.balance);
  });

  it('rejects an invalid slot number', async () => {
    await expect(saveToSlot(0, clone(base))).rejects.toBeInstanceOf(SaveError);
    await expect(saveToSlot(MAX_SLOTS + 1, clone(base))).rejects.toBeInstanceOf(SaveError);
  });
});

describe('export and import', () => {
  it('exports a file name and text that import back into the first free slot', async () => {
    const { text, fileName } = exportText(clone(base));
    expect(fileName).toMatch(/^pitchside-.*\.json$/);
    const probe = inspectImport(text);
    expect(probe.ok).toBe(true);
    const r = await importIntoSlot(text);
    expect(r.slot).toBe(1);
    const loaded = await loadSlot(1);
    expect(loaded.state.day).toBe(base.day);
  });

  it('explains why a bad import was refused and writes nothing', async () => {
    const probe = inspectImport('{"format":"something-else"}');
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.message).toMatch(/not a Pitchside save/);
    await expect(importIntoSlot('nope')).rejects.toBeInstanceOf(SaveError);
    expect((await listSlots()).every((s) => !s.meta)).toBe(true);
  });

  it('refuses to import when every slot is full unless a slot is chosen', async () => {
    for (let i = 1; i <= MAX_SLOTS; i++) await saveToSlot(i, clone(base));
    const { text } = exportText(clone(base));
    await expect(importIntoSlot(text)).rejects.toThrow(/full/);
    const r = await importIntoSlot(text, 3);
    expect(r.slot).toBe(3);
  });
});
