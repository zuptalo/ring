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
  | 'beacon'
  // Call-progress cues (caller side): looped while dialing, looped once the callee's
  // device acknowledges (ringing), and a one-shot when nobody answers.
  | 'calling'
  | 'ringing'
  | 'noanswer'
  // In-call state + control cues (spec 0004 US5): one-shots fired on call-state transitions
  // and on the user's mute/camera toggles, plus a "call is full" refusal and a quiet cue for
  // a chat message arriving during a call.
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'callended'
  | 'mute'
  | 'unmute'
  | 'cameraon'
  | 'cameraoff'
  | 'callfull'
  | 'incallmsg'
  // Classic "busy" signal played on the caller's screen when the callee is on another call.
  | 'busy'
  // Call-waiting cues (spec 0005): a second-call alert (distinct from the normal incoming
  // ring), and confirmations for putting a call on hold, resuming it, and swapping.
  | 'callwaiting'
  | 'hold'
  | 'resume'
  | 'swap'
  // Played to the party coming OFF hold, alongside the 5s "you're about to be visible" countdown.
  | 'resuming'
  // In-chat game cues (spec 0008 FR-026): the match call when a game starts (and on a
  // rematch), a soft tick per accepted move, a small win fanfare, a warm losing descent,
  // and a neutral pair for a draw. Played only while the game's chat is open, behind the
  // "Game sounds" toggle.
  | 'gamestart'
  | 'gamemove'
  | 'gamewin'
  | 'gamelose'
  | 'gamedraw'
  // Group challenge cues (spec 0009): the announcement fanfare-let and the
  // "someone's in!" confirmation.
  | 'gamechallenge'
  | 'gameaccept';

interface Note {
  freq: number;
  start: number; // seconds from now
  dur: number; // seconds
  type?: OscillatorType;
  gain?: number; // peak gain (0..1)
}

// Note frequencies (equal-tempered).
const E6 = 1318.51;
const C6 = 1046.5;
const B5 = 987.77;
const G5 = 783.99;
const E5 = 659.25;
const D5 = 587.33;
const C5 = 523.25;
const A5 = 880.0;
const A4 = 440.0;
const F4 = 349.23;
const Bb4 = 466.16;

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
  // Caller "calling" ringback: a mellow low double-beep, looped before the callee
  // acknowledges.
  calling: [
    { freq: D5, start: 0, dur: 0.18, type: 'sine', gain: 0.22 },
    { freq: A4, start: 0.22, dur: 0.22, type: 'sine', gain: 0.22 },
  ],
  // Caller "ringing": a brighter rising triple, looped once their device is ringing.
  ringing: [
    { freq: E5, start: 0, dur: 0.13, type: 'triangle', gain: 0.26 },
    { freq: A5, start: 0.13, dur: 0.13, type: 'triangle', gain: 0.26 },
    { freq: C6, start: 0.27, dur: 0.18, type: 'triangle', gain: 0.26 },
  ],
  // Caller "no answer": a descending three-note, played once at timeout.
  noanswer: [
    { freq: D5, start: 0, dur: 0.18, type: 'sine', gain: 0.25 },
    { freq: Bb4, start: 0.22, dur: 0.2, type: 'sine', gain: 0.22 },
    { freq: F4, start: 0.44, dur: 0.34, type: 'sine', gain: 0.2 },
  ],
  // In-call cues — deliberately short + quiet so they inform without nagging.
  connecting: [{ freq: A4, start: 0, dur: 0.13, type: 'sine', gain: 0.16 }],
  connected: [
    { freq: E5, start: 0, dur: 0.1, type: 'sine', gain: 0.2 },
    { freq: A5, start: 0.1, dur: 0.16, type: 'sine', gain: 0.2 },
  ],
  reconnecting: [
    { freq: F4, start: 0, dur: 0.12, type: 'sine', gain: 0.16 },
    { freq: F4, start: 0.18, dur: 0.14, type: 'sine', gain: 0.14 },
  ],
  callended: [
    { freq: A4, start: 0, dur: 0.14, type: 'sine', gain: 0.18 },
    { freq: F4, start: 0.15, dur: 0.22, type: 'sine', gain: 0.16 },
  ],
  mute: [{ freq: 320, start: 0, dur: 0.09, type: 'sine', gain: 0.18 }],
  unmute: [{ freq: 520, start: 0, dur: 0.09, type: 'sine', gain: 0.18 }],
  cameraon: [
    { freq: C5, start: 0, dur: 0.08, type: 'triangle', gain: 0.18 },
    { freq: E5, start: 0.08, dur: 0.12, type: 'triangle', gain: 0.18 },
  ],
  cameraoff: [
    { freq: E5, start: 0, dur: 0.08, type: 'triangle', gain: 0.18 },
    { freq: C5, start: 0.08, dur: 0.12, type: 'triangle', gain: 0.16 },
  ],
  callfull: [
    { freq: 220, start: 0, dur: 0.12, type: 'square', gain: 0.16 },
    { freq: 220, start: 0.18, dur: 0.12, type: 'square', gain: 0.16 },
  ],
  incallmsg: [{ freq: A5, start: 0, dur: 0.1, type: 'sine', gain: 0.12 }],
  // A recognizable two-beep busy signal (low, repeated), like a phone busy tone.
  busy: [
    { freq: 480, start: 0, dur: 0.26, type: 'sine', gain: 0.2 },
    { freq: 480, start: 0.38, dur: 0.26, type: 'sine', gain: 0.2 },
  ],
  // Call-waiting alert: two equal high beeps — the classic "another call" tone, distinct
  // from the rising incoming ring (beacon/ringing).
  callwaiting: [
    { freq: C6, start: 0, dur: 0.1, type: 'sine', gain: 0.24 },
    { freq: C6, start: 0.24, dur: 0.1, type: 'sine', gain: 0.24 },
  ],
  // Hold: a gentle DESCENDING pair (the call steps back).
  hold: [
    { freq: A5, start: 0, dur: 0.1, type: 'sine', gain: 0.18 },
    { freq: E5, start: 0.1, dur: 0.16, type: 'sine', gain: 0.16 },
  ],
  // Resume: an ASCENDING pair (the call comes back) — mirror of hold.
  resume: [
    { freq: E5, start: 0, dur: 0.1, type: 'sine', gain: 0.18 },
    { freq: A5, start: 0.1, dur: 0.16, type: 'sine', gain: 0.18 },
  ],
  // Swap: a brisk two-note flip up, distinct from resume.
  swap: [
    { freq: G5, start: 0, dur: 0.08, type: 'triangle', gain: 0.18 },
    { freq: C6, start: 0.08, dur: 0.12, type: 'triangle', gain: 0.18 },
  ],
  // Resuming (coming off hold): a brighter, more insistent rising arpeggio (triangle, up into the
  // high register, a touch louder) so it actually grabs attention before you go live — repeated a
  // couple of times across the countdown by the caller. Still short, so it's noticeable not annoying.
  resuming: [
    { freq: G5, start: 0, dur: 0.09, type: 'triangle', gain: 0.26 },
    { freq: C6, start: 0.11, dur: 0.09, type: 'triangle', gain: 0.28 },
    { freq: E6, start: 0.22, dur: 0.22, type: 'triangle', gain: 0.32 },
  ],
  // Game start / rematch "match call": a playful rising triple — an invitation,
  // brighter than beacon but shorter than ringing.
  gamestart: [
    { freq: C5, start: 0, dur: 0.09, type: 'triangle', gain: 0.22 },
    { freq: E5, start: 0.09, dur: 0.09, type: 'triangle', gain: 0.22 },
    { freq: A5, start: 0.18, dur: 0.18, type: 'triangle', gain: 0.24 },
  ],
  // A move landing: one soft tick, quiet on purpose — it plays often.
  gamemove: [{ freq: 660, start: 0, dur: 0.07, type: 'sine', gain: 0.14 }],
  // Winning: a small four-note fanfare climbing to the octave.
  gamewin: [
    { freq: C5, start: 0, dur: 0.1, type: 'triangle', gain: 0.22 },
    { freq: E5, start: 0.1, dur: 0.1, type: 'triangle', gain: 0.24 },
    { freq: G5, start: 0.2, dur: 0.1, type: 'triangle', gain: 0.26 },
    { freq: C6, start: 0.3, dur: 0.26, type: 'triangle', gain: 0.3 },
  ],
  // Losing: a warm three-note descent — gentle, never a sad trombone.
  gamelose: [
    { freq: E5, start: 0, dur: 0.12, type: 'sine', gain: 0.2 },
    { freq: C5, start: 0.12, dur: 0.14, type: 'sine', gain: 0.18 },
    { freq: A4, start: 0.27, dur: 0.22, type: 'sine', gain: 0.16 },
  ],
  // Draw: two equal mid notes — even, unresolved, like the game.
  gamedraw: [
    { freq: A4, start: 0, dur: 0.12, type: 'sine', gain: 0.16 },
    { freq: A4, start: 0.16, dur: 0.12, type: 'sine', gain: 0.16 },
  ],
  // A challenge lands: a bold rising fourth + flourish — an invitation with
  // swagger, longer than gamestart so it reads as an announcement.
  gamechallenge: [
    { freq: G5, start: 0, dur: 0.1, type: 'triangle', gain: 0.24 },
    { freq: C6, start: 0.1, dur: 0.1, type: 'triangle', gain: 0.26 },
    { freq: G5, start: 0.22, dur: 0.08, type: 'triangle', gain: 0.2 },
    { freq: E6, start: 0.32, dur: 0.22, type: 'triangle', gain: 0.28 },
  ],
  // Someone took the seat: a bright, quick two-note confirmation.
  gameaccept: [
    { freq: C5, start: 0, dur: 0.09, type: 'triangle', gain: 0.22 },
    { freq: G5, start: 0.09, dur: 0.16, type: 'triangle', gain: 0.24 },
  ],
};

/** All defined recipe names (for tests / completeness checks). */
export const RECIPE_NAMES: string[] = Object.keys(RECIPES);

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

/* ---- one-shot call cues (rate-limited) ---- */

// Suppress a repeat of the SAME cue within this window so rapid mute/unmute or reconnect
// flapping can't produce a storm of beeps (spec 0004 US5).
const CUE_DEDUP_MS = 400;
const lastCueAt = new Map<string, number>();

/** Pure rate-limit decision: returns whether `name` may play now, recording the time if so.
 *  Exposed (and `now` injectable) for unit testing without the Web Audio layer. */
export function claimCue(name: string, now: number = Date.now()): boolean {
  const prev = lastCueAt.get(name) ?? -Infinity;
  if (now - prev < CUE_DEDUP_MS) return false;
  lastCueAt.set(name, now);
  return true;
}

// e2e cue recording: off by default (null) so production has zero overhead. The dev test
// hook flips it on to assert WHICH cues fired across call-state transitions and that they go
// silent when "Call sounds" is off (the gate lives in the caller, so a recorded cue means it
// passed the gate and de-dup).
let cueLog: string[] | null = null;
export function recordCues(on: boolean): void {
  cueLog = on ? [] : null;
}
export function recordedCues(): string[] {
  return cueLog ? [...cueLog] : [];
}

/** Play a one-shot call cue, rate-limited per cue name. No-op for blocked/absent audio
 *  (playTone handles that). Caller decides whether cues are enabled (the "Call sounds"
 *  setting); this only de-dupes and plays. */
export function cue(name: ToneName): void {
  if (claimCue(name)) {
    cueLog?.push(name);
    playTone(name);
  }
}
