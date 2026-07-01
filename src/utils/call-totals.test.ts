// Spec 1025 (US6): the Calls-tab totals aggregation. Pure — grouped by the `video` flag, tolerant of
// missing bytes/duration.
import { describe, it, expect } from 'vitest';
import { computeCallTotals } from './call-totals';
import type { Call } from '@/db/types';

const call = (over: Partial<Call>): Call => ({
  id: 'c',
  contactId: 'p',
  name: 'Peer',
  avatar: '',
  direction: 'outgoing',
  missed: false,
  video: false,
  timestamp: 0,
  updatedAt: 0,
  ...over,
});

describe('computeCallTotals', () => {
  it('sums minutes and bytes grouped by audio vs video', () => {
    const t = computeCallTotals([
      call({ video: false, durationSec: 120, bytes: 1000 }), // 2 min audio
      call({ video: false, durationSec: 180, bytes: 500 }), //  3 min audio
      call({ video: true, durationSec: 600, bytes: 9000 }), // 10 min video
    ]);
    expect(t.audioMinutes).toBe(5);
    expect(t.videoMinutes).toBe(10);
    expect(t.audioBytes).toBe(1500);
    expect(t.videoBytes).toBe(9000);
    expect(t.combinedBytes).toBe(10500);
  });

  it('treats missing bytes as 0 but still counts duration', () => {
    const t = computeCallTotals([
      call({ video: false, durationSec: 60 }), // bytes missing → 0 bytes, 1 min
      call({ video: true, durationSec: 0, bytes: undefined }), // 0 min, 0 bytes
    ]);
    expect(t.audioMinutes).toBe(1);
    expect(t.audioBytes).toBe(0);
    expect(t.videoMinutes).toBe(0);
    expect(t.combinedBytes).toBe(0);
  });

  it('returns zeros for no calls', () => {
    expect(computeCallTotals([])).toEqual({
      audioMinutes: 0,
      videoMinutes: 0,
      audioBytes: 0,
      videoBytes: 0,
      combinedBytes: 0,
    });
  });
});
