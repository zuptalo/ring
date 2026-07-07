# Feature Specification: Zombie Push Subscriptions Rotate Themselves

**Feature Branch**: `feat/1037-zombie-push-subscriptions`

**Created**: 2026-07-07

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: Follow-up to specs 2022/1034 (the push-death incident). The one
remaining unhealed failure mode: a ZOMBIE subscription — the push service
accepts sends (201) but the device never receives, and the browser still
returns the old subscription object, so re-registering on every open just
re-registers the corpse. Today recovery needs a manual notifications
off/on toggle. Users bitten by the old silent-wake bug should instead heal
automatically the first time they open the app.

## Mechanism

The zombie signature is detectable on-device: *a message that sat queued for
a long time arrived via the normal drain, and no push wake ever happened
after it was sent — while we supposedly held a valid subscription.*

- **FR-001 (wake stamp)**: the service worker records `push.lastWakeAt` at the
  top of EVERY push wake.
- **FR-002 (stale-drain marker)**: when an inbound message's sender timestamp
  is older than 10 minutes at receive time, the receive path records
  `push.staleMsg` = { at: the message's send time, recordedAt: now }.
- **FR-003 (rotation decision — pure, unit-tested)**: on app open/foreground
  (inside the existing `ensurePushSubscription`), rotate — unsubscribe and
  subscribe fresh, yielding a NEW endpoint — exactly when:
  - a stale-drain marker exists, AND
  - it was recorded ≥ 60s ago (a racing held-push wake gets a chance to land
    first), AND
  - `lastWakeAt` predates the stale message's send time (no wake since —
    the should-have-woken-but-didn't core of the signature), AND
  - the last rotation was ≥ 24h ago (thrash cap).
  Rotation clears the marker and stamps `push.lastRotateAt`.

## Why false positives are harmless

A phone that was simply off/offline matches "stale messages drained" — but on
reconnect the push service DELIVERS its held wakes (28-day TTL), stamping
`lastWakeAt` fresh, which invalidates the signature. Only a subscription that
never wakes again rotates. And even a spurious rotation costs nothing: the new
endpoint keeps notifications working seamlessly; the old row is replaced.

## Zero-Knowledge Impact

None. All signals are device-local timestamps; the server sees only the same
subscribe call it already sees on every app open, occasionally with a new
endpoint.

## Success Criteria

- **SC-001**: Unit tests cover the rotation decision: fires on the zombie
  signature; declines when a wake followed the stale message, within the
  60s grace, within the 24h cap, or with no marker.
- **SC-002**: Existing push registration behavior (key-mismatch re-subscribe,
  normal reuse) is unchanged.
- **SC-003**: Client gates green (typecheck/build, unit suite, notification
  e2e).
