# Phase 0 — Research: 9-AM-Local Version-Announcement Push

All "NEEDS CLARIFICATION" items from Technical Context are resolved below.

## R1 — Where the client reports installed version + timezone
**Decision**: Piggyback on the existing `POST /v1/push/subscribe` call.
**Rationale**: The client already re-sends the subscription on app start and on every
foreground (`src/services/push.ts` `ensurePushSubscription`/`revalidatePushSubscription`,
~5-min throttle), so version + offset stay fresh (DST/travel/updates picked up on the next
foreground) with no new endpoint or always-on channel — matches the locked decision.
**Alternatives considered**: a dedicated `device-report` WS frame on connect (more code,
new surface); a separate REST endpoint (extra surface). Rejected for minimalism.

## R2 — Timezone representation + sign convention
**Decision**: Store a coarse **UTC offset in whole minutes** = JavaScript
`new Date().getTimezoneOffset()`. Local time = `UTC − offset` (getTimezoneOffset returns
`UTC − local`, e.g. New York EST → +300, Berlin CEST → −120).
**Rationale**: Minutes cover half/45-min zones; far less identifying than an IANA name or
coordinates (Principle IX). Refreshed each foreground, so DST is handled without storing a
zone. The only use is `EXTRACT hour(local) == 9`.
**Alternatives considered**: IANA zone name (more identifying, more storage, needs a tz
database server-side). Rejected.

## R3 — "Behind" comparison
**Decision**: `installed_version <> current_server_version` (string inequality).
**Rationale**: Ring is single-deployment (one current version at a time); dev builds carry
`-dev.N+sha`, so any difference is a real "not the current build." No semver parsing
needed.
**Alternatives considered**: semver "<" comparison — unnecessary and fragile against the
`+sha` build metadata; could mis-handle pre-release ordering. Rejected.

## R4 — When is it "9 AM there"? (scheduler cadence + window)
**Decision**: A periodic job every **15 minutes** selects devices whose **local hour == 9**
(a pure `dueAtNine(subs, nowUTC)` function), then sends + marks-announced. Delivery lands
within the local 09:00–09:59 window, deduped to once.
**Rationale**: 15 min is frequent enough to land near 09:00 and cheap at Ring's scale; the
hour-equality + once-per-release dedup keeps it simple and idempotent across ticks within
the hour. Pure function = unit-testable with an injected clock (no DB, no real time).
**Alternatives considered**: per-device timers (state explosion); exact 09:00 cron per zone
(complex, marginal benefit); doing the hour math in SQL (harder to unit-test). Rejected.

## R5 — Offline-at-9 AM behavior + dedup point (from the clarification)
**Decision**: Send the version push with a **short TTL (~a few hours, expiring by local
midday)** and mark the device announced-for-this-version **on send** (not on confirmed
delivery — Web Push gives no delivery receipt).
**Rationale**: A short TTL guarantees a missed-morning push is dropped by the push service
rather than delivered that night (satisfies SC-001 / FR-015). Dedup-on-send keeps
"once per release" simple; a device that misses the window relies on the in-app prompt and
becomes eligible again only when a newer version ships. Matches the user's clarification.
**Alternatives considered**: long hold (re-introduces night delivery — rejected); retry
next morning until delivered (needs delivery tracking Web Push can't provide, and blurs
once-per-release — rejected).

## R6 — Upsert that doesn't clobber version/tz from the SW resubscribe
**Decision**: `SaveSubscription` upserts p256dh/auth always, and version/tz via
`COALESCE(EXCLUDED.x, push_subscriptions.x)` so a request that omits them (the SW
`resubscribePush`, which has no `__APP_VERSION__`) preserves the page-reported values.
`last_announced_version` is only ever written by the scheduler.
**Rationale**: Keeps the existing single subscribe endpoint authoritative while tolerating
the version-less SW path. **Alternatives**: a separate metadata endpoint (extra surface).
Rejected.

## R7 — Replace, not augment, the on-boot broadcast
**Decision**: Remove `announceVersionIfChanged` (boot broadcast) + `BroadcastVersion` +
`AllSubscriptions`; the scheduler is the sole delivery path. Keep `versionParams`/
`tickleVersion`/`ring-version` topic; reduce `versionTTL` to the short value (R5).
**Rationale**: The user wants no immediate blast. The `app_meta` table (migration 0024)
becomes unused for this feature but stays (migrations are forward-only); drop the now-dead
`GetAppMeta`/`SetAppMeta`/`lastAnnouncedVersionKey` only if no other caller.

## R8 — Background-job pattern + graceful shutdown
**Decision**: Reuse the existing relay-sweep ticker pattern in `cmd/ringd/main.go run()`:
`go func(){ t := time.NewTicker(15*time.Minute); defer t.Stop(); for { select { case
<-ctx.Done(): return; case <-t.C: /* evaluate + send */ } } }()`, with a bounded work
timeout per tick and `slog` logging.
**Rationale**: Proven pattern in the codebase; honors `ctx` from `signal.NotifyContext` for
clean shutdown; has direct access to `st` (store) + `notifier`.
