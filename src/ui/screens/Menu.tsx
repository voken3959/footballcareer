import { useEffect, useState } from 'react';
import { useStore } from '../../store/store';
import { Card, Chip, Empty, Spinner } from '../kit';
import { MAX_SLOTS, loadSlot as readSlot, exportText, type SlotInfo } from '../../persistence/saves';
import { useImportFlow } from '../ImportFlow';

function savedAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function SlotCard({ info, onLoad, onDelete, onExport, onBackup }: { info: SlotInfo; onLoad: () => void; onDelete: () => void; onExport: () => void; onBackup: () => void }) {
  const m = info.meta;
  if (!m) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed border-ink-700 px-4 py-3 text-sm text-ink-400">
        <span>Slot {info.slot} · empty</span>
      </div>
    );
  }
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink-50">{m.playerName}</span>
          <Chip>{m.position}</Chip>
          {m.retired && <Chip tone="warn">Retired</Chip>}
          <Chip>{m.difficulty}</Chip>
        </div>
        <div className="mt-0.5 text-xs text-ink-300">
          Slot {info.slot} · age {m.age} · overall {m.overall} · {m.clubName} · {m.dateLabel}
        </div>
        <div className="text-xs text-ink-400">{m.appearances} apps, {m.goals} goals · saved {savedAgo(m.savedAt)} · {(info.bytes / 1024 / 1024).toFixed(1)} MB</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary btn-sm" onClick={onLoad}>Load</button>
        <button className="btn btn-sm" onClick={onExport}>Export</button>
        {info.backupMeta && <button className="btn btn-sm" onClick={onBackup} title={`Backup from ${savedAgo(info.backupMeta.savedAt)}`}>Load backup</button>}
        <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

export function Menu() {
  const slots = useStore((s) => s.slots);
  const refresh = useStore((s) => s.refreshSlots);
  const loadCareer = useStore((s) => s.loadCareer);
  const continueLast = useStore((s) => s.continueLast);
  const deleteSlot = useStore((s) => s.deleteSlot);
  const toast = useStore((s) => s.toast);
  const ask = useStore((s) => s.ask);
  const setView = useStore((s) => s.setView);
  const persistent = useStore((s) => s.persistent);
  const bootError = useStore((s) => s.bootError);
  const [loaded, setLoaded] = useState(false);
  const importer = useImportFlow();

  useEffect(() => { void refresh().then(() => setLoaded(true)); }, [refresh]);

  const saved = slots.filter((s) => s.meta);

  const doExportSlot = async (slot: number) => {
    try {
      const r = await readSlot(slot);
      const { text, fileName } = exportText(r.state);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('ok', `Exported ${fileName}`);
    } catch (e) {
      toast('err', e instanceof Error ? e.message : 'Export failed.');
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-3">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
            <rect width="40" height="40" rx="9" fill="#064e3b" />
            <circle cx="20" cy="20" r="11" fill="none" stroke="#34d399" strokeWidth="2" />
            <path d="M20 9 V31 M9 20 H31" stroke="#34d399" strokeWidth="2" />
            <circle cx="20" cy="20" r="3" fill="#34d399" />
          </svg>
          <h1 className="text-3xl font-bold tracking-tight text-ink-50">Pitchside</h1>
        </div>
        <p className="max-w-2xl text-ink-200">
          One footballer. One career, from a sixteen-year-old with something to prove to the day you hang up your boots. Train, play, negotiate, move,
          and live with the consequences. Every number in the game is simulated, and every change to your player has a reason you can read.
        </p>
      </header>

      {!persistent && (
        <div className="rounded-lg border border-warn-400/40 bg-warn-400/10 px-4 py-3 text-sm text-warn-400">
          This browser is not allowing local storage (private mode?). Your career will live only in memory: use Settings → Export career to keep a copy.
        </div>
      )}
      {bootError && <div className="rounded-lg border border-bad-500/50 bg-bad-500/10 px-4 py-3 text-sm text-bad-400">{bootError}</div>}

      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary btn-lg" disabled={!saved.length} onClick={() => void continueLast()}>
          Continue career
        </button>
        <button className="btn btn-lg" onClick={() => setView('wizard')}>New career</button>
        <button className="btn btn-lg" onClick={importer.choose}>Import save file</button>
        {importer.input}
      </div>

      <section aria-labelledby="slots-h" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="slots-h" className="card-title">Save slots</h2>
          <span className="text-xs text-ink-400">{saved.length} of {MAX_SLOTS} used</span>
        </div>
        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-ink-300"><Spinner /> Reading saves…</div>
        ) : !saved.length ? (
          <Empty title="No careers yet" body="Start a new career to create your first save. Your progress is saved automatically after every match and big decision." action={<button className="btn btn-primary" onClick={() => setView('wizard')}>Start a career</button>} />
        ) : (
          <div className="flex flex-col gap-2">
            {slots.map((s) => (
              <SlotCard
                key={s.slot}
                info={s}
                onLoad={() => void loadCareer(s.slot)}
                onBackup={() => ask({ title: 'Load the backup?', body: 'This loads the version of the career saved before the most recent save. Anything done since then is not in it.', confirmLabel: 'Load backup', onConfirm: () => void loadCareer(s.slot, true) })}
                onExport={() => void doExportSlot(s.slot)}
                onDelete={() => ask({ title: `Delete the career in slot ${s.slot}?`, body: `${s.meta?.playerName}'s whole career will be removed, including its backup. This cannot be undone.`, confirmLabel: 'Delete career', danger: true, onConfirm: () => void deleteSlot(s.slot) })}
              />
            ))}
          </div>
        )}
      </section>

      <Card title="How it plays">
        <ul className="grid gap-x-8 gap-y-2 text-sm text-ink-200 sm:grid-cols-2">
          <li>You control the player, not the team: the manager picks the eleven, so form, fitness and training earn your place.</li>
          <li>Potential is hidden. Your coaches can only estimate it, and it narrows as you age.</li>
          <li>Matches can be played instantly, as live text, or as a 2D replay. All three are the same simulation.</li>
          <li>Saves are versioned, backed up on every write, and can be exported as a JSON file.</li>
        </ul>
      </Card>

      {importer.dialog}
    </div>
  );
}
