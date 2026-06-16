/**
 * Pick which keys to evict from a least-recently-used ordering so a cache stays
 * within `max` live entries — without ever evicting a key in `keep` (e.g. items
 * currently on screen, or pinned by an open viewer).
 *
 * `order` is the access order, least-recently-used first and most-recently-used
 * last. Returns the keys to drop, oldest first. If the only way to get under `max`
 * would be to evict protected keys, those are left in place (correctness over a
 * hard memory cap): the cache may briefly exceed `max` while many items are pinned.
 *
 * Pure and side-effect free so it can be unit-tested independently of the DOM /
 * object-URL lifecycle that consumes its decisions (spec 1005, FR-005 / SC-002).
 */
export function selectEvictions(order: string[], keep: Set<string>, max: number): string[] {
  const overflow = order.length - max;
  if (overflow <= 0) return [];
  const evictable = order.filter((k) => !keep.has(k));
  return evictable.slice(0, overflow);
}
