import { describe, it, expect } from 'vitest';
import { resolveIncomingTimestamp, senderClockIsSkewed, CLOCK_SKEW_TOLERANCE_MS } from './message-time';

const NOW = 1_800_000_000_000; // fixed epoch ms; these helpers are pure
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('resolveIncomingTimestamp (spec 2056)', () => {
  it('keeps the sender timestamp when it agrees with the relay (the normal case)', () => {
    expect(resolveIncomingTimestamp(NOW, NOW)).toBe(NOW);
    expect(resolveIncomingTimestamp(NOW - 5_000, NOW)).toBe(NOW - 5_000); // ordinary latency
    expect(resolveIncomingTimestamp(NOW - CLOCK_SKEW_TOLERANCE_MS, NOW)).toBe(NOW - CLOCK_SKEW_TOLERANCE_MS);
  });

  it('keeps a genuinely OLD message old when it was queued while we were offline', () => {
    // Sent 6h ago and queued 6h ago: the sender's clock is fine, the message really is old.
    // It must stay old — the chat shows it in the past AND the push-zombie staleness signal
    // relies on this being honest.
    const sixHoursAgo = NOW - 6 * HOUR;
    expect(resolveIncomingTimestamp(sixHoursAgo, sixHoursAgo)).toBe(sixHoursAgo);
  });

  it('corrects a sender whose clock runs an hour SLOW (the reported timezone bug)', () => {
    // Stale tzdata: the device shows the right wall clock but its UTC is an hour behind, so
    // every message it sends claims to be an hour older than it is. Relayed just now.
    const claimed = NOW - HOUR;
    expect(resolveIncomingTimestamp(claimed, NOW)).toBe(NOW);
  });

  it('corrects a sender whose clock runs FAST (would sort into the future)', () => {
    expect(resolveIncomingTimestamp(NOW + 2 * HOUR, NOW)).toBe(NOW);
  });

  it('corrects the half-hour timezone offsets too (well above tolerance)', () => {
    expect(resolveIncomingTimestamp(NOW - 30 * MIN, NOW)).toBe(NOW);
  });

  it('trusts the sender when the relay time is unknown (older server, no regression)', () => {
    const claimed = NOW - HOUR;
    expect(resolveIncomingTimestamp(claimed, undefined)).toBe(claimed);
    expect(resolveIncomingTimestamp(claimed, 0)).toBe(claimed);
  });

  it('falls back to the relay time when the sender sent no timestamp at all', () => {
    expect(resolveIncomingTimestamp(0, NOW)).toBe(NOW);
  });

  it('never consults the local clock, so a skewed RECIPIENT still orders correctly', () => {
    // Both inputs are independent of Date.now(); ordering is decided purely between the
    // sender's claim and the relay's stamp.
    const a = resolveIncomingTimestamp(NOW - HOUR, NOW);
    const b = resolveIncomingTimestamp(NOW - HOUR + 1_000, NOW + 1_000);
    expect(b).toBeGreaterThan(a); // relative order of two skewed messages is preserved
  });

  it('keeps successive messages from a skewed sender in the order they were relayed', () => {
    const skew = -HOUR;
    const relayTimes = [NOW, NOW + 30_000, NOW + 90_000];
    const out = relayTimes.map((r) => resolveIncomingTimestamp(r + skew, r));
    expect(out).toEqual(relayTimes); // monotonic, matching send order
  });
});

describe('senderClockIsSkewed', () => {
  it('is false for agreeing clocks and unknown references', () => {
    expect(senderClockIsSkewed(NOW, NOW)).toBe(false);
    expect(senderClockIsSkewed(NOW - 5_000, NOW)).toBe(false);
    expect(senderClockIsSkewed(NOW, undefined)).toBe(false);
    expect(senderClockIsSkewed(0, NOW)).toBe(false);
  });

  it('is true once the disagreement exceeds tolerance, in either direction', () => {
    expect(senderClockIsSkewed(NOW - HOUR, NOW)).toBe(true);
    expect(senderClockIsSkewed(NOW + HOUR, NOW)).toBe(true);
  });

  it('does NOT flag a genuinely queued-while-offline message', () => {
    const old = NOW - 6 * HOUR;
    expect(senderClockIsSkewed(old, old)).toBe(false);
  });
});
