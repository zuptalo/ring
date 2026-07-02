/**
 * Per-person hidden/visible invariant core (spec 1027, research R8).
 *
 * Ring's crypto forces the shape of coexistence: the 1:1 Double Ratchet session
 * for a peer is keyed by the plain 1:1 chat's id, so there can only ever be ONE
 * plain 1:1 per peer (INV-3) — a second thread with the same person must be a
 * "pair conversation" (a group-modeled chat with exactly that one participant,
 * sender-key crypto, routed by groupId). On top of that channel reality, spec
 * 1027 defines the per-person rule: at most one HIDDEN chat (INV-1) and at most
 * one VISIBLE chat (INV-2) per person. Hidden/visible are roles; channel type is
 * whatever each thread happens to be.
 *
 * This module is a pure leaf (no idb, no service imports) so the invariant is
 * unit-testable without IndexedDB and usable from both the data layer
 * (`queries.ts`) and the UI (`ChatActionsSheet`) without cycles — the same
 * pattern as `hidden-state.ts`.
 */
import type { Chat } from '@/db/types';

/** All conversations that count as "a chat with this person" for the per-person
 *  rule: plain 1:1s and pair conversations. Multi-member groups never count —
 *  they hide/unhide individually and are unconstrained by the pair invariant. */
export function chatsWithPeer(chats: Chat[], peerId: string): Chat[] {
  return chats.filter((c) => c.participantIds.length === 1 && c.participantIds[0] === peerId);
}

export type PairVerdict = { ok: true } | { ok: false; reason: string };

/** True for the threads the per-person rule constrains (single-participant). */
function isPairScoped(c: Chat): boolean {
  return c.participantIds.length === 1;
}

/**
 * INV-1 gate for the Hide action: hiding is blocked when ANOTHER chat with the
 * same person is already hidden. Multi-member groups always pass. Re-hiding an
 * already-hidden chat passes (idempotent — its own id never blocks it).
 */
export function canHide(chats: Chat[], hidden: ReadonlySet<string>, chatId: string): PairVerdict {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat || !isPairScoped(chat)) return { ok: true };
  const peer = chat.participantIds[0];
  const otherHidden = chatsWithPeer(chats, peer).some((c) => c.id !== chatId && hidden.has(c.id));
  if (otherHidden) {
    return { ok: false, reason: 'You already have a hidden chat with this person' };
  }
  return { ok: true };
}

/**
 * INV-2 gate for the Unhide action: unhiding is blocked while a VISIBLE chat
 * with the same person exists (delete it first — histories are never merged).
 * A pending request placeholder counts as a blocker too: it turns visible the
 * moment the request is accepted, which would break INV-2 after the fact.
 * Another hidden chat does not block — unhiding is the way out of the legacy
 * two-hidden state.
 */
export function canUnhide(chats: Chat[], hidden: ReadonlySet<string>, chatId: string): PairVerdict {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat || !isPairScoped(chat)) return { ok: true };
  const peer = chat.participantIds[0];
  const visibleExists = chatsWithPeer(chats, peer).some((c) => c.id !== chatId && !hidden.has(c.id));
  if (visibleExists) {
    return {
      ok: false,
      reason: 'You already have a chat with this person. Delete it first to unhide this one',
    };
  }
  return { ok: true };
}

/**
 * Rule R stage 1 — pre-decrypt session resolution for an inbound frame from
 * `peerId` (spec 1027 D2). Every frame from a peer rides the per-peer 1:1
 * ratchet, whose session is stored under the plain 1:1 chat's id, so this picks
 * that chat WITHOUT reading the (still sealed) payload:
 *
 *   1. the visible plain 1:1 (non-pending preferred, pending placeholder next);
 *   2. else the hidden plain 1:1 — content lands there silently;
 *   3. else null — the caller consults the `hiddenPeer:` reset block and only
 *      then creates a fresh visible 1:1.
 *
 * Never returns a pair conversation: those carry no 1:1 session, and their
 * content routes by `payload.groupId` post-decrypt (rule R stage 2). In the
 * legacy B1 state (hidden AND visible plain 1:1) the visible one wins — that is
 * where the live session ended up.
 */
export function resolveInboundDirectChat(
  chats: Chat[],
  hidden: ReadonlySet<string>,
  peerId: string,
): Chat | null {
  const ones = chats.filter(
    (c) => !c.isGroup && c.participantIds.length === 1 && c.participantIds[0] === peerId,
  );
  const visible = ones.filter((c) => !hidden.has(c.id));
  return visible.find((c) => !c.pending) ?? visible[0] ?? ones.find((c) => hidden.has(c.id)) ?? null;
}
