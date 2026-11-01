/**
 * Small synthesised sound cues for match day (no audio files, so nothing to download or license).
 * Everything is a no-op when sound is off, when the browser has no Web Audio, or before the first user gesture
 * has let the audio context start. Volume is the player's own setting, 0..1.
 */

export type Cue = 'whistle' | 'whistleLong' | 'goal' | 'chance' | 'yellow' | 'red' | 'notify';

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { ctx = null; }
  return ctx;
}

export const soundSupported = (): boolean => typeof window !== 'undefined' && !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);

/** Call from a click handler so the browser lets sound start later (autoplay policy). */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  // a fixed pseudo-random sequence keeps the "crowd" the same every time and never touches the simulation's random stream
  let s = 123456789;
  for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 0xffffffff) * 2 - 1; }
  noiseBuf = buf;
  return buf;
}

function tone(c: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, start: number, dur: number, gain: number): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, start);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.03, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function swell(c: AudioContext, out: AudioNode, start: number, dur: number, peak: number, freq: number, q: number): void {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(start);
  src.stop(start + dur + 0.05);
}

function whistle(c: AudioContext, out: AudioNode, start: number, dur: number): void {
  const o = c.createOscillator();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = 2900;
  lfo.frequency.value = 32;
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
  g.gain.setValueAtTime(0.5, start + dur - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start); lfo.start(start);
  o.stop(start + dur + 0.05); lfo.stop(start + dur + 0.05);
}

/** Play one cue. `volume` is 0..1 and scales a master gain that is already kept modest. */
export function playCue(cue: Cue, opts: { enabled: boolean; volume: number }): void {
  if (!opts.enabled || opts.volume <= 0) return;
  const c = context();
  if (!c || c.state !== 'running') { if (c) unlockAudio(); if (!c || c.state !== 'running') return; }
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, opts.volume)) * 0.35;
  master.connect(c.destination);
  const t = c.currentTime + 0.01;
  switch (cue) {
    case 'whistle': whistle(c, master, t, 0.35); break;
    case 'whistleLong': whistle(c, master, t, 0.5); whistle(c, master, t + 0.65, 0.5); break;
    case 'goal':
      swell(c, master, t, 1.9, 0.55, 900, 0.7);
      [523.25, 659.25, 783.99].forEach((f, i) => tone(c, master, 'triangle', f, f, t + i * 0.09, 0.5, 0.35));
      break;
    case 'chance': swell(c, master, t, 0.8, 0.35, 700, 0.9); break;
    case 'yellow': tone(c, master, 'square', 620, 520, t, 0.14, 0.18); tone(c, master, 'square', 620, 520, t + 0.18, 0.14, 0.18); break;
    case 'red': tone(c, master, 'sawtooth', 220, 150, t, 0.5, 0.3); whistle(c, master, t, 0.45); break;
    case 'notify': tone(c, master, 'sine', 880, 880, t, 0.14, 0.3); tone(c, master, 'sine', 1174.66, 1174.66, t + 0.12, 0.22, 0.3); break;
  }
}
