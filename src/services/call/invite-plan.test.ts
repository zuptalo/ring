// Unit tests for the pure invite-planning helper (spec 1028, T009). inviteToRoom
// uses this to decide WHO to ring: drop ids already present/ringing/self, dedup
// the request, and clamp to the remaining capacity so a mid-call add never
// overshoots the cap. No WebRTC — pure decision.
import { describe, it, expect } from 'vitest';
import { planInvite } from './invite-plan';

const SELF = 'self';

describe('planInvite', () => {
  it('rings a fresh contact that fits', () => {
    expect(planInvite('audio', [SELF, 'a'], [], SELF, ['b'])).toEqual({
      toRing: ['b'],
      dropped: [],
    });
  });

  it('drops ids already in the roster, already ringing, or self', () => {
    const r = planInvite('audio', [SELF, 'a'], ['b'], SELF, ['a', 'b', SELF, 'c']);
    expect(r.toRing).toEqual(['c']); // a (in room), b (ringing), self all dropped as present
    expect(r.dropped).toEqual([]); // 'c' fits (audio cap 8)
  });

  it('dedups repeats within the request', () => {
    expect(planInvite('audio', [SELF], [], SELF, ['c', 'c', 'd', 'c'])).toEqual({
      toRing: ['c', 'd'],
      dropped: [],
    });
  });

  it('clamps to remaining capacity — the overflow is dropped, not rung', () => {
    // video cap 4, self + a in room → remaining 2. Request 3 fresh → ring 2, drop 1.
    const r = planInvite('video', [SELF, 'a'], [], SELF, ['b', 'c', 'd']);
    expect(r.toRing).toEqual(['b', 'c']);
    expect(r.dropped).toEqual(['d']);
  });

  it('rings nobody (and drops all) when the call is already full', () => {
    const roster = [SELF, 'a', 'b', 'c']; // video full
    expect(planInvite('video', roster, [], SELF, ['d'])).toEqual({
      toRing: [],
      dropped: ['d'],
    });
  });

  it('counts already-ringing invitees against remaining capacity', () => {
    // video: self + a in room + b ringing = 3, remaining 1. Request c,d → ring c, drop d.
    const r = planInvite('video', [SELF, 'a'], ['b'], SELF, ['c', 'd']);
    expect(r.toRing).toEqual(['c']);
    expect(r.dropped).toEqual(['d']);
  });

  it('an empty request is a no-op', () => {
    expect(planInvite('audio', [SELF, 'a'], [], SELF, [])).toEqual({ toRing: [], dropped: [] });
  });

  // (spec 1030, T011) Group-invite fold: the request is the INVITE's member list.
  // A member in both the invite and the current call must resolve to one
  // participant (never re-rung), and the fold clamps like any other add.
  describe('group-invite fold (spec 1030 US3)', () => {
    it('a shared member is not re-rung — one participant, one leg', () => {
      // Current call: self + a + b. Invite room: c (initiator) + b (shared) + self.
      const r = planInvite('audio', [SELF, 'a', 'b'], [], SELF, ['c', 'b', SELF]);
      expect(r.toRing).toEqual(['c']); // b and self already present — deduped
      expect(r.dropped).toEqual([]);
    });

    it('a shared member who is still RINGING in our call is also deduped', () => {
      const r = planInvite('audio', [SELF, 'a'], ['b'], SELF, ['b', 'c']);
      expect(r.toRing).toEqual(['c']);
      expect(r.dropped).toEqual([]);
    });

    it('clamps the fold to the remaining capacity of the combined call', () => {
      // audio cap 8: self + 5 in room = 6, remaining 2; invite brings 3 fresh → 1 dropped.
      const roster = [SELF, 'a', 'b', 'c', 'd', 'e'];
      const r = planInvite('audio', roster, [], SELF, ['f', 'g', 'h']);
      expect(r.toRing).toEqual(['f', 'g']);
      expect(r.dropped).toEqual(['h']);
    });
  });
});
