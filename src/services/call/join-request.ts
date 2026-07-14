/**
 * Join-request state (spec 1041) — the PURE rules behind the consent-gated
 * merge: while in a call, the callee may INVITE the party behind a waiting or
 * held call to join it; nothing moves anyone into the room without their
 * explicit accept (the pre-1041 merge auto-joined them — the consent hole).
 *
 * One instance lives per ongoing call on the callee's side (module state in
 * useCall.ts), dies with the call (rejection-final is scoped to the call,
 * FR-011), and is deliberately free of IO so the rules stay vitest-covered:
 *
 *  - a party with an outstanding request can't be asked again until it
 *    resolves;
 *  - a REJECTION is final for this call (FR-009) — the merge affordances for
 *    that party disappear; hold/swap/decline are untouched;
 *  - capacity is the caller's input (canAdd), not re-derived here;
 *  - teardown drains every pending request so each gets its joinreq-cancel.
 */

export interface JoinRequestState {
  roomId: string; // pre-minted for a 1:1 ongoing call; the real roomId for a group
  pending: Map<string, string>; // partyId → their waiting attempt's callId
  rejected: Set<string>; // rejection-final for THIS call
  // (spec 2031) Parties who ACCEPTED and are on their way into the room. Kept so
  // (a) the invite affordance stays "Invited" (not re-askable) while they join,
  // and (b) the roster-join retire of a redundant held 1:1 can prove the join
  // came from OUR invite — even when the sealed accept reply itself was lost
  // (the roster broadcast is the authoritative join signal).
  accepted: Set<string>;
}

export function createJoinRequests(roomId: string): JoinRequestState {
  return { roomId, pending: new Map(), rejected: new Set(), accepted: new Set() };
}

/** May the callee send this party a join request right now? */
export function canRequest(s: JoinRequestState, partyId: string, capacityOk: boolean): boolean {
  return capacityOk && !s.rejected.has(partyId) && !s.pending.has(partyId) && !s.accepted.has(partyId);
}

/** Register an outgoing request. Returns false when the state forbids it. */
export function request(s: JoinRequestState, partyId: string, callId: string): boolean {
  if (s.rejected.has(partyId) || s.pending.has(partyId) || s.accepted.has(partyId)) return false;
  s.pending.set(partyId, callId);
  return true;
}

/** The party declined: pending → rejected, final for this call. */
export function reject(s: JoinRequestState, partyId: string): void {
  s.pending.delete(partyId);
  s.rejected.add(partyId);
}

/** The party accepted: pending → accepted, hand back their attempt's callId. */
export function accept(s: JoinRequestState, partyId: string): string | undefined {
  const callId = s.pending.get(partyId);
  s.pending.delete(partyId);
  s.accepted.add(partyId);
  return callId;
}

/** The waiting attempt died (cancel/timeout/hang-up): forget the pending
 *  request silently — their prompt died with the attempt, and no rejection
 *  memory is created. */
export function clearParty(s: JoinRequestState, partyId: string): void {
  s.pending.delete(partyId);
}

/** Teardown: empty the pending set, returning each entry once so the caller
 *  can send its joinreq-cancel (FR-014). */
export function drainPending(s: JoinRequestState): Array<{ partyId: string; callId: string }> {
  const out = [...s.pending.entries()].map(([partyId, callId]) => ({ partyId, callId }));
  s.pending.clear();
  return out;
}
