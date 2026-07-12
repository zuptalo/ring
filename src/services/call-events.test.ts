import { describe, it, expect } from 'vitest';
import {
  RING_WINDOW_MS,
  UNIT_STALE_MS,
  buildRingEvent,
  buildEndedEvent,
  isRingStale,
  reconcilePending,
  applyCallTickle,
  applyCallOutcome,
  sweepStaleUnits,
  hasFreshRing,
  type PendingCallEvent,
  type CallBadgeUnit,
} from './call-events';

const NOW = 1_800_000_000_000;

const pending = (over: Partial<PendingCallEvent> = {}): PendingCallEvent => ({
  callId: 'c1',
  from: 'alice',
  kind: 'audio',
  receivedAt: NOW,
  ...over,
});

describe('marker construction', () => {
  it('builds a ring event with the dial-time facts', () => {
    expect(buildRingEvent('c1', 'video', NOW)).toEqual({
      phase: 'ring', callId: 'c1', kind: 'video', at: NOW,
    });
    expect(buildRingEvent('c2', 'audio', NOW, 'room-9')).toEqual({
      phase: 'ring', callId: 'c2', kind: 'audio', roomId: 'room-9', at: NOW,
    });
  });

  it('builds an ended event carrying the outcome', () => {
    expect(buildEndedEvent('c1', 'audio', 'missed', NOW)).toEqual({
      phase: 'ended', callId: 'c1', kind: 'audio', outcome: 'missed', at: NOW,
    });
    expect(buildEndedEvent('c1', 'video', 'answered', NOW, 'room-9').roomId).toBe('room-9');
  });
});

describe('ring staleness', () => {
  it('a ring inside the window is not stale', () => {
    expect(isRingStale(pending(), NOW + RING_WINDOW_MS - 1)).toBe(false);
  });
  it('a ring past the window is stale', () => {
    expect(isRingStale(pending(), NOW + RING_WINDOW_MS + 1)).toBe(true);
  });
});

describe('reconcilePending — the missed-trace decision table', () => {
  it('an existing call-log row always wins: clear, never log (FR-018)', () => {
    expect(reconcilePending(pending(), { hasRow: true, sawLive: false, now: NOW + RING_WINDOW_MS * 2 })).toBe('clear');
  });
  it('a ring the device handled live is owned by the live path: clear', () => {
    expect(reconcilePending(pending(), { hasRow: false, sawLive: true, now: NOW + RING_WINDOW_MS * 2 })).toBe('clear');
  });
  it('an explicit missed outcome logs the trace', () => {
    expect(reconcilePending(pending(), { hasRow: false, sawLive: false, now: NOW, outcome: 'missed' })).toBe('log-missed');
  });
  it('cancelled (caller hung up before answer) logs as missed per the clarification', () => {
    expect(reconcilePending(pending(), { hasRow: false, sawLive: false, now: NOW, outcome: 'cancelled' })).toBe('log-missed');
  });
  it('answered (any device) clears without logging (FR-016)', () => {
    expect(reconcilePending(pending(), { hasRow: false, sawLive: false, now: NOW, outcome: 'answered' })).toBe('clear');
  });
  it('a stale ring with no outcome and no row reconciles to missed (caller crashed)', () => {
    expect(reconcilePending(pending(), { hasRow: false, sawLive: false, now: NOW + RING_WINDOW_MS + 1 })).toBe('log-missed');
  });
  it('a fresh ring with no outcome is kept (still ringing)', () => {
    expect(reconcilePending(pending(), { hasRow: false, sawLive: false, now: NOW + 1000 })).toBe('keep');
  });
});

describe('badge units — FR-007/FR-008/FR-010', () => {
  it('first tickle appends exactly one ringing unit', () => {
    const units = applyCallTickle([], undefined, NOW);
    expect(units).toHaveLength(1);
    expect(units[0].state).toBe('ringing');
  });

  it('re-ring tickles inside the window never add more (FR-008)', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, undefined, NOW);
    units = applyCallTickle(units, undefined, NOW + 10_000);
    units = applyCallTickle(units, undefined, NOW + 20_000);
    expect(units).toHaveLength(1);
  });

  it('a known callId dedups by id, and claims an anonymous fresh unit instead of double-counting', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, undefined, NOW); // first tickle undecryptable
    units = applyCallTickle(units, 'c1', NOW + 10_000); // second tickle resolved the marker
    expect(units).toHaveLength(1);
    expect(units[0].callId).toBe('c1');
    units = applyCallTickle(units, 'c1', NOW + 20_000);
    expect(units).toHaveLength(1);
  });

  it('two distinguishable calls each count once (FR-008)', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, 'c1', NOW);
    units = applyCallTickle(units, 'c2', NOW + 5_000);
    expect(units).toHaveLength(2);
  });

  it('an undistinguishable overlap folds into one unit — undercount, never overcount', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, undefined, NOW);
    units = applyCallTickle(units, undefined, NOW + 5_000); // actually a 2nd call; can't tell
    expect(units).toHaveLength(1);
  });

  it('a tickle after the previous ring expired counts as a new call', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, undefined, NOW);
    units = applyCallTickle(units, undefined, NOW + RING_WINDOW_MS + 1_000);
    expect(units).toHaveLength(2);
  });

  it('missed flips the SAME unit — never a second one (FR-010)', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, 'c1', NOW);
    units = applyCallOutcome(units, 'c1', 'missed', NOW + 30_000);
    expect(units).toHaveLength(1);
    expect(units[0].state).toBe('missed');
  });

  it('missed with no prior unit (marker arrived, tickle lost) still adds one', () => {
    const units = applyCallOutcome([], 'c1', 'missed', NOW);
    expect(units).toHaveLength(1);
    expect(units[0].state).toBe('missed');
  });

  it('missed flips the newest anonymous ringing unit when the callId is unknown', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, undefined, NOW);
    units = applyCallOutcome(units, 'c1', 'missed', NOW + 30_000);
    expect(units).toHaveLength(1);
    expect(units[0].state).toBe('missed');
  });

  it('answered removes the unit', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, 'c1', NOW);
    units = applyCallOutcome(units, 'c1', 'answered', NOW + 5_000);
    expect(units).toHaveLength(0);
  });

  it('cancelled counts as missed for the badge (there will be a trace to see)', () => {
    let units: CallBadgeUnit[] = [];
    units = applyCallTickle(units, 'c1', NOW);
    units = applyCallOutcome(units, 'c1', 'cancelled', NOW + 5_000);
    expect(units).toEqual([expect.objectContaining({ state: 'missed' })]);
  });

  it('stale units are swept', () => {
    const units: CallBadgeUnit[] = [
      { callId: 'old', ts: NOW - UNIT_STALE_MS - 1, state: 'missed' },
      { callId: 'new', ts: NOW, state: 'ringing' },
    ];
    expect(sweepStaleUnits(units, NOW)).toEqual([expect.objectContaining({ callId: 'new' })]);
  });
});

describe('hasFreshRing — the msg-wake ring-upgrade gate (spec 2026)', () => {
  it('a fresh ring with no outcome in the batch → true', () => {
    expect(hasFreshRing([buildRingEvent('c1', 'audio', NOW)], NOW + 5_000)).toBe(true);
  });

  it('empty / absent batches → false', () => {
    expect(hasFreshRing(undefined, NOW)).toBe(false);
    expect(hasFreshRing([], NOW)).toBe(false);
  });

  it('a ring past the window is stale → false (never name a caller who stopped calling)', () => {
    expect(hasFreshRing([buildRingEvent('c1', 'audio', NOW)], NOW + RING_WINDOW_MS + 1)).toBe(false);
  });

  it('a ring whose call also ENDED in the same batch → false (missed/cancelled owns the alert)', () => {
    const batch = [
      buildRingEvent('c1', 'audio', NOW),
      buildEndedEvent('c1', 'audio', 'missed', NOW + 30_000),
    ];
    expect(hasFreshRing(batch, NOW + 31_000)).toBe(false);
  });

  it('an ended marker for a DIFFERENT call does not kill a fresh ring', () => {
    const batch = [
      buildEndedEvent('c0', 'audio', 'answered', NOW),
      buildRingEvent('c1', 'video', NOW + 1_000),
    ];
    expect(hasFreshRing(batch, NOW + 2_000)).toBe(true);
  });

  it('outcome-only batches → false', () => {
    expect(hasFreshRing([buildEndedEvent('c1', 'audio', 'missed', NOW)], NOW)).toBe(false);
  });
});
