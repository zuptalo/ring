# Implementation Plan: Finish Add-to-Call — Kind Upgrade, Join Cue, Group Merge, Robustness

**Branch**: `feat/1030-finish-call-kind` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1030-finish-call-kind/spec.md`

## Summary

Completes spec 1028's deferred items on top of its merged promotion/merge code, all
client-only and mesh-only with **no new server capability**. The audit found the
happy result that **US1 (kind reconciliation) is mostly already provided** by Ring's
per-participant group-video toggle (`toggleVideoMode`, cap ≤ 4) — the clarification
("offer per participant, no auto-camera") maps straight onto it, so US1 is chiefly
verification + tests. The genuinely-new work: a **join cue** (roster-diff → toast),
**group-invite merge** (stop the current auto-busy, route the invite into the waiting
slot, fold its members into your room), an **add-in-flight guard** so a swap can't
race a promotion, and **churn tests**. Design + code anchors: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>`, Ionic 8); **no server changes**
(Go untouched — verified by a task)

**Primary Dependencies**: the existing `src/services/call/` engine + the 1028
promotion/merge code (`ensureActiveIsRoom`, `mergeIncoming`, `convertActiveToRoom`,
`inviteToRoom`, `sendJoinRoom`, `capacity.ts`, `invite-plan.ts`, `toggleVideoMode`); the
existing `appToast`/cue infra

**Storage**: none new (calls are ephemeral)

**Testing**: vitest (pure decision helpers), Playwright `e2e/` (audio meshes + 2-person
proxies), `drive/` scenarios (video paths / real device)

**Target Platform**: PWA; WebRTC mesh

**Constraints**: mesh only; zero-knowledge (no new server-visible data); caps 4/8 unchanged;
single held slot unchanged; CI cannot run 3-person video mesh headless

**Scale/Scope**: ~4 client files touched + 2 small pure helpers + tests; crypto core and
server NOT modified

## Constitution Check

*GATE: constitution v1.2.0 — re-checked after Phase 1: PASS.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary | ✅ | No new server-visible data. Kind-video reuses the per-participant group-video path; the cue is a local roster diff; group-invite merge reuses existing ring/roster/leave signalling. ZK Impact section present. |
| II. Spec-Driven | ✅ | Spec 1030 (ad-hoc), pipeline followed: specify → clarify (1 Q) → plan → tasks → analyze → taskstoissues → implement. |
| III. TDD | ✅ | Pure helpers (`videoCapableAfterMerge`, `newJoiners`, combined-headcount) unit-first; each user-facing item gets a failing e2e before the code. |
| IV. Crypto Discipline | ✅ (n/a-heavy) | No crypto touched; no new signal (unlike 1028's joinroom). `/speckit-checklist` NOT required — this touches neither new wire data nor crypto (reuses 1028's already-reviewed signalling). |
| V. Offline-First | ✅ | No store/schema change. |
| VI. Stateless Server | ✅ | Server untouched (a task asserts an empty `server/` diff). |
| VII. Quality Gates | ✅ | build + vitest + e2e where behaviour changed; go build/vet/test. |
| VIII. Traceable Delivery | ✅ | `make roadmap`; taskstoissues (reuse the open 1028 issues where they map); PR `Closes #N`. |
| IX. Privacy & Data Minimization | ✅ | No new data collected; room membership is the same signal group calls already expose. |
| X. Accessibility & i18n | ✅ | The cue is plain, transient text; "Add to call" on a stock button; the video affordance already exists. |
| XI. Ionic-First UI | ✅ | Reuses `appToast`/cue + the existing incoming-prompt buttons + the existing "Turn on video" control — no bespoke widgets. |

No violations → Complexity Tracking omitted.

## Project Structure

```text
specs/1030-finish-call-kind/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/internal-api.md
├── checklists/requirements.md
└── tasks.md   (/speckit-tasks)

src/services/call/
├── merge-kind.ts + .test.ts     # NEW pure: videoCapableAfterMerge(kind, combinedHeadcount)
├── join-cue.ts + .test.ts       # NEW pure: newJoiners(announced, roster, selfId)
├── capacity.ts / invite-plan.ts # reused (extend tests for combined headcount)
src/composables/useCall.ts       # join-cue on roster update; mergeGroupInvite;
                                 #   handleGroupInvite → waiting slot; add-in-flight guard
src/views/detail/CallActivePage.vue  # "Add to call" for a group second-incoming
e2e/  (+ call-join-cue, call-merge-kind, call-group-merge, call-merge-held, call-churn)
drive/scenarios/ (+ merge-video, call-add-churn)
```

**Structure Decision**: two new pure leaves (`merge-kind.ts`, `join-cue.ts`) keep the
decision logic unit-testable without WebRTC; everything else composes the existing 1028
orchestration and the existing group-video/roster/hold machinery — no forks.

## Design (Phase 1 summary)

### D1. Kind reconciliation (US1) — R1
Verify the merged/promoted **audio group** exposes the existing per-participant "Turn on
video" affordance when combined ≤ 4 and refuses at > 4 (both already in `toggleVideoMode`).
Pure `videoCapableAfterMerge(activeKind, combinedHeadcount)` encodes the rule for tests.
No auto-camera; the merged video caller opts in via the same control. No new signalling.

### D2. Join cue (US2) — R2
In the `call-roster` handler, before assigning `callMeta.roster`, compute
`newJoiners(announced, frame.members, selfId)`; `appToast("{name} joined the call")` for
each (name via contacts / stream-owner map, else "Someone"); add them to the per-call
`announced` set. Reset `announced` on each new call. Not the local user; a reconnect
doesn't change roster membership so it never re-fires.

### D3. Group-invite merge (US3) — R3
`handleGroupInvite`: in a call + free slot → raise `incomingSecond` (kind `group`, roomId,
members) instead of auto-busy; no free slot → keep auto-busy. `mergeGroupInvite()`:
combined-headcount `canAdd` → `ensureActiveIsRoom` → `inviteToRoom(members − present)` →
`sendGroupLeave(inviteRoomId)` → clear slot. UI: "Add to call" shown for a group
second-incoming. Dedup via `planInvite`.

### D4. Add-in-flight guard + held coexistence (US4) — R4
Module `addInFlight` promise set around `ensureActiveIsRoom`+`inviteToRoom`; `swapCalls`/
`parkActiveAsHeld` await it (or no-op with a toast) so a swap can't park mid-conversion.
Merge/add never touch `heldSlot` (already true) — e2e asserts it.

### D5. Churn (US5) — R5
Tests over the existing serialized `rosterChain` + set-based `applyRoster` + `planInvite`
dedup + spec-2012 recovery + `armGroupIdleTimeout` (promotion timeout). Fix only what the
tests expose.

## Zero-Knowledge & Crypto Review Notes
- No new frame/field/request. Video-capable reuses the per-participant renegotiation a
  camera toggle already does; the cue is a local roster diff; group-invite merge reuses
  ring/roster/leave. Room membership + cap are the only server-visible signals — unchanged.
- Crypto core / `messaging.ts` untouched; no new sealed signal (1028's `joinroom` reused).
- A task verifies the `server/` tree diff is empty. `/speckit-checklist` not required
  (no new Principle I/IV surface).

## Testing strategy
Red → Green: pure helpers first; per-item failing e2e before the code. Audio meshes +
2-person proxies for e2e; video results via drive/real device. Keep ALL existing call
tests green (SC-006).

## Complexity Tracking
No violations — table empty. The scope is deliberately small (completion/polish over the
already-shipped, real-device-validated 1028 core).
