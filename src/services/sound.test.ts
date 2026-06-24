import { describe, it, expect } from 'vitest';
import { claimCue, RECIPE_NAMES } from './sound';

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
});
