/**
 * Pure geometry/list math for the pinned-grid drag (spec 1045). Dependency-free on
 * purpose (like chat-pins): the pointer-event state machine in useChatDrag feeds
 * DOM rects in and gets slot indices / preview orders out, so all the fiddly
 * clamping logic is unit-testable without a DOM.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Which grid slot (0-based, row-major) is the pointer over? `count` is the number
 * of REAL slots the caller is considering (pass pins+1 when previewing an
 * insertion so the trailing gap is reachable); a cell past the last slot (ragged
 * final row) clamps to the last slot. `slack` grows the rect on every side so the
 * gesture is forgiving right at the edge. Returns null outside the (slackened)
 * rect — the caller treats that as "not over the grid".
 */
export function gridSlotAt(
  x: number,
  y: number,
  rect: RectLike,
  count: number,
  cols = 3,
  slack = 0,
): number | null {
  if (count <= 0 || !isInside(x, y, rect, slack)) return null;
  const col = Math.min(cols - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * cols)));
  const rows = Math.ceil(count / cols);
  const row = Math.min(rows - 1, Math.max(0, Math.floor(((y - rect.top) / rect.height) * rows)));
  return Math.min(count - 1, row * cols + col);
}

/** Containment test with optional slack margin. */
export function isInside(x: number, y: number, rect: RectLike, slack = 0): boolean {
  return (
    x >= rect.left - slack &&
    x <= rect.left + rect.width + slack &&
    y >= rect.top - slack &&
    y <= rect.top + rect.height + slack
  );
}

/** Move list[from] to index `to` (immutably). Out-of-range or equal → unchanged. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to > list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.min(to, next.length), 0, item);
  return next;
}

/**
 * The order the grid should DISPLAY mid-drag: `dragId` moved (member) or inserted
 * (foreign, i.e. a list row being pinned) at `hoverIndex`. A null hover restores
 * the true order — the pointer has left the grid, so the gap closes.
 */
export function previewOrder(ids: string[], dragId: string, hoverIndex: number | null): string[] {
  if (hoverIndex == null) return [...ids]; // pointer left the grid → true order, gap closed
  const without = ids.filter((id) => id !== dragId);
  const at = Math.max(0, Math.min(hoverIndex, without.length));
  without.splice(at, 0, dragId);
  return without;
}

// Auto-scroll tuning: the outer 15% of the viewport is "hot"; speed ramps
// linearly from 0 at the inner edge to MAX at the physical edge.
const EDGE_FRACTION = 0.15;
const MAX_EDGE_SPEED = 14; // px per frame — brisk but trackable

/**
 * Signed auto-scroll velocity (px/frame) for a drag at viewport-y `y`: negative
 * near the top (scroll up), positive near the bottom, 0 in the calm middle.
 */
export function edgeScrollVelocity(
  y: number,
  viewportTop: number,
  viewportHeight: number,
): number {
  const edge = viewportHeight * EDGE_FRACTION;
  const fromTop = y - viewportTop;
  const fromBottom = viewportTop + viewportHeight - y;
  if (fromTop < edge) {
    const t = Math.max(0, Math.min(1, 1 - fromTop / edge));
    return -t * MAX_EDGE_SPEED;
  }
  if (fromBottom < edge) {
    const t = Math.max(0, Math.min(1, 1 - fromBottom / edge));
    return t * MAX_EDGE_SPEED;
  }
  return 0;
}
