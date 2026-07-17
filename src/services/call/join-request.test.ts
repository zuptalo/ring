import { describe, it, expect } from 'vitest';
import {
  createJoinRequests,
  canRequest,
  request,
  reject,
  accept,
  clearParty,
  drainPending,
} from './join-request';

const fresh = () => createJoinRequests('room-1');

describe('join-request state (spec 1041)', () => {
  it('a fresh party with capacity can be requested', () => {
    expect(canRequest(fresh(), 'sara', true)).toBe(true);
  });

  it('capacity gates the request (FR-008)', () => {
    expect(canRequest(fresh(), 'sara', false)).toBe(false);
  });

  it('an outstanding request blocks a duplicate', () => {
    const s = fresh();
    expect(request(s, 'sara', 'call-1')).toBe(true);
    expect(canRequest(s, 'sara', true)).toBe(false);
    expect(request(s, 'sara', 'call-1')).toBe(false);
  });

  it('a rejection is final for this call (FR-009): no further requests, ever', () => {
    const s = fresh();
    request(s, 'sara', 'call-1');
    reject(s, 'sara');
    expect(canRequest(s, 'sara', true)).toBe(false);
    expect(request(s, 'sara', 'call-2')).toBe(false);
  });

  it('rejection only blocks the rejecting party, not others', () => {
    const s = fresh();
    request(s, 'sara', 'call-1');
    reject(s, 'sara');
    expect(canRequest(s, 'kamran', true)).toBe(true);
  });

  it('accept moves the party pending → accepted and returns the attempt callId', () => {
    const s = fresh();
    request(s, 'sara', 'call-1');
    expect(accept(s, 'sara')).toBe('call-1');
    expect(accept(s, 'sara')).toBeUndefined(); // idempotent
    expect(s.accepted.has('sara')).toBe(true);
    // (spec 2031 FR-005) An accepted party is on their way into the room: no
    // re-request while they join — the affordance stays "Invited" until their
    // roster arrival retires it (or the call ends).
    expect(canRequest(s, 'sara', true)).toBe(false);
    expect(request(s, 'sara', 'call-2')).toBe(false);
  });

  it('a lost accept reply still resolves through accept() at roster time (spec 2031)', () => {
    const s = fresh();
    request(s, 'sara', 'call-1');
    // No reply ever arrives; their roster join calls accept() late.
    expect(s.pending.has('sara')).toBe(true);
    accept(s, 'sara');
    expect(s.pending.has('sara')).toBe(false);
    expect(s.accepted.has('sara')).toBe(true);
  });

  it('a waiting attempt dying clears its pending entry silently (FR-013)', () => {
    const s = fresh();
    request(s, 'sara', 'call-1');
    clearParty(s, 'sara');
    expect(canRequest(s, 'sara', true)).toBe(true); // no rejection memory
  });

  it('teardown drains every pending request exactly once (FR-014)', () => {
    const s = fresh();
    request(s, 'sara', 'call-1');
    request(s, 'kamran', 'call-2');
    reject(s, 'kamran'); // rejected is NOT pending anymore
    request(s, 'lee', 'call-3');
    const drained = drainPending(s);
    expect(drained).toEqual([
      { partyId: 'sara', callId: 'call-1' },
      { partyId: 'lee', callId: 'call-3' },
    ]);
    expect(drainPending(s)).toEqual([]);
  });
});
