# Bug: Push failures hide their reason, and dead subscriptions are retried forever

**Feature Branch**: `fix/2022-push-failures-name`

**Created**: 2026-07-07

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: Live incident on the dev server (2026-07-05 → 07-06): one iPhone's
push subscription was rejected by Apple with HTTP 400 on 123 consecutive
message tickles across two days. The device silently received NO notifications
the whole time. Two defects compounded:

1. **The send path discards the response body.** Apple names every rejection
   (`{"reason":"BadJwtToken"}`, `BadWebPushTopic`, expired-subscription
   variants…) in the body; the log recorded only `status=400`, so diagnosing
   required re-sending pushes by hand with a probe.
2. **Pruning only triggers on 404/410.** In practice Apple reports dead or
   invalidated subscriptions with 400/403 reasons too. Such a subscription is
   retried forever — and since a device holds one subscription, that device is
   push-dead with no self-healing, even though the client re-registers on every
   app foreground and would recover immediately if the server dropped the corpse.

## Fix (server only, `internal/push`)

- **FR-001**: On any non-success push response, read (bounded) and log the
  response body alongside status + endpoint host, so the push service's own
  reason lands in the log.
- **FR-002**: A pure, unit-tested decision `shouldPrune(status, body)`:
  - 404 / 410 → prune (existing behavior, unchanged).
  - 400 / 403 → prune ONLY when the body's reason names a dead subscription
    (`Unregistered`, `BadDeviceToken`, `DeviceTokenNotForTopic`,
    `ExpiredToken`, `Gone`, `InvalidSubscription`, `SubscriptionExpired`).
  - NEVER prune on reasons that mean OUR REQUEST was malformed
    (`BadWebPushTopic`, `BadWebPushTtl`, `BadJwtToken`, `PayloadTooLarge`,
    rate limiting…) — pruning healthy subscriptions over a server-side bug
    would be the worse failure (it silently unsubscribes every device).
  - Unknown reason / empty body → do not prune, log loudly.
- **FR-003**: Recovery is client-driven and already ships: the app re-registers
  its subscription on every foreground; once the dead row is pruned, the next
  register writes a fresh one.

## Zero-Knowledge Impact

None. Push payloads remain the same content-free tickles; only failure
handling and logging change (bodies logged are the PUSH SERVICE's own error
JSON, never user data).

## Success Criteria

- **SC-001**: Unit tests cover the prune decision for every reason class above
  (dead → prune; our-bug → keep; unknown → keep).
- **SC-002**: Non-success sends log the response body (visible in a fake-server
  test).
- **SC-003**: `go build ./... && go vet ./... && go test ./...` green; no
  client or wire changes.
