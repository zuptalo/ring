/**
 * Bounded, incrementally-updated chat history (spec 1011, research D2/D3).
 *
 * The chat view sources its render window from `rows` here instead of
 * `useLiveQuery(listMessages)`. Two things make scroll-up smooth at any length:
 *
 *  1. **Bounded.** `rows` holds only a contiguous run around the rendered window
 *     (≤ `maxRows`), read in batches via `listMessagesOlder/Newer`. `loadOlder`
 *     prepends and trims the newest tail; `loadNewer` appends and trims the oldest
 *     head — so memory stays bounded however far the user scrolls (FR-013).
 *
 *  2. **Incremental.** On a `messages` change we do NOT replace `rows` wholesale (the
 *     churn `useLiveQuery` caused — re-allocating thousands of objects + re-rendering on
 *     every reaction/seen/tick). Instead we reconcile the loaded window in place:
 *     patch-by-id (shallow-merge one row), remove-by-id (splice), and append a new
 *     bottom message only when the run touches the bottom. The `rows` array is never
 *     reassigned, so Vue diffs only the rows that actually changed (FR-011, D3).
 *
 * Pure index/slice math lives in chat-pagination / chat-window; this composable is the
 * stateful glue. It is read-only against IndexedDB — no schema/wire change.
 */
import { computed, isRef, onScopeDispose, ref, watch, type Ref } from 'vue';
import { subscribe } from '@/db/idb';
import { listMessagesOlder, listMessagesNewer, countChatMessages } from '@/db/queries';
import { BATCH_SIZE, MAX_ROWS } from '@/utils/chat-window';
import type { Message } from '@/db/types';

export interface ChatHistory {
  /** The loaded contiguous run, oldest→newest (bounded). Mutated in place, never
   *  reassigned — exposed read-only so callers don't replace it. */
  rows: Readonly<Ref<Message[]>>;
  hasOlder: Ref<boolean>;
  hasNewer: Ref<boolean>;
  total: Ref<number>;
  oldestLoadedTs: Ref<number | null>;
  newestLoadedTs: Ref<number | null>;
  /** Counts of messages NOT in `rows` (older than the first / newer than the last loaded
   *  row). The view sizes its top/bottom spacers from these so the scroll range reflects
   *  the whole chat without holding it (spec 1011). Invariant: older + rows.length + newer
   *  = total. */
  olderUnloaded: Ref<number>;
  newerUnloaded: Ref<number>;
  /** Flips true after the first batch resolves (the view reveals the list then). */
  ready: Ref<boolean>;
  loadOlder(): Promise<number>;
  loadNewer(): Promise<number>;
  /** Load a bounded window CENTERED on `ts` in one read-pair (for jump-to-older seek,
   *  spec 1011 D7) — far cheaper than paging batch-by-batch to a distant target. Replaces
   *  `rows` with the window; returns false when the chat has nothing at/around `ts`. */
  seekTo(ts: number): Promise<boolean>;
  reload(): Promise<void>;
}

export interface ChatHistoryOpts {
  batchSize?: number;
  maxRows?: number;
}

/** A compact change signature: every mutating write bumps `updatedAt`, but we also fold
 *  in the fields a receipt/reaction/edit/delete touches so a reconcile patches exactly
 *  the rows that changed (and skips the rest — fresh reads always have new array refs,
 *  so a shallow object compare would false-positive on every tick). */
function sig(m: Message): string {
  return [
    m.updatedAt,
    m.status,
    m.seenAt ?? '',
    m.deleted ?? '',
    m.body,
    m.reactions?.length ?? 0,
    m.receipts?.length ?? 0,
  ].join('|');
}

export function useChatHistory(
  chatId: Ref<string> | string,
  q?: Ref<string>,
  opts: ChatHistoryOpts = {},
): ChatHistory {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const maxRows = opts.maxRows ?? MAX_ROWS;

  const rows = ref<Message[]>([]);
  const hasOlder = ref(false);
  const hasNewer = ref(false);
  const total = ref(0);
  const oldestLoadedTs = ref<number | null>(null);
  const newestLoadedTs = ref<number | null>(null);
  // We track `newerUnloaded` explicitly (loadOlder's tail-trim grows it, loadNewer consumes
  // it); olderUnloaded is derived from the invariant older + loaded + newer = total.
  const newerUnloaded = ref(0);
  const olderUnloaded = computed(() => Math.max(0, total.value - rows.value.length - newerUnloaded.value));
  const ready = ref(false);

  const cid = () => (isRef(chatId) ? chatId.value : chatId);
  const query = () => (q ? q.value : '');

  // A monotonically-increasing token guards async work: a chat/search switch (reload)
  // or a newer reconcile supersedes any in-flight read so a stale result can't land.
  let token = 0;

  function refreshCursors(): void {
    oldestLoadedTs.value = rows.value.length ? rows.value[0].timestamp : null;
    newestLoadedTs.value = rows.value.length ? rows.value[rows.value.length - 1].timestamp : null;
  }

  /** Reset to a fresh newest batch (initial load + on chatId/q change). */
  async function reload(): Promise<void> {
    const mine = ++token;
    const c = cid();
    const qq = query();
    const batch = await listMessagesOlder(c, null, batchSize, qq);
    const t = await countChatMessages(c);
    if (mine !== token) return; // superseded
    rows.value.splice(0, rows.value.length, ...batch); // in place, keep array identity
    refreshCursors();
    total.value = t;
    newerUnloaded.value = 0; // the newest batch → nothing newer is unloaded
    hasNewer.value = false; // the newest batch → pinned to the bottom
    hasOlder.value = qq ? batch.length === batchSize : t > rows.value.length;
    ready.value = true;
  }

  async function loadOlder(): Promise<number> {
    if (!hasOlder.value || oldestLoadedTs.value == null) return 0;
    const c = cid();
    const qq = query();
    const batch = await listMessagesOlder(c, oldestLoadedTs.value, batchSize, qq);
    if (!batch.length) {
      hasOlder.value = false;
      return 0;
    }
    rows.value.unshift(...batch);
    hasOlder.value = batch.length === batchSize;
    // Trim the newest tail so memory stays bounded; we're scrolling up, so the trimmed
    // rows are below the viewport — they become "newer-unloaded" (the bottom spacer).
    if (rows.value.length > maxRows) {
      const trimmed = rows.value.length - maxRows;
      rows.value.splice(maxRows, trimmed);
      newerUnloaded.value += trimmed;
      hasNewer.value = true;
    }
    refreshCursors();
    return batch.length;
  }

  async function loadNewer(): Promise<number> {
    if (!hasNewer.value || newestLoadedTs.value == null) return 0;
    const c = cid();
    const qq = query();
    const batch = await listMessagesNewer(c, newestLoadedTs.value, batchSize, qq);
    if (!batch.length) {
      hasNewer.value = false;
      return 0;
    }
    rows.value.push(...batch);
    newerUnloaded.value = Math.max(0, newerUnloaded.value - batch.length); // consumed K newer
    hasNewer.value = batch.length === batchSize;
    // Trim the oldest head (we're scrolling down; the head is far off-screen above). Those
    // rows become "older-unloaded" again (derived via the invariant from the smaller rows).
    if (rows.value.length > maxRows) {
      rows.value.splice(0, rows.value.length - maxRows);
      hasOlder.value = true;
    }
    refreshCursors();
    return batch.length;
  }

  async function seekTo(ts: number): Promise<boolean> {
    const mine = ++token;
    const c = cid();
    const qq = query();
    const newerHalf = Math.floor(maxRows / 2);
    // older: strictly older than ts; from-ts: ts and newer (includes the target row).
    const older = await listMessagesOlder(c, ts, maxRows - newerHalf, qq);
    const fromTs = await listMessagesNewer(c, ts - 1, newerHalf, qq);
    const t = await countChatMessages(c);
    if (mine !== token) return false;
    const combined = [...older, ...fromTs];
    if (!combined.length) return false;
    rows.value.splice(0, rows.value.length, ...combined);
    refreshCursors();
    total.value = t;
    // A full half in either direction means there's very likely more beyond the window;
    // a short read means we hit that end (a later loadOlder/Newer returns 0 and corrects).
    hasOlder.value = older.length === maxRows - newerHalf;
    hasNewer.value = fromTs.length === newerHalf;
    // Split the remaining unloaded across the two spacers (we don't know the exact rank of
    // the target; subsequent loadOlder/Newer correct the counts precisely).
    const rest = Math.max(0, t - rows.value.length);
    newerUnloaded.value = hasNewer.value ? (hasOlder.value ? Math.floor(rest / 2) : rest) : 0;
    ready.value = true;
    return true;
  }

  /** Reconcile the loaded window in place on a 'messages' change — no wholesale replace. */
  async function reconcile(): Promise<void> {
    if (!rows.value.length || oldestLoadedTs.value == null) {
      // Empty (or first message into an empty chat) → just (re)load the newest batch.
      await reload();
      return;
    }
    const mine = ++token;
    const c = cid();
    const qq = query();
    // The fresh state of the loaded window (+ a batch of headroom for new bottom rows).
    const limit = rows.value.length + batchSize;
    const fresh = await listMessagesNewer(c, oldestLoadedTs.value - 1, limit, qq);
    const t = await countChatMessages(c);
    if (mine !== token) return; // superseded by a reload / newer reconcile

    const freshById = new Map(fresh.map((m) => [m.id, m]));
    // Patch changed rows + splice removed ones (walk backwards so splices are stable).
    for (let i = rows.value.length - 1; i >= 0; i--) {
      const cur = rows.value[i];
      const f = freshById.get(cur.id);
      if (!f) {
        rows.value.splice(i, 1); // remove-by-id
      } else if (sig(f) !== sig(cur)) {
        Object.assign(rows.value[i], f); // patch-by-id (shallow-merge, same object)
      }
    }
    // Append new bottom messages only when the run touches the bottom; otherwise they're
    // beyond the loaded window and surfaced via hasNewer (no yank, FR-004).
    if (!hasNewer.value) {
      const have = new Set(rows.value.map((m) => m.id));
      const newest = newestLoadedTs.value ?? -Infinity;
      for (const m of fresh) {
        if (m.timestamp > newest && !have.has(m.id)) rows.value.push(m);
      }
    }
    refreshCursors();
    total.value = t;
  }

  // Subscribe to the change bus + reset on chatId/q change.
  const stops: Array<() => void> = [];
  if (isRef(chatId)) stops.push(watch(chatId, () => void reload()));
  if (q) stops.push(watch(q, () => void reload()));
  const unsub = subscribe(['messages'], () => void reconcile());
  onScopeDispose(() => {
    unsub();
    stops.forEach((s) => s());
  });

  void reload();

  return {
    rows: rows as Readonly<Ref<Message[]>>,
    hasOlder,
    hasNewer,
    total,
    oldestLoadedTs,
    newestLoadedTs,
    olderUnloaded,
    newerUnloaded,
    ready,
    loadOlder,
    loadNewer,
    seekTo,
    reload,
  };
}
