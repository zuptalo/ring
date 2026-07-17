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
  | 'gameaccept'
  // Battleship foley (spec 1033): torpedo away, splash, impact, the groan of a
  // sinking boat, and the sonar ping when the scope is yours.
  | FxName;

/** Effect-layer cues (spec 1033): synthesized foley, not note recipes.
 *  The ar-* set (spec 1038) is Armada's richer naval foley — deck guns,
 *  shell splashes, armor hits, the full sinking sequence, and the victory
 *  march / defeat lament. Battleship keeps its original bs-* set untouched. */
export type FxName =
  | 'bs-fire'
  | 'bs-splash'
  | 'bs-hit'
  | 'bs-sunk'
  | 'bs-sonar'
  | 'ar-fire'
  | 'ar-splash'
  | 'ar-hit'
  | 'ar-sunk'
  | 'ar-sonar'
  | 'ar-victory'
  | 'ar-defeat';

interface Note {
  freq: number;
  start: number; // seconds from now
  dur: number; // seconds
  type?: OscillatorType;
  gain?: number; // peak gain (0..1)
}

/* ---- spec 1049: the alert-voice engine ----
 *
 * The 7 audible ALERT tones (the settings TONES list) no longer play as bare
 * oscillator beeps. Each is a sequence of STRIKES rendered like a small struck
 * instrument: several harmonically-related partials with independent decays
 * (bell / marimba / glass / wood spectra), each partial a ±4-cent detuned pair
 * for warmth, a soft attack with a tiny pitch settle so the note sounds struck
 * rather than switched on, and a shared bus that adds a subtle generated
 * reverb tail and compresses overlapping tones so bursts can't clip.
 *
 * Still zero audio files: the "reverb" impulse response is exponentially
 * decaying noise built on the fly — math, not a sample. The call/game cues and
 * the foley below deliberately keep their original engines and wiring, so they
 * sound byte-identical (spec 1049 FR-007). */

export type AlertToneName = 'note' | 'chime' | 'ping' | 'pop' | 'pulse' | 'glow' | 'beacon';

/** One component of a struck spectrum: a frequency ratio against the strike's
 *  fundamental, its relative level, and how fast it dies compared to the body
 *  (high partials decay quicker on real instruments — that's most of the realism). */
export interface AlertPartial {
  ratio: number;
  gain: number; // relative to the strike gain (0..1]
  durScale: number; // fraction of the strike's dur this partial rings for
}

export type TimbreName = 'marimba' | 'bell' | 'glass' | 'wood';

/** Struck-instrument spectra. Ratios: marimba ≈ harmonic-ish bar modes, bell =
 *  the classic inharmonic minor-third stack, glass = bright stretched partials,
 *  wood = a damped knock. Exported for the spec 1049 structural tests. */
export const TIMBRES: Record<TimbreName, AlertPartial[]> = {
  marimba: [
    { ratio: 1, gain: 1, durScale: 1 },
    { ratio: 4, gain: 0.24, durScale: 0.4 },
    { ratio: 9.2, gain: 0.07, durScale: 0.22 },
  ],
  bell: [
    { ratio: 1, gain: 1, durScale: 1 },
    { ratio: 2.0, gain: 0.34, durScale: 0.75 },
    { ratio: 2.74, gain: 0.2, durScale: 0.55 },
    { ratio: 5.4, gain: 0.08, durScale: 0.3 },
  ],
  glass: [
    { ratio: 1, gain: 1, durScale: 1 },
    { ratio: 2.32, gain: 0.38, durScale: 0.65 },
    { ratio: 4.25, gain: 0.16, durScale: 0.45 },
    { ratio: 6.63, gain: 0.06, durScale: 0.25 },
  ],
  wood: [
    { ratio: 1, gain: 1, durScale: 1 },
    { ratio: 2.8, gain: 0.16, durScale: 0.3 },
  ],
};

/** One struck note of an alert tone. */
export interface AlertStrike {
  freq: number; // fundamental (Hz)
  start: number; // seconds from now
  dur: number; // body decay (s); partials scale off this
  gain: number; // peak level of the fundamental pair
  timbre: TimbreName;
  attack?: number; // seconds; default 0.008 — 'glow' swells slower on purpose
}

/** The generated reverb tail's length — part of every tone's duration budget
 *  (structural test: max strike end + this ≤ 1.2 s). */
export const ALERT_TAIL_S = 0.45;

/** The 7 alert-tone redesigns (spec 1049). Same names, same recognizable
 *  characters as the old recipes — Note is still one soft note, Chime still its
 *  high falling pair, Beacon still a rising triple — they just sound like small
 *  instruments now instead of oscillators. 'pop' stays the LOWEST voice of the
 *  set (it is the default reaction tone, spec 1048, and must read as subtle). */
export const ALERT_TONES: Record<AlertToneName, AlertStrike[]> = {
  // A single warm marimba note — the default; the octave shimmer is the timbre's 4× partial.
  note: [{ freq: 880.0, start: 0, dur: 0.5, gain: 0.3, timbre: 'marimba' }],
  // Two small glass bells, the familiar high E6→B5 pair.
  chime: [
    { freq: 1318.51, start: 0, dur: 0.38, gain: 0.24, timbre: 'glass' },
    { freq: 987.77, start: 0.14, dur: 0.55, gain: 0.26, timbre: 'glass' },
  ],
  // One bright glass tick — short and light.
  ping: [{ freq: 1318.51, start: 0, dur: 0.28, gain: 0.24, timbre: 'glass' }],
  // A rounded low wooden thump — quick, quiet-friendly.
  pop: [{ freq: 330, start: 0, dur: 0.22, gain: 0.3, timbre: 'wood' }],
  // Two equal muted wood taps.
  pulse: [
    { freq: 720, start: 0, dur: 0.16, gain: 0.2, timbre: 'wood' },
    { freq: 720, start: 0.18, dur: 0.18, gain: 0.2, timbre: 'wood' },
  ],
  // A soft rising bell pair with a slower swell — keeps the old "gentle sweep" feel.
  glow: [
    { freq: 440.0, start: 0, dur: 0.34, gain: 0.22, timbre: 'bell', attack: 0.05 },
    { freq: 659.25, start: 0.12, dur: 0.5, gain: 0.24, timbre: 'bell', attack: 0.06 },
  ],
  // Three ascending bells — the arpeggio it has always been.
  beacon: [
    { freq: 523.25, start: 0, dur: 0.3, gain: 0.22, timbre: 'bell' },
    { freq: 659.25, start: 0.11, dur: 0.3, gain: 0.22, timbre: 'bell' },
    { freq: 783.99, start: 0.22, dur: 0.45, gain: 0.24, timbre: 'bell' },
  ],
};

/** All alert-tone names (spec 1049 structural tests). */
export const ALERT_TONE_NAMES: string[] = Object.keys(ALERT_TONES);

// Note frequencies (equal-tempered).
const E6 = 1318.51;
const C6 = 1046.5;
const G5 = 783.99;
const E5 = 659.25;
const D5 = 587.33;
const C5 = 523.25;
const A5 = 880.0;
const A4 = 440.0;
const F4 = 349.23;
const Bb4 = 466.16;

// The 7 user-facing alert tones moved to ALERT_TONES above (spec 1049); RECIPES
// now carries only the call/game cues, whose sound is deliberately untouched.
const RECIPES: Record<Exclude<ToneName, 'none' | FxName | AlertToneName>, Note[]> = {
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

/* ---- spec 1049: alert bus + strike renderer ---- */

// The shared output chain for alert tones: input → compressor → destination, with
// a parallel generated-reverb send. The compressor is the clip-guard — overlapping
// tones (a message burst, mashed previews) sum into it and get gently squashed
// instead of distorting. Built lazily once per context; cue/foley paths keep their
// original direct wiring (FR-007).
let alertBusInput: GainNode | null = null;
let alertBusCtx: AudioContext | null = null;

/** A tiny procedural room: stereo exponentially-decaying noise. An impulse
 *  response made of math — nothing sampled, keeping the module's no-assets rule. */
function generatedImpulse(ac: AudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(ac.sampleRate * ALERT_TAIL_S));
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Slight per-channel level + phase difference decorrelates L/R into "space".
    const lvl = ch ? 0.86 : 1;
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8) * lvl;
    }
  }
  return buf;
}

function alertBus(ac: AudioContext): GainNode {
  if (alertBusInput && alertBusCtx === ac) return alertBusInput;
  const input = ac.createGain();
  input.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  input.connect(comp); // dry
  const conv = ac.createConvolver();
  conv.buffer = generatedImpulse(ac);
  const wet = ac.createGain();
  wet.gain.value = 0.18; // a suggestion of a room, not a cathedral
  input.connect(conv);
  conv.connect(wet);
  wet.connect(comp);
  comp.connect(ac.destination);
  alertBusInput = input;
  alertBusCtx = ac;
  return input;
}

const CENT = Math.pow(2, 1 / 1200);

/** Render one struck note: each partial as a ±4-cent detuned oscillator pair with
 *  its own faster decay, a soft attack, and a tiny pitch settle on the fundamental
 *  so it reads as STRUCK, not switched on. All one-shot nodes with scheduled stops
 *  — nothing accumulates. */
function strike(ac: AudioContext, out: GainNode, s: AlertStrike): void {
  const t0 = ac.currentTime + s.start;
  const attack = s.attack ?? 0.008;
  for (const p of TIMBRES[s.timbre]) {
    const dur = Math.max(0.05, s.dur * p.durScale);
    for (const det of [-4, 4]) {
      const o = ac.createOscillator();
      o.type = 'sine';
      const f = s.freq * p.ratio * Math.pow(CENT, det);
      if (p.ratio === 1) {
        // The settle: land on pitch ~30ms after the hit.
        o.frequency.setValueAtTime(f * Math.pow(CENT, 8), t0);
        o.frequency.exponentialRampToValueAtTime(f, t0 + 0.03);
      } else {
        o.frequency.value = f;
      }
      const g = ac.createGain();
      // Halved: the detuned pair sums back to the strike/partial level.
      const peak = (s.gain * p.gain) / 2;
      g.gain.setValueAtTime(EPS, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
      o.connect(g);
      g.connect(out);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }
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
/* ---- synthesized sound effects (spec 1033) ----
 *
 * The note recipes above are melodic: fixed-frequency oscillator beeps. Real
 * FOLEY — explosions, water, sonar — is the other classic synthesis family:
 * filtered NOISE with swept envelopes. An explosion is a noise burst through a
 * closing low-pass over a sub-bass drop; a splash is a high-passed spray with
 * a pitch-falling bloop; a sonar ping is a long exponential sine decay with a
 * gentle bend and an echo. Still zero audio files, still royalty-free. */

const EPS = 0.0001; // exponential ramps cannot reach zero

let noiseBuf: AudioBuffer | null = null;
function noise(ac: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

/** Gain node with an attack + exponential-decay envelope. */
function env(ac: AudioContext, t0: number, peak: number, attack: number, end: number): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(EPS, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(EPS, t0 + end);
  return g;
}

/** Filtered-noise burst whose filter frequency sweeps f0 → f1. */
function noiseSweep(
  ac: AudioContext,
  t0: number,
  type: BiquadFilterType,
  f0: number,
  f1: number,
  sweep: number,
  q: number,
  peak: number,
  attack: number,
  end: number,
): void {
  const src = noise(ac);
  const filt = ac.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(f0, t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + sweep);
  filt.Q.value = q;
  const g = env(ac, t0, peak, attack, end);
  src.connect(filt).connect(g).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + end + 0.05);
}

/** Oscillator whose pitch sweeps f0 → f1 under an envelope. */
function oscSweep(
  ac: AudioContext,
  t0: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  sweep: number,
  peak: number,
  attack: number,
  end: number,
): void {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + sweep);
  const g = env(ac, t0, peak, attack, end);
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t0 + end + 0.05);
}

const FX: Record<string, (ac: AudioContext, t0: number) => void> = {
  // Torpedo away: a compressed-air whoosh (band-passed noise diving from
  // bright to low) over a soft launch thump.
  'bs-fire': (ac, t0) => {
    noiseSweep(ac, t0, 'bandpass', 2200, 250, 0.38, 1.2, 0.2, 0.012, 0.42);
    oscSweep(ac, t0, 'sine', 110, 55, 0.12, 0.16, 0.008, 0.16);
  },
  // Nothing but water: a droplet plop with its spray, and a tiny second drip.
  'bs-splash': (ac, t0) => {
    noiseSweep(ac, t0, 'highpass', 900, 700, 0.3, 0.7, 0.12, 0.006, 0.32);
    oscSweep(ac, t0, 'sine', 330, 130, 0.18, 0.16, 0.006, 0.22);
    oscSweep(ac, t0 + 0.22, 'sine', 520, 220, 0.1, 0.045, 0.006, 0.12);
  },
  // Impact: the classic synthesized explosion — a noise burst through a
  // closing low-pass, a sub-bass drop, and a bright initial crack.
  'bs-hit': (ac, t0) => {
    noiseSweep(ac, t0, 'lowpass', 3200, 120, 0.5, 0.7, 0.32, 0.008, 0.6);
    oscSweep(ac, t0, 'sine', 90, 33, 0.4, 0.3, 0.008, 0.5);
    noiseSweep(ac, t0, 'highpass', 2500, 2000, 0.06, 0.7, 0.1, 0.004, 0.07);
  },
  // A boat goes down: a deeper, longer blast, a groan sliding down the
  // register, and a couple of bubbles gurgling up after.
  'bs-sunk': (ac, t0) => {
    noiseSweep(ac, t0, 'lowpass', 2400, 60, 0.9, 0.7, 0.32, 0.01, 1.0);
    oscSweep(ac, t0, 'sine', 75, 26, 0.8, 0.3, 0.01, 0.9);
    oscSweep(ac, t0 + 0.08, 'sawtooth', 90, 34, 1.0, 0.07, 0.1, 1.15);
    oscSweep(ac, t0 + 0.85, 'sine', 280, 540, 0.09, 0.04, 0.008, 0.12);
    oscSweep(ac, t0 + 1.02, 'sine', 340, 640, 0.08, 0.03, 0.008, 0.1);
  },
  // The scope is yours: a long decaying ping with a gentle downward bend, a
  // watery band-passed tail, and a fainter echo.
  'bs-sonar': (ac, t0) => {
    oscSweep(ac, t0, 'sine', 1500, 1380, 1.1, 0.14, 0.008, 1.15);
    noiseSweep(ac, t0, 'bandpass', 1500, 1400, 0.8, 9, 0.02, 0.02, 0.8);
    oscSweep(ac, t0 + 0.55, 'sine', 1500, 1390, 0.7, 0.045, 0.008, 0.8);
  },

  /* ---- Armada (spec 1038): the full naval foley set. Same technique —
     layered filtered noise + swept oscillators, scheduled like a tiny film
     mix: transient → body → tail → detail events. All deterministic. ---- */

  // Deck gun firing: the muzzle CRACK, the boom rolling out low, the gun
  // carriage thump, and the shell whistling away downrange.
  'ar-fire': (ac, t0) => {
    noiseSweep(ac, t0, 'highpass', 3200, 2400, 0.03, 0.7, 0.5, 0.002, 0.05); // muzzle crack
    noiseSweep(ac, t0, 'lowpass', 900, 80, 0.35, 0.8, 0.4, 0.006, 0.55); // the boom
    oscSweep(ac, t0, 'sine', 72, 36, 0.28, 0.34, 0.006, 0.42); // carriage thump
    noiseSweep(ac, t0 + 0.1, 'bandpass', 1900, 850, 0.5, 4, 0.05, 0.05, 0.6); // shell away
  },
  // Shell into open water: the entry PLOOSH, the body of water swallowing it,
  // the spray sheet falling back, then droplet patter and a foam fizz.
  'ar-splash': (ac, t0) => {
    noiseSweep(ac, t0, 'lowpass', 1400, 300, 0.22, 0.8, 0.28, 0.004, 0.3); // ploosh
    oscSweep(ac, t0, 'sine', 300, 95, 0.2, 0.2, 0.005, 0.26); // the bloop body
    noiseSweep(ac, t0 + 0.05, 'highpass', 1100, 800, 0.35, 0.7, 0.1, 0.02, 0.45); // spray falls back
    // Droplets pattering down, each a tiny falling blip.
    oscSweep(ac, t0 + 0.32, 'sine', 700, 420, 0.05, 0.035, 0.004, 0.07);
    oscSweep(ac, t0 + 0.44, 'sine', 520, 330, 0.05, 0.03, 0.004, 0.07);
    oscSweep(ac, t0 + 0.53, 'sine', 620, 380, 0.05, 0.028, 0.004, 0.06);
    oscSweep(ac, t0 + 0.66, 'sine', 430, 290, 0.05, 0.022, 0.004, 0.06);
    oscSweep(ac, t0 + 0.78, 'sine', 540, 340, 0.04, 0.016, 0.004, 0.05);
    noiseSweep(ac, t0 + 0.25, 'bandpass', 2400, 1700, 0.6, 3, 0.03, 0.05, 0.85); // foam fizz
  },
  // Armor-piercing hit: struck STEEL first (three inharmonic partials — a
  // bell no one tuned), the crack, the blast body, the sub-bass punch, then
  // fire crackling in the wound.
  'ar-hit': (ac, t0) => {
    oscSweep(ac, t0, 'triangle', 1244, 1170, 0.2, 0.14, 0.003, 0.24); // clang partial 1
    oscSweep(ac, t0, 'triangle', 831, 790, 0.25, 0.1, 0.003, 0.3); // clang partial 2
    oscSweep(ac, t0, 'triangle', 2093, 1900, 0.14, 0.07, 0.003, 0.17); // clang partial 3
    noiseSweep(ac, t0, 'highpass', 2800, 2300, 0.05, 0.7, 0.4, 0.003, 0.06); // the crack
    noiseSweep(ac, t0 + 0.01, 'lowpass', 2600, 140, 0.45, 0.8, 0.4, 0.008, 0.7); // blast body
    oscSweep(ac, t0 + 0.01, 'sine', 85, 30, 0.4, 0.32, 0.008, 0.55); // sub punch
    // Fire takes hold: irregular little crackles.
    noiseSweep(ac, t0 + 0.5, 'bandpass', 1600, 1450, 0.04, 6, 0.03, 0.004, 0.05);
    noiseSweep(ac, t0 + 0.62, 'bandpass', 1300, 1200, 0.04, 6, 0.026, 0.004, 0.05);
    noiseSweep(ac, t0 + 0.78, 'bandpass', 1750, 1600, 0.04, 6, 0.022, 0.004, 0.05);
    noiseSweep(ac, t0 + 0.9, 'bandpass', 1450, 1350, 0.04, 6, 0.016, 0.004, 0.05);
  },
  // The ship goes down: two detonations (the hit, then the MAGAZINE), hull
  // steel groaning apart, the sea rushing over the deck, the last air
  // bubbling up, and a deep farewell as she settles.
  'ar-sunk': (ac, t0) => {
    noiseSweep(ac, t0, 'lowpass', 2600, 200, 0.3, 0.8, 0.36, 0.006, 0.45); // first blast
    oscSweep(ac, t0, 'sine', 90, 40, 0.25, 0.26, 0.006, 0.35);
    noiseSweep(ac, t0 + 0.22, 'lowpass', 2000, 50, 0.8, 0.8, 0.5, 0.01, 1.3); // the magazine
    oscSweep(ac, t0 + 0.22, 'sine', 60, 22, 0.7, 0.4, 0.01, 1.1);
    oscSweep(ac, t0 + 0.35, 'sawtooth', 95, 30, 1.6, 0.09, 0.12, 1.9); // hull groan
    oscSweep(ac, t0 + 0.6, 'sawtooth', 130, 45, 1.4, 0.05, 0.15, 1.8); // tearing steel
    noiseSweep(ac, t0 + 0.9, 'lowpass', 700, 200, 1.0, 0.8, 0.12, 0.15, 1.9); // sea over the deck
    oscSweep(ac, t0 + 1.4, 'sine', 55, 24, 1.2, 0.08, 0.1, 2.4); // she settles
    // The last air escapes, bubble by bubble.
    oscSweep(ac, t0 + 1.7, 'sine', 260, 520, 0.09, 0.045, 0.006, 0.12);
    oscSweep(ac, t0 + 1.9, 'sine', 300, 610, 0.08, 0.04, 0.006, 0.11);
    oscSweep(ac, t0 + 2.05, 'sine', 340, 700, 0.08, 0.034, 0.006, 0.1);
    oscSweep(ac, t0 + 2.25, 'sine', 290, 560, 0.07, 0.026, 0.006, 0.09);
    oscSweep(ac, t0 + 2.4, 'sine', 380, 760, 0.06, 0.02, 0.006, 0.08);
    oscSweep(ac, t0 + 2.6, 'sine', 320, 620, 0.06, 0.014, 0.006, 0.08);
  },
  // Your scope brightens: a cleaner ping than the old set — the strike tone,
  // its watery band tail, and two receding echoes off the seafloor.
  'ar-sonar': (ac, t0) => {
    oscSweep(ac, t0, 'sine', 1520, 1400, 1.0, 0.13, 0.006, 1.05);
    noiseSweep(ac, t0, 'bandpass', 1520, 1420, 0.7, 10, 0.018, 0.015, 0.75);
    oscSweep(ac, t0 + 0.5, 'sine', 1510, 1395, 0.6, 0.045, 0.008, 0.7);
    oscSweep(ac, t0 + 1.0, 'sine', 1500, 1390, 0.4, 0.016, 0.01, 0.45);
  },
  // Victory: a bugle "charge!" over field drums — snare taps, bass-drum
  // downbeats, the call climbing the major triad, and a cymbal shimmer on
  // the final held note. Brass = triangle doubled by a quiet square an
  // octave down (the square supplies the bite).
  'ar-victory': (ac, t0) => {
    const bugle = (at: number, f: number, dur: number, peak: number): void => {
      oscSweep(ac, t0 + at, 'triangle', f, f * 0.995, dur, peak, 0.015, dur + 0.06);
      oscSweep(ac, t0 + at, 'square', f / 2, (f / 2) * 0.995, dur, peak * 0.22, 0.015, dur + 0.06);
    };
    const snare = (at: number, peak: number): void =>
      noiseSweep(ac, t0 + at, 'bandpass', 1800, 1500, 0.08, 1.2, peak, 0.003, 0.09);
    const bass = (at: number): void => oscSweep(ac, t0 + at, 'sine', 85, 60, 0.1, 0.16, 0.004, 0.14);
    bass(0);
    snare(0, 0.1);
    snare(0.3, 0.07);
    bass(0.6);
    snare(0.6, 0.1);
    snare(0.9, 0.07);
    // The call: c-c-c-F-A-C' … A-C' (the classic charge contour, in C).
    bugle(0.0, 523.25, 0.13, 0.14);
    bugle(0.18, 523.25, 0.13, 0.14);
    bugle(0.36, 523.25, 0.13, 0.14);
    bugle(0.54, 698.46, 0.28, 0.17);
    bugle(0.9, 880.0, 0.28, 0.17);
    bugle(1.26, 1046.5, 0.46, 0.2);
    bugle(1.82, 880.0, 0.16, 0.15);
    bugle(2.0, 1046.5, 0.6, 0.22);
    bass(2.0);
    noiseSweep(ac, t0 + 2.0, 'highpass', 5200, 3800, 0.8, 0.7, 0.05, 0.01, 1.0); // cymbal shimmer
  },
  // Defeat: colours struck. A slow minor lament, each tone sagging a
  // half-breath flat as it fades, over a dark undertow, one distant boom,
  // and the wash of an indifferent sea.
  'ar-defeat': (ac, t0) => {
    const toll = (at: number, f: number, dur: number, peak: number): void => {
      oscSweep(ac, t0 + at, 'triangle', f, f * 0.965, dur, peak, 0.03, dur + 0.25);
      oscSweep(ac, t0 + at, 'sine', f / 2, (f / 2) * 0.965, dur, peak * 0.5, 0.03, dur + 0.3);
    };
    toll(0.0, 523.25, 0.4, 0.14); // C5
    toll(0.5, 440.0, 0.4, 0.13); // A4
    toll(1.0, 349.23, 0.5, 0.13); // F4
    toll(1.6, 293.66, 1.0, 0.15); // D4, held
    oscSweep(ac, t0, 'sine', 60, 38, 2.2, 0.07, 0.2, 2.6); // the undertow
    noiseSweep(ac, t0 + 0.2, 'lowpass', 500, 80, 0.9, 0.8, 0.1, 0.05, 1.2); // a distant boom
    noiseSweep(ac, t0 + 0.8, 'bandpass', 620, 360, 1.4, 2, 0.035, 0.3, 2.0); // the sea, unmoved
  },
};

/** Names of the effect-layer cues (unioned with RECIPE_NAMES for coverage tests). */
export const FX_NAMES = Object.keys(FX);

export function playTone(name: string): void {
  if (!name || name === 'none') return;
  // Alert tones (spec 1049) render on the strike engine through the shared bus;
  // everything else stays on its original engine + wiring.
  const alert = ALERT_TONES[name as AlertToneName];
  if (alert) {
    const acA = audioCtx();
    if (!acA) return;
    const out = alertBus(acA);
    for (const s of alert) strike(acA, out, s);
    return;
  }
  const ac0 = FX[name] ? audioCtx() : null;
  if (FX[name]) {
    if (ac0) FX[name](ac0, ac0.currentTime);
    return;
  }
  const recipe = RECIPES[name as Exclude<ToneName, 'none' | FxName | AlertToneName>];
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
