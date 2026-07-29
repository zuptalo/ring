import { describe, it, expect, beforeEach } from 'vitest';
import { PLAYBACK_RATES } from '@/utils/playback';
import { RATE_CAP, rateFor, cycleRateFor, touchRate, __resetPlaybackRates } from './usePlaybackRates';

// Spec 2059. The rate used to be one app-wide value, so speeding up one voice message sped up
// the pill on every other one. These tests pin the property that was missing: a rate belongs to
// the thing it was set on.
describe('per-message playback rates', () => {
  beforeEach(() => __resetPlaybackRates());

  it('reads normal speed for a message nobody has touched', () => {
    expect(rateFor('never-seen')).toBe(1);
  });

  it('cycling one message leaves every other message alone', () => {
    cycleRateFor('a');
    expect(rateFor('a')).not.toBe(1);
    expect(rateFor('b')).toBe(1);
    expect(rateFor('c')).toBe(1);
  });

  it("cycles through the app's rates and wraps back to normal", () => {
    const seen: number[] = [];
    for (let i = 0; i < PLAYBACK_RATES.length; i++) seen.push(cycleRateFor('m'));
    // Starting from 1, one full lap visits every other rate and returns to 1.
    expect(seen[seen.length - 1]).toBe(1);
    expect(new Set(seen)).toEqual(new Set(PLAYBACK_RATES));
  });

  it("remembers a message's rate so returning to it is not a surprise", () => {
    cycleRateFor('m');
    const chosen = rateFor('m');
    // Reading it many times must not drift it.
    expect(rateFor('m')).toBe(chosen);
    expect(rateFor('m')).toBe(chosen);
  });

  describe('bounding', () => {
    it('never remembers more than the cap', () => {
      for (let i = 0; i < RATE_CAP + 50; i++) cycleRateFor(`m${i}`);
      let remembered = 0;
      for (let i = 0; i < RATE_CAP + 50; i++) if (rateFor(`m${i}`) !== 1) remembered++;
      expect(remembered).toBeLessThanOrEqual(RATE_CAP);
    });

    it('drops the least recently used, keeping the ones still in play', () => {
      cycleRateFor('keeper');
      for (let i = 0; i < RATE_CAP - 1; i++) cycleRateFor(`filler${i}`);
      // 'keeper' is the oldest by insertion — but it is still being used, so using it again
      // must save it from the next eviction.
      touchRate('keeper');
      cycleRateFor('newcomer'); // pushes past the cap, evicting the true least-recently-used

      expect(rateFor('keeper')).not.toBe(1);
      expect(rateFor('newcomer')).not.toBe(1);
      expect(rateFor('filler0')).toBe(1); // the genuinely stale one went
    });

    // Guards the trap this design was written around: recency must NOT be refreshed by
    // rateFor, which is called from render-time computeds. If reading counted as use, the
    // pill's own render would keep mutating the structure it had just tracked.
    it('reading a rate does not count as use', () => {
      cycleRateFor('old');
      for (let i = 0; i < RATE_CAP - 1; i++) cycleRateFor(`f${i}`);
      rateFor('old'); // a render, not a use
      cycleRateFor('newcomer');
      expect(rateFor('old')).toBe(1); // reading did not save it
    });
  });
});
