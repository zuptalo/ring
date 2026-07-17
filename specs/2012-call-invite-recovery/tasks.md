---
description: "Task list for spec 2012 — call invite recovery & honest ringing"
---

# Tasks: Call invite recovery & honest ringing

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Tests**: REQUIRED. Server table tests (`hub`) lead for the relay behavior; client guards + e2e for
the cross-context flows.

## Phase 3: User Story 1 — incoming call survives a reload (P1)

- [x] T001 [US1] In `server/internal/ws/hub.go`: always buffer the 1:1 `call-offer` (+ its trickled
  ICE) for the existing TTL, not only when `!delivered`, so a reconnecting callee re-receives it via
  `flushBufferedCalls()` (FR-001/FR-004).
- [x] T002 [US1] In `hub.go`: clear the buffered invite for a callId when the call resolves
  (answer/cancel/end/reject/busy), so a settled/declined call never re-rings on a later reconnect
  (FR-003).
- [x] T003 [US1] In `src/composables/useCall.ts` `handleOffer`: early-return if already showing the
  incoming call for the same `callId` (no duplicate ring on re-delivery) (FR-002).
- [x] T004 [US1] Server tests (`hub_test.go`): an online-delivered offer is re-delivered on the
  callee's reconnect; a resolved/declined call's invite is NOT re-delivered.

## Phase 4: User Story 2 — honest ringing (P1)

- [x] T005 [US2] In `hub.go`: when the callee's last socket drops during an active ring, start a short
  grace; if the callee re-rings within it, cancel; else notify the CALLER with a `call-end`/
  `call-cancel` (reason `unreachable`) so it ends promptly (FR-005/FR-006). Preserve the long
  no-answer backstop (FR-007).
- [x] T006 [US2] Server tests: caller is notified when the callee drops and does not re-ring within
  grace; caller is NOT notified when the callee re-rings within grace.

## Phase 5: User Story 3 — no audio resume countdown (P3)

- [x] T007 [US3] In `src/composables/useCall.ts`: gate `beginResumeCountdown` on the call being video;
  an audio call resumes immediately with no countdown (FR-008).

## Phase 6: Polish

- [x] T008 Zero-knowledge confirmation (Principle I): the recovered invite is the existing sealed
  call-offer ciphertext; server stores no plaintext; no new readable metadata (FR-009).
- [x] T009 Full gate: `npm run build`; `npx vitest run`; `cd server && go build/vet/test`;
  `RING_E2E_PORT=8085 npm run test:e2e` (call-connect / call-waiting / calls — no regression).
- [x] T010 e2e: a callee reload mid-ring restores the incoming call (where the harness can drive a
  reload/drop); audio resume shows no countdown.
- [x] T011 Flip spec `Status:` to `in-review` at PR and run `make roadmap`.

## Tracking Issues

Created by `taskstoissues` — one per story group; the PR `Closes` each.
