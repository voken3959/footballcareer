import { useState } from 'react';
import { useAct, useDerived, useGame } from '../../store/hooks';
import { Bar, Card, Chip, Empty, Help, PageHeader, ScrollX, Segmented } from '../kit';
import { ConditionMeters } from '../parts';
import { clsx, formatShort, signed } from '../format';
import { ATTR_LABEL, ageAt } from '../../engine/attributes';
import { FOCUS_BLURB, FOCUS_LABEL, INTENSITY, focusAttrs, previewTraining, type Intensity } from '../../engine/progression';
import { SEVERITY_LABEL } from '../../engine/injuries';
import type { PlayerInstruction, TrainingFocus, TrainingPlan } from '../../engine/types';

const ALL_FOCUS: TrainingFocus[] = ['position', 'finishing', 'passing', 'dribbling', 'defending', 'physical', 'tactical', 'goalkeeping', 'recovery'];
const INTENSITIES: Intensity[] = ['rest', 'light', 'normal', 'intensive'];

const INSTRUCTION_LABEL: Record<PlayerInstruction, { label: string; blurb: string }> = {
  default: { label: 'Play your natural game', blurb: 'No special instruction. The manager’s plan decides.' },
  shoot_more: { label: 'Shoot more', blurb: 'Take shots earlier. More attempts, a little less quality.' },
  pass_more: { label: 'Pass more', blurb: 'Keep the ball moving and look for the final pass.' },
  dribble_more: { label: 'Take players on', blurb: 'Run at defenders. High reward, but you lose the ball more often.' },
  stay_back: { label: 'Stay back', blurb: 'Hold your position and protect the defence. Fewer chances to score.' },
};

export function Training() {
  const g = useGame();
  const act = useAct();
  const user = g.players[g.userId];
  const plan = g.training.plan;
  const age = ageAt(user.birthDay, g.day);
  const isGK = user.position === 'GK';
  const focusOptions = ALL_FOCUS.filter((f) => (f === 'goalkeeping' ? isGK : true));
  const [hover, setHover] = useState<TrainingFocus | null>(null);

  const preview = useDerived((s) => previewTraining(s, s.players[s.userId], s.training.plan));
  const compare = useDerived((s) => INTENSITIES.map((i) => ({ i, pv: previewTraining(s, s.players[s.userId], { ...s.training.plan, intensity: i }) })));
  const recent = g.career.attrChanges.slice(-10).reverse();

  const set = (patch: Partial<TrainingPlan>, message: string) => {
    act((gg) => { gg.training.plan = { ...gg.training.plan, ...patch }; return { ok: true, message }; });
  };

  const focusShown = hover ?? plan.focus;
  const focusSet = new Set(focusAttrs(focusShown, user.position));
  const maxPts = Math.max(0.001, ...preview.weeklyPoints.map((w) => w.pts));

  if (g.career.retired) return <><PageHeader title="Training" /><Empty title="You have retired" body="There is no training plan to set. See Career History for your legacy." /></>;

  return (
    <>
      <PageHeader
        title="Training"
        subtitle={`${user.displayName} · age ${age} · changes apply from the next session`}
      />

      {user.injury && (
        <div className="mb-4 rounded-lg border border-bad-500/40 bg-bad-900/20 px-4 py-3 text-sm text-ink-100" role="status">
          <span className="font-semibold">Injured: </span>{user.injury.type} ({SEVERITY_LABEL[user.injury.severity]}), {user.injury.daysLeft} days to go.
          <span className="ml-1 text-ink-300">Training is limited while you recover, and growth is slowed.</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <Card title="Focus">
            <div className="mb-3"><Help>What your sessions concentrate on. Focus attributes grow faster; the rest still develop at the normal rate. Potential and age still decide how much you can gain.</Help></div>
            <div role="radiogroup" aria-label="Training focus" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {focusOptions.map((f) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={plan.focus === f}
                  onClick={() => set({ focus: f }, `Training focus set to ${FOCUS_LABEL[f].toLowerCase()}.`)}
                  onMouseEnter={() => setHover(f)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(f)}
                  onBlur={() => setHover(null)}
                  className={clsx('rounded-md border px-3 py-2 text-left transition-colors', plan.focus === f ? 'border-pitch-500 bg-pitch-900/30' : 'border-ink-700 hover:border-ink-500')}
                >
                  <span className="block text-sm font-medium text-ink-50">{FOCUS_LABEL[f]}</span>
                  <span className="block text-xs text-ink-300">{FOCUS_BLURB[f]}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-300">
              {focusShown === 'recovery'
                ? 'Recovery sessions train no attributes.'
                : <>Boosted attributes: {[...focusSet].map((k) => ATTR_LABEL[k]).join(', ')}.</>}
            </p>
          </Card>

          <Card title="Intensity">
            <Segmented<Intensity> label="Training intensity" value={plan.intensity} onChange={(v) => set({ intensity: v }, `Intensity set to ${INTENSITY[v].label.toLowerCase()}.`)} options={INTENSITIES.map((i) => ({ id: i, label: INTENSITY[i].label, hint: INTENSITY[i].blurb }))} />
            <p className="mt-2 text-sm text-ink-200">{INTENSITY[plan.intensity].blurb}</p>
            <ScrollX className="mt-3">
              <table className="tbl">
                <thead><tr><th>Intensity</th><th className="num">Hours/day</th><th className="num">Growth per week</th><th className="num">Fatigue/session</th><th className="num">Injury risk/week</th></tr></thead>
                <tbody>
                  {compare.map(({ i, pv }) => (
                    <tr key={i} className={i === plan.intensity ? 'me' : ''}>
                      <td>{INTENSITY[i].label}</td>
                      <td className="num">{pv.hours}</td>
                      <td className="num">{pv.totalPoints > 0 ? `+${pv.totalPoints.toFixed(2)}` : '–'}</td>
                      <td className="num">{pv.fatiguePerSession}</td>
                      <td className="num">{pv.injuryRiskWeek.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
            <p className="mt-2 text-xs text-ink-400">Growth is in attribute points across all attributes, from your current age, potential, playing time and condition. A fractional gain accumulates until it becomes a whole point.</p>
          </Card>

          <Card title="Match instruction">
            <div className="mb-3"><Help>Applies to your player in every match you play. The manager still chooses the tactics.</Help></div>
            <div role="radiogroup" aria-label="Match instruction" className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(INSTRUCTION_LABEL) as PlayerInstruction[]).map((k) => (
                <button key={k} role="radio" aria-checked={plan.matchInstruction === k}
                  onClick={() => set({ matchInstruction: k }, `Match instruction: ${INSTRUCTION_LABEL[k].label.toLowerCase()}.`)}
                  className={clsx('rounded-md border px-3 py-2 text-left', plan.matchInstruction === k ? 'border-pitch-500 bg-pitch-900/30' : 'border-ink-700 hover:border-ink-500')}>
                  <span className="block text-sm font-medium text-ink-50">{INSTRUCTION_LABEL[k].label}</span>
                  <span className="block text-xs text-ink-300">{INSTRUCTION_LABEL[k].blurb}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Recent attribute changes" pad={false}>
            {recent.length === 0 ? <div className="p-4"><Empty title="No changes yet" body="Attributes move in whole points once enough progress has built up. Each change is listed here with its reason." /></div> : (
              <ul className="divide-y divide-ink-800">
                {recent.map((c, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2 text-sm">
                    <span className="w-14 shrink-0 text-xs text-ink-400">{formatShort(c.day)}</span>
                    <span className="min-w-0 flex-1"><span className="font-medium text-ink-50">{ATTR_LABEL[c.attr]}</span> <span className="text-ink-300">{c.reason}</span></span>
                    <span className={clsx('shrink-0 font-semibold', c.to > c.from ? 'text-pitch-400' : 'text-bad-400')}>{c.from} → {c.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Your condition">
            <ConditionMeters p={user} compact />
            <p className="mt-3 text-xs text-ink-300">{preview.recoveryNote}</p>
          </Card>

          <Card title="Expected growth this week">
            {preview.weeklyPoints.length === 0 ? (
              <p className="text-sm text-ink-300">At {age} your attributes are no longer growing. Training protects what you have, and recovery slows the decline.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {preview.weeklyPoints.map((w) => (
                  <li key={w.attr}>
                    <div className="mb-0.5 flex items-baseline justify-between text-xs">
                      <span className={clsx(focusSet.has(w.attr) ? 'font-medium text-pitch-400' : 'text-ink-200')}>{w.label}</span>
                      <span className="text-ink-300">+{w.pts.toFixed(2)}</span>
                    </div>
                    <Bar value={w.pts} max={maxPts} color={focusSet.has(w.attr) ? 'bg-pitch-500' : 'bg-ink-500'} label={w.label} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-400">Total about +{preview.totalPoints.toFixed(2)} attribute points a week.</p>
          </Card>

          <Card title="What is shaping your growth">
            <p className="mb-2 text-sm text-ink-200">Overall growth rate: <span className={clsx('font-semibold', preview.multiplier >= 1 ? 'text-pitch-400' : 'text-warn-400')}>{(preview.multiplier * 100).toFixed(0)}%</span> of the baseline for your age.</p>
            <ul className="flex flex-col gap-1">
              {preview.parts.map((p) => (
                <li key={p.label} className="flex items-center justify-between text-sm">
                  <span className="text-ink-200">{p.label}</span>
                  <Chip tone={p.value > 1.005 ? 'good' : p.value < 0.995 ? 'bad' : undefined}>{signed((p.value - 1) * 100)}%</Chip>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
