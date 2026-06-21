# Implementation Plan: 9-AM-Local Version-Announcement Push (Per-Device, Behind-Only)

**Branch**: `feat/1016-9-am-local` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1016-9-am-local/spec.md`

## Summary

Replace the immediate, all-device version-announcement broadcast (shipped in #313) with a
**scheduled, per-device, behind-only** delivery: the content-free `{"t":"version"}` push
is sent at **09:00 in each device's local time**, only to devices whose installed client
version differs from the server's current version, **once per release**, and with a
**short lifetime** so a missed-morning push expires by ~local midday instead of arriving
at night. The client reports its installed version + local UTC-offset-minutes by
piggybacking on the existing push-subscribe call; a periodic server job evaluates which
devices are due and sends to each.

## Technical Context

**Language/Version**: Go 1.26 (server `ringd`); TypeScript / Vue 3 + Ionic (client PWA).

**Primary Dependencies**: stdlib `net/http`, `pgx` v5, embedded SQL migrations,
`SherClockHolmes/webpush-go` (existing); client `fetch` + existing push/SW stack. No new
dependencies.

**Storage**: PostgreSQL — extend the existing `push_subscriptions` table (forward-only
migration). No client IndexedDB change.

**Testing**: `go test ./...` (in-memory fake store) for store/handler/scheduler-selector;
a pure unit test for the local-9AM selector; client `vue-tsc` + `vite build`; drive/console
spot-check that the subscribe request carries the new fields.

**Target Platform**: Linux server + installable PWA (existing).

**Project Type**: web-service + PWA (existing Ring monorepo).

**Performance Goals**: the periodic scheduler runs every ~15 min and queries a
pre-filtered (behind, not-yet-announced) subset; bounded delivery concurrency (reuse the
existing broadcast cap). No user-facing latency path.

**Constraints**: zero-knowledge boundary (Principle I); forward-only migrations
(Principle VI); content-free push payload; coarse metadata only.

**Scale/Scope**: Ring's small private network — at most a few thousand subscriptions;
every-15-min full evaluation is comfortably within budget.

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS. Push payload stays content-free;
  the only new server-readable data is the installed version (already public) + a coarse
  UTC-offset-in-minutes + a last-notified-version dedup marker. Captured in the spec's
  **Zero-Knowledge Impact** section + NFR-ZK-001..003. The crypto/ZK **checklist is
  REQUIRED** (next step) because this adds a metadata surface.
- **II. Spec-Driven Development** — PASS. Running the full pipeline; branch/commits/issues
  trace to spec 1016.
- **III. Test-Driven Development** — PASS with a noted limitation. `tasks.md` orders
  failing tests first: a pure `dueAtNine` selector unit test, store query/dedup tests, and
  subscribe-handler persistence tests (fake store). **e2e limitation**: the actual
  9-AM-local push *delivery* is not e2e-testable in the harness (no push service + no
  wall-clock/timezone control), so behavioral coverage is unit-level for the timing/targeting
  logic; client-side reporting is verified via typecheck + a drive spot-check. Justified
  deviation from "add an e2e spec," recorded here.
- **IV. Crypto Discipline** — PASS (N/A). No crypto added or changed.
- **V. Offline-First Data Integrity** — PASS (N/A). No IndexedDB object store change; the
  client only adds two fields to an existing outbound request.
- **VI. Stateless Server & Forward-Only Migrations** — PASS. New `NNNN_*.sql` migration
  (ALTER push_subscriptions, additive); no shipped migration edited; `SECRETS_KEY`
  untouched.
- **VII. Quality Gates** — PASS. `go build/vet/test`, `vue-tsc`, `vite build` are the DoD.
- **VIII. Traceable, Auto-Closing Delivery** — PASS. `taskstoissues` → `Closes #N` in the
  PR.
- **IX. Privacy & Data Minimization** — PASS. Two coarse fields, minimal, single-purpose,
  not repurposed (NFR-ZK-003).
- **X. Accessibility & i18n** — PASS (N/A). No new text surface (the notification copy is
  unchanged and already rendered from public config).
- **XI. Ionic-First UI** — PASS (N/A). No UI change.

**Gate result: PASS** — proceed; the crypto/ZK checklist is the one required follow-up
artifact before tasks.

## Design Overview

### Client (report version + tz on the existing subscribe)
- The client already re-POSTs the push subscription on app start and on each foreground
  (`src/services/push.ts` `ensurePushSubscription` / `revalidatePushSubscription`, ~5-min
  throttle). Add two fields to that request body: `installedVersion` (the compile-time
  `__APP_VERSION__`, already used in `src/composables/useAppUpdate.ts`) and
  `tzOffsetMinutes` (`new Date().getTimezoneOffset()`).
- `src/services/api.ts` `subscribePush` gains the two optional fields.
- The service-worker resubscribe path (`src/services/sw-push.ts`) keeps sending without
  these fields (no `__APP_VERSION__` in the SW build); the server preserves existing values
  when they're absent (COALESCE), so the SW path never clobbers them.

### Server (store the fields, schedule the 9-AM delivery)
- **Migration** (next `NNNN`): `ALTER TABLE push_subscriptions ADD COLUMN installed_version
  text, ADD COLUMN tz_offset_minutes int, ADD COLUMN last_announced_version text;`
- **`SaveSubscription`** (`store/push.go`): accept optional `installedVersion *string` +
  `tzOffsetMinutes *int`; upsert refreshes p256dh/auth always and version/tz only when
  provided (`COALESCE(EXCLUDED.x, push_subscriptions.x)`). `last_announced_version` is never
  written here.
- **`SubscriptionsBehind(ctx, currentVersion)`** (`store/push.go`): SQL pre-filter —
  `installed_version IS NOT NULL AND tz_offset_minutes IS NOT NULL AND installed_version <>
  $1 AND (last_announced_version IS NULL OR last_announced_version <> $1)`; returns endpoint
  + keys + tz_offset (new `TZOffsetMinutes` field on the `PushSubscription` struct).
- **Pure selector** `dueAtNine(subs, nowUTC) []PushSubscription` (new
  `internal/push/schedule.go`): keep subs whose **local** hour == 9, where `local = nowUTC -
  tz_offset_minutes` (JS `getTimezoneOffset()` = UTC−local). Unit-testable with an injected
  `now`.
- **`SendVersion(ctx, sub)`** (`internal/push/push.go`): deliver the existing
  `versionParams()` tickle to ONE subscription — with a **short TTL** for the
  expire-by-midday requirement (FR-015). Reuse `deliver`; set `versionTTL` to a few hours so
  a missed morning push never arrives at night. (The collapsible `ring-version` topic stays.)
- **`MarkAnnounced(ctx, endpoint, version)`** (`store/push.go`): set `last_announced_version
  = version WHERE endpoint = $1` — dedup-on-send (FR-006/FR-015).
- **Scheduler goroutine** in `cmd/ringd/main.go run()`, modeled on the existing relay-sweep
  ticker (`time.NewTicker`, `defer ticker.Stop()`, `select { <-ctx.Done() | <-ticker.C }`):
  every ~15 min, skip if `version == "dev"`/`""` or `notifier == nil`; else `subs :=
  SubscriptionsBehind(version)`; for each `dueAtNine(subs, time.Now().UTC())` →
  `SendVersion` + `MarkAnnounced` (bounded concurrency like the old broadcast).
- **Remove** the on-boot broadcast: `announceVersionIfChanged` (main.go) +
  `Notifier.BroadcastVersion` + `Store.AllSubscriptions` (+ `GetAppMeta`/`SetAppMeta` /
  `lastAnnouncedVersionKey` if unused). The `app_meta` table (migration 0024) stays
  (append-only) but is no longer used by this feature.

### Unchanged
- The service-worker `{"t":"version"}` handler + `showVersionNotification` (fetches
  `/v1/config` at delivery, content-free) and the in-app `useAppUpdate` toast are untouched
  — the SW path is delivery-time-agnostic, so time-shifting the push needs no SW change.

## Project Structure

### Documentation (this feature)
```text
specs/1016-9-am-local/
├── plan.md          # this file
├── research.md      # Phase 0
├── data-model.md    # Phase 1
├── quickstart.md    # Phase 1
├── contracts/       # Phase 1 (subscribe request contract delta)
└── tasks.md         # /speckit-tasks (next)
```

### Source (touched)
```text
server/internal/db/migrations/NNNN_push_version.sql   # new (additive ALTER)
server/internal/store/push.go                          # fields + SaveSubscription + SubscriptionsBehind + MarkAnnounced; remove AllSubscriptions
server/internal/push/push.go                           # SendVersion + short version TTL; remove BroadcastVersion
server/internal/push/schedule.go                       # new: pure dueAtNine + tests
server/internal/api/push_handlers.go                   # subscribe DTO gains installedVersion/tzOffsetMinutes
server/cmd/ringd/main.go                               # remove announceVersionIfChanged; add the 15-min scheduler
src/services/api.ts, src/services/push.ts              # send installedVersion + tzOffsetMinutes on subscribe
```

## Phasing
- **Phase 0 — research.md**: design parameters (scheduler cadence, short TTL value, offset
  sign, dedup-on-send, COALESCE upsert). Done.
- **Phase 1 — data-model.md / contracts / quickstart**: the `push_subscriptions` delta, the
  `/v1/push/subscribe` request contract delta, the verification recipe. Done.
- **Phase 2 — tasks.md**: produced by `/speckit-tasks` (TDD order).

## Complexity Tracking
No constitution deviations requiring justification beyond the noted TDD/e2e limitation
(push-timing not e2e-testable in the harness; covered by unit tests + typecheck + drive
spot-check).
