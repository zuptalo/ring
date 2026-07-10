// The double-notification fix: when the page bridges a hidden delivery via
// notifyLocal (backgrounded-but-connected), it mirrors the rich note into the
// shown-summary so a co-arriving push wake re-asserts THAT note (same
// ring:<chatId> tag) instead of firing the stray "New message" generic. These pin
// recordPageShown's contract: it seeds the summary the SW reads, merges by tag,
// and deliberately writes NO shown-sig (so the SW's first re-assert is permitted,
// not skipped as identical).
import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect } from 'vitest';
import { put } from '@/db/idb';
import { recordPageShown, loadShownSummary, loadShownSigs, saveShownSig, shouldReassert, SUMMARY_KEY } from './sw-inbox';

// fake-indexeddb persists across tests in a file; reset the summary + sigs so each
// case starts clean (these all write the same ring:chat-1 tag).
beforeEach(async () => {
  await put('settings', { key: SUMMARY_KEY, value: [] });
  await put('settings', { key: 'sw.shownSig', value: {} });
});

const NOW = Date.now(); // loadShownSummary TTL-filters to a 2-min window, so stay near real time
const note = (over: Partial<{ tag: string; title: string; body: string; url: string; id: string }> = {}) => ({
  tag: 'ring:chat-1',
  title: 'Macbook',
  body: 'made a move, your turn 😏',
  url: '/chat/chat-1',
  id: 'm1',
  ...over,
});

describe('recordPageShown — page seeds the summary the SW re-asserts from', () => {
  it('writes a summary entry for the tag that loadShownSummary returns', async () => {
    await recordPageShown(note(), NOW);
    const list = await loadShownSummary();
    const entry = list.find((e) => e.tag === 'ring:chat-1');
    expect(entry).toBeTruthy();
    expect(entry!.body).toBe('made a move, your turn 😏');
    expect(entry!.ids).toEqual(['m1']);
  });

  it('CLEARS a stale shown-sig so the SW is PERMITTED to re-assert (not skip as identical)', async () => {
    // A prior move's SW show left an identical-looking sig ("made a move…", count 1).
    await saveShownSig('ring:chat-1', { body: 'made a move, your turn 😏', count: 1, ts: NOW });
    await recordPageShown(note({ id: 'm2' }), NOW + 10);
    const sigs = await loadShownSigs();
    expect(sigs['ring:chat-1']).toBeUndefined(); // cleared, so the re-assert isn't vetoed
    // The whole point: reassertFromSummary calls shouldReassert(sig, entry); with no
    // sig it returns true → the SW re-asserts the rich note instead of the generic —
    // even though the new move's text is identical to the prior one.
    const entry = (await loadShownSummary()).find((e) => e.tag === 'ring:chat-1')!;
    expect(shouldReassert(sigs['ring:chat-1'], entry)).toBe(true);
  });

  it('merges ids per tag (a second backgrounded delivery grows the cumulative count)', async () => {
    await recordPageShown(note({ id: 'a' }), NOW + 20);
    await recordPageShown(note({ id: 'b', body: 'made a move 🎲' }), NOW + 30);
    const entry = (await loadShownSummary()).find((e) => e.tag === 'ring:chat-1')!;
    expect(new Set(entry.ids)).toEqual(new Set(['a', 'b']));
    expect(entry.body).toBe('made a move 🎲'); // latest body wins
  });

  it('keeps distinct tags separate (another chat is untouched)', async () => {
    await recordPageShown(note({ id: 'm1' }), NOW + 40);
    await recordPageShown(note({ tag: 'ring:chat-9', id: 'z', body: 'hi' }), NOW + 41);
    const list = await loadShownSummary();
    expect(list.find((e) => e.tag === 'ring:chat-9')!.ids).toEqual(['z']);
    expect(list.find((e) => e.tag === 'ring:chat-1')!.ids).toEqual(['m1']); // untouched by chat-9
  });
});
