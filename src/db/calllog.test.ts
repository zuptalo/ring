import { describe, it, expect } from 'vitest';
import { callLogPreview } from './calllog';
import type { CallLog } from './types';

const base: CallLog = { direction: 'outgoing', video: false, missed: false };

describe('callLogPreview — call-outcome labels (spec 0004 US2/FR-031)', () => {
  it('labels a busy outgoing call "Busy", not "No answer"', () => {
    // The regression: calling someone already in a call ended with reason busy but was logged
    // as a plain unanswered outgoing call ("No answer").
    expect(callLogPreview({ ...base, missed: true, outcome: 'busy' })).toBe('Busy');
  });

  it('labels an unavailable call "Unavailable"', () => {
    expect(callLogPreview({ ...base, missed: true, outcome: 'unavailable' })).toBe('Unavailable');
  });

  it('labels a declined call', () => {
    expect(callLogPreview({ ...base, missed: true, outcome: 'declined' })).toBe('Call declined');
    expect(callLogPreview({ ...base, direction: 'incoming', missed: true, outcome: 'declined' })).toBe('Declined');
  });

  it('still says "No answer" / "Missed call" for a plain unanswered call (no outcome)', () => {
    expect(callLogPreview({ ...base, missed: true })).toBe('No answer');
    expect(callLogPreview({ ...base, direction: 'incoming', missed: true })).toBe('Missed call');
  });

  it('shows a duration for a connected call', () => {
    expect(callLogPreview({ ...base, durationSec: 75 })).toBe('Call · 1:15');
  });
});
