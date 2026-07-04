// Spec 2020 (T003) — the pure re-assert decision: a nothing-new wake re-shows the
// coalesced notification ONLY when its content differs from what the user already saw
// on that tag (new body, or a grown cumulative count). An identical re-assert is
// skipped, because iOS renders even a silent same-tag re-show as a fresh banner and a
// duplicate Notification Center entry — the burst-duplication the user reported.
import { describe, it, expect } from 'vitest';
import { shouldReassert, type ShownSig, type ShownSummary } from './sw-inbox';

const entry = (body: string, ids: string[]): ShownSummary => ({
  tag: 'ring:chat-1',
  title: 'Alice',
  body,
  url: '/chat/chat-1',
  ids,
  ts: 1000,
});
const sig = (body: string, count: number): ShownSig => ({ body, count, ts: 900 });

describe('spec 2020: shouldReassert', () => {
  it('no prior signature → re-assert (first wake after a show gap)', () => {
    expect(shouldReassert(undefined, entry('msg 2', ['a', 'b']))).toBe(true);
  });

  it('identical body + count → SKIP (the reported duplicate: three "(2)" banners)', () => {
    expect(shouldReassert(sig('msg 2', 2), entry('msg 2', ['a', 'b']))).toBe(false);
  });

  it('same body but a grown count → re-assert (the count is news)', () => {
    expect(shouldReassert(sig('msg 2', 2), entry('msg 2', ['a', 'b', 'c']))).toBe(true);
  });

  it('new body, same count → re-assert (content is news)', () => {
    expect(shouldReassert(sig('msg 2', 2), entry('msg 3', ['a', 'b']))).toBe(true);
  });
});
