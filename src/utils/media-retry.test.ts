import { describe, it, expect } from 'vitest';
import { AUTO_RETRY_LIMIT, shouldAutoRetry } from './media-retry';

// Spec 2058 FR-006. The on-view recovery re-fires every time a pending bubble scrolls back
// into view, so an attachment that can never be fetched (its blob aged off the relay, say)
// would otherwise retry forever — a tight loop against the relay for a message that will
// never load. The bound stops that while leaving the manual tap always available.
describe('shouldAutoRetry', () => {
  it('allows the first attempt on a message never tried before', () => {
    expect(shouldAutoRetry(0)).toBe(true);
  });

  it('keeps allowing attempts below the limit', () => {
    expect(shouldAutoRetry(1)).toBe(true);
    expect(shouldAutoRetry(2)).toBe(true);
  });

  it('stops at the limit', () => {
    expect(shouldAutoRetry(AUTO_RETRY_LIMIT)).toBe(false);
  });

  it('stays stopped past the limit', () => {
    expect(shouldAutoRetry(AUTO_RETRY_LIMIT + 1)).toBe(false);
    expect(shouldAutoRetry(99)).toBe(false);
  });

  it('caps at three attempts per message per session', () => {
    expect(AUTO_RETRY_LIMIT).toBe(3);
  });

  // Defensive: the caller reads from a Map that may have no entry yet, so undefined/NaN
  // must not be read as "already exhausted" — that would silently disable recovery.
  it('treats a missing count as zero attempts', () => {
    expect(shouldAutoRetry(undefined as unknown as number)).toBe(true);
    expect(shouldAutoRetry(NaN)).toBe(true);
  });
});
