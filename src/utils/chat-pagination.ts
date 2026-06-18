/**
 * Pure pagination/cursor math for bounded chat-history reads (spec 1011, research D2).
 *
 * The bounded reads in queries.ts pull the whole chat off the `messages` `chatId`
 * index, sort it once, and slice a batch with these helpers — no compound index, no
 * DB_VERSION bump. Keeping the slice math pure makes the seam-dedupe property (a row
 * exactly on the cursor is never returned by both adjacent batches) directly unit-
 * testable without IndexedDB.
 *
 * Cursors are timestamps (the public contract signature). Within a chat, messages are
 * stamped with `now()` ms per send and the dev seed spreads timestamps, so colliding
 * timestamps are effectively absent; ordering still breaks ties by `id` so the sort is
 * deterministic. The strict `<` / `>` boundary is what dedupes the seam: the row at the
 * cursor is the edge row already held by the loaded run, so neither adjacent batch
 * re-emits it.
 */

export interface TimeId {
  id: string;
  timestamp: number;
}

/** Deterministic order: ascending by timestamp, ties broken by id. */
export function compareByTimeId(a: TimeId, b: TimeId): number {
  return a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The `limit` rows immediately OLDER than `beforeTs` (strictly older — seam dedupe),
 * returned oldest→newest. When `beforeTs` is null, the newest `limit` rows.
 * `sortedAsc` MUST already be sorted ascending (caller sorts once).
 */
export function sliceOlder<T extends TimeId>(
  sortedAsc: readonly T[],
  beforeTs: number | null,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  const upper = beforeTs == null ? sortedAsc.length : lowerBound(sortedAsc, beforeTs);
  const start = Math.max(0, upper - limit);
  return sortedAsc.slice(start, upper);
}

/**
 * The `limit` rows immediately NEWER than `afterTs` (strictly newer — seam dedupe),
 * returned oldest→newest. `sortedAsc` MUST already be sorted ascending.
 */
export function sliceNewer<T extends TimeId>(
  sortedAsc: readonly T[],
  afterTs: number,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  const lower = upperBound(sortedAsc, afterTs);
  return sortedAsc.slice(lower, lower + limit);
}

/** First index whose timestamp is >= ts (rows before it are strictly older). */
function lowerBound(sortedAsc: readonly TimeId[], ts: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid].timestamp < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose timestamp is > ts (rows from it on are strictly newer). */
function upperBound(sortedAsc: readonly TimeId[], ts: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid].timestamp <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
