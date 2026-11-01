import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { useGame } from '../../store/hooks';
import { commentaryFor, minuteLabel, type CommentaryLine } from '../../engine/commentary';
import { Card, Chip, Segmented } from '../kit';
import { PitchView } from '../Pitch';
import { ClubTag } from '../parts';
import { MatchReportView } from './MatchReportView';
import { clsx } from '../format';
import { Crest } from '../art';
import { playCue, unlockAudio } from '../sound';

/** Match seconds that pass per real second at 1× (a whole match takes just under four minutes). */
const BASE_RATE = 24;
const SPEEDS = [1, 2, 4, 10];

function lineClass(l: CommentaryLine): string {
  switch (l.kind) {
    case 'goal': return 'border-l-2 border-pitch-500 bg-pitch-900/30 font-semibold text-ink-50';
    case 'card': return 'border-l-2 border-warn-400 text-ink-50';
    case 'injury': return 'border-l-2 border-bad-500 text-ink-50';
    case 'save': case 'chance': return 'border-l-2 border-info-400/60 text-ink-100';
    case 'sub': return 'border-l-2 border-ink-500 text-ink-200';
    case 'info': return 'border-l-2 border-ink-600 text-ink-300 italic';
    default: return 'border-l-2 border-transparent text-ink-300';
  }
}

export function LiveMatch() {
  const g = useGame();
  const session = useStore((s) => s.session)!;
  const finishMatch = useStore((s) => s.finishMatch);
  const reduced = g.settings.reducedMotion;
  const rec = session.record;
  const mode = session.mode;
  const total = Math.max(1, rec.result.durationSeconds);
  const [vt, setVt] = useState(mode === 'instant' ? total + 1 : 0);
  const [playing, setPlaying] = useState(mode !== 'instant');
  const [speed, setSpeed] = useState(reduced ? 4 : Math.max(1, Math.min(10, Math.round(g.settings.commentarySpeed))) || 1);
  const [follow, setFollow] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => commentaryFor(rec, mode === 'visual' ? 'key' : 'full'), [rec, mode]);
  const keyTimes = useMemo(() => rec.result.events.filter((e) => ['goal', 'own_goal', 'big_chance', 'save', 'woodwork', 'red', 'penalty_awarded', 'half_time', 'full_time'].includes(e.type)).map((e) => e.t), [rec]);
  const finished = vt >= total;

  useEffect(() => {
    if (!playing || finished) return;
    const id = setInterval(() => setVt((v) => Math.min(total + 1, v + 0.1 * BASE_RATE * speed)), 100);
    return () => clearInterval(id);
  }, [playing, finished, speed, total]);

  useEffect(() => { if (finished) setPlaying(false); }, [finished]);

  // sound cues for events that pass while the match is actually playing (never when skipping or scrubbing)
  const lastVt = useRef(vt);
  useEffect(() => { unlockAudio(); }, []);
  useEffect(() => {
    const prev = lastVt.current;
    lastVt.current = vt;
    if (!playing || vt <= prev || vt - prev > 0.1 * BASE_RATE * speed * 1.6 + 1) return;
    const opts = { enabled: g.settings.sound, volume: g.settings.volume };
    for (const e of rec.result.events) {
      if (e.t <= prev) continue;
      if (e.t > vt) break;
      if (e.type === 'goal' || e.type === 'own_goal') playCue('goal', opts);
      else if (e.type === 'yellow') playCue('yellow', opts);
      else if (e.type === 'red') playCue('red', opts);
      else if (e.type === 'big_chance' || e.type === 'woodwork' || e.type === 'penalty_awarded') playCue('chance', opts);
      else if (e.type === 'kickoff' || e.type === 'second_half') playCue('whistle', opts);
      else if (e.type === 'half_time' || e.type === 'full_time') playCue('whistleLong', opts);
    }
  }, [vt, playing, speed, rec, g.settings.sound, g.settings.volume]);

  const shown = useMemo(() => lines.filter((l) => l.t <= vt), [lines, vt]);
  useEffect(() => {
    if (follow && feedRef.current) feedRef.current.scrollTop = 0;
  }, [shown.length, follow]);

  // score and clock at the current moment
  const { score, clock, period } = useMemo(() => {
    const s: [number, number] = [0, 0];
    let label = "0'";
    let per = 1;
    for (const e of rec.result.events) {
      if (e.t > vt) break;
      if (e.type === 'goal') s[e.side]++;
      else if (e.type === 'own_goal') s[(1 - e.side) as 0 | 1]++;
      label = minuteLabel(e);
      per = e.period;
    }
    if (vt >= total) { s[0] = rec.result.hg; s[1] = rec.result.ag; }
    return { score: s, clock: vt >= total ? 'FT' : label, period: per };
  }, [rec, vt, total]);

  const home = g.clubs[rec.homeId];
  const away = g.clubs[rec.awayId];
  const homeNation = g.nations[rec.homeId];
  const awayNation = g.nations[rec.awayId];

  const userStats = rec.result.players[g.userId];
  const userNow = (() => {
    if (!userStats) return rec.userSummary?.selected === 'injured' ? 'Injured' : rec.userSummary?.selected === 'suspended' ? 'Suspended' : 'Not in the squad';
    const min = vt / 60;
    if (userStats.started) return userStats.offMin !== null && min >= userStats.offMin ? 'Substituted' : 'On the pitch';
    if (userStats.onMin !== null) return min >= userStats.onMin ? 'On the pitch' : 'On the bench';
    return 'On the bench';
  })();

  const jump = (t: number) => { setVt(Math.max(0, Math.min(total + 1, t))); };
  const nextKey = () => { const n = keyTimes.find((t) => t > vt + 2); jump(n !== undefined ? n - 1 : total + 1); };

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="card sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center justify-center gap-4 sm:justify-start">
          <div className="flex min-w-0 items-center gap-2 text-right">
            <span className="hidden truncate text-sm font-semibold text-ink-50 sm:inline">{rec.homeName}</span>
            {home ? <Crest crest={home.crest} size={30} /> : homeNation && <Crest crest={homeNation.crest} size={30} />}
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold tabular-nums text-ink-50" aria-live="polite">{score[0]} – {score[1]}</div>
            <div className={clsx('text-xs font-semibold', finished ? 'text-ink-300' : 'text-pitch-400')}>{clock}{period >= 3 && !finished ? ' · ET' : ''}</div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {away ? <Crest crest={away.crest} size={30} /> : awayNation && <Crest crest={awayNation.crest} size={30} />}
            <span className="hidden truncate text-sm font-semibold text-ink-50 sm:inline">{rec.awayName}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={userNow === 'On the pitch' ? 'good' : undefined}>{userNow}</Chip>
          <span className="text-xs text-ink-300">{rec.compName}{rec.round ? ` · ${rec.round}` : ''}</span>
        </div>
      </header>

      {!finished && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-2.5" role="group" aria-label="Playback controls">
          <button className="btn btn-primary btn-sm w-20" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Resume'}</button>
          <Segmented size="sm" label="Speed" value={speed} onChange={setSpeed} options={SPEEDS.map((s) => ({ id: s, label: `${s}×` }))} />
          <button className="btn btn-sm" onClick={nextKey}>Next moment</button>
          <button className="btn btn-sm" onClick={() => jump(total + 1)}>Skip to full time</button>
          <input type="range" min={0} max={total} value={Math.min(vt, total)} onChange={(e) => jump(Number(e.target.value))} aria-label="Match progress" className="ml-auto h-1.5 min-w-32 flex-1 cursor-pointer appearance-none rounded-full bg-ink-700 accent-emerald-500" />
        </div>
      )}

      {mode !== 'instant' && !finished && (
        <div className={clsx('grid gap-4', mode === 'visual' ? 'lg:grid-cols-[1.6fr_1fr]' : '')}>
          {mode === 'visual' && <PitchView g={g} rec={rec} t={Math.min(vt, total)} />}
          <Card title={mode === 'visual' ? 'Key moments' : 'Commentary'} pad={false} actions={<label className="flex items-center gap-1.5 text-xs text-ink-300"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow latest</label>}>
            <div ref={feedRef} className={clsx('overflow-y-auto px-3 py-2', mode === 'visual' ? 'max-h-[28rem]' : 'max-h-[60vh] min-h-[24rem]')} aria-live="off">
              {shown.length === 0 ? <p className="py-6 text-center text-sm text-ink-400">Waiting for kick-off…</p> : (
                <ul className="flex flex-col gap-1">
                  {[...shown].reverse().slice(0, 120).map((l) => (
                    <li key={l.i} className={clsx('flex gap-3 rounded-r px-2 py-1.5 text-sm slide-in', lineClass(l))}>
                      <span className="w-12 shrink-0 text-xs font-medium text-ink-400">{l.minute}</span>
                      <span>{l.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}

      {finished && (
        <>
          <MatchReportView g={g} rec={rec} />
          {session.devRecord && (
            <Card title="Reserves match">
              <p className="text-sm text-ink-200">
                <ClubTag club={g.clubs[session.devRecord.homeId]} size={16} /> <span className="mx-2 font-semibold text-ink-50">{session.devRecord.result.hg}–{session.devRecord.result.ag}</span> <ClubTag club={g.clubs[session.devRecord.awayId]} size={16} />
              </p>
              {session.devRecord.userSummary && session.devRecord.userSummary.minutes > 0 && (
                <p className="mt-1 text-xs text-ink-300">You played {session.devRecord.userSummary.minutes} minutes{session.devRecord.userSummary.rating !== null ? `, rating ${session.devRecord.userSummary.rating.toFixed(1)}` : ''}.</p>
              )}
            </Card>
          )}
          <div className="flex justify-end gap-2 pb-6">
            <button className="btn btn-primary btn-lg" onClick={finishMatch} data-autofocus>Continue</button>
          </div>
        </>
      )}
    </div>
  );
}
