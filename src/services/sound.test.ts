import { describe, it, expect } from 'vitest';
import { claimCue, FX_NAMES, RECIPE_NAMES } from './sound';

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
