/**
 * Pinned-chats grid logic (spec 1044). Pure and dependency-free (imported by both
 * the data layer and unit tests, like ownsync-keys) — the Chats tab renders pinned
 * chats as an iMessage-style avatar grid ABOVE the list, and the pinned rows leave
 * the list while the grid shows them.
 */

// iMessage parity: at most 9 pinned chats (3 rows of 3). Enforced at pin time by
// setChatPinned; partitionPinned also clamps defensively because a synced snapshot
// from another device is applied as-is (the cap gates new pins, not existing data).
export const MAX_PINNED_CHATS = 9;
export const PINNED_GRID_MAX = MAX_PINNED_CHATS;

export interface PartitionOpts {
  /** The "All" chip is active (the grid only shows there). */
  filterAll: boolean;
  /** A search query is active (pinned chats must be findable as normal rows). */
  searching: boolean;
}

/**
 * Split a (already filter-applied, pinned-first-ordered) chat array into the grid
 * and the remaining list rows. Outside the All-chip/empty-search context the grid
 * is empty and every chat stays a row — search results and filter chips treat
 * pinned chats like any other chat.
 */
export function partitionPinned<T extends { pinned?: boolean }>(
  chats: T[],
  opts: PartitionOpts,
): { grid: T[]; list: T[] } {
  if (!opts.filterAll || opts.searching) return { grid: [], list: chats };
  const pinned = chats.filter((c) => c.pinned);
  const grid = pinned.slice(0, PINNED_GRID_MAX);
  const overflow = new Set(pinned.slice(PINNED_GRID_MAX));
  const list = chats.filter((c) => !c.pinned || overflow.has(c));
  return { grid, list };
}
