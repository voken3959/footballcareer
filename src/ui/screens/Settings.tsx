import { useEffect, useState } from 'react';
import { useAct, useGame } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Card, Chip, PageHeader, Row, Segmented, Slider, Toggle } from '../kit';
import { useImportFlow } from '../ImportFlow';
import { playCue, soundSupported, unlockAudio } from '../sound';
import { clsx, formatDate } from '../format';
import { APP_VERSION } from '../../persistence/envelope';
import { MAX_SLOTS, exportText, loadSlot as readSlot, saveToSlot, type SlotInfo } from '../../persistence/saves';
import { SCHEMA_VERSION, SIM_VERSION, type Difficulty, type Settings as SettingsT } from '../../engine/types';

const DIFFICULTY: { id: Difficulty; label: string; blurb: string }[] = [
  { id: 'casual', label: 'Casual', blurb: 'Faster growth, slower decline, fewer injuries, and clubs that are easier to deal with.' },
  { id: 'standard', label: 'Standard', blurb: 'The intended balance. Realistic progression and normal injury rates.' },
  { id: 'simulation', label: 'Simulation', blurb: 'Slower growth, steeper decline, more injuries and tougher negotiations.' },
];

const SIM_PREF: { id: SettingsT['simPreference']; label: string; hint: string }[] = [
  { id: 'ask', label: 'Ask me each time', hint: 'Choose how to play every match' },
  { id: 'instant', label: 'Instant result', hint: 'Simulate straight to the report' },
  { id: 'commentary', label: 'Live text', hint: 'Follow the match as commentary' },
  { id: 'visual', label: '2D replay', hint: 'Watch it unfold on a pitch' },
];

function savedAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Settings() {
  const g = useGame();
  const act = useAct();
  const s = g.settings;
  const set = <K extends keyof SettingsT>(key: K, value: SettingsT[K]) => act((gg) => { gg.settings[key] = value; return { ok: true, message: '' }; }, { quiet: true });
  return (
    <>
      <PageHeader title="Settings" subtitle="Difficulty, matches, audio, display and saves" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card title="Difficulty">
            <div role="radiogroup" aria-label="Difficulty" className="flex flex-col gap-2">
              {DIFFICULTY.map((d) => (
                <button key={d.id} role="radio" aria-checked={s.difficulty === d.id} onClick={() => set('difficulty', d.id)}
                  className={clsx('rounded-md border px-3 py-2 text-left transition-colors', s.difficulty === d.id ? 'border-pitch-500 bg-pitch-900/30' : 'border-ink-700 hover:border-ink-500')}>
                  <span className="block text-sm font-medium text-ink-50">{d.label}</span>
                  <span className="block text-xs text-ink-300">{d.blurb}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-400">You can change this at any point. It affects development, injuries and negotiations from now on, not what has already happened.</p>
          </Card>

          <Card title="Matches">
            <p className="mb-2 text-sm text-ink-200">How your matches are played. All three ways use the same simulation, so the result is identical whichever you pick.</p>
            <Segmented<SettingsT['simPreference']> label="Match viewing" value={s.simPreference} onChange={(v) => set('simPreference', v)} options={SIM_PREF} />
            <div className="mt-4">
              <p className="mb-1.5 text-sm text-ink-200">Starting speed for live matches</p>
              <Segmented<number> size="sm" label="Starting speed" value={[1, 2, 4, 10].includes(Math.round(s.commentarySpeed)) ? Math.round(s.commentarySpeed) : 1} onChange={(v) => set('commentarySpeed', v)} options={[1, 2, 4, 10].map((v) => ({ id: v, label: `${v}×` }))} />
              <p className="mt-1 text-xs text-ink-400">You can change speed at any time during a match. At 1× a full match takes under four minutes.</p>
            </div>
          </Card>

          <Audio />

          <Card title="Display and accessibility">
            <Toggle checked={s.largeText} onChange={(v) => set('largeText', v)} label="Larger text" hint="Increases text size across the game." />
            <Toggle checked={s.highContrast} onChange={(v) => set('highContrast', v)} label="High contrast" hint="Brighter text and stronger borders." />
            <Toggle checked={s.reducedMotion} onChange={(v) => set('reducedMotion', v)} label="Reduce motion" hint="Removes animations and starts live matches at a faster speed." />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Saving />
          <Slots />
          <About />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- audio */

function Audio() {
  const g = useGame();
  const act = useAct();
  const s = g.settings;
  const supported = soundSupported();
  return (
    <Card title="Audio">
      <Toggle checked={s.sound} onChange={(v) => { act((gg) => { gg.settings.sound = v; return { ok: true, message: '' }; }, { quiet: true }); if (v) unlockAudio(); }} label="Match sounds" hint="Whistles, crowd noise on goals and cards during live matches." />
      <div className="mt-2">
        <Slider label="Volume" value={Math.round(s.volume * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => act((gg) => { gg.settings.volume = v / 100; return { ok: true, message: '' }; }, { quiet: true })} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" disabled={!supported || !s.sound} onClick={() => { unlockAudio(); window.setTimeout(() => playCue('goal', { enabled: s.sound, volume: s.volume }), 60); }}>Play test sound</button>
        <button className="btn btn-sm" disabled={!supported || !s.sound} onClick={() => { unlockAudio(); window.setTimeout(() => playCue('whistleLong', { enabled: s.sound, volume: s.volume }), 60); }}>Test whistle</button>
        {!supported && <span className="text-xs text-warn-400">This browser has no audio support.</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ saving */

function Saving() {
  const g = useGame();
  const act = useAct();
  const save = useStore((s) => s.save);
  const slot = useStore((s) => s.slot);
  const persistent = useStore((s) => s.persistent);
  const saveNow = useStore((s) => s.saveNow);
  const exportCareer = useStore((s) => s.exportCareer);
  const quit = useStore((s) => s.quitToMenu);
  const ask = useStore((s) => s.ask);
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), 15000); return () => window.clearInterval(id); }, []);
  return (
    <Card title="Saving">
      <Toggle checked={g.settings.autosave} onChange={(v) => act((gg) => { gg.settings.autosave = v; return { ok: true, message: v ? 'Autosave is on.' : 'Autosave is off. Save by hand or your progress may be lost.' }; })} label="Autosave" hint="Saves a moment after every match, decision and day you advance." />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {save.status === 'saving' && <Chip tone="info">Saving…</Chip>}
        {save.status === 'saved' && save.at && <Chip tone="good">Saved {savedAgo(save.at)}</Chip>}
        {save.status === 'error' && <Chip tone="bad">Save failed</Chip>}
        {save.status === 'idle' && <Chip>Not saved yet this session</Chip>}
        <span className="text-xs text-ink-400">{slot !== null ? `Slot ${slot}` : 'No slot'} · {persistent ? 'stored in this browser' : 'memory only'}</span>
      </div>
      {save.error && <p className="mt-2 text-xs text-bad-400">{save.error}</p>}
      {!persistent && <p className="mt-2 text-xs text-warn-400">This browser is not letting the game keep a save. Export your career to keep a copy.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => void saveNow('manual').then((ok) => { if (ok) useStore.getState().toast('ok', 'Career saved.'); })}>Save now</button>
        <button className="btn" onClick={exportCareer}>Export career file</button>
        <button className="btn btn-ghost" onClick={() => ask({ title: 'Quit to the main menu?', body: 'Your career is saved first.', confirmLabel: 'Quit to menu', onConfirm: () => void quit() })}>Quit to menu</button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- slots */

function Slots() {
  const g = useGame();
  const slots = useStore((s) => s.slots);
  const current = useStore((s) => s.slot);
  const refresh = useStore((s) => s.refreshSlots);
  const loadCareer = useStore((s) => s.loadCareer);
  const saveNow = useStore((s) => s.saveNow);
  const deleteSlot = useStore((s) => s.deleteSlot);
  const toast = useStore((s) => s.toast);
  const ask = useStore((s) => s.ask);
  const importer = useImportFlow();
  const [copyTo, setCopyTo] = useState<number | ''>('');
  useEffect(() => { void refresh(); }, [refresh]);

  const exportSlot = async (n: number) => {
    try {
      const r = await readSlot(n);
      const { text, fileName } = exportText(r.state);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('ok', `Exported ${fileName}`);
    } catch (e) { toast('err', e instanceof Error ? e.message : 'Export failed.'); }
  };

  const load = (n: number, backup: boolean) => ask({
    title: backup ? 'Load the backup?' : `Load slot ${n}?`,
    body: backup ? 'This loads the version saved before the latest save of that slot. Your current career is saved first.' : 'Your current career is saved first, then this one opens.',
    confirmLabel: backup ? 'Load backup' : 'Load',
    onConfirm: () => { void (async () => { await saveNow('switch'); await loadCareer(n, backup); })(); },
  });

  const copy = async () => {
    if (copyTo === '') return;
    const target = slots.find((x) => x.slot === copyTo);
    const run = async () => {
      try { await saveToSlot(copyTo, g); await refresh(); toast('ok', `Copied this career into slot ${copyTo}.`); } catch (e) { toast('err', e instanceof Error ? e.message : 'Copy failed.'); }
    };
    if (target?.meta) ask({ title: `Replace slot ${copyTo}?`, body: `${target.meta.playerName}'s career in that slot will be overwritten with a copy of this one.`, confirmLabel: 'Replace', danger: true, onConfirm: () => void run() });
    else await run();
  };

  const used = slots.filter((x) => x.meta).length;
  return (
    <Card title={`Save slots · ${used} of ${MAX_SLOTS} used`} pad={false}>
      <ul className="divide-y divide-ink-800">
        {slots.map((s: SlotInfo) => (
          <li key={s.slot} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            {s.meta ? (
              <>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-50">{s.meta.playerName}{s.slot === current && <Chip tone="good">Open now</Chip>}{s.meta.retired && <Chip tone="warn">Retired</Chip>}</p>
                  <p className="text-xs text-ink-300">Slot {s.slot} · age {s.meta.age} · {s.meta.clubName} · {s.meta.dateLabel} · saved {savedAgo(s.meta.savedAt)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.slot !== current && <button className="btn btn-sm" onClick={() => load(s.slot, false)}>Load</button>}
                  <button className="btn btn-sm" onClick={() => void exportSlot(s.slot)}>Export</button>
                  {s.backupMeta && <button className="btn btn-sm" onClick={() => load(s.slot, true)} title={`Backup from ${savedAgo(s.backupMeta.savedAt)}`}>Backup</button>}
                  {s.slot !== current && <button className="btn btn-danger btn-sm" onClick={() => ask({ title: `Delete slot ${s.slot}?`, body: `${s.meta?.playerName}'s career and its backup will be removed. This cannot be undone.`, confirmLabel: 'Delete', danger: true, onConfirm: () => void deleteSlot(s.slot) })}>Delete</button>}
                </div>
              </>
            ) : <span className="text-sm text-ink-400">Slot {s.slot} · empty</span>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 px-4 py-3">
        <label htmlFor="copy-to" className="text-xs text-ink-300">Save a copy to</label>
        <select id="copy-to" className="field !w-auto py-1 text-xs" value={copyTo} onChange={(e) => setCopyTo(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Choose a slot</option>
          {slots.filter((x) => x.slot !== current).map((x) => <option key={x.slot} value={x.slot}>Slot {x.slot}{x.meta ? ` (replaces ${x.meta.playerName})` : ' (empty)'}</option>)}
        </select>
        <button className="btn btn-sm" disabled={copyTo === ''} onClick={() => void copy()}>Copy</button>
        <span className="mx-1 hidden h-4 w-px bg-ink-700 sm:block" aria-hidden />
        <button className="btn btn-sm" onClick={importer.choose}>Import a save file</button>
        {importer.input}
      </div>
      {importer.dialog}
    </Card>
  );
}

/* ------------------------------------------------------------------- about */

function About() {
  const g = useGame();
  return (
    <Card title="This career">
      <Row label="Name">{g.name}</Row>
      <Row label="Started">{formatDate(g.career.startDay)}</Row>
      <Row label="Today">{formatDate(g.day)}</Row>
      <Row label="Seed">{g.seed}</Row>
      <Row label="Game version">{APP_VERSION}</Row>
      <Row label="Save format / simulation">{SCHEMA_VERSION} / {SIM_VERSION}</Row>
      <p className="mt-3 text-xs text-ink-400">The seed and simulation version fully determine how every match plays out, so the same save always replays the same way.</p>
    </Card>
  );
}
