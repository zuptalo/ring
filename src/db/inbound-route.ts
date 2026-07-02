/**
 * Rule R stage 1 — pre-decrypt inbound session resolution (spec 1027, fixes B1).
 *
 * Every inbound frame from a peer rides the per-peer 1:1 Double Ratchet, whose
 * session is stored under the plain 1:1 chat's id (`sessions[chatId]`). The old
 * code resolved that chat with `startDirectChat`, which REFUSES hidden chats —
 * so hiding your only 1:1 made the peer's next frame mint a fresh VISIBLE chat
 * with no session (spurious re-key, visible content, orphaned hidden thread).
 *
 * This resolver replaces that call. It is deliberately a thin leaf over idb +
 * hidden-state + tombstones (no queries.ts import) so the decision table is
 * unit-testable; `receiveIncomingInner` acts on the returned kind:
 *
 *   chat    → open the packet under chatId (visible 1:1 first, else hidden 1:1)
 *   blocked → hiddenPeer reset block (FR-018): ack + drop, no rekey, no trace
 *   defer   → hidden set not yet decryptable: re-queue, never resolve blind
 *   create  → genuinely new peer: create the fresh visible 1:1 (existing path)
 *
 * `payload.groupId` (rule R stage 2) is NOT consulted here — it lives inside
 * the sealed payload and only routes CONTENT after the packet is opened.
 */
import { getAll } from './idb';
import { hasHiddenPeerBlock } from './tombstones';
import { ensureHiddenLoaded, isHiddenKnown } from '@/services/hidden-state';
import { resolveInboundDirectChat } from '@/services/hidden-pair';
import type { Chat } from './types';

export type InboundRoute =
  | { kind: 'chat'; chatId: string }
  | { kind: 'blocked' }
  | { kind: 'defer' }
  | { kind: 'create' };

export async function routeInboundFrom(peerId: string): Promise<InboundRoute> {
  const hidden = await ensureHiddenLoaded();
  // Fail closed: an unknown set must never be read as "nothing hidden" — a
  // hidden 1:1 would fall through to `create` and resurrect a visible chat.
  // Unreachable in practice (frames queue while locked, and unlocked implies
  // the set decrypts), but the guard costs nothing and the invariant is load-
  // bearing.
  if (!isHiddenKnown()) return { kind: 'defer' };
  const chats = await getAll<Chat>('chats');
  const chat = resolveInboundDirectChat(chats, hidden, peerId);
  if (chat) return { kind: 'chat', chatId: chat.id };
  // No conversation with this peer. A reset block only guards re-CREATION: if a
  // chat exists again the user has already re-engaged, so frames route above.
  if (await hasHiddenPeerBlock(peerId)) return { kind: 'blocked' };
  return { kind: 'create' };
}
