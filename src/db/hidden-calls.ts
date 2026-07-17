/**
 * Pure helper (spec 1019 FR-019, extended by spec 1027 FR-014): map the
 * hidden-chat set to the call `contactId`s that must be excluded from the
 * Calls tab and the missed badge.
 *
 * A `Call` stores `contactId = peer userId` for a 1:1 and `= room/group id` for
 * a group, while the hidden set holds chat ids — so a hidden group's calls key
 * on its group/chat id, and calls with a hidden PERSON key on the peer id.
 *
 * The per-person rule (1027): a peer's 1:1 calls are excluded when their
 * hidden thread — plain 1:1 OR pair conversation — is their ONLY chat. When a
 * visible chat with the same person coexists, their calls belong to that open
 * relationship and stay in history (hiding them would leak the other way: a
 * visible contact with mysteriously missing calls). Multi-member groups only
 * ever exclude their own room id, never their members.
 *
 * Extracted from `queries.ts` so it can be unit-tested without importing the
 * (heavy, DOM-dependent) data layer.
 */
import type { Chat } from './types';

export function hiddenCallKeys(chats: Chat[], hidden: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const c of chats) {
    if (!hidden.has(c.id)) continue;
    out.add(c.id); // group/room calls key on the group/chat id
    const peer = c.participantIds.length === 1 ? c.participantIds[0] : null;
    if (!peer) continue; // multi-member group → members' own calls untouched
    const visibleWithPeer = chats.some(
      (o) =>
        o.id !== c.id &&
        !hidden.has(o.id) &&
        o.participantIds.length === 1 &&
        o.participantIds[0] === peer,
    );
    if (!visibleWithPeer) out.add(peer); // 1:1 calls key on the peer id
  }
  return out;
}
