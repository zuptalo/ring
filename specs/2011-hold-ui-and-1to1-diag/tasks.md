---
description: "Task list for spec 2011 — call on-hold visualization & 1:1 diagnostics"
---

# Tasks: Call on-hold visualization & 1:1 diagnostics

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Tests**: Presentation changes — covered by e2e + the existing unit suite (no new pure logic).

## Phase 3: User Story 1 — on-hold reads clearly and once (P1)

- [x] T001 [US1] In `src/views/detail/CallActivePage.vue`: remove the redundant `cw-onhold` pill
  (`v-if="remoteHeld"`); show the centered `held-overlay` for audio too (change its `v-if` to
  `remoteHeld && !mainIsLocal`); blur the `audio-stage` when held (`held-frozen`). Leave the
  parked-call (`heldCall`) bar and the group `tile-onhold` badge untouched (FR-001..FR-004).
- [x] T002 [US1] Adjust CSS so `.held-overlay` centers over the audio avatar stage and the blur reads
  well on the avatar (reuse existing `.held-frozen` / `.held-overlay`).

## Phase 4: User Story 2 — 1:1 ⓘ panel populates (P2)

- [x] T003 [US2] In `src/composables/useCall.ts` `pollStats` (1:1 `pc` branch, only when no
  `groupSession`): build a status line from the polled getStats (codec, up/down kbps, current tier
  `oneToOneQc.tier`, RTT/loss) and call `setDiagSnapshot([...])`; clear the snapshot on teardown
  (FR-005/FR-007). Group calls keep owning the snapshot (FR-006).

## Phase 5: User Story 3 — switch-calls is a clear action (P2)

- [x] T003b [US3] Make the call-waiting switch control a prominent 'Switch to {name}' action (swap icon + action tint) in `CallActivePage.vue`; behavior (`swapCalls`) unchanged.

## Phase 6: Polish

- [x] T004 e2e: held audio call shows the overlay + no pill (via the call-waiting hold path); the 1:1
  ⓘ panel shows a live line on a connected call. No regression to call-waiting / call suites.
- [x] T005 Full gate: `npm run build`; `npx vitest run`; `cd server && go build/vet/test`;
  `RING_E2E_PORT=8085 npm run test:e2e` (call-waiting + calls, no regression).
- [x] T006 Flip spec `Status:` to `in-review` at PR and run `make roadmap`.

## Tracking Issues

Created by `taskstoissues` — one issue per story group; the PR `Closes` each.
