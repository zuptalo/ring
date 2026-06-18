/**
 * Pure group-run + day-divider math for the bounded chat window (spec 1011, research D8).
 *
 * Avatars/day-dividers render on the first bubble of a sender-run / day. The bug a
 * windowed list introduces is computing "is this a run/day start?" from the previous
 * RENDERED item: at the window's top edge that predecessor changes as older rows are
 * prepended or evicted, so an avatar/divider flickers and injects a height jump into the
 * anchored frame. The fix is to compute from the row's TRUE predecessor in the loaded run
 * (preserved across the window edge). These helpers take that predecessor explicitly, so
 * the answer depends only on the data, never on what happens to be rendered.
 */
import { sameDay } from './time';

export interface RunMsg {
  senderId: string;
  outgoing: boolean;
}

/**
 * Whether `cur` begins a new sender-run (its avatar + colored name show). Group chats
 * only; your own outgoing bubbles never start a run. True when there is no predecessor,
 * or the predecessor was outgoing / from a different sender.
 */
export function isRunStart(
  prev: RunMsg | null | undefined,
  cur: RunMsg,
  isGroup: boolean,
): boolean {
  if (!isGroup) return false;
  if (cur.outgoing) return false;
  if (!prev) return true;
  return prev.outgoing || prev.senderId !== cur.senderId;
}

/**
 * Whether a day divider renders above `cur` — true for the oldest loaded item (no
 * predecessor) or when the calendar day changes from the predecessor.
 */
export function showDay(
  prev: { timestamp: number } | null | undefined,
  cur: { timestamp: number },
): boolean {
  return !prev || !sameDay(prev.timestamp, cur.timestamp);
}
