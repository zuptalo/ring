/**
 * Pure invite planning for growing a call (spec 1028). Given the people the user
 * wants to add, decide who actually gets rung: drop anyone already in the room,
 * already ringing, or self; dedup the request; and clamp to the remaining
 * capacity for the call's kind so a mid-call add can never overshoot the cap
 * (the ids that don't fit are reported as `dropped` so the caller can surface the
 * cap reason). Dependency-free (no WebRTC) so `inviteToRoom`'s decision is
 * exhaustively unit-tested; the impure wrapper only performs the ring.
 */
import { remainingSlots } from './capacity';
import type { CallKind } from './types';

export function planInvite(
  kind: CallKind,
  roster: string[],
  invited: string[],
  selfId: string,
  requested: string[],
): { toRing: string[]; dropped: string[] } {
  const present = new Set([selfId, ...roster, ...invited]);
  const fresh: string[] = [];
  const seen = new Set<string>();
  for (const id of requested) {
    if (!id || present.has(id) || seen.has(id)) continue;
    seen.add(id);
    fresh.push(id);
  }
  const room = remainingSlots(kind, roster, invited, selfId);
  return { toRing: fresh.slice(0, room), dropped: fresh.slice(room) };
}
