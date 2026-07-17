import { describe, it, expect } from 'vitest';
import { reduce, EMPTY_SLOTS, type CallSlots } from './slots';

/**
 * Pure call-slot reducer (spec 0005). At most TWO calls: one `active`, one `held`. This is the
 * unit-testable spine of call waiting — which call is active vs held after accept / swap /
 * drop / remote-end, with the two-call cap encoded. No WebRTC, no IndexedDB.
 */

const A = 'call-a';
const B = 'call-b';
const C = 'call-c';

describe('call-slot reducer', () => {
  it('starts empty', () => {
    expect(EMPTY_SLOTS).toEqual({ active: null, held: null });
  });

  it('accept connects the first call as active', () => {
    const r = reduce(EMPTY_SLOTS, { t: 'accept', callId: A });
    expect(r.rejected).toBe(false);
    expect(r.slots).toEqual({ active: A, held: null });
  });

  it('accepting a second call holds the current one and makes the new one active', () => {
    const one: CallSlots = { active: A, held: null };
    const r = reduce(one, { t: 'accept', callId: B });
    expect(r.rejected).toBe(false);
    expect(r.slots).toEqual({ active: B, held: A });
  });

  it('rejects a third call (two-call cap) without changing state', () => {
    const two: CallSlots = { active: B, held: A };
    const r = reduce(two, { t: 'accept', callId: C });
    expect(r.rejected).toBe(true);
    expect(r.slots).toEqual(two); // unchanged
  });

  it('swap exchanges active and held, repeatably', () => {
    let s: CallSlots = { active: B, held: A };
    s = reduce(s, { t: 'swap' }).slots;
    expect(s).toEqual({ active: A, held: B });
    s = reduce(s, { t: 'swap' }).slots;
    expect(s).toEqual({ active: B, held: A });
    s = reduce(s, { t: 'swap' }).slots;
    expect(s).toEqual({ active: A, held: B }); // 3 swaps → flipped
  });

  it('swap is a no-op with only one call', () => {
    const one: CallSlots = { active: A, held: null };
    expect(reduce(one, { t: 'swap' }).slots).toEqual(one);
  });

  it('dropActive promotes the held call to active', () => {
    const two: CallSlots = { active: B, held: A };
    expect(reduce(two, { t: 'dropActive' }).slots).toEqual({ active: A, held: null });
  });

  it('dropActive with only one call returns to idle', () => {
    const one: CallSlots = { active: A, held: null };
    expect(reduce(one, { t: 'dropActive' }).slots).toEqual({ active: null, held: null });
  });

  it('dropHeld frees the held slot and leaves active untouched', () => {
    const two: CallSlots = { active: B, held: A };
    expect(reduce(two, { t: 'dropHeld' }).slots).toEqual({ active: B, held: null });
  });

  it('remoteEndedHeld frees the held slot like dropHeld (active untouched)', () => {
    const two: CallSlots = { active: B, held: A };
    expect(reduce(two, { t: 'remoteEndedHeld' }).slots).toEqual({ active: B, held: null });
  });

  it('a full accept→swap→dropActive→dropActive cycle returns to idle', () => {
    let s = reduce(EMPTY_SLOTS, { t: 'accept', callId: A }).slots; // {A,-}
    s = reduce(s, { t: 'accept', callId: B }).slots; // {B,A}
    s = reduce(s, { t: 'swap' }).slots; // {A,B}
    s = reduce(s, { t: 'dropActive' }).slots; // drop A → {B,-}
    expect(s).toEqual({ active: B, held: null });
    s = reduce(s, { t: 'dropActive' }).slots; // drop B → idle
    expect(s).toEqual({ active: null, held: null });
  });
});
