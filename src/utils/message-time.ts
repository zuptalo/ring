// (spec 2056) Deciding what time an INCOMING message really happened.
//
// A message carries the timestamp its SENDER's device put on it, and that timestamp drives both
// the displayed time and the message's position in the conversation. That makes conversation
// order hostage to every participant's clock: a phone with stale timezone data — an old Android
// still applying a DST rule its country abolished, for instance — reports a wall clock that looks
// right to its owner while its actual UTC time is an hour off. Every message it sends then sorts
// an hour into the past on the recipient's screen, so new messages appear ABOVE older ones
// instead of at the end of the chat, and can be missed entirely.
//
// The recipient cannot judge this from the sender's timestamp alone, because "timestamp well in
// the past" is also exactly what a legitimate message queued while the recipient was offline
// looks like. The discriminator is the RELAY's own receive time, which the server now stamps on
// every delivered frame:
//
//   • queued-while-offline → the sender sent it when they said, so their claim and the relay
//     time agree; the message is genuinely old and must stay old (Ring's push-zombie detection
//     depends on that being honest).
//   • skewed sender clock → the claim and the relay time disagree by the skew, even though the
//     message was relayed seconds ago.
//
// So: trust the sender's own timestamp while it is consistent with when the relay saw the frame,
// and fall back to the relay's time when it is not. The comparison never involves OUR clock, so a
// recipient whose own clock is wrong still orders the conversation correctly.

/** How far a sender's claimed time may sit from the relay's receive time before we stop
 *  believing it. Generous enough to absorb ordinary network latency, brief queuing and modest
 *  clock drift, far below the smallest timezone error (30 minutes). */
export const CLOCK_SKEW_TOLERANCE_MS = 90_000;

/**
 * The timestamp to store for an incoming message.
 *
 * @param claimedTs   the sender's own timestamp for the message (epoch ms)
 * @param relayedAtMs when the relay accepted the frame (epoch ms); 0/undefined when unknown
 *                    (a server older than spec 2056), in which case the claim is kept as-is.
 *
 * Note the deliberate trade-off when a sender composes while offline and sends much later: the
 * claim and the relay time diverge, so we use the relay time — the message shows when it reached
 * the conversation rather than when it was typed. That is the safe direction: it can never sort a
 * message into the distant past, which is the failure being fixed. The sender's own copy keeps
 * their compose time.
 */
export function resolveIncomingTimestamp(claimedTs: number, relayedAtMs?: number): number {
  if (!claimedTs) return relayedAtMs || Date.now();
  if (!relayedAtMs) return claimedTs; // no reference to check against → take the sender's word
  return Math.abs(claimedTs - relayedAtMs) <= CLOCK_SKEW_TOLERANCE_MS ? claimedTs : relayedAtMs;
}

/** Whether the sender's clock disagrees with the relay beyond tolerance — i.e. we corrected it.
 *  Split out so callers can skip clock-dependent heuristics (the stale-drain / missed-wake push
 *  signals) that a skewed sender would otherwise trip falsely. */
export function senderClockIsSkewed(claimedTs: number, relayedAtMs?: number): boolean {
  if (!claimedTs || !relayedAtMs) return false;
  return Math.abs(claimedTs - relayedAtMs) > CLOCK_SKEW_TOLERANCE_MS;
}
