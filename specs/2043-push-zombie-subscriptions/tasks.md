# Tasks: Push zombie subscriptions & silent-wake strikes

**Feature**: `fix/2043-push-zombie-subscriptions` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

TDD is mandated (Principle III — a `2001+` bug fix begins with a failing regression test).
Test tasks precede the implementation they cover. `[P]` marks tasks touching different files
with no incomplete dependency. Checked boxes reflect work already completed on this branch;
unchecked tasks are the owed behavioral/deploy verification.

## Phase 1: Setup

- [X] T001 Create hotfix spec + branch via `make spec CATEGORY=hotfix` (branch `fix/2043-push-zombie-subscriptions`, `specs/2043-push-zombie-subscriptions/`), and run `make roadmap`

## Phase 2: Foundational (blocking prerequisites)

- [X] T002 Add per-event guard primitives `WakeCtx`, `WakeResult`, `runGuardedWake`, and `PUSH_DEADLINE_MESSAGE` in `src/services/sw-inbox.ts` (pure, injectable — the seam every story's SW change builds on)

## Phase 3: User Story 1 — New device keeps receiving notifications through a burst (P1)

**Goal**: No push wake completes silently; a burst can't make one event's show suppress
another's fallback. **Independent test**: overlapping `push` events each end with an accepted
`showNotification` (sw-guard unit + drive/e2e burst).

- [X] T003 [US1] Write failing guard regression tests in `src/services/sw-guard.test.ts`: burst isolation (sibling show must not suppress this event's fallback), clean-resolve backstop, licensed-silence exemption, timeout fallback
- [X] T004 [US1] Thread a per-event `WakeCtx` through `dispatchPush(event, ctx)` in `src/sw.ts`, setting `shown`/`satisfied` at every terminal (call, conn, post, post-activity, version, page-claim, drain, message); make `showQuietUnlessVisible` return did-show
- [X] T005 [US1] Rewrite `guardedPush` to use `runGuardedWake` and DELETE the module-global `lastNotificationAt` + the `showNotification` monkeypatch in `src/sw.ts`
- [X] T006 [US1] Update `tryAuthoritativeDrain(ctx)` and `showMessageNotification(ctx)` in `src/sw.ts` to report their outcome into the ctx
- [ ] T007 [US1] Add a drive/e2e burst scenario (5 rapid messages to a backgrounded recipient) asserting via `window.__ringTest.pushWakeLedger()` that no wake is silent (SC-001)

## Phase 4: User Story 2 — An already-zombie device heals itself on next open (P1)

**Goal**: A subscription the server proves is dead (old queued frames, no wake since)
force-rotates on foreground, even at `lastWakeAt==0`. **Independent test**: seeded
`lastWakeAt=0` + old queue → rotates once, respects the 2h cap; a caught-up offline device
does not.

- [X] T008 [P] [US2] Write failing `shouldRotateForQueueAge` truth-table tests in `src/services/push.rotate.test.ts` (empty / too-fresh / `lastWakeAt>=oldest` / `lastWakeAt==0` old queue / within-vs-over 2h cap)
- [X] T009 [P] [US2] Write failing `TestRelayStatus` in `server/internal/api/relay_handlers_test.go` (count + null-when-empty + NO dequeue side effect)
- [X] T010 [US2] Add `OldestPendingForRecipient` to `server/internal/store/relay.go` and to the `RelayStore` interface in `server/internal/ws/hub.go`; implement in the fakes (`auth_handlers_test.go`, `ws/relay_test.go`)
- [X] T011 [US2] Add the side-effect-free `relayStatus` handler in `server/internal/api/relay_handlers.go` and register `GET /v1/relay/status` behind `authMW` in `server/internal/api/router.go`
- [X] T012 [P] [US2] Add `fetchRelayStatus()` (bearer auth, 8s timeout) in `src/services/api.ts`
- [X] T013 [US2] Add the pure `shouldRotateForQueueAge` predicate (10-min bar, 2h cap, `push.lastForceRotateAt`) and `healZombieIfLikely()` (throttled probe → force-rotate) in `src/services/push.ts`
- [X] T014 [US2] Add the `ensurePushSubscription({ forceRotate })` hook reusing the unsubscribe→subscribe→register path in `src/services/push.ts`
- [X] T015 [US2] Wire `void healZombieIfLikely()` into `src/composables/useSync.ts` on transport `online` and on `visibilitychange`→visible

## Phase 5: User Story 3 — We can see why a device fell silent (P2)

**Goal**: Server zombie-fleet gauge + content-free on-device wake ledger + opt-in production
reason diagnostic. **Independent test**: sweep logs a `push: zombie fleet` count; with the
toggle on, a fallback shows a content-free reason and the ledger records enum entries.

- [X] T016 [P] [US3] Add `CountZombieFleet(staleAge)` in `server/internal/store/relay.go`
- [X] T017 [US3] Emit `slog.Info("push: zombie fleet", ...)` from the ringd hourly sweep loop in `server/cmd/ringd/main.go`
- [X] T018 [P] [US3] Add the content-free wake ledger (`recordWake`/`readWakeLedger`, `push.wakeLedger`) in `src/services/sw-inbox.ts`; record one entry per wake in `guardedPush` (`src/sw.ts`)
- [X] T019 [US3] Extend `showGeneric`'s reason gate with the opt-in `diagnostics.pushReasonText` setting in `src/sw.ts`
- [X] T020 [P] [US3] Add the `diagnostics.pushReasonText` toggle to `src/settings/schema.ts` and expose `pushWakeLedger()` on the dev test hook in `src/services/testhook.ts`

## Phase 6: Polish & Cross-Cutting

- [X] T021 Verify all gates: `npm run build`, `go build/vet/test`, full vitest (1174 pass), full `go test ./...`
- [X] T022 Capture the prod before-baseline (`zombie_devices_24h = 13`; `1d0ca925` = 5 frames) for the SC-002 before/after
- [ ] T023 Deploy, then confirm SC-002: the zombie count falls from 13 and `1d0ca925`'s frames drain as devices foreground; watch the `push: zombie fleet` log
- [ ] T024 Real-device pass on iOS 26.5.2 with the diagnostics toggle on: confirm burst notifications land and the wake ledger populates (the owed device verification)

## GitHub issues (task groups → for the feature→develop PR's `Closes #N`)

- **#1031** — US1: per-event push guard (T002–T007)
- **#1032** — US2: server `/relay/status` + client zombie self-heal (T008–T015)
- **#1033** — US3: observability — zombie metric + wake ledger + diagnostic (T016–T020)
- **#1034** — Verification & rollout (T021–T024)

## Dependencies & order

- Setup (T001) → Foundational (T002) → then stories.
- **US1** (T003–T007) depends only on T002; it is the acute fix and the MVP.
- **US2** (T008–T015): T010→T011 (handler needs the store method + interface); T012→T013→T014→T015 (client heal needs the fetch, predicate, rotate hook, then wiring). Server tasks and client `fetchRelayStatus` (T012) are `[P]` relative to each other.
- **US3** (T016–T020) depends on T002 (ledger records via the guard) but is otherwise independent of US1/US2.
- Polish (T021–T024) after the stories; T023/T024 require a deploy + device (owed).

## Parallel execution examples

- US2 kick-off in parallel: T008 (client predicate test) ∥ T009 (server handler test) ∥ T012 (client fetch helper) — different files, no shared dependency.
- US3 in parallel: T016 (server count) ∥ T018 (client ledger) ∥ T020 (settings toggle + test hook).

## Implementation strategy

MVP = **US1** (stops new zombies — the acute fresh-device strike-out). Then **US2** (recovers
the existing 35% fleet). Then **US3** (measurement + on-device root-cause). US1 and US3 are
independently shippable; US2 is the highest-impact recovery and depends on its own server
endpoint only.
