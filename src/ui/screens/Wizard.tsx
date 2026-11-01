import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import {
  PATHWAYS, TALENT_BANDS, defaultOptions, clubsForPathway, previewClubs, previewPlayer,
  type NewCareerOptions, type Pathway, type ProfileFocus, type TalentBand,
} from '../../engine/career';
import { Rng } from '../../engine/rng';
import { genName } from '../../engine/playerGen';
import { NATIONS } from '../../engine/names';
import { ALL_ATTRS, ATTR_GROUP, ATTR_LABEL, POSITION_LABEL, overall } from '../../engine/attributes';
import { POSITIONS, type Difficulty, type Personality, type Position } from '../../engine/types';
import type { Club } from '../../engine/types';
import { Card, Chip, Segmented, Spinner, Bar } from '../kit';
import { Crest, Portrait } from '../art';
import { clsx, ratingClass } from '../format';
import { MAX_SLOTS } from '../../persistence/saves';

const STEPS = ['Career', 'You', 'Footballer', 'Club', 'Review'] as const;

const DIFFICULTY: { id: Difficulty; label: string; blurb: string }[] = [
  { id: 'casual', label: 'Casual', blurb: 'More interest from clubs, more generous contract talks, slightly gentler progression.' },
  { id: 'standard', label: 'Standard', blurb: 'The intended balance. Clubs and managers treat you fairly but do not hand you anything.' },
  { id: 'simulation', label: 'Simulation', blurb: 'Realistic and unforgiving: less interest, tougher negotiations, and managers who punish poor form.' },
];

const PERSONALITIES: { id: Personality; label: string; blurb: string }[] = [
  { id: 'professional', label: 'Professional', blurb: 'Trains well: about 6% faster development, steady match form and a patient negotiator.' },
  { id: 'ambitious', label: 'Ambitious', blurb: 'Pushes for bigger deals and works harder than most: about 3% faster development.' },
  { id: 'competitive', label: 'Competitive', blurb: 'Thrives in a fight for a place: sharper on match days and slightly faster development.' },
  { id: 'charismatic', label: 'Charismatic', blurb: 'Wins people over: the best negotiator, with a naturally upbeat mood.' },
  { id: 'loyal', label: 'Loyal', blurb: 'Patient in contract talks and willing to take a little less to stay.' },
  { id: 'reserved', label: 'Reserved', blurb: 'Quiet and private. Settles for slightly smaller deals and has a lower resting mood.' },
  { id: 'risk-taking', label: 'Risk-taking', blurb: 'Gets paid more at the table but has little patience for a long negotiation.' },
];

const FOCUS: { id: ProfileFocus; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'Balanced', blurb: 'An even spread of attributes.' },
  { id: 'technical', label: 'Technical', blurb: 'Stronger on the ball, weaker physically and mentally.' },
  { id: 'physical', label: 'Physical', blurb: 'Quick and strong, rawer technically.' },
  { id: 'mental', label: 'Mental', blurb: 'Reads the game early, less gifted athletically.' },
];

const POSITION_BLURB: Record<Position, string> = {
  GK: 'Shot-stopping, handling and distribution.', RB: 'Overlapping runs and one-on-one defending.', CB: 'Aerial strength, tackling and reading danger.',
  LB: 'Pace down the flank and recovery runs.', DM: 'Shields the back four and breaks up play.', CM: 'The engine: passing, work rate and balance.',
  AM: 'Creativity between the lines.', RW: 'Dribbling, crossing and cutting inside.', LW: 'Dribbling, crossing and cutting inside.', ST: 'Finishing, movement and composure in the box.',
};

const FIRST_NAMES_UI = 'First name';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

function ChoiceCard({ selected, onClick, title, children, badge }: { selected: boolean; onClick: () => void; title: string; children?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={clsx('flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors', selected ? 'border-pitch-500 bg-pitch-900/30' : 'border-ink-700 bg-ink-850 hover:border-ink-500')}
    >
      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-50">{title}{badge}</span>
      {children && <span className="text-xs text-ink-300">{children}</span>}
    </button>
  );
}

export function Wizard() {
  const setView = useStore((s) => s.setView);
  const newCareer = useStore((s) => s.newCareer);
  const refresh = useStore((s) => s.refreshSlots);
  const slots = useStore((s) => s.slots);
  const ask = useStore((s) => s.ask);
  const [step, setStep] = useState(0);
  const [o, setO] = useState<NewCareerOptions>(() => defaultOptions(Math.floor(Math.random() * 2 ** 31)));
  const [clubChoice, setClubChoice] = useState<string | null>(null); // null = let the game decide
  const [slot, setSlot] = useState<number | null>(null);
  const [world, setWorld] = useState<{ clubs: Club[]; seed: number } | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (slot === null && slots.length) setSlot(slots.find((s) => !s.meta)?.slot ?? 1);
  }, [slots, slot]);

  // The world depends only on the seed, so preview it once per seed (after the first paint, since it takes a moment).
  useEffect(() => {
    setWorld(null);
    const t = setTimeout(() => {
      const { world: w } = previewClubs(o.seed, 'custom');
      setWorld({ clubs: Object.values(w.clubs), seed: o.seed });
    }, 30);
    return () => clearTimeout(t);
  }, [o.seed]);

  const set = (patch: Partial<NewCareerOptions>) => setO((prev) => ({ ...prev, ...patch }));

  const pathwayClubs = useMemo(() => {
    if (!world) return [];
    const byId = Object.fromEntries(world.clubs.map((c) => [c.id, c]));
    return clubsForPathway({ clubs: byId, players: {}, squads: {}, freeAgents: [] }, o.pathway);
  }, [world, o.pathway]);

  // keep the chosen club valid when the pathway changes
  useEffect(() => {
    if (clubChoice && world && !pathwayClubs.some((c) => c.id === clubChoice)) setClubChoice(null);
  }, [pathwayClubs, clubChoice, world]);

  const chosenClub = clubChoice ? world?.clubs.find((c) => c.id === clubChoice) : undefined;
  const preview = useMemo(() => {
    const opts: NewCareerOptions = { ...o, clubId: clubChoice ?? undefined };
    return previewPlayer(opts, chosenClub?.reputation ?? 60);
  }, [o, clubChoice, chosenClub]);

  const pathwayAges: [number, number] = o.pathway === 'custom' ? [16, 36] : [16, 16];
  useEffect(() => {
    if (o.pathway !== 'custom' && o.age !== 16) set({ age: 16 });
    if (o.pathway === 'custom' && !o.custom) set({ custom: { ovr: 58, talent: 'good' } });
  }, [o.pathway]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOk = o.firstName.trim().length > 0 && o.lastName.trim().length > 0;
  const canNext = step === 1 ? nameOk : true;

  const reroll = () => {
    const nat = o.nationality;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const { first, last } = genName(new Rng(seed), nat);
    setClubChoice(null);
    set({ seed, profileSeed: seed ^ 0x9e3779b9, firstName: first, lastName: last });
  };

  const start = async () => {
    if (slot === null) return;
    const existing = slots.find((s) => s.slot === slot)?.meta;
    const go = async () => {
      setStarting(true);
      const ok = await newCareer({ ...o, clubId: clubChoice ?? undefined, careerName: `${o.firstName.trim()} ${o.lastName.trim()}` }, slot);
      if (!ok) setStarting(false);
    };
    if (existing) {
      ask({ title: `Replace the career in slot ${slot}?`, body: `${existing.playerName}'s career will be overwritten. The previous version is kept as a backup until the next save.`, confirmLabel: 'Replace and start', danger: true, onConfirm: () => void go() });
    } else void go();
  };

  const attrGroups = (['technical', 'physical', 'mental'] as const).map((g) => ({ g, keys: ALL_ATTRS.filter((k) => ATTR_GROUP[k] === g) }));
  const kit = chosenClub?.crest.primary ?? '#10b981';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-50">New career</h1>
          <p className="text-sm text-ink-300">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setView('menu')}>Cancel</button>
      </header>

      <ol className="flex gap-1" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button className="w-full text-left" disabled={i > step && !(i <= 4 && nameOk)} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
              <div className={clsx('h-1 rounded-full', i <= step ? 'bg-pitch-500' : 'bg-ink-700')} />
              <div className={clsx('mt-1 text-xs', i === step ? 'font-semibold text-pitch-400' : 'text-ink-400')}>{s}</div>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col gap-5">
          <Card title="Where does the story begin?">
            <div role="radiogroup" aria-label="Pathway" className="grid gap-3 sm:grid-cols-2">
              {PATHWAYS.map((p) => (
                <ChoiceCard key={p.id} selected={o.pathway === p.id} onClick={() => set({ pathway: p.id as Pathway })} title={p.label}>{p.blurb}</ChoiceCard>
              ))}
            </div>
          </Card>
          <Card title="Difficulty">
            <div role="radiogroup" aria-label="Difficulty" className="grid gap-3 sm:grid-cols-3">
              {DIFFICULTY.map((d) => (
                <ChoiceCard key={d.id} selected={o.difficulty === d.id} onClick={() => set({ difficulty: d.id })} title={d.label}>{d.blurb}</ChoiceCard>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-400">Difficulty can be changed later in Settings. It never changes how a match is simulated, only how clubs and managers treat you.</p>
          </Card>
          <Card title="The world">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-ink-200">
                Your career runs in a fictional world: 32 clubs across two divisions, a national cup and an international calendar. The world number below fixes
                every club, manager and player, so the same number always gives the same world.
              </p>
              <div className="flex items-center gap-2">
                <input className="field w-36 font-mono" inputMode="numeric" aria-label="World number" value={o.seed} onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')); if (Number.isFinite(v) && v <= 2 ** 31 - 1) { setClubChoice(null); set({ seed: v, profileSeed: v ^ 0x9e3779b9 }); } }} />
                <button className="btn" onClick={reroll}>New world</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
          <Card title="Who are you?">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={FIRST_NAMES_UI}><input className="field" value={o.firstName} maxLength={24} onChange={(e) => set({ firstName: e.target.value })} aria-invalid={!o.firstName.trim()} /></Field>
              <Field label="Last name"><input className="field" value={o.lastName} maxLength={24} onChange={(e) => set({ lastName: e.target.value })} aria-invalid={!o.lastName.trim()} /></Field>
              <Field label="Name on the shirt" hint="Optional. Defaults to initial and surname.">
                <input className="field" value={o.displayName ?? ''} maxLength={20} placeholder={`${o.firstName.trim()[0] ?? ''}. ${o.lastName.trim()}`} onChange={(e) => set({ displayName: e.target.value })} />
              </Field>
              <Field label="Nationality" hint="Decides which national team you can play for.">
                <select className="field" value={o.nationality} onChange={(e) => set({ nationality: e.target.value })}>
                  {NATIONS.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
                </select>
              </Field>
              <Field label={`Starting age: ${o.age}`} hint={o.pathway === 'custom' ? 'Custom careers can begin at any age from 16 to 36.' : 'Every career in this pathway begins at sixteen.'}>
                <input type="range" min={pathwayAges[0]} max={pathwayAges[1]} value={o.age} disabled={pathwayAges[0] === pathwayAges[1]} onChange={(e) => set({ age: Number(e.target.value) })} className="w-full accent-emerald-500" aria-label="Starting age" />
              </Field>
              <Field label="Shirt number">
                <input className="field" type="number" min={1} max={99} value={o.shirt ?? ''} placeholder="Any" onChange={(e) => set({ shirt: e.target.value ? Math.max(1, Math.min(99, Number(e.target.value))) : undefined })} />
              </Field>
              <Field label="Preferred foot">
                <Segmented label="Preferred foot" value={o.foot} onChange={(v) => set({ foot: v })} options={[{ id: 'right', label: 'Right' }, { id: 'left', label: 'Left' }, { id: 'both', label: 'Both' }]} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Height: ${o.height} cm`}><input type="range" min={160} max={200} value={o.height} onChange={(e) => set({ height: Number(e.target.value) })} className="w-full accent-emerald-500" aria-label="Height" /></Field>
                <Field label={`Weight: ${o.weight} kg`}><input type="range" min={55} max={95} value={o.weight} onChange={(e) => set({ weight: Number(e.target.value) })} className="w-full accent-emerald-500" aria-label="Weight" /></Field>
              </div>
            </div>
          </Card>
          <Card title="Appearance">
            <div className="flex flex-col items-center gap-4">
              <Portrait look={o.appearance} kit={kit} size={128} />
              {([['Skin tone', 'skin', 6], ['Hair colour', 'hair', 6], ['Hair style', 'style', 6]] as const).map(([label, key, n]) => (
                <div key={key} className="w-full">
                  <div className="label">{label}</div>
                  <div className="flex gap-1.5">
                    {Array.from({ length: n }, (_, i) => (
                      <button key={i} aria-label={`${label} ${i + 1}`} aria-pressed={o.appearance[key] === i} onClick={() => set({ appearance: { ...o.appearance, [key]: i } })} className={clsx('h-7 flex-1 rounded-md border text-[10px] font-semibold', o.appearance[key] === i ? 'border-pitch-400 bg-pitch-900/50 text-pitch-400' : 'border-ink-600 bg-ink-800 text-ink-300 hover:border-ink-400')}>{i + 1}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-5">
          <Card title="Position">
            <div role="radiogroup" aria-label="Position" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {POSITIONS.map((p) => (
                <ChoiceCard key={p} selected={o.position === p} onClick={() => set({ position: p, secondary: o.secondary === p ? null : o.secondary })} title={`${p} · ${POSITION_LABEL[p]}`}>{POSITION_BLURB[p]}</ChoiceCard>
              ))}
            </div>
            <div className="mt-4 max-w-xs">
              <Field label="Second position (optional)" hint="You can cover here at a small penalty.">
                <select className="field" value={o.secondary ?? ''} onChange={(e) => set({ secondary: (e.target.value || null) as Position | null })}>
                  <option value="">None</option>
                  {POSITIONS.filter((p) => p !== o.position).map((p) => <option key={p} value={p}>{p} · {POSITION_LABEL[p]}</option>)}
                </select>
              </Field>
            </div>
          </Card>
          <Card title="What are you known for?">
            <div role="radiogroup" aria-label="Attribute focus" className="grid gap-3 sm:grid-cols-4">
              {FOCUS.map((f) => <ChoiceCard key={f.id} selected={o.focus === f.id} onClick={() => set({ focus: f.id })} title={f.label}>{f.blurb}</ChoiceCard>)}
            </div>
            <p className="mt-3 text-xs text-ink-400">Your overall rating at the start is the same whatever you pick; only the shape of your attributes changes.</p>
          </Card>
          <Card title="Personality">
            <div role="radiogroup" aria-label="Personality" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PERSONALITIES.map((p) => <ChoiceCard key={p.id} selected={o.personality === p.id} onClick={() => set({ personality: p.id })} title={p.label}>{p.blurb}</ChoiceCard>)}
            </div>
          </Card>
          {o.pathway === 'custom' && o.custom && (
            <Card title="Custom level">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Overall rating at the start: ${o.custom.ovr}`} hint="A professional first-teamer is around 60–70; stars are 80 and above.">
                  <input type="range" min={30} max={85} value={o.custom.ovr} onChange={(e) => set({ custom: { ...o.custom!, ovr: Number(e.target.value) } })} className="w-full accent-emerald-500" aria-label="Starting overall" />
                </Field>
                <Field label="Talent" hint="How high your hidden potential can reach. You will not be told the exact number.">
                  <Segmented label="Talent" value={o.custom.talent} onChange={(v: TalentBand) => set({ custom: { ...o.custom!, talent: v } })} options={(Object.keys(TALENT_BANDS) as TalentBand[]).map((t) => ({ id: t, label: TALENT_BANDS[t].label }))} />
                </Field>
              </div>
            </Card>
          )}
        </div>
      )}

      {step === 3 && (
        <Card title={o.pathway === 'custom' ? 'Choose any club' : 'Clubs that would take you'} actions={<button className={clsx('btn btn-sm', clubChoice === null && 'btn-primary')} onClick={() => setClubChoice(null)}>Let the game choose</button>}>
          {!world ? (
            <div className="flex items-center gap-2 text-sm text-ink-300"><Spinner /> Building the world…</div>
          ) : (
            <div role="radiogroup" aria-label="Club" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[...pathwayClubs].sort((a, b) => b.reputation - a.reputation).map((c) => (
                <button key={c.id} role="radio" aria-checked={clubChoice === c.id} onClick={() => setClubChoice(c.id)} className={clsx('flex items-center gap-3 rounded-lg border p-3 text-left', clubChoice === c.id ? 'border-pitch-500 bg-pitch-900/30' : 'border-ink-700 bg-ink-850 hover:border-ink-500')}>
                  <Crest crest={c.crest} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-50">{c.name}</span>
                    <span className="block text-xs text-ink-300">Division {c.division} · {c.stadium}</span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-400">Reputation <Bar value={c.reputation} className="w-20" /> {c.reputation}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-ink-400">Clubs differ in coaching, facilities, how many youngsters their manager plays and how deep the squad is in your position. Look at the squad before you commit to a crowded one.</p>
        </Card>
      )}

      {step === 4 && (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <Card title="Your footballer">
            <div className="flex items-center gap-3">
              <Portrait look={o.appearance} kit={kit} size={72} />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-ink-50">{o.displayName?.trim() || `${o.firstName.trim()[0]}. ${o.lastName.trim()}`}</div>
                <div className="text-sm text-ink-300">{o.firstName} {o.lastName}</div>
                <div className="mt-1 flex flex-wrap gap-1.5"><Chip>{o.position}</Chip><Chip>{o.age} yrs</Chip><Chip>{NATIONS.find((n) => n.code === o.nationality)?.name}</Chip></div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><div className="stat-label">Overall</div><div className={clsx('stat-value', ratingClass(overall(preview)))}>{Math.round(overall(preview))}</div></div>
              <div><div className="stat-label">Potential</div><div className="stat-value text-ink-300">Hidden</div></div>
              <div><div className="stat-label">Personality</div><div className="text-ink-50 capitalize">{o.personality}</div></div>
              <div><div className="stat-label">Difficulty</div><div className="text-ink-50 capitalize">{o.difficulty}</div></div>
              <div className="col-span-2"><div className="stat-label">Club</div><div className="flex items-center gap-2 text-ink-50">{chosenClub ? <><Crest crest={chosenClub.crest} size={18} />{chosenClub.name}</> : 'Chosen for you from the pathway'}</div></div>
              <div className="col-span-2"><div className="stat-label">World</div><div className="font-mono text-ink-50">{o.seed}</div></div>
            </div>
            <div className="mt-4">
              <label className="label" htmlFor="slot">Save into</label>
              <select id="slot" className="field" value={slot ?? ''} onChange={(e) => setSlot(Number(e.target.value))}>
                {Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).map((n) => {
                  const m = slots.find((s) => s.slot === n)?.meta;
                  return <option key={n} value={n}>Slot {n} · {m ? `replaces ${m.playerName}` : 'empty'}</option>;
                })}
              </select>
            </div>
          </Card>
          <Card title="Starting attributes">
            <div className="grid gap-5 sm:grid-cols-3">
              {attrGroups.map(({ g, keys }) => (
                <div key={g}>
                  <div className="mb-1 text-xs font-semibold capitalize text-pitch-400">{g}</div>
                  <ul className="space-y-1">
                    {keys.map((k) => (
                      <li key={k} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-ink-300">{ATTR_LABEL[k]}</span>
                        <span className={clsx('font-semibold tabular-nums', ratingClass(preview.attrs[k]))}>{preview.attrs[k]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-400">Attributes grow with age, training and playing time, and every change is recorded with its reason. How far they can grow is not shown.</p>
          </Card>
        </div>
      )}

      <footer className="flex items-center justify-between gap-3">
        <button className="btn" disabled={step === 0 || starting} onClick={() => setStep((s) => s - 1)}>Back</button>
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</button>
        ) : (
          <button className="btn btn-primary btn-lg" disabled={starting || slot === null || !nameOk} onClick={() => void start()}>{starting ? 'Starting…' : 'Start career'}</button>
        )}
      </footer>
    </div>
  );
}
