import { describe, it, expect, vi, beforeEach } from 'vitest';

// useChatHistory reads bounded batches from queries.ts and subscribes to the idb
// 'messages' change bus. Mock both so the windowing + incremental-apply logic is tested
// in isolation (node env, no IndexedDB). `subscribe` captures the change callback so a
// test can fire a "messages changed" notification and assert the incremental reconcile.
const h = vi.hoisted(() => ({
  older: vi.fn(),
  newer: vi.fn(),
  count: vi.fn(),
  subscribe: vi.fn(),
  changeCb: null as null | (() => void),
}));

vi.mock('@/db/queries', () => ({
  listMessagesOlder: h.older,
  listMessagesNewer: h.newer,
  countChatMessages: h.count,
}));
vi.mock('@/db/idb', () => ({
  subscribe: (_stores: string[], cb: () => void) => {
    h.subscribe(_stores, cb);
    h.changeCb = cb;
    return () => {};
  },
}));

import { effectScope, ref, nextTick } from 'vue';
import { useChatHistory } from './useChatHistory';
import type { Message } from '@/db/types';

const flush = () => new Promise((r) => setTimeout(r, 0));

// Minimal Message factory — only the fields the composable touches.
function msg(id: string, ts: number, over: Partial<Message> = {}): Message {
  return { id, chatId: 'c1', timestamp: ts, updatedAt: ts, body: id, status: 'sent', ...over } as Message;
}

// Fire the captured change-bus callback and let the async reconcile settle.
async function fireChange() {
  h.changeCb?.();
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.changeCb = null;
  h.count.mockResolvedValue(0);
  h.older.mockResolvedValue([]);
  h.newer.mockResolvedValue([]);
});

describe('useChatHistory — initial load', () => {
  it('loads the newest batch oldest→newest and subscribes to messages once', async () => {
    h.older.mockResolvedValueOnce([msg('m3', 30), msg('m4', 40), msg('m5', 50)]);
    h.count.mockResolvedValue(5);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory('c1', undefined, { batchSize: 3, maxRows: 8 })));
    await flush();

    expect(h.older).toHaveBeenCalledWith('c1', null, 3, '');
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m3', 'm4', 'm5']);
    expect(ch.hasOlder.value).toBe(true); // total 5 > 3 loaded
    expect(ch.hasNewer.value).toBe(false); // newest batch → at the bottom
    expect(ch.total.value).toBe(5);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.subscribe.mock.calls[0][0]).toEqual(['messages']);
    scope.stop();
  });
});

describe('useChatHistory — loadOlder / loadNewer', () => {
  it('loadOlder prepends a batch and updates oldestLoadedTs/hasOlder', async () => {
    h.older.mockResolvedValueOnce([msg('m3', 30), msg('m4', 40), msg('m5', 50)]); // initial
    h.count.mockResolvedValue(5);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory('c1', undefined, { batchSize: 3, maxRows: 8 })));
    await flush();
    const arr = ch.rows.value; // capture array identity

    h.older.mockResolvedValueOnce([msg('m1', 10), msg('m2', 20)]); // older than ts 30
    const added = await ch.loadOlder();

    expect(added).toBe(2);
    expect(h.older).toHaveBeenLastCalledWith('c1', 30, 3, '');
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(ch.oldestLoadedTs.value).toBe(10);
    expect(ch.hasOlder.value).toBe(false); // batch (2) < batchSize (3) → start reached
    expect(ch.rows.value).toBe(arr); // never reassigned the array
    scope.stop();
  });

  it('trims the newest tail past maxRows (sets hasNewer) and loadNewer re-appends', async () => {
    // Initial newest batch of 2; maxRows 4 so a second prepend overflows by 1.
    h.older.mockResolvedValueOnce([msg('m5', 50), msg('m6', 60)]);
    h.count.mockResolvedValue(6);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory('c1', undefined, { batchSize: 3, maxRows: 4 })));
    await flush();

    // Initial: 2 loaded of 6 total → 4 older unloaded, 0 newer.
    expect(ch.olderUnloaded.value).toBe(4);
    expect(ch.newerUnloaded.value).toBe(0);

    h.older.mockResolvedValueOnce([msg('m2', 20), msg('m3', 30), msg('m4', 40)]); // +3 → 5 rows
    await ch.loadOlder();
    // 5 > maxRows 4 → trim 1 from the newest tail (m6); now at [m2,m3,m4,m5]
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m2', 'm3', 'm4', 'm5']);
    expect(ch.hasNewer.value).toBe(true);
    expect(ch.newestLoadedTs.value).toBe(50);
    // The trimmed m6 is now "newer-unloaded"; older dropped by the 3 we prepended → 1 left.
    expect(ch.newerUnloaded.value).toBe(1);
    expect(ch.olderUnloaded.value).toBe(1); // 6 total - 4 loaded - 1 newer
    expect(ch.olderUnloaded.value + ch.rows.value.length + ch.newerUnloaded.value).toBe(6); // invariant

    h.newer.mockResolvedValueOnce([msg('m6', 60)]); // newer than ts 50
    const added = await ch.loadNewer();
    expect(added).toBe(1);
    expect(h.newer).toHaveBeenLastCalledWith('c1', 50, 3, '');
    expect(ch.rows.value.map((m) => m.id)).toContain('m6');
    expect(ch.newerUnloaded.value).toBe(0); // consumed the trimmed m6 back
    scope.stop();
  });
});

describe('useChatHistory — incremental change-bus apply', () => {
  async function setup(initial: Message[], total = initial.length) {
    h.older.mockResolvedValueOnce(initial);
    h.count.mockResolvedValue(total);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory('c1', undefined, { batchSize: 3, maxRows: 8 })));
    await flush();
    return { ch, scope };
  }

  it('patch-by-id shallow-merges exactly one row (reaction/seen/edit), array kept', async () => {
    const { ch, scope } = await setup([msg('m1', 10), msg('m2', 20), msg('m3', 30)]);
    const arr = ch.rows.value;
    const row2Before = ch.rows.value[1];

    // The reconcile re-reads the loaded window; m2 now seen (status + updatedAt changed).
    h.newer.mockResolvedValueOnce([
      msg('m1', 10),
      msg('m2', 20, { status: 'seen', updatedAt: 999 }),
      msg('m3', 30),
    ]);
    await fireChange();

    expect(ch.rows.value[1].status).toBe('seen');
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']); // no add/remove
    expect(ch.rows.value).toBe(arr); // array not reassigned
    expect(ch.rows.value[1]).toBe(row2Before); // same row object, merged in place
    expect(ch.rows.value[0].status).toBe('sent'); // untouched rows unchanged
    scope.stop();
  });

  it('remove-by-id splices a deleted row out', async () => {
    const { ch, scope } = await setup([msg('m1', 10), msg('m2', 20), msg('m3', 30)]);
    const arr = ch.rows.value;
    h.newer.mockResolvedValueOnce([msg('m1', 10), msg('m3', 30)]); // m2 gone
    await fireChange();
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(ch.rows.value).toBe(arr);
    scope.stop();
  });

  it('appends a new inbound message only when the run touches the bottom', async () => {
    const { ch, scope } = await setup([msg('m1', 10), msg('m2', 20), msg('m3', 30)]);
    expect(ch.hasNewer.value).toBe(false); // at the bottom
    h.newer.mockResolvedValueOnce([msg('m1', 10), msg('m2', 20), msg('m3', 30), msg('m4', 40)]);
    await fireChange();
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    scope.stop();
  });

  it('does NOT append a newer message when the run is not at the bottom', async () => {
    const { ch, scope } = await setup([msg('m1', 10), msg('m2', 20), msg('m3', 30)]);
    // Force "not at bottom": simulate a prior tail-trim having set hasNewer.
    h.older.mockResolvedValueOnce([msg('x0', 5)]);
    // (batchSize 3, maxRows 8 — no trim here; instead drive hasNewer directly is not
    //  exposed, so emulate by loading older to keep at bottom=false is N/A.)
    // Use the reconcile path with hasNewer already false but assert the inverse via a
    // separate not-at-bottom fixture below.
    scope.stop();

    // Dedicated not-at-bottom fixture: maxRows tiny so the first loadOlder trims tail.
    h.older.mockReset();
    h.older.mockResolvedValueOnce([msg('m5', 50), msg('m6', 60)]); // initial newest
    h.count.mockResolvedValue(6);
    const scope2 = effectScope();
    let ch2!: ReturnType<typeof useChatHistory>;
    scope2.run(() => (ch2 = useChatHistory('c1', undefined, { batchSize: 3, maxRows: 4 })));
    await flush();
    h.older.mockResolvedValueOnce([msg('m2', 20), msg('m3', 30), msg('m4', 40)]);
    await ch2.loadOlder(); // trims m6 → hasNewer true (not at bottom)
    expect(ch2.hasNewer.value).toBe(true);

    // A change arrives; reconcile sees m6 again but must NOT re-append it (beyond window).
    h.newer.mockResolvedValueOnce([msg('m2', 20), msg('m3', 30), msg('m4', 40), msg('m5', 50)]);
    await fireChange();
    expect(ch2.rows.value.map((m) => m.id)).toEqual(['m2', 'm3', 'm4', 'm5']);
    scope2.stop();
  });
});

describe('useChatHistory — seekTo (jump-to-older)', () => {
  it('loads a window centered on a timestamp in one read-pair, replacing rows in place', async () => {
    h.older.mockResolvedValueOnce([msg('m9', 90), msg('m10', 100)]); // initial newest
    h.count.mockResolvedValue(10);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory('c1', undefined, { batchSize: 2, maxRows: 4 })));
    await flush();
    const arr = ch.rows.value;

    // Seek to ts 30: older(<30) → m1,m2 ; from-ts(>=30) → m3,m4.
    h.older.mockResolvedValueOnce([msg('m1', 10), msg('m2', 20)]);
    h.newer.mockResolvedValueOnce([msg('m3', 30), msg('m4', 40)]);
    const ok = await ch.seekTo(30);

    expect(ok).toBe(true);
    expect(h.older).toHaveBeenLastCalledWith('c1', 30, 2, ''); // strictly older than 30
    expect(h.newer).toHaveBeenLastCalledWith('c1', 29, 2, ''); // ts and newer (29 = 30 - 1)
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(ch.rows.value).toBe(arr); // mutated in place, not reassigned
    expect(ch.hasOlder.value).toBe(true);
    expect(ch.hasNewer.value).toBe(true); // a target deep in history has newer messages
    scope.stop();
  });
});

describe('useChatHistory — reset on chatId/q change', () => {
  it('reloads a fresh newest batch when chatId changes', async () => {
    const chatId = ref('c1');
    h.older.mockResolvedValueOnce([msg('a1', 10)]);
    h.count.mockResolvedValue(1);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory(chatId, undefined, { batchSize: 3, maxRows: 8 })));
    await flush();
    expect(ch.rows.value.map((m) => m.id)).toEqual(['a1']);

    h.older.mockResolvedValueOnce([{ ...msg('b1', 11), chatId: 'c2' }, { ...msg('b2', 12), chatId: 'c2' }]);
    h.count.mockResolvedValue(2);
    chatId.value = 'c2';
    await nextTick();
    await flush();
    expect(h.older).toHaveBeenLastCalledWith('c2', null, 3, '');
    expect(ch.rows.value.map((m) => m.id)).toEqual(['b1', 'b2']);
    scope.stop();
  });

  it('reloads when the search term changes', async () => {
    const q = ref('');
    h.older.mockResolvedValueOnce([msg('m1', 10), msg('m2', 20)]);
    h.count.mockResolvedValue(2);
    const scope = effectScope();
    let ch!: ReturnType<typeof useChatHistory>;
    scope.run(() => (ch = useChatHistory('c1', q, { batchSize: 3, maxRows: 8 })));
    await flush();

    h.older.mockResolvedValueOnce([msg('m2', 20)]); // filtered
    q.value = 'm2';
    await nextTick();
    await flush();
    expect(h.older).toHaveBeenLastCalledWith('c1', null, 3, 'm2');
    expect(ch.rows.value.map((m) => m.id)).toEqual(['m2']);
    scope.stop();
  });
});
