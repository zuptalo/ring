/**
 * Pure call-capacity gate (spec 1028). A video call holds at most VIDEO_MAX (4)
 * and an audio call at most AUDIO_MAX (8) participants — the existing caps, now
 * enforced PRE-EMPTIVELY on every mid-call add path (add-people, merge,
 * group-invite merge) so the user is stopped before anyone is rung, instead of
 * failing after the fact with a server `call-full`. The server's `JoinIfRoom`
 * stays the authoritative backstop; this is UX, not the security boundary.
 *
 * A person who has been INVITED (is ringing) but hasn't joined still holds a
 * slot, so two concurrent adds can't both slip past the gate and overshoot the
 * cap. Dependency-free (no WebRTC) so it is exhaustively unit-tested.
 */
import { VIDEO_MAX, AUDIO_MAX, type CallKind } from './types';

export function capOf(kind: CallKind): number {
  return kind === 'video' ? VIDEO_MAX : AUDIO_MAX;
}

/** Distinct heads currently occupying slots: everyone in the room, everyone
 *  ringing, and self — counted once each. */
export function headcount(roster: string[], invited: string[], selfId: string): number {
  return new Set([selfId, ...roster, ...invited]).size;
}

/** Free slots left for the call's kind (never negative). */
export function remainingSlots(
  kind: CallKind,
  roster: string[],
  invited: string[],
  selfId: string,
): number {
  return Math.max(0, capOf(kind) - headcount(roster, invited, selfId));
}

/** Pre-emptive add gate (FR-010/FR-011). `n` is how many NEW people the user is
 *  trying to add. The reason copy is kind-specific and user-facing. */
export function canAdd(
  kind: CallKind,
  roster: string[],
  invited: string[],
  selfId: string,
  n: number,
): { ok: true } | { ok: false; reason: string } {
  if (n <= remainingSlots(kind, roster, invited, selfId)) return { ok: true };
  const reason =
    kind === 'video'
      ? `Video calls are limited to ${VIDEO_MAX} people`
      : `Audio calls are limited to ${AUDIO_MAX} people`;
  return { ok: false, reason };
}
