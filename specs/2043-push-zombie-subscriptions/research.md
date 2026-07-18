# Phase 0 Research — Push zombie subscriptions & silent-wake strikes

No open `NEEDS CLARIFICATION` remained after `/speckit-clarify` (the two self-heal timing
values were resolved). This records the decisions that shaped the design.

## Decision: the failure is a client-side "zombie", not a server revocation

- **Rationale**: Live prod evidence — `push: delivered endpoint=web.push.apple.com` (Apple
  201) 102× / 26h with **zero** `push: pruning`; `relay_queue` rows delete on ack
  (`store/relay.go` `DeleteRelay`), so leftover rows == frames never drained; 13/37 subs held
  stale unacked backlog. The upstream push service accepts every send but the device never
  wakes. This is the documented WebKit/Chromium behavior: repeated push wakes without
  `showNotification` revoke delivery while the push service still returns 201.
- **Alternatives considered**: server VAPID/config fault (ruled out — deliveries succeed,
  config endpoint serves a valid key); not-installed PWA / permission (ruled out — the
  subscription exists and is installed, iOS `installed_version 1.0.4`).

## Decision: per-event WakeCtx instead of a module-global stamp

- **Rationale**: The pre-fix guard tracked "did we show" in a module global
  (`lastNotificationAt`). In an overlapping burst a later event's accepted show bled past an
  earlier event's start and suppressed its fallback → a silent wake → an iOS strike. A
  per-event context (`{ shown, satisfied }`) threaded through `dispatchPush` attributes each
  show to exactly its event, eliminating cross-event bleed. Extracted into a pure,
  injectable `runGuardedWake` so it is unit-testable outside the `self`-bound SW module.
- **Alternatives considered**: (a) a per-event counter derived from a global monotonic show
  count — still cross-contaminated by sibling events; (b) `getNotifications()` at fallback
  time — already rejected historically (counts stale prior-push notifications). Per-event
  ctx is the only attribution that is correct under concurrency.

## Decision: server-truth self-heal reading queue age, wake-independent

- **Rationale**: The existing rotation (`shouldRotateForStaleness`,
  `shouldRotateForMissedWakes`) keys on the *decrypted* send time of drained messages, so it
  needs the app to receive+decrypt and can match neither a fresh-burst zombie (<10 min,
  <3 drain sessions) nor a subscription that never woke. Reading the server's oldest-queued
  age directly lets the client decide from ground truth, and the `lastWakeAt >= oldest` guard
  is the only wake check — so it fires even at `lastWakeAt == 0`, exactly the un-healable
  case. A side-effect-free endpoint (no dequeue, no receipt) makes it safe to poll on
  foreground.
- **Timing** (from `/speckit-clarify`): 10-minute zombie bar (a held push to a live sub has
  landed by then, so a merely-offline device won't false-rotate; matches `STALE_MSG_MS`);
  2-hour retry cap, separate from the 24h drain cap, so a rotation onto another dead endpoint
  can retry within the day without thrashing.
- **Alternatives considered**: extending `/relay/pending` to expose `created_at` (rejected —
  it emits delivery receipts as a side effect, unsafe to poll); lowering the existing 24h cap
  (rejected — it also governs the decrypted-evidence path and would increase churn there).

## Decision: observability is content-free and opt-in

- **Rationale**: This bug class has recurred across 6+ specs because it is invisible on real
  iOS devices. A server aggregate gauge + a content-free on-device ledger + an opt-in reason
  diagnostic give measurement and on-device root-cause without crossing the zero-knowledge
  boundary. Reuses the spec-2014 dev-host reason-gate pattern.
- **Alternatives considered**: richer per-terminal outcome enums (deferred — coarse
  shown/licensed-silent/fallback already distinguishes the failure modes we act on);
  always-on production reason text (rejected — noise for normal users; gated behind a toggle).
