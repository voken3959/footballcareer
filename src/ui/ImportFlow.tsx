import { useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/store';
import { Modal } from './kit';
import { inspectImport } from '../persistence/saves';
import { POSITION_LABEL } from '../engine/attributes';
import type { Position } from '../engine/types';

/**
 * The file-picker half of importing a career: choose a file, check it is a real save, pick a slot, import.
 * Shared by the main menu and Settings so both behave identically.
 */
export function useImportFlow(): { choose: () => void; input: ReactNode; dialog: ReactNode } {
  const slots = useStore((s) => s.slots);
  const importCareer = useStore((s) => s.importCareer);
  const toast = useStore((s) => s.toast);
  const refresh = useStore((s) => s.refreshSlots);
  const [pending, setPending] = useState<{ text: string; summary: string; warnings: string[] } | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 120 * 1024 * 1024) { toast('err', 'That file is too large to be a Pitchside save.'); return; }
    try {
      await refresh();
      const text = await f.text();
      const probe = inspectImport(text);
      if (!probe.ok) { toast('err', probe.message); return; }
      const m = probe.meta;
      const free = useStore.getState().slots.find((s) => !s.meta);
      setPick(free?.slot ?? null);
      setPending({ text, summary: `${m.playerName} (${POSITION_LABEL[m.position as Position] ?? m.position}), age ${m.age}, overall ${m.overall}, ${m.clubName}, ${m.dateLabel}`, warnings: probe.warnings });
    } catch {
      toast('err', 'That file could not be read.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const input = <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import save file" onChange={(e) => void onFile(e.target.files?.[0])} />;

  const dialog = (
    <Modal
      open={!!pending}
      title="Import this career?"
      onClose={() => setPending(null)}
      footer={
        <>
          <button className="btn" onClick={() => setPending(null)}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={pick === null || busy}
            onClick={async () => {
              if (!pending || pick === null) return;
              setBusy(true);
              const ok = await importCareer(pending.text, pick);
              setBusy(false);
              if (ok) setPending(null);
            }}
          >
            Import into slot {pick ?? '–'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-100">{pending?.summary}</p>
      {pending?.warnings.map((w) => <p key={w} className="mb-2 text-xs text-warn-400">{w}</p>)}
      <label className="label" htmlFor="import-slot">Save into</label>
      <select id="import-slot" className="field" value={pick ?? ''} onChange={(e) => setPick(Number(e.target.value))}>
        {slots.map((s) => <option key={s.slot} value={s.slot}>Slot {s.slot} {s.meta ? `· replaces ${s.meta.playerName}` : '· empty'}</option>)}
      </select>
    </Modal>
  );

  return { choose: () => fileRef.current?.click(), input, dialog };
}
