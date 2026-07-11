/**
 * Mutual-call ("glare") resolution for 1:1 calls (spec 1039) — PURE functions so the
 * policy is unit-testable without WebRTC or the call store.
 *
 * When two contacts place calls at each other at (nearly) the same time, each device
 * sees the peer's offer cross its own unanswered outgoing attempt. Both devices must
 * independently reach the SAME resolution with no extra round-trip, so the tie-break is
 * a fixed ordering of the two user ids — the attempt whose CALLER has the smaller id
 * survives. (Same convention as the mesh's polite/impolite rule and the pre-1039 glare
 * branch, so one ordering governs all call collisions.)
 *
 * The yielding side then either joins the surviving call automatically (kinds match —
 * both people already asked for exactly this call, so ringing is pure friction) or
 * falls back to a normal incoming ring (kinds differ — auto-accepting a video offer
 * after placing an AUDIO call would light a camera nobody consented to; the ring is the
 * established consent surface, constitution Principle IX).
 */
import type { CallKind } from '@/services/call/types';

/** The shape of the current call slot the decision needs — structurally satisfied by
 *  CallMeta, so useCall can pass `callMeta.value` straight in. */
export interface GlareAttempt {
  direction: 'incoming' | 'outgoing';
  isGroup: boolean;
  kind: CallKind;
  peerUserId?: string;
}

export type GlareRole = 'none' | 'win' | 'yield';
export type GlareDecision = 'none' | 'ignore' | 'auto-accept' | 'ring';

/**
 * Which side of a mutual attempt we are, given an incoming 1:1 offer from `from`.
 * `unanswered` is whether our own attempt is still awaiting an answer (idle-while-
 * setting-up, dialing, or remote-ringing) — a connected/connecting call is NOT glare;
 * it follows the ordinary busy/call-waiting rules.
 */
export function glareRole(
  selfId: string,
  from: string,
  attempt: GlareAttempt | null | undefined,
  unanswered: boolean,
): GlareRole {
  if (!selfId || !from || !attempt || !unanswered) return 'none';
  if (attempt.isGroup || attempt.direction !== 'outgoing') return 'none';
  if (attempt.peerUserId !== from) return 'none';
  return selfId < from ? 'win' : 'yield';
}

/** How the yielding side joins the surviving call: automatically when it grants exactly
 *  what this user already asked for (same kind), a normal ring otherwise (consent). */
export function yieldMode(attemptKind: CallKind, offerKind: CallKind): 'auto-accept' | 'ring' {
  return attemptKind === offerKind ? 'auto-accept' : 'ring';
}

/** The composed decision table (data-model.md): what to do with a crossing 1:1 offer. */
export function glareDecision(
  selfId: string,
  from: string,
  attempt: GlareAttempt | null | undefined,
  unanswered: boolean,
  offerKind: CallKind,
): GlareDecision {
  const role = glareRole(selfId, from, attempt, unanswered);
  if (role === 'none') return 'none';
  if (role === 'win') return 'ignore';
  return yieldMode((attempt as GlareAttempt).kind, offerKind);
}
