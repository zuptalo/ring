/**
 * Call-event markers (spec 1040) — the PURE logic behind caller identity in
 * notifications, the missed-call trace, and the ringing-call badge unit.
 *
 * The caller (or group-call initiator) sends a sealed `callEvent` frame over
 * the existing pairwise ratchet: `ring` at dial time, `ended` at outcome time
 * (see `CallEventSignal` in crypto/message.ts and contracts/call-event.md).
 * This module holds every decision those markers drive, with no IndexedDB,
 * service-worker, or crypto dependency, so the rules stay unit-testable:
 *
 *  - freshness/staleness of a pending ring against the ring window;
 *  - the reconcile decision table (when a marker becomes a missed-call log,
 *    when it clears silently, when it waits);
 *  - the app-badge unit transitions (one unit per call across its whole
 *    ringing → missed-unseen lifecycle — never two).
 *
 * The stateful glue lives in db/queries.ts (receive branch), composables/
 * useCall.ts (send sites), and sw-inbox.ts / sw.ts (notifications + badge).
 */
import type { CallEventSignal } from './crypto/message';

/** How long a ring can plausibly still be ringing: the 60s ring window used by
 *  caller timeout, relay offer buffering, and push TTL, plus delivery slack.
 *  Past this, a pending ring with no outcome means the caller died mid-ring. */
export const RING_WINDOW_MS = 75_000;

/** Badge units older than this are bookkeeping leaks (the page clears units on
 *  every open; a device closed for days shouldn't accumulate ghosts). */
export const UNIT_STALE_MS = 24 * 60 * 60 * 1000;

export function buildRingEvent(
  callId: string,
  kind: 'audio' | 'video',
  at: number,
  roomId?: string,
): CallEventSignal {
  return { phase: 'ring', callId, kind, ...(roomId ? { roomId } : {}), at };
}

export function buildEndedEvent(
  callId: string,
  kind: 'audio' | 'video',
  outcome: 'missed' | 'cancelled' | 'answered',
  at: number,
  roomId?: string,
): CallEventSignal {
  return { phase: 'ended', callId, kind, outcome, ...(roomId ? { roomId } : {}), at };
}

/** A ring marker awaiting its outcome on the receiver. */
export interface PendingCallEvent {
  callId: string;
  from: string; // the caller/initiator user id (the authenticated frame sender)
  kind: 'audio' | 'video';
  roomId?: string;
  receivedAt: number; // receiver clock — staleness is judged locally, never off `at`
}

export function isRingStale(p: PendingCallEvent, now: number): boolean {
  return now - p.receivedAt > RING_WINDOW_MS;
}

export type ReconcileDecision = 'log-missed' | 'clear' | 'keep';

/**
 * The missed-trace decision for one pending ring (data-model.md table):
 *  - an existing call-log row for this callId always wins (the live path
 *    logged it — never duplicate, never overwrite, FR-018);
 *  - a ring this device handled live is owned by the live UI's own logging
 *    (answer/decline/timeout all write their row) — clear;
 *  - explicit `missed`/`cancelled` outcome → log the missed trace (a cancel
 *    before answer is a missed call per the spec clarification);
 *  - explicit `answered` (on any of the callee's devices) → clear, log
 *    nothing (FR-016);
 *  - no outcome yet: stale → the caller died mid-ring, log missed; fresh →
 *    keep waiting (the call may still be ringing).
 */
export function reconcilePending(
  p: PendingCallEvent,
  ctx: { hasRow: boolean; sawLive: boolean; now: number; outcome?: 'missed' | 'cancelled' | 'answered' },
): ReconcileDecision {
  if (ctx.hasRow || ctx.sawLive) return 'clear';
  if (ctx.outcome === 'answered') return 'clear';
  if (ctx.outcome === 'missed' || ctx.outcome === 'cancelled') return 'log-missed';
  return isRingStale(p, ctx.now) ? 'log-missed' : 'keep';
}

/**
 * One app-badge unit per call while the app is closed (FR-007/008/010). The
 * service worker holds these in the shared settings store; the page clears
 * them all on foreground (FR-009 — by then the calls store is authoritative).
 */
export interface CallBadgeUnit {
  callId?: string; // known when a marker decrypted; absent on the heuristic path
  ts: number; // when the unit was created (ring freshness / staleness)
  state: 'ringing' | 'missed';
}

const freshRinging = (units: CallBadgeUnit[], now: number): CallBadgeUnit | undefined =>
  [...units].reverse().find((u) => u.state === 'ringing' && now - u.ts <= RING_WINDOW_MS);

/**
 * A `{"t":"call"}` push arrived. Exactly one unit per distinguishable call:
 *  - a unit with this callId already exists → no change (re-ring);
 *  - callId known but only an ANONYMOUS fresh ringing unit exists → claim it
 *    (the first tickle couldn't decrypt the marker; don't double-count);
 *  - callId unknown and any fresh ringing unit exists → same call re-ringing
 *    (the fold-to-one degradation: undercount, never overcount);
 *  - otherwise → a new call, append one ringing unit.
 */
export function applyCallTickle(
  units: CallBadgeUnit[],
  callId: string | undefined,
  now: number,
): CallBadgeUnit[] {
  if (callId && units.some((u) => u.callId === callId)) return units;
  const anon = freshRinging(units, now);
  if (callId && anon && !anon.callId) {
    return units.map((u) => (u === anon ? { ...u, callId } : u));
  }
  if (!callId && anon) return units;
  return [...units, { ...(callId ? { callId } : {}), ts: now, state: 'ringing' }];
}

/**
 * An outcome marker was decrypted (SW preview) — hand the SAME unit over:
 *  - `missed`/`cancelled` flips ringing → missed (or creates the unit if the
 *    tickle never arrived: the trace exists, it deserves its badge);
 *  - `answered` removes the unit (handled on some device, nothing pending).
 * Matching prefers the callId, falling back to the newest fresh anonymous
 * ringing unit (its tickle predated the marker's decryptability).
 */
export function applyCallOutcome(
  units: CallBadgeUnit[],
  callId: string | undefined,
  outcome: 'missed' | 'cancelled' | 'answered',
  now: number,
): CallBadgeUnit[] {
  const target =
    (callId ? units.find((u) => u.callId === callId) : undefined) ?? freshRinging(units, now);
  if (outcome === 'answered') {
    return target ? units.filter((u) => u !== target) : units;
  }
  if (target) {
    return units.map((u) => (u === target ? { ...u, callId: u.callId ?? callId, state: 'missed' as const } : u));
  }
  return [...units, { ...(callId ? { callId } : {}), ts: now, state: 'missed' }];
}

/** Drop units old enough to be bookkeeping leaks. */
export function sweepStaleUnits(units: CallBadgeUnit[], now: number): CallBadgeUnit[] {
  return units.filter((u) => now - u.ts <= UNIT_STALE_MS);
}

/**
 * Does this batch of decrypted markers carry a call that may STILL be ringing —
 * a fresh `ring` with no `ended` outcome for the same call in the same batch?
 * The msg-wake ring upgrade (sw.ts) gates on this before paying previewCallRing's
 * refetch: the dial-time marker rides the queued message channel (its send is
 * deferred off the call-setup hot path), so the {"t":"call"} tickle wake usually
 * ran first and showed the generic ring — the marker's own wake is where the
 * name becomes available. `at` is the sender's clock: a freshness hint only,
 * matching previewCallRing's display rule (stale → stay generic).
 */
export function hasFreshRing(evs: readonly CallEventSignal[] | undefined, now: number): boolean {
  if (!evs?.length) return false;
  const ended = new Set(evs.filter((e) => e.phase === 'ended').map((e) => e.callId));
  return evs.some((e) => e.phase === 'ring' && !ended.has(e.callId) && now - e.at <= RING_WINDOW_MS);
}
