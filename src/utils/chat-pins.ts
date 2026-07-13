/**
 * Pinned-chats grid logic (specs 1044 + 1045). Pure and dependency-free (imported by
 * both the data layer and unit tests, like ownsync-keys) — the Chats tab renders
 * pinned chats as an iMessage-style avatar grid ABOVE the list, and the pinned rows
 * leave the list while the grid shows them. Since spec 1045 the grid's order is the
 * USER'S arrangement (`pinnedRank`), not recency — a new message lights the badge
 * but never moves the tile.
 */

// iMessage parity: at most 9 pinned chats (3 rows of 3). Enforced at pin time by
// setChatPinned; partitionPinned also clamps defensively because a synced snapshot
// from another device is applied as-is (the cap gates new pins, not existing data).
export const MAX_PINNED_CHATS = 9;
export const PINNED_GRID_MAX = MAX_PINNED_CHATS;

/** The slice of Chat these helpers need (kept structural so tests stay tiny). */
export interface PinOrderable {
  id: string;
  pinned?: boolean;
  pinnedRank?: number;
  lastMessageTime?: number;
}

/**
 * Order among PINNED chats (spec 1045): the user's arrangement first (`pinnedRank`
 * ascending), with legacy/unranked pins after the ranked ones. Ties — rank gaps and
 * duplicates happen after a cross-device sync merge, ranks are absent on pins that
 * predate the feature — fall back to recency and then to the (stable) input order,
 * so the grid is always deterministic and never crashes on odd data. Local writes
 * renumber 0..n-1, so ties heal on the next rearrange.
 */
export function pinnedOrder(a: PinOrderable, b: PinOrderable): number {
  const ra = a.pinnedRank ?? Infinity;
  const rb = b.pinnedRank ?? Infinity;
  if (ra !== rb) return ra - rb;
  return (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0);
}

/**
 * Rank for a chat being pinned via a non-drag surface (swipe / sheet / peek menu):
 * append at the END of the arrangement (FR-002). `max(rank) + 1` normally; the
 * pinned COUNT is the floor so that legacy unranked pins (which a later
 * ensurePinRanks() will stamp into the low ranks) can never end up after it.
 */
export function nextPinRank(chats: PinOrderable[]): number {
  const pinned = chats.filter((c) => c.pinned);
  let maxRank = -1;
  for (const c of pinned) {
    if (typeof c.pinnedRank === 'number' && c.pinnedRank > maxRank) maxRank = c.pinnedRank;
  }
  return Math.max(maxRank + 1, pinned.length);
}

export interface PartitionOpts {
  /** The "All" chip is active (the grid only shows there). */
  filterAll: boolean;
  /** A search query is active (pinned chats must be findable as normal rows). */
  searching: boolean;
}

/**
 * Split a (already filter-applied) chat array into the grid and the remaining list
 * rows. The grid is re-sorted by the user's arrangement here (defence in depth —
 * chatOrder upstream already sorts pinned chats the same way, but search results
 * and other callers aren't guaranteed to). Outside the All-chip/empty-search
 * context the grid is empty and every chat stays a row — search results and filter
 * chips treat pinned chats like any other chat.
 */
export function partitionPinned<T extends PinOrderable>(
  chats: T[],
  opts: PartitionOpts,
): { grid: T[]; list: T[] } {
  if (!opts.filterAll || opts.searching) return { grid: [], list: chats };
  const pinned = chats.filter((c) => c.pinned).sort(pinnedOrder);
  const grid = pinned.slice(0, PINNED_GRID_MAX);
  const overflow = new Set(pinned.slice(PINNED_GRID_MAX));
  const list = chats.filter((c) => !c.pinned || overflow.has(c));
  return { grid, list };
}
