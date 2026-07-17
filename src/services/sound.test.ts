import { describe, it, expect } from 'vitest';
import {
  claimCue,
  FX_NAMES,
  RECIPE_NAMES,
  ALERT_TONES,
  ALERT_TONE_NAMES,
  ALERT_TAIL_S,
  TIMBRES,
  playTone,
} from './sound';

describe('claimCue — call-cue rate limiter (spec 0004 US5)', () => {
  it('allows the first play and suppresses an immediate repeat of the same cue', () => {
    expect(claimCue('mute', 1000)).toBe(true);
    expect(claimCue('mute', 1100)).toBe(false); // within the dedup window
    expect(claimCue('mute', 1500)).toBe(true); // window elapsed → allowed again
  });

  it('rate-limits each cue independently', () => {
    expect(claimCue('connected', 5000)).toBe(true);
    expect(claimCue('reconnecting', 5000)).toBe(true); // a different cue is not suppressed
    expect(claimCue('connected', 5050)).toBe(false); // same cue, still within window
  });

  it('has a recipe for every call cue (so no cue is silently missing)', () => {
    for (const name of [
      'connecting',
      'connected',
      'reconnecting',
      'callended',
      'mute',
      'unmute',
      'cameraon',
      'cameraoff',
      'callfull',
      'incallmsg',
    ]) {
      expect(RECIPE_NAMES).toContain(name);
    }
  });

  it('has a recipe for every call-waiting cue (spec 0005 US5)', () => {
    for (const name of ['callwaiting', 'hold', 'resume', 'swap', 'resuming']) {
      expect(RECIPE_NAMES).toContain(name);
    }
  });

  it('has a recipe for every game cue (spec 0008 FR-026)', () => {
    for (const name of ['gamestart', 'gamemove', 'gamewin', 'gamelose', 'gamedraw']) {
      expect(RECIPE_NAMES).toContain(name);
    }
  });

  it('has a recipe for every challenge cue (spec 0009 FR-001)', () => {
    for (const name of ['gamechallenge', 'gameaccept']) {
      expect(RECIPE_NAMES).toContain(name);
    }
  });

  it('has an effect for every Battleship foley cue (spec 1033)', () => {
    for (const name of ['bs-fire', 'bs-splash', 'bs-hit', 'bs-sunk', 'bs-sonar']) {
      expect([...RECIPE_NAMES, ...FX_NAMES]).toContain(name);
    }
  });

  it('has an effect for every Armada foley cue incl. the victory march and defeat lament (spec 1038)', () => {
    for (const name of ['ar-fire', 'ar-splash', 'ar-hit', 'ar-sunk', 'ar-sonar', 'ar-victory', 'ar-defeat']) {
      expect(FX_NAMES).toContain(name);
    }
  });

  it('de-dups a rapid hold→swap→hold storm so cue-fatigue is bounded (spec 0005 T027)', () => {
    // Fumbling the swap button shouldn't machine-gun the same cue.
    expect(claimCue('swap', 10_000)).toBe(true);
    expect(claimCue('swap', 10_100)).toBe(false); // second tap within the window — suppressed
    expect(claimCue('hold', 10_100)).toBe(true); // a distinct cue still plays
    expect(claimCue('swap', 10_700)).toBe(true); // window elapsed — allowed again
  });
});

/* ---- spec 1049: richer alert tones — the structural half of the contract
 * (specs/1049-richer-higher-quality/contracts/tone-structure.md). The aesthetic
 * half (richness, character, distinguishability) is the manual listening pass
 * via the Settings previews and is deliberately NOT encoded here. ---- */

// The 7 audible alert tones offered by the settings TONES list ('none' excluded).
const AUDIBLE_ALERTS = ['note', 'chime', 'ping', 'pop', 'pulse', 'glow', 'beacon'];

describe('spec 1049 — alert-tone structure', () => {
  it('rule 1: every audible settings tone has an alert voice, and "none" does not', () => {
    expect([...ALERT_TONE_NAMES].sort()).toEqual([...AUDIBLE_ALERTS].sort());
    expect(ALERT_TONE_NAMES).not.toContain('none');
  });

  it('rule 2: every strike uses a defined timbre with at least 2 partials (layered, not a beep)', () => {
    for (const name of AUDIBLE_ALERTS) {
      for (const s of ALERT_TONES[name as keyof typeof ALERT_TONES]) {
        const partials = TIMBRES[s.timbre];
        expect(partials, `${name} strike timbre "${s.timbre}"`).toBeDefined();
        expect(partials.length, `${name} → ${s.timbre} partials`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('rule 3: every tone, including its reverb tail, fits the 1.2s budget', () => {
    for (const name of AUDIBLE_ALERTS) {
      const strikes = ALERT_TONES[name as keyof typeof ALERT_TONES];
      const end = Math.max(...strikes.map((s) => s.start + s.dur)) + ALERT_TAIL_S;
      expect(end, `${name} total incl. tail`).toBeLessThanOrEqual(1.2);
    }
  });

  it('rule 4: strike gains sit in the consistent-loudness band; partial gains are sane', () => {
    for (const name of AUDIBLE_ALERTS) {
      for (const s of ALERT_TONES[name as keyof typeof ALERT_TONES]) {
        expect(s.gain, `${name} strike gain`).toBeGreaterThanOrEqual(0.08);
        expect(s.gain, `${name} strike gain`).toBeLessThanOrEqual(0.45);
      }
    }
    for (const [tname, partials] of Object.entries(TIMBRES)) {
      for (const p of partials) {
        expect(p.gain, `${tname} partial gain`).toBeGreaterThan(0);
        expect(p.gain, `${tname} partial gain`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rule 5: each tone keeps its established melodic character', () => {
    const T = ALERT_TONES;
    // chime: two strikes, the high descending pair it has always been (E6 → B5).
    expect(T.chime).toHaveLength(2);
    expect(T.chime[0].freq).toBeGreaterThan(T.chime[1].freq);
    // glow: two strikes rising.
    expect(T.glow).toHaveLength(2);
    expect(T.glow[0].freq).toBeLessThan(T.glow[1].freq);
    // beacon: three strikes, strictly ascending arpeggio.
    expect(T.beacon).toHaveLength(3);
    expect(T.beacon[0].freq).toBeLessThan(T.beacon[1].freq);
    expect(T.beacon[1].freq).toBeLessThan(T.beacon[2].freq);
    // pulse: two equal taps.
    expect(T.pulse).toHaveLength(2);
    expect(T.pulse[0].freq).toBe(T.pulse[1].freq);
    // note / ping / pop: single strikes; pop stays the lowest voice of the set.
    expect(T.note).toHaveLength(1);
    expect(T.ping).toHaveLength(1);
    expect(T.pop).toHaveLength(1);
    const fundamentals = AUDIBLE_ALERTS.map((n) => T[n as keyof typeof T][0].freq);
    expect(Math.min(...fundamentals)).toBe(T.pop[0].freq);
  });

  it('rule 6 (fence): the cue recipes keep every cue and no longer carry the alert tones', () => {
    for (const name of AUDIBLE_ALERTS) expect(RECIPE_NAMES).not.toContain(name);
    // The cue families themselves are pinned by the suites above — spot-pin two here so
    // this rule reads complete on its own.
    expect(RECIPE_NAMES).toContain('calling');
    expect(RECIPE_NAMES).toContain('gamemove');
  });

  it('rule 7: playing an alert tone with audio unavailable is a silent no-op', () => {
    // node env: no window/AudioContext → the context factory yields null.
    for (const name of [...AUDIBLE_ALERTS, 'none']) {
      expect(() => playTone(name), name).not.toThrow();
    }
  });
});
