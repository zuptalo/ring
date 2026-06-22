import { describe, it, expect } from 'vitest';
import { recordedMs } from './rec-clock';

// recordedMs is the recorder's elapsed-time accounting: how much was actually RECORDED,
// banking each segment across pauses so a paused gap is never counted. Used by both the
// elapsed display and the auto-stop in the video-note recorder.
describe('recordedMs', () => {
  it('while recording, counts the current segment on top of banked time', () => {
    // No banked time, one live segment from t=1000 to now=4000 → 3000ms recorded.
    expect(recordedMs({ accumMs: 0, segStartMs: 1000, paused: false }, 4000)).toBe(3000);
  });

  it('while paused, excludes the gap entirely (only banked time counts)', () => {
    // 3000ms already banked; paused, so the (huge) wall-clock gap since segStartMs is ignored.
    expect(recordedMs({ accumMs: 3000, segStartMs: 9999, paused: true }, 9_999_999)).toBe(3000);
  });

  it('on resume, continues from banked time — it does not restart or jump by the paused gap', () => {
    // After banking 3000ms and resuming at t=10000, by now=12000 another 2000ms recorded → 5000ms.
    expect(recordedMs({ accumMs: 3000, segStartMs: 10_000, paused: false }, 12_000)).toBe(5000);
  });

  it('sums multiple recorded segments correctly', () => {
    // 5000ms banked across two prior segments; a third live segment adds 1500ms → 6500ms.
    expect(recordedMs({ accumMs: 5000, segStartMs: 20_000, paused: false }, 21_500)).toBe(6500);
  });

  it('is zero at the very first instant of recording', () => {
    expect(recordedMs({ accumMs: 0, segStartMs: 5000, paused: false }, 5000)).toBe(0);
  });
});
