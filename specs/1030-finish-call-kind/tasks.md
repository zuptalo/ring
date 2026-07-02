# Tasks: Finish Add-to-Call — Kind Upgrade, Join Cue, Group Merge, Robustness

**Input**: Design documents from `/specs/1030-finish-call-kind/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md, quickstart.md. Builds on the merged 1028 promotion/merge code.

**Tests**: REQUIRED (constitution III). Pure decision helpers are unit-first; each
user-facing item writes a failing e2e before the code. No crypto/ZK checklist (no new
wire data — reuses 1028's already-reviewed signalling). Design ids (R1–R7, D1–D5,
INV-1..5) reference research/plan/data-model.

**CI constraint**: 3-person VIDEO mesh is NOT runnable headless — e2e uses AUDIO meshes
(3–4) + 2-person proxies; the VIDEO result of a merge is drive/real-device only.

## Format: `[ID] [P?] [Story?] Description`

---

## Phase 1: Join cue (US2, Priority: P1) 🎯 first slice

**Goal**: A brief "{name} joined the call" when a genuinely-new participant joins;
never for self or a reconnect.

**Independent Test**: A+B+C in a group audio call; A adds D → every existing
participant sees a cue naming D; force a reconnect of an existing participant → no cue.

- [ ] T001 [P] [US2] Failing unit tests in `src/services/call/join-cue.test.ts`: `newJoiners(announced, roster, selfId)` — excludes self, dedups vs already-announced, returns multiple genuinely-new members, empty roster → none
- [ ] T002 [US2] Implement `src/services/call/join-cue.ts` (`newJoiners`) until T001 is green
- [ ] T003 [P] [US2] Failing Playwright e2e `e2e/call-join-cue.spec.ts` (audio): A/B/C in a group call, A adds D, every existing participant sees a "{name} joined the call" cue naming D; a forced reconnect of an existing participant shows NO cue; no cue for the local user's own join
- [ ] T004 [US2] Wire the cue into the `call-roster` handler in `src/composables/useCall.ts`: maintain a per-call `announced` set (reset on new call), and for each `newJoiners(...)` toast "{name} joined the call" via `appToast` (name from contacts / stream-owner map; "Someone" for a non-contact)

**Checkpoint**: growing a call is legible — every new arrival is acknowledged once.

---

## Phase 2: Kind reconciliation (US1, Priority: P1)

**Goal**: After a merge, a call ≤ 4 is video-capable (per-participant "Turn on video"
control offered, no auto-camera); a call > 4 stays audio-only.

**Independent Test**: Promote/merge to a ≤4 audio group → "Turn on video" available and
works for one participant without enabling others' cameras; a >4 audio group → turning
on video is refused.

- [ ] T005 [P] [US1] Failing unit tests in `src/services/call/merge-kind.test.ts`: `videoCapableAfterMerge(activeKind, combinedHeadcount)` — video call → true; audio ≤ VIDEO_MAX → true; audio > VIDEO_MAX → false
- [ ] T006 [US1] Implement `src/services/call/merge-kind.ts` (`videoCapableAfterMerge`) until T005 is green
- [ ] T007 [P] [US1] Failing Playwright e2e `e2e/call-merge-kind.spec.ts` (audio): after promoting/merging into a ≤4 audio group, the "Turn on video" affordance is present and one participant turning it on does NOT enable others' cameras (no auto-camera); after a >4 audio group, turning on video is refused with the cap reason
- [ ] T008 [US1] Ensure `meta.kind`/roster are correct after promotion/merge so the existing `toggleVideoMode` gate (≤ VIDEO_MAX) and the "Turn on video" affordance apply — fix only what T007 exposes (expected minimal/no behavioural change beyond confirmation); the merged video caller opts in via the same control

**Checkpoint**: kind reconciliation matches the per-participant clarification.

---

## Phase 3: Merge coexists with hold + add-in-flight guard (US4, Priority: P2)

**Goal**: Merging into the active call never disturbs a held call; a swap can't race a
promotion/add.

**Independent Test**: Active call X + held call Y; merge a caller into X; Y stays
held/paused and swaps correctly; single-held rule holds throughout.

- [ ] T009 [P] [US4] Failing Playwright e2e `e2e/call-merge-held.spec.ts` (audio): A active on X while holding Y; merge an incoming caller into X; assert Y is still held + paused and swaps back correctly, and at most one call is ever held
- [ ] T010 [US4] Add the `addInFlight` guard in `src/composables/useCall.ts` (set around `ensureActiveIsRoom`+`inviteToRoom`); make `swapCalls`/`parkActiveAsHeld` await it (or no-op with a toast) so a swap can't park mid-conversion (FR-010); confirm merge/add never read/write `heldSlot`

**Checkpoint**: hold/swap (specs 0005/2009) fully intact alongside merge.

---

## Phase 4: Group-invite merge (US3, Priority: P2)

**Goal**: "Add to call" works for an incoming GROUP invite — fold its members into your
call within the combined cap, dedup shared members, block over cap.

**Independent Test**: A+B in a call; C starts a group inviting A (+D); A's prompt shows
Add to call; choosing it folds C(+D) into A's call within the cap; a member in both
dedups to one; an over-cap fold is blocked with a reason leaving both calls unchanged.

- [ ] T011 [P] [US3] Failing unit tests: combined-headcount cap for a group fold — extend `src/services/call/capacity.test.ts` / `invite-plan.test.ts` for the distinct union of two rosters (fits vs over-cap; a shared member counted once)
- [ ] T012 [P] [US3] Failing Playwright e2e `e2e/call-group-merge.spec.ts` (audio): A+B in a call, C starts a group inviting A(+D); A's second-incoming prompt offers Add to call; folding brings C(+D) into A's call within cap, a shared member resolves to one participant, and a separate over-cap case is blocked with a reason (both calls unchanged)
- [ ] T013 [US3] In `handleGroupInvite` (`src/composables/useCall.ts`): when `callState !== 'idle'` AND `canRaiseSecondIncoming()`, raise `incomingSecond` as `kind:'group'` (roomId + members) instead of `sendGroupBusy`; keep auto-busy when no slot is free (spec 2009)
- [ ] T014 [US3] Implement `mergeGroupInvite()` in `src/composables/useCall.ts`: `canAdd` over the combined distinct headcount → block with reason if over cap; else `ensureActiveIsRoom()` → `inviteToRoom(members − present)` (planInvite dedups) → `sendGroupLeave(inviteRoomId)` → clear the slot; export it in the `useCall()` accessor + a testhook
- [ ] T015 [US3] Show **Add to call** for a `kind:'group'` second-incoming in `src/views/detail/CallActivePage.vue` (alongside Hold + Decline), wired to `mergeGroupInvite`

**Checkpoint**: the richest merge path works, cap-bounded and dedup-correct.

---

## Phase 5: Churn robustness (US5, Priority: P2)

**Goal**: Growing a call converges under churn — concurrent join/leave, simultaneous
same-person add, invitee reload, promotion timeout — no stuck ringing, duplicates, or
orphaned connections.

**Independent Test**: Scripted churn on an audio mesh; final roster/tiles/connectivity
correct on every device with no orphaned state.

- [ ] T016 [P] [US5] Failing Playwright e2e `e2e/call-churn.spec.ts` (audio): concurrent join+leave converges to the correct roster with no stuck tile; two callers adding the SAME new person → one participant/one leg (dedup); an invitee reloading mid-ring returns and joins cleanly (no duplicate)
- [ ] T017 [P] [US5] Drive scenario `drive/scenarios/call-add-churn.mjs` for harder multi-party churn on the live stack
- [ ] T018 [US5] Add/verify the promotion-timeout path: a promoted 1:1 whose peer never follows and where no one else joins ends cleanly via the existing `armGroupIdleTimeout` with no orphaned ringing tile; harden `applyRoster`/`inviteToRoom`/the cue against whatever T016/T017 expose (reuse the serialized `rosterChain` + set semantics — no new mechanism)

**Checkpoint**: growing a call is reliable under pressure.

---

## Phase 6: Video validation, cleanup & gates

- [ ] T019 [P] Drive scenario `drive/scenarios/merge-video.mjs`: merge into a ≤4 call, turn cameras on per participant, confirm video flows among 3 (real device / live stack — NOT headless CI); screenshot the grid
- [ ] T020 Verify **no `server/` diff** (FR-013): `cd server && go build ./... && go vet ./... && go test ./...` green AND `git diff --stat origin/develop -- server/` is empty; STOP + escalate if a server change appears necessary
- [ ] T021 Run ALL existing call e2e + unit green (SC-006): `calls`, `call-waiting`, `call-waiting-slot`, `call-caps`, `call-reinvite`, `call-promote`, `call-merge`, `call-add-merge`, `call-add-cap`, plus the call unit tests
- [ ] T022 Full gates: `npm run build`, `npx vitest run` (coverage floors), `npm run test:e2e`, `cd server && go build/vet/test`
- [ ] T023 Bump spec `**Status**:` to `in-review` → `make roadmap`; and bump spec 1028 `**Status**:` if all its remaining items are now complete

---

## Dependencies & Execution Order

- **Phase 1 (US2 cue)** is the smallest self-contained win — start here (MVP-ish).
- **Phase 2 (US1)** is mostly verification (the group-video toggle already exists).
- **Phase 3 (US4 guard)** is independent and small.
- **Phase 4 (US3 group merge)** builds on 1028's `ensureActiveIsRoom`/`inviteToRoom` and
  the waiting-slot; do after the guard so a fold-then-swap is safe.
- **Phase 5 (US5 churn)** exercises everything; do after the add/merge paths.
- **Phase 6** last; T020 (no-server-diff) + T022 (gates) gate the PR.

### Parallel opportunities
- T001/T005/T011 (pure unit tests) and each phase's failing e2e are [P].
- Drive scenarios (T017, T019) run parallel to their story's e2e.

---

## Implementation Strategy

Small completion spec — no big-bang. Land the **join cue** first (visible, self-contained),
then kind reconciliation (mostly tests), the hold guard, group-invite merge, churn
hardening, and video validation. Each checkpoint is independently testable; the server
stays untouched throughout (verified by T020). Reuse the open 1028 issues where a task
maps to a deferred 1028 item; create new issues only for genuinely-new work (the cue's
pure helper, the group-invite waiting-slot change).
