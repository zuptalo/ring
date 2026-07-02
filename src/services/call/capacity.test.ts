// Unit tests for the pure call-capacity gate (spec 1028, T001). Every add path
// (add-people, merge, group-invite merge) gates on these before ringing anyone;
// the server JoinIfRoom stays the authoritative backstop. Caps: 4 video / 8 audio
// (VIDEO_MAX/AUDIO_MAX), and an INVITED (ringing) person holds a slot so two
// concurrent adds can't both overshoot.
import { describe, it, expect } from 'vitest';
import { capOf, headcount, remainingSlots, canAdd } from './capacity';

const SELF = 'self';

describe('capOf', () => {
  it('is 4 for video and 8 for audio', () => {
    expect(capOf('video')).toBe(4);
    expect(capOf('audio')).toBe(8);
  });
});

describe('headcount (distinct roster ∪ invited ∪ self)', () => {
  it('counts self even when the roster is empty', () => {
    expect(headcount([], [], SELF)).toBe(1);
  });
  it('dedups across roster, invited, and self', () => {
    // roster has self+A; invited has A (ringing→joined race) + B. Distinct = self,A,B.
    expect(headcount([SELF, 'a'], ['a', 'b'], SELF)).toBe(3);
  });
  it('a ringing invitee counts', () => {
    expect(headcount([SELF, 'a'], ['b'], SELF)).toBe(3);
  });
});

describe('remainingSlots', () => {
  it('video 4-cap: self + 1 in room leaves 2', () => {
    expect(remainingSlots('video', [SELF, 'a'], [], SELF)).toBe(2);
  });
  it('audio 8-cap: self + 3 leaves 4', () => {
    expect(remainingSlots('audio', [SELF, 'a', 'b', 'c'], [], SELF)).toBe(4);
  });
  it('invited (ringing) people consume remaining slots', () => {
    // video: self + a in room + b,c ringing = 4 → full.
    expect(remainingSlots('video', [SELF, 'a'], ['b', 'c'], SELF)).toBe(0);
  });
  it('never goes negative (legacy over-cap state)', () => {
    expect(remainingSlots('video', [SELF, 'a', 'b', 'c', 'd'], [], SELF)).toBe(0);
  });
});

describe('canAdd', () => {
  it('allows an add that fits', () => {
    expect(canAdd('audio', [SELF, 'a'], [], SELF, 1)).toEqual({ ok: true });
  });

  it('blocks the 5th on a video call with a kind-specific reason', () => {
    // self + 3 already = 4 (full). Adding 1 more → blocked.
    const r = canAdd('video', [SELF, 'a', 'b', 'c'], [], SELF, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/video calls.*4/i);
  });

  it('blocks the 9th on an audio call with a kind-specific reason', () => {
    const roster = [SELF, 'a', 'b', 'c', 'd', 'e', 'f', 'g']; // 8 = full
    const r = canAdd('audio', roster, [], SELF, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/audio calls.*8/i);
  });

  it('blocks adding MORE than remaining even if one would fit', () => {
    // video: self + 2 = 3, remaining 1. Adding 2 → blocked (the picker cap).
    expect(canAdd('video', [SELF, 'a', 'b'], [], SELF, 2).ok).toBe(false);
    expect(canAdd('video', [SELF, 'a', 'b'], [], SELF, 1).ok).toBe(true);
  });

  it('counts invited against the cap (no concurrent overshoot)', () => {
    // audio: self + 6 in room + 1 ringing = 8 → full; another add blocked.
    const roster = [SELF, 'a', 'b', 'c', 'd', 'e', 'f'];
    expect(canAdd('audio', roster, ['g'], SELF, 1).ok).toBe(false);
  });

  it('US6 combined headcount: passing the union of two rosters as roster+invited', () => {
    // Merge group invite: current [self,a] + incoming [c,d]; distinct combined = 4.
    // Video cap 4 → exactly fits (adding c,d as the n via invited pre-union): allowed.
    expect(canAdd('video', [SELF, 'a'], [], SELF, 2)).toEqual({ ok: true });
    // One more (a 5th) → blocked.
    expect(canAdd('video', [SELF, 'a'], [], SELF, 3).ok).toBe(false);
  });

  // (spec 1030, T011) Group-invite fold gate: `n` is the count of DISTINCT
  // newcomers — the invite's members minus anyone already in/ringing in our call
  // — so a shared member is counted once across the two rosters (FR-007).
  describe('group-invite fold — distinct union of two rosters (spec 1030 US3)', () => {
    // Current audio call: self + a. Incoming invite room: c + b + a (a is shared).
    const roster = [SELF, 'a'];
    const inviteMembers = ['c', 'b', 'a'];
    const distinctNewcomers = inviteMembers.filter((id) => !new Set([SELF, ...roster]).has(id));

    it('a member in both rosters is counted once', () => {
      expect(distinctNewcomers).toEqual(['c', 'b']); // 'a' shared → not a newcomer
      // Combined distinct = self, a, c, b = 4 ≤ audio cap → fits.
      expect(canAdd('audio', roster, [], SELF, distinctNewcomers.length)).toEqual({ ok: true });
    });

    it('blocks the fold when the combined DISTINCT headcount exceeds the cap', () => {
      // Video cap 4: self + a (2) folding 3 distinct newcomers → 5 → blocked with reason.
      const r = canAdd('video', roster, [], SELF, 3);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/video calls.*4/i);
    });

    it('the fits vs does-not-fit boundary sits exactly at the cap', () => {
      // Audio cap 8: self + 5 in room = 6. Two newcomers fit (8), three don't (9).
      const six = [SELF, 'a', 'b', 'c', 'd', 'e'];
      expect(canAdd('audio', six, [], SELF, 2).ok).toBe(true);
      expect(canAdd('audio', six, [], SELF, 3).ok).toBe(false);
    });
  });
});
