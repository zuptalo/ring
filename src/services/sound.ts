/**
 * Notification tones, synthesized with the Web Audio API.
 *
 * No audio files ship with the app. Every tone is generated on the fly from a
 * tiny note recipe (oscillator + gain envelope). That keeps them genuinely
 * royalty-free (nothing sampled or licensed), weightless, and theme-neutral.
 * The names here are the values in the settings schema's tone list.
 *
 * A single shared AudioContext is created lazily and resumed on demand. Mobile
 * browsers require a user gesture before audio plays, which the app has had by
 * the time a notification arrives (and tone previews in Settings are gestures).
 */

export type ToneName =
  | 'none'
  | 'note'
  | 'chime'
  | 'ping'
  | 'pop'
  | 'pulse'
  | 'glow'
  | 'beacon';

interface Note {
  freq: number;
  start: number; // seconds from now
  dur: number; // seconds
  type?: OscillatorType;
  gain?: number; // peak gain (0..1)
}

// Note frequencies (equal-tempered).
const E6 = 1318.51;
const B5 = 987.77;
const G5 = 783.99;
const E5 = 659.25;
const C5 = 523.25;
const A5 = 880.0;

const RECIPES: Record<Exclude<ToneName, 'none'>, Note[]> = {
  // Soft single blip, the default.
  note: [{ freq: A5, start: 0, dur: 0.18, type: 'sine' }],
  // Two ascending bell-like notes.
  chime: [
    { freq: E6, start: 0, dur: 0.16, type: 'triangle' },
    { freq: B5, start: 0.12, dur: 0.22, type: 'triangle' },
  ],
  // Bright, short ping.
  ping: [{ freq: E6, start: 0, dur: 0.14, type: 'sine', gain: 0.5 }],
  // Quick low pop.
  pop: [{ freq: 600, start: 0, dur: 0.08, type: 'sine' }],
  // Two equal beeps.
  pulse: [
    { freq: 720, start: 0, dur: 0.1, type: 'square', gain: 0.25 },
    { freq: 720, start: 0.16, dur: 0.1, type: 'square', gain: 0.25 },
  ],
  // Gentle rising sweep.
  glow: [
    { freq: 440, start: 0, dur: 0.12, type: 'sine' },
    { freq: 660, start: 0.1, dur: 0.2, type: 'sine' },
  ],
  // Three-note arpeggio.
  beacon: [
    { freq: C5, start: 0, dur: 0.12, type: 'triangle' },
    { freq: E5, start: 0.1, dur: 0.12, type: 'triangle' },
    { freq: G5, start: 0.2, dur: 0.22, type: 'triangle' },
  ],
};

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function playNote(ac: AudioContext, note: Note): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = note.type ?? 'sine';
  osc.frequency.value = note.freq;
  const t0 = ac.currentTime + note.start;
  const peak = note.gain ?? 0.3;
  // Short attack + exponential-ish decay for a soft, non-harsh envelope.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + note.dur + 0.02);
}

/** Play a notification tone by name. No-op for 'none' or when audio is blocked. */
export function playTone(name: string): void {
  if (!name || name === 'none') return;
  const recipe = RECIPES[name as Exclude<ToneName, 'none'>];
  if (!recipe) return;
  const ac = audioCtx();
  if (!ac) return;
  for (const note of recipe) playNote(ac, note);
}

/** Preview a tone (used when picking one in Settings). */
export const previewTone = playTone;

/* ---- looping ring tones (calls) ---- */

let loopTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Repeat a tone every periodMs, used for ringback (outgoing) and the incoming
 * ring. Only one loop runs at a time. Note: a tone started while the app hasn't
 * had a user gesture may be silently blocked (autoplay policy); backgrounded
 * incoming alerts rely on the OS push notification sound instead.
 */
export function startLoopTone(name: ToneName, periodMs: number): void {
  stopLoopTone();
  playTone(name);
  loopTimer = setInterval(() => playTone(name), periodMs);
}

export function stopLoopTone(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}
