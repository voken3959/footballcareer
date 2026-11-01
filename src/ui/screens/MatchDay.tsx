import { useEffect } from 'react';
import { useDerived, useGame } from '../../store/hooks';
import { useStore } from '../../store/store';
import { Card, Chip, Empty, PageHeader } from '../kit';
import { ClubTag, FormPips } from '../parts';
import { clsx, ordinal, ratingClass, dateWithOffset } from '../format';
import { previewMatch } from '../../engine/game';
import { pendingUserFixture } from '../../engine/daily';
import { FORMATIONS } from '../../engine/formations';
import { overall, slotRating } from '../../engine/attributes';
import type { PlayerInstruction } from '../../engine/types';
import type { PlayMode } from '../../engine/game';
import { nationName } from '../../engine/names';

const INSTRUCTIONS: { id: PlayerInstruction; label: string; hint: string }[] = [
  { id: 'default', label: 'Normal game', hint: 'Play to your position and the manager’s plan.' },
  { id: 'shoot_more', label: 'Shoot more', hint: 'Take shooting chances early. More attempts, a few of them poor.' },
  { id: 'pass_more', label: 'Look to pass', hint: 'Keep it simple and involve team-mates. Fewer shots, more creation.' },
  { id: 'dribble_more', label: 'Take players on', hint: 'Run at defenders. Can unlock a defence or lose the ball.' },
  { id: 'stay_back', label: 'Stay disciplined', hint: 'Hold your position and avoid risks. Safer, less spectacular.' },
];

const MODES: { id: PlayMode; label: string; blurb: string }[] = [
  { id: 'instant', label: 'Instant result', blurb: 'Play the match and go straight to the report.' },
  { id: 'commentary', label: 'Live text', blurb: 'Follow the match through commentary, minute by minute.' },
  { id: 'visual', label: '2D replay', blurb: 'Watch the match unfold on the pitch with commentary alongside.' },
];

function StrengthRow({ label, a, b }: { label: string; a: number; b: number }) {
  const d = a - b;
  return (
    <div className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 py-1 text-sm">
      <span className={clsx('text-right font-semibold tabular-nums', d >= 0 ? 'text-pitch-400' : 'text-ink-100')}>{Math.round(a)}</span>
      <span className="text-center text-xs text-ink-300">{label}</span>
      <span className={clsx('font-semibold tabular-nums', d < 0 ? 'text-pitch-400' : 'text-ink-100')}>{Math.round(b)}</span>
    </div>
  );
}

export function MatchDay() {
  const g = useGame();
  const go = useStore((s) => s.go);
  const act = useStore((s) => s.act);
  const playMatch = useStore((s) => s.playMatch);
  const pending = pendingUserFixture(g);
  const pv = useDerived((gg) => (pendingUserFixture(gg) ? previewMatch(gg) : null), [g.day]);
  const user = g.players[g.userId];
  useEffect(() => { if (!pending) go('home'); }, [pending, go]);
  if (!pending || !pv) return <Empty title="No match today" action={<button className="btn btn-primary" onClick={() => go('home')}>Back to Home</button>} />;

  const f = pending.fixture;
  const isClub = pending.kind === 'club';
  const homeClub = isClub ? g.clubs[f.homeId] : undefined;
  const awayClub = isClub ? g.clubs[f.awayId] : undefined;
  const sel = pv.selection;
  const mySide = pv.userClubSide;
  const instruction = g.training.plan.matchInstruction;
  const pref = g.settings.simPreference;
  const sty = pv.strength;
  const forme = pv.form;

  const lineup = sel ? sel.lineup : [];
  const slots = sel ? FORMATIONS[sel.formation].slots : [];
  const rows: { line: string; items: { p: (typeof lineup)[number]; pos: string }[] }[] = [];
  for (const line of ['att', 'mid', 'def', 'gk'] as const) {
    const items = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.line === line).map(({ s, i }) => ({ p: lineup[i], pos: s.pos })).filter((x) => x.p);
    if (items.length) rows.push({ line, items });
  }

  return (
    <>
      <PageHeader
        title="Match day"
        subtitle={`${pv.competition}${pv.round ? ` · ${pv.round}` : ''} · ${dateWithOffset(g, f.day)}`}
        actions={<button className="btn btn-ghost" onClick={() => go('home')}>Back</button>}
      />
      <Card className="mb-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
          <div className="flex flex-col items-center gap-1">
            {homeClub ? <ClubTag club={homeClub} size={42} className="flex-col text-base" bold /> : <span className="text-lg font-semibold text-ink-50">{nationName(f.homeId)}</span>}
            {forme && <FormPips form={forme.home} />}
            {pv.table && <span className="text-xs text-ink-300">{ordinal(pv.table.home)} in the league</span>}
          </div>
          <div className="text-2xl font-bold text-ink-400">v</div>
          <div className="flex flex-col items-center gap-1">
            {awayClub ? <ClubTag club={awayClub} size={42} className="flex-col text-base" bold /> : <span className="text-lg font-semibold text-ink-50">{nationName(f.awayId)}</span>}
            {forme && <FormPips form={forme.away} />}
            {pv.table && <span className="text-xs text-ink-300">{ordinal(pv.table.away)} in the league</span>}
          </div>
        </div>
        {f.neutral && <p className="mt-2 text-center text-xs text-ink-300">Played at a neutral venue.</p>}
        {f.knockout && <p className="mt-1 text-center text-xs text-warn-400">Knockout tie: extra time and penalties if level.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Your situation">
            <div className="flex flex-wrap items-center gap-2">
              {pv.status && <Chip tone={pv.status === 'start' ? 'good' : pv.status === 'bench' ? 'warn' : 'bad'}>{pv.status === 'start' ? 'Starting' : pv.status === 'bench' ? 'On the bench' : 'Out of the squad'}</Chip>}
              <Chip>Form {pv.playerForm}</Chip>
              <Chip>Fatigue {Math.round(user.cond.fatigue)}</Chip>
              <Chip>Sharpness {Math.round(user.cond.sharpness)}</Chip>
              <Chip>Morale {Math.round(user.cond.morale)}</Chip>
              <Chip>Importance {Math.round(pv.importance * 100)}%</Chip>
            </div>
            {pv.reasons.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-200">{pv.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {!isClub && <p className="mt-3 text-sm text-ink-200">You are representing {nationName(g.international.nation)}. The national team’s manager picks the eleven.</p>}
          </Card>

          {sel && (
            <Card title={`Expected line-up · ${FORMATIONS[sel.formation].name}`}>
              <div className="rounded-lg bg-gradient-to-b from-emerald-900/40 to-emerald-950/40 p-3">
                <div className="flex flex-col gap-3">
                  {rows.map((r) => (
                    <div key={r.line} className="flex flex-wrap justify-center gap-2">
                      {r.items.map(({ p, pos }) => (
                        <div key={p.id} className={clsx('min-w-[5.5rem] rounded-md border px-2 py-1 text-center', p.id === g.userId ? 'border-gold-400 bg-gold-400/10' : 'border-ink-600 bg-ink-900/70')}>
                          <div className="text-[10px] text-ink-400">{pos}</div>
                          <div className="truncate text-xs font-medium text-ink-50">{p.displayName}</div>
                          <div className={clsx('text-xs font-semibold', ratingClass(slotRating(p, pos as never)))}>{Math.round(slotRating(p, pos as never))}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 text-xs text-ink-300">
                <span className="font-medium text-ink-200">Bench: </span>
                {sel.bench.map((p) => (
                  <span key={p.id} className={clsx('mr-2 inline-block', p.id === g.userId && 'font-semibold text-gold-400')}>{p.displayName} ({p.position} {Math.round(overall(p))})</span>
                ))}
              </div>
              {sel.unavailable.length > 0 && (
                <div className="mt-2 text-xs text-ink-400">
                  <span className="font-medium text-ink-300">Unavailable: </span>
                  {sel.unavailable.map((u) => `${g.players[u.id]?.displayName ?? '?'} (${u.reason})`).join('; ')}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {mySide !== null && sty[0] && sty[1] && (
            <Card title="Team strength">
              <div className="mb-1 grid grid-cols-[3rem_1fr_3rem] gap-2 text-[11px] uppercase tracking-wide text-ink-400"><span className="text-right">{homeClub?.shortName}</span><span /><span>{awayClub?.shortName}</span></div>
              <StrengthRow label="Overall" a={sty[0].overall} b={sty[1].overall} />
              <StrengthRow label="Attack" a={sty[0].attack} b={sty[1].attack} />
              <StrengthRow label="Midfield" a={sty[0].midfield} b={sty[1].midfield} />
              <StrengthRow label="Defence" a={sty[0].defence} b={sty[1].defence} />
              <StrengthRow label="Goalkeeper" a={sty[0].keeper} b={sty[1].keeper} />
              <StrengthRow label="Freshness" a={sty[0].fitness} b={sty[1].fitness} />
              <p className="mt-2 text-xs text-ink-400">Estimated from the likely line-ups, fitness and form. The match itself still has to be played.</p>
            </Card>
          )}
          <Card title="Your instruction">
            <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Match instruction">
              {INSTRUCTIONS.map((i) => (
                <button key={i.id} role="radio" aria-checked={instruction === i.id} onClick={() => act((gg) => { gg.training.plan.matchInstruction = i.id; return { ok: true, message: '' }; }, { quiet: true })}
                  className={clsx('rounded-md border px-3 py-2 text-left text-sm', instruction === i.id ? 'border-pitch-500 bg-pitch-900/30' : 'border-ink-700 hover:border-ink-500')}>
                  <span className="block font-medium text-ink-50">{i.label}</span>
                  <span className="block text-xs text-ink-300">{i.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-400">Only applies if you play. It changes your own tendencies, not the team’s tactics.</p>
          </Card>
          <Card title="Play the match">
            <div className="flex flex-col gap-2">
              {MODES.map((m) => (
                <button key={m.id} className={clsx('btn flex-col items-start gap-0.5 py-2.5 text-left', (pref === m.id || (pref === 'ask' && m.id === 'commentary')) && 'btn-primary')} onClick={() => playMatch(m.id)}>
                  <span className="font-semibold">{m.label}</span>
                  <span className="text-xs font-normal opacity-80">{m.blurb}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-400">All three run the same simulation with the same result. Your usual choice can be set in Settings.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
