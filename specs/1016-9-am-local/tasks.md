# Tasks: 9-AM-Local Version-Announcement Push (Per-Device, Behind-Only)

**Feature**: spec 1016 | **Branch**: `feat/1016-9-am-local`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Data model**: [data-model.md](./data-model.md) | **Contract**: [contracts/push-subscribe.md](./contracts/push-subscribe.md)

TDD is mandated (Constitution Principle III): each user story lists its **failing tests
first**, then the implementation that makes them pass. `[P]` = parallelizable (distinct
files, no incomplete-task dependency).

## Phase 1: Setup

- [x] T001 Add forward-only migration `server/internal/db/migrations/0025_push_version.sql`: `ALTER TABLE push_subscriptions ADD COLUMN installed_version text, ADD COLUMN tz_offset_minutes int, ADD COLUMN last_announced_version text;` (additive; no shipped migration edited — Principle VI). (#316)

## Phase 2: Foundational — per-device metadata capture + storage (BLOCKS all user stories; realizes US4's storage shape)

- [x] T002 [P] Add `TZOffsetMinutes int` (plus the new fields as needed for reads/writes) to the `PushSubscription` struct in `server/internal/store/push.go`. (#317)
- [x] T003 [P] Write FAILING handler tests in `server/internal/api/push_handlers_test.go`: subscribing with `installedVersion`+`tzOffsetMinutes` persists both; a re-subscribe that OMITS them preserves the previously stored values (COALESCE semantics); `last_announced_version` is never written by subscribe. (#318)
- [x] T004 Extend the subscribe DTO in `server/internal/api/push_handlers.go` with optional `installedVersion *string` + `tzOffsetMinutes *int` and pass them to `SaveSubscription`. (#319)
- [x] T005 Update `SaveSubscription` in `server/internal/store/push.go` to upsert p256dh/auth always and version/tz only when provided (`COALESCE(EXCLUDED.x, push_subscriptions.x)`); update the in-memory fake store in `push_handlers_test.go` to mimic COALESCE. Makes T003 pass. (#320)
- [x] T006 [P] Client: add `installedVersion` (the `__APP_VERSION__` constant) + `tzOffsetMinutes` (`new Date().getTimezoneOffset()`) to `subscribePush` in `src/services/api.ts` and its caller in `src/services/push.ts` (the SW resubscribe path in `src/services/sw-push.ts` intentionally omits them). (#321)

## Phase 3: User Story 1 — Out-of-date user told at 09:00 local, not overnight (P1)

**Goal**: deliver the update push during the device's local 09:00 hour (never at night).
**Independent test**: `dueAtNine` selects a behind device at local 09:00 and not at other hours; `SendVersion` uses the short, expire-by-midday TTL.

- [x] T007 [P] [US1] Write FAILING unit tests for `dueAtNine(subs, nowUTC)` in `server/internal/push/schedule_test.go`: selected iff local hour (`UTC − tz_offset_minutes`) == 9 — cover UTC(0), EST(+300), CEST(−120), IST(+330 half-hour); and the same subs one hour off → not selected. (#322)
- [x] T008 [US1] Implement the pure `dueAtNine` in `server/internal/push/schedule.go`. Makes T007 pass. (#323)
- [x] T009 [P] [US1] Write FAILING test in `server/internal/push/push_test.go`: `SendVersion(sub)` delivers the content-free `{"t":"version"}` tickle to ONE subscription with the SHORT TTL (a few hours, not the old 3 days) and the `ring-version` topic / low urgency. (#324)
- [x] T010 [US1] Implement `SendVersion(ctx, sub)` in `server/internal/push/push.go` and set `versionTTL` to the short value (FR-015 expire-by-midday). Makes T009 pass. (#325)

## Phase 4: User Story 2 — Already-updated users never pinged (P1)

**Goal**: only devices whose installed version differs from current are eligible.
**Independent test**: the sweep includes a behind+9 AM device and excludes up-to-date / NULL-metadata devices.

- [x] T011 [P] [US2] Write FAILING tests in `server/internal/push/schedule_test.go` for the per-tick sweep selection (over a fake `VersionSchedStore`): a behind device at local 09:00 is chosen; an up-to-date device, and a device with NULL version or NULL offset, are excluded. (#326)
- [x] T012 [US2] Implement `SubscriptionsBehind(ctx, currentVersion)` in `server/internal/store/push.go` (SQL pre-filter: non-null version+tz, `installed_version <> $1`) and `SweepVersionAnnouncements(ctx, store, notifier, currentVersion, nowUTC)` in `server/internal/push/schedule.go` (calls `SubscriptionsBehind` → `dueAtNine` → `SendVersion`) over a small `VersionSchedStore` interface. Makes T011 pass. (#327)

## Phase 5: User Story 3 — Not re-nagged for the same version (P2)

**Goal**: once-per-release dedup keyed on send.
**Independent test**: a device already announced for the current version is skipped; after a newer version it becomes eligible once.

- [x] T013 [P] [US3] Write FAILING tests in `server/internal/push/schedule_test.go`: a device with `last_announced_version == current` is excluded; after the sweep sends + marks, a second sweep does not re-select it; when `current` changes to a newer value, it is selected exactly once. (#328)
- [x] T014 [US3] Implement `MarkAnnounced(ctx, endpoint, version)` in `server/internal/store/push.go`, add the `(last_announced_version IS NULL OR <> $1)` dedup clause to `SubscriptionsBehind`, and call `MarkAnnounced` after `SendVersion` in the sweep (dedup-on-send). Makes T013 pass. (#329)

## Phase 6: User Story 4 — Minimal metadata / ZK + remove the old broadcast (P2)

**Goal**: content-free payload, only the three coarse fields, no profile-building logs; the immediate broadcast is gone.
**Independent test**: payload bytes are exactly `{"t":"version"}`; no delivery/open tracking exists; the boot broadcast path is removed.

- [x] T015 [P] [US4] Write/extend a FAILING assertion test in `server/internal/push/push_test.go` that the version push payload is content-free (carries only the `{"t":"version"}` marker, no version/notes) and that no delivery- or open-confirmation is recorded anywhere (dedup is send-keyed only). (#330)
- [x] T016 [US4] Remove the immediate broadcast: delete `announceVersionIfChanged` and its boot call in `server/cmd/ringd/main.go`; remove `Notifier.BroadcastVersion` (`server/internal/push/push.go`) and `Store.AllSubscriptions` (`server/internal/store/push.go`) — plus `GetAppMeta`/`SetAppMeta`/`lastAnnouncedVersionKey` if they have no other caller. Wire the 15-min scheduler goroutine in `main.go run()` (relay-sweep ticker pattern: `time.NewTicker`, `defer Stop`, `select{<-ctx.Done()|<-t.C}`; skip when `version`==`dev`/`""` or `notifier==nil`) calling `SweepVersionAnnouncements(ctx, st, notifier, version, time.Now().UTC())`. (#331)
- [x] T017 [US4] Ensure NFR-ZK-004: review `SweepVersionAnnouncements`/`SendVersion`/scheduler `slog` calls so they record only coarse operational counts (e.g., "due=N sent=N") — never a device's local time-of-day, per-device send history, or delivery/open events. (#332)

## Phase 7: Polish & Cross-Cutting

- [x] T018 [P] Run gates: `cd server && go build ./... && go vet ./... && go test ./...` and `npm run build` (vue-tsc + vite). Fix any failure. Confirm the in-app update toast path (`useAppUpdate` / SW `{"t":"version"}` handler) is untouched (FR-011) and that no new endpoint/query exposes the per-device version/offset (NFR-ZK-003). (#333)
- [x] T019 [P] Drive/console spot-check against the live `make start` stack that `POST /v1/push/subscribe` now carries `installedVersion` + `tzOffsetMinutes` (quickstart §1). (#334)
- [x] T020 Bump spec `Status:` (planned → in-progress, later in-review) and run `make roadmap`. (#335)

## Dependencies & Order

- **Phase 1 → Phase 2** block everything (migration + metadata capture/storage).
- **US1 (T007–T010)** provides `dueAtNine` + `SendVersion`, consumed by **US2 (T011–T012)**'s sweep; **US3 (T013–T014)** adds dedup to that sweep; **US4 (T015–T017)** wires the scheduler + removes the old path.
- **Phase 7** runs last.
- Within a story, the `[P]` test task precedes its implementation task (TDD).

## Parallel Example
After Phase 2, the test-authoring tasks T007, T009, T011, T013, T015 touch the same two test files (`schedule_test.go`, `push_test.go`) so are only partly parallel; T006 (client) is fully parallel with all server tasks; T002 is parallel with T003.

## MVP
**US1 + US2** (deliver the update push at the device's local 09:00, only to behind devices) is the minimum that solves the stated problem. US3 (no re-nag) and US4 (ZK/cleanup) are required before shipping but layer on top.

## Implementation Strategy
Build Phase 2 once (capture/store), then add the pure `dueAtNine` and `SendVersion` (US1),
the `SubscriptionsBehind` filter + sweep (US2), the dedup (US3), and finally wire the
scheduler + delete the old broadcast (US4). Keep each story's tests green before moving on.
