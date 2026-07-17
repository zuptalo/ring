import { describe, it, expect } from 'vitest';
import { isRunStart, showDay } from './chat-grouping';

// Group-run + day-divider math computed from the row's PREDECESSOR (the real previous
// message in the loaded run, not the previous *rendered* item). Feeding the true
// predecessor — preserved across the window's top edge — is what stops an avatar or
// day-divider from flickering when older rows are prepended/evicted (D8 / INV-7).

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date(2026, 0, 1, 12, 0, 0).getTime(); // a fixed local noon
const t0Later = t0 + 60 * 1000; // same day, a minute later
const t1 = t0 + DAY; // next day

describe('isRunStart (group avatar/name on the first bubble of a run)', () => {
  it('is false in a 1:1 chat (no avatars/names)', () => {
    expect(isRunStart({ senderId: 'b', outgoing: false }, { senderId: 'b', outgoing: false }, false)).toBe(false);
  });

  it('is true when there is no predecessor in the run', () => {
    expect(isRunStart(null, { senderId: 'b', outgoing: false }, true)).toBe(true);
  });

  it('is false for your own outgoing bubble', () => {
    expect(isRunStart({ senderId: 'b', outgoing: false }, { senderId: 'me', outgoing: true }, true)).toBe(false);
  });

  it('is true when the previous message was from a different sender', () => {
    expect(isRunStart({ senderId: 'a', outgoing: false }, { senderId: 'b', outgoing: false }, true)).toBe(true);
  });

  it('is true when the previous message was outgoing (yours)', () => {
    expect(isRunStart({ senderId: 'me', outgoing: true }, { senderId: 'b', outgoing: false }, true)).toBe(true);
  });

  it('is false in the middle of a same-sender run', () => {
    expect(isRunStart({ senderId: 'b', outgoing: false }, { senderId: 'b', outgoing: false }, true)).toBe(false);
  });

  it('does not toggle when the true predecessor is preserved across the window edge', () => {
    const prev = { senderId: 'b', outgoing: false };
    const cur = { senderId: 'b', outgoing: false };
    // Same (prev, cur) → same answer regardless of whether prev is the first RENDERED
    // row; the bug is passing `undefined` when prev is merely outside the rendered slice.
    expect(isRunStart(prev, cur, true)).toBe(false);
    // Contrast: dropping the predecessor would wrongly flip it to a run start (flicker).
    expect(isRunStart(undefined, cur, true)).toBe(true);
  });
});

describe('showDay (date divider above the first message of a day)', () => {
  it('is true for the oldest loaded item (no predecessor)', () => {
    expect(showDay(null, { timestamp: t0 })).toBe(true);
  });

  it('is false within the same day', () => {
    expect(showDay({ timestamp: t0 }, { timestamp: t0Later })).toBe(false);
  });

  it('is true when the day changes', () => {
    expect(showDay({ timestamp: t0Later }, { timestamp: t1 })).toBe(true);
  });

  it('does not toggle when the true predecessor is preserved across the window edge', () => {
    // Same-day predecessor present → no divider; dropping it would wrongly inject one.
    expect(showDay({ timestamp: t0 }, { timestamp: t0Later })).toBe(false);
    expect(showDay(undefined, { timestamp: t0Later })).toBe(true);
  });
});
