/**
 * Pure helper (spec 1019, FR-019): map the hidden-chat set to the call
 * `contactId`s that must be excluded from the Calls tab and the missed badge.
 *
 * A `Call` stores `contactId = peer userId` for a 1:1 and `= room/group id` for a
 * group, while the hidden set holds chat ids — so a hidden group's calls key on
 * its group/chat id, and a hidden 1:1's calls key on the peer id.
 *
 * Extracted from `queries.ts` so it can be unit-tested without importing the
 * (heavy, DOM-dependent) data layer.
 */
import type { Chat } from './types';

export function hiddenCallKeys(chats: Chat[], hidden: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const c of chats) {
    if (!hidden.has(c.id)) continue;
    out.add(c.id); // group calls key on the group/chat id
    if (!c.isGroup && c.participantIds[0]) out.add(c.participantIds[0]); // 1:1 calls key on the peer id
  }
  return out;
}
