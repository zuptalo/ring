// Spec 2016: the SW must show the generic placeholder ONLY for a genuinely-new message it couldn't
// render — never when there's nothing new (the relay queue was empty, or every fetched frame was
// already shown). These tests pin the pure gating discriminator `isNothingNew` against every shape
// `previewPending` returns, and document the caller's resulting decision.
import { describe, it, expect } from 'vitest';
import { isNothingNew, aggregate, mergeIntoSummary, type PreviewResult, type SwNote, type ShownSummary } from './sw-inbox';

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

const base: PreviewResult = { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: false };
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

// Spec 2017: coalescing a burst into ONE per-chat notification with a cumulative (not per-pass) count.
const mk = (tag: string, ids: string[], body: string): SwNote => ({ ids, title: 'Alice', body, url: `/chat/${tag}`, tag });

describe('spec 2017 — aggregate carries a count field, does not bake "(k)" into the title', () => {
  it('merges same-tag notes, latest body wins, count = merged ids, title stays the base', () => {
    const out = aggregate([mk('ring:c1', ['a'], '1'), mk('ring:c1', ['b'], '2'), mk('ring:c1', ['c'], '3')]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Alice'); // base title — the "(3)" is formatted by the show path
    expect(out[0].body).toBe('3'); // latest wins
    expect(out[0].count).toBe(3);
    expect(out[0].ids).toEqual(['a', 'b', 'c']);
  });

  it('distinct tags stay separate, each with its own count', () => {
    const out = aggregate([mk('ring:c1', ['a'], 'hi'), mk('ring:c2', ['b'], 'yo')]);
    expect(out.map((n) => [n.tag, n.count])).toEqual([['ring:c1', 1], ['ring:c2', 1]]);
  });
});

describe('spec 2017 — mergeIntoSummary makes the count cumulative across overlapping wakes', () => {
  it('first wake: no prior summary → count is this note', () => {
    const m = mergeIntoSummary(undefined, { ...mk('ring:c1', ['a', 'b'], '2'), count: 2 }, 1000);
    expect(m.ids).toEqual(['a', 'b']);
    expect(m.body).toBe('2');
    expect(m.ts).toBe(1000);
  });

  it('later wake: unions new ids onto the prior summary (cumulative), latest body, dedupes overlaps', () => {
    const prev: ShownSummary = { tag: 'ring:c1', title: 'Alice', body: '2', url: '/chat/ring:c1', ids: ['a', 'b'], ts: 1000 };
    const m = mergeIntoSummary(prev, { ...mk('ring:c1', ['b', 'c', 'd'], '5'), count: 3 }, 2000);
    expect(m.ids).toEqual(['a', 'b', 'c', 'd']); // 'b' not double-counted → true backlog = 4, not a per-pass 3
    expect(m.body).toBe('5'); // latest
    expect(m.ts).toBe(2000);
  });
});
