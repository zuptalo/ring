/**
 * Pure logic for the "scroll to latest" control (spec 1012).
 *
 * The control's visibility and its unread badge are driven by two pure functions so the
 * decision logic is unit-testable without a DOM: the view feeds in the live distance from the
 * bottom (px) and a list of messages newer than the boundary.
 */

/** A message as far as the unread count cares: its time, whether it's the local user's, and
 *  whether it's been deleted. */
export interface UnreadMsg {
  id: string;
  timestamp: number;
  outgoing?: boolean;
  deleted?: boolean;
  senderId?: string;
  /** Spec 1013: epoch ms when this device reported the message Seen; undefined = not yet. */
  seenReportedAt?: number;
}

/**
 * Whether the control should be shown, with hysteresis so it doesn't flicker near the edge:
 * show once scrolled further than `showPx` from the bottom, hide once back within `hidePx`,
 * and otherwise keep the current `shown` state. Callers pass `showPx > hidePx`.
 */
export function jumpButtonVisible(
  distanceFromBottomPx: number,
  shown: boolean,
  showPx: number,
  hidePx: number,
): boolean {
  if (distanceFromBottomPx > showPx) return true;
  if (distanceFromBottomPx <= hidePx) return false;
  return shown;
}

/** The "everything up to here is read" cut: the newest message the user had seen when they left
 *  the bottom, as a (timestamp, id) point in the chat's canonical order. The id matters because
 *  message ids are random (not time-monotonic) and several messages can share a millisecond — so
 *  a plain timestamp boundary would drop a same-ms message that actually sorts *after* the cut. */
export interface UnreadBoundary {
  ts: number;
  id: string;
}

/**
 * Count of UNREAD messages — incoming (not the local user's), non-deleted messages that sort
 * strictly after `boundary` in (timestamp, id) order — and the earliest such message's id (the
 * first-unread jump target). `boundary === null` (pinned to bottom) ⇒ nothing is unread.
 *
 * The (timestamp, id) cut is exact even with millisecond ties: a same-ts message with a greater
 * id sorts below the boundary message (so it arrived after → unread); one with a smaller id sorts
 * above it (already on-screen when the user left the bottom → read); the boundary message itself
 * is excluded. This mirrors the chat's render order, so "unread" == "below the cut in the list".
 */
export function unreadSince(
  messages: readonly UnreadMsg[],
  boundary: UnreadBoundary | null,
  selfId: string,
): { count: number; firstId: string | null } {
  if (boundary === null) return { count: 0, firstId: null };
  const unread = messages
    .filter(
      (m) =>
        (m.timestamp > boundary.ts || (m.timestamp === boundary.ts && m.id > boundary.id)) &&
        !m.deleted &&
        !(m.outgoing === true || (m.senderId !== undefined && m.senderId === selfId)),
    )
    .sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { count: unread.length, firstId: unread.length ? unread[0].id : null };
}

/**
 * The seen frontier (spec 1013): the `(timestamp, id)` of the **newest incoming, non-deleted
 * message this device has reported Seen** (`seenReportedAt` set), or `null` if none have been
 * reported. Because the uniform catch-up rule reports Seen for a viewed message and everything
 * older, the not-yet-Seen set is exactly `unreadSince(messages, seenFrontier(...), selfId)` —
 * the messages after this frontier. Pure; deterministic by `(timestamp, id)`; ignores input order.
 */
export function seenFrontier(messages: readonly UnreadMsg[], selfId: string): UnreadBoundary | null {
  let best: UnreadBoundary | null = null;
  for (const m of messages) {
    if (m.seenReportedAt == null || m.deleted) continue;
    if (m.outgoing === true || (m.senderId !== undefined && m.senderId === selfId)) continue;
    if (best === null || m.timestamp > best.ts || (m.timestamp === best.ts && m.id > best.id)) {
      best = { ts: m.timestamp, id: m.id };
    }
  }
  return best;
}
