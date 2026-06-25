// Spec 2016: the SW must show the generic placeholder ONLY for a genuinely-new message it couldn't
// render — never when there's nothing new (the relay queue was empty, or every fetched frame was
// already shown). These tests pin the pure gating discriminator `isNothingNew` against every shape
// `previewPending` returns, and document the caller's resulting decision.
import { describe, it, expect } from 'vitest';
import { isNothingNew, type PreviewResult } from './sw-inbox';

// Mirror the caller's decision in sw.ts so the test documents the full gating, not just one helper:
//   notes        → show the rich note(s)
//   timedOut     → show generic (slow cold start; handled by the caller, not this result)
//   newUnshown   → show generic (a genuinely-new message we couldn't render)
//   isNothingNew → re-assert silently / show nothing (NO new placeholder)  ← the 2016 fix
function decision(r: PreviewResult, timedOut = false): 'notes' | 'generic' | 'nothing-new' | 'silent' {
  if (r.notes.length) return 'notes';
  if (timedOut) return 'generic';
  if (r.suppressed) return 'silent'; // notifications off → no placeholder, no badge
  if (r.silenced) return 'silent'; // mute / badge-only → no placeholder
  if (r.newUnshown) return 'generic';
  if (isNothingNew(r)) return 'nothing-new';
  return 'generic';
}

const base: PreviewResult = { notes: [], pending: 0, suppressed: false, silenced: false, newUnshown: false };
const note = { ids: ['m1'], title: 'Alice', body: 'hi', url: '/', tag: 'chat-1' };

describe('spec 2016 — generic placeholder gating (isNothingNew)', () => {
  it('all-seen wake (frames existed but every one was already shown) → nothing new, NO generic', () => {
    // previewPending: decrypt loop skipped every frame (seen) → notes:[], newUnshown:false, no reason
    const r: PreviewResult = { ...base, pending: 3, newUnshown: false };
    expect(isNothingNew(r)).toBe(true);
    expect(decision(r)).toBe('nothing-new');
  });

  it('no-frames wake (relay queue empty / settings-sync push) → nothing new, NO generic', () => {
    const r: PreviewResult = { ...base, newUnshown: false, reason: 'no-frames' };
    expect(isNothingNew(r)).toBe(true);
    expect(decision(r)).toBe('nothing-new');
  });

  it('fetched-but-undecryptable NEW frame → still shows the generic (real fallback preserved)', () => {
    const r: PreviewResult = { ...base, pending: 1, newUnshown: true, reason: 'decrypt-failed' };
    expect(isNothingNew(r)).toBe(false);
    expect(decision(r)).toBe('generic');
  });

  it('PIN-locked device with pending frames → genuinely new → generic', () => {
    const r: PreviewResult = { ...base, pending: 2, newUnshown: true, reason: 'locked' };
    expect(isNothingNew(r)).toBe(false);
    expect(decision(r)).toBe('generic');
  });

  it('failed relay fetch → uncertain → generic (newUnshown true)', () => {
    const r: PreviewResult = { ...base, newUnshown: true, reason: 'relay-error' };
    expect(isNothingNew(r)).toBe(false);
    expect(decision(r)).toBe('generic');
  });

  it('a slow cold start (timedOut) still shows the generic even with a nothing-new result', () => {
    const r: PreviewResult = { ...base, newUnshown: false };
    expect(decision(r, /* timedOut */ true)).toBe('generic');
  });

  it('decrypted notes → shows the rich note, never nothing-new', () => {
    const r: PreviewResult = { ...base, notes: [note], pending: 1, newUnshown: false };
    expect(isNothingNew(r)).toBe(false);
    expect(decision(r)).toBe('notes');
  });

  it('suppressed (notifications off) and silenced (mute/badge-only) → no placeholder, not nothing-new', () => {
    expect(decision({ ...base, suppressed: true })).toBe('silent');
    expect(decision({ ...base, silenced: true })).toBe('silent');
    // isNothingNew is specifically about the no-new-message case, not the user-disabled cases:
    expect(isNothingNew({ ...base, suppressed: true })).toBe(false);
    expect(isNothingNew({ ...base, silenced: true })).toBe(false);
  });
});
