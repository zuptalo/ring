# Implementation Plan: Robust Calls + Add-to-Call (Merge Incoming, Add People)

**Branch**: `feat/1028-robust-audio-and` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1028-robust-audio-and/spec.md`

## Summary

Grow a live call two ways — **merge** an incoming caller (or group invite) into your
current call, and **add** new people to an ongoing call — within the existing 4-video /
8-audio caps. The design reuses proven mesh machinery and adds **no new server
capability**: promotion of a 1:1 to a group is a **sealed `joinroom` control signal**
(the `sendHoldResume` pattern) plus a fresh mesh room both sides join via the existing
`call-join`/roster/late-leg path; adding people rings them via the existing in-room
`call-ring`. Both funnel through one pure **capacity gate** and one **`inviteToRoom`**
primitive. Kind reconciliation reuses the existing consent-gated video upgrade; the
existing peer auto-follows with a "{name} joined the call" cue. Plus a robustness pass
over the add/roster/leg lifecycle and cleanup of dead "SFU" comments. Design rationale
and code anchors: [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>`, Ionic 8); **no server
changes intended** (Go untouched — verified by a task)

**Primary Dependencies**: native WebRTC (mesh, DTLS-SRTP), the existing
`src/services/call/` engine (`mesh.ts`, `signalling.ts`, `useCall.ts`), sealed
signalling over each pair's Double Ratchet (`messaging.ts` via `signalling.ts`)

**Storage**: none new (calls are ephemeral; call-history logging unchanged)

**Testing**: vitest (pure capacity/decision helpers), Playwright `e2e/` (audio meshes
+ 2-person proxies), `drive/` scenarios (video path / real-device)

**Target Platform**: PWA (iOS Safari / Android Chrome / desktop); WebRTC mesh

**Project Type**: web app (client-only change)

**Performance Goals**: merge completes < 10s to three-way media (SC-001); no second
capture / no camera re-prompt (SC-006); no regression to first-connect speed (spec 2008)

**Constraints**: mesh only (no SFU); zero-knowledge (no new server-visible data); caps
4 video / 8 audio unchanged; single held slot unchanged; CI cannot run 3-person video
mesh headless

**Scale/Scope**: ~6 client files touched + a new pure `capacity.ts` + tests; the crypto
core and the server are NOT modified

## Constitution Check

*GATE: constitution v1.2.0 — re-checked after Phase 1 design: PASS.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary | ✅ | No new server-visible data. `joinroom` is an opaque sealed `CallSignal` inside an existing `call-ice` frame; promotion/add reuse existing group-call signalling + the same-room key gate. Mandatory ZK Impact section present. |
| II. Spec-Driven Development | ✅ | Spec 1028 (ad-hoc), pipeline followed: specify → clarify (3 Qs) → plan → tasks → analyze → taskstoissues → implement. |
| III. Test-Driven Development | ✅ | tasks.md orders failing tests first; pure capacity/decision helpers unit-first; new user-facing behaviour gets e2e. Not a `2001+` bug spec, so no single regression-test mandate, but robustness fixes get targeted tests. |
| IV. Crypto Discipline | ✅ | No new primitives/schemes. `joinroom` reuses `sealForChat`/`openPacket` exactly like hold/resume; per-pair ratchet unchanged; `messaging.ts` untouched. The one new sealed `CallSignal.type` carries only `{roomId, kind}` (opaque to the server). `/speckit-checklist` REQUIRED (Principle I/IV) before implement; security review on the PR. |
| V. Offline-First Data Integrity | ✅ | No IndexedDB store/schema change; calls are ephemeral. |
| VI. Stateless Server & Migrations | ✅ | Server untouched (a task verifies `go build/vet/test` stays green with no `server/` diff). |
| VII. Quality Gates | ✅ | `npm run build`, vitest, `go build/vet/test`, e2e for changed behaviour. Release-note-style commit subjects. |
| VIII. Traceable Delivery | ✅ | `make roadmap`; taskstoissues; PR lists `Closes #N`. |
| IX. Privacy & Data Minimization | ✅ | No new data collected; room membership is the same signal group calls already expose. |
| X. Accessibility & i18n | ✅ | Add-people picker + "Add to call" action on stock Ionic; cue is plain copy; no direction-risk text. |
| XI. Ionic-First UI | ✅ | Add-people uses the existing contact-picker pattern; "Add to call" is a button on the existing incoming overlay; the join cue is `ion-toast`/existing cue infra — no bespoke widgets. |

No violations → Complexity Tracking omitted. **One standing risk (not a violation):**
promoting a live 1:1 to a mesh mid-call is inherently the most fragile change; mitigated
by reusing the proven late-join path (R2) rather than migrating a live PC, and by the
robustness tests (US5).

## Project Structure

### Documentation (this feature)

```text
specs/1028-robust-audio-and/
├── plan.md              # This file
├── research.md          # Phase 0 — audit + decisions R1-R10
├── data-model.md        # Phase 1 — call/room/roster entities + promotion state machine
├── quickstart.md        # Phase 1 — implementation slices
├── contracts/
│   └── internal-api.md  # Phase 1 — new client fns + the joinroom signal (no HTTP change)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/services/call/
├── capacity.ts            # NEW — pure cap gate (capOf/remainingSlots/canAdd)
├── capacity.test.ts       # NEW
├── types.ts               # (unchanged caps; maybe a Capacity type)
├── mesh.ts                # start(existing) reuse already exists; verify roster dedup on add
└── signalling.ts          # NEW: sendJoinRoom (sealed CallSignal 'joinroom'); comment fixes

src/composables/
└── useCall.ts             # ensureActiveIsRoom (promotion), inviteToRoom, mergeIncoming,
                           #   addPeople, joinroom dispatch, join cue; SFU comment cleanup

src/components/
├── IncomingCallOverlay.vue  # "Add to call" action (direct caller + group invite)
└── (contact picker reuse for Add people)

src/views/detail/
└── CallActivePage.vue     # "Add people" button + picker entry; roster/tiles already reactive

e2e/  (+ call-add-merge.spec.ts, call-add-cap.spec.ts; extend call-waiting.spec.ts)
drive/scenarios/  (+ promote-1to1-video.mjs; extend group-call-4.mjs)
```

**Structure Decision**: client-only; the one new module (`capacity.ts`) is a pure leaf
so the cap math is unit-tested without WebRTC. All new call orchestration lives in the
existing `useCall.ts` / `signalling.ts` / `mesh.ts` so it composes with the proven
hold/swap/roster code rather than forking it.

## Design (Phase 1 summary — details in data-model.md / contracts/)

### D1. Promotion (1:1 → mesh) — the `joinroom` signal (R2)
`ensureActiveIsRoom()`: if the active call is a 1:1, mint a `roomId`, build a
`MeshSession(roomId, kind).start(existingStream)`, send a sealed `CallSignal
{type:'joinroom', roomId, kind}` to the peer over the existing `call-ice` channel, and
tear the 1:1 PC down once the mesh leg connects. The peer's `handleMeshSignal`/`call-ice`
dispatch gains a `joinroom` case: auto-join the room (reuse stream), show the cue. Result:
a mesh room reusing the proven late-join legs. Idempotent when already a room.

### D2. Add-people (US2) + merge (US1/US6) via `inviteToRoom` (R3)
`inviteToRoom(ids)`: dedup vs `roster ∪ invited`, cap-gate (D3), add to `meta.invited`,
`call-ring` each. Composed:
- **addPeople(pickedIds)** = `ensureActiveIsRoom()` → `inviteToRoom`.
- **mergeIncoming()** (direct caller) = `ensureActiveIsRoom()` → send `joinroom` to the
  incoming caller (they join instead of a 1:1 answer); reuse their capture.
- **mergeGroupInvite()** (US6) = cap-check combined distinct headcount →
  `ensureActiveIsRoom()` → `inviteToRoom(inviteRoster − present)` → `call-leave` the
  incoming invite room.

### D3. Capacity gate (R4) — `capacity.ts`
Pure `capOf`/`remainingSlots`/`canAdd`. The picker disables past `remainingSlots`;
merge/add call `canAdd` before ringing; server `JoinIfRoom` is the backstop. US6 uses the
combined distinct headcount.

### D4. Kind reconciliation (R5)
After a merge join: if wanted AND combined ≤ `VIDEO_MAX`, run the existing
`requestVideoUpgrade` (consent-gated); else audio-only. No new mechanism.

### D5. Cue (R6) + robustness (R7)
Transient "{name} joined the call" toast on `joinroom` / new post-promotion roster member.
Robustness: reuse `rosterChain` serialization + set-based `applyRoster`; `inviteToRoom`
dedups; add-in-flight guard before a swap; a promotion timeout that leaves a half-formed
room cleanly rather than stalling.

### D6. Cleanups (R9)
Fix the misleading "SFU" comments in `useCall.ts`; remove any dead SFU remnants (no
behaviour change).

## Zero-Knowledge & Crypto Review Notes (Principle I/IV gate)
- No new server frame or field; `joinroom` is an opaque sealed `CallSignal` (server
  relays ciphertext, same as hold/resume/qos). Room membership + the numeric cap are the
  only server-visible signals — identical to today's group calls.
- `messaging.ts` and the crypto core are untouched; `joinroom` uses the existing
  `sealForChat`/`openPacket`.
- A task verifies **no `server/` diff** is required; if one is, it is escalated before
  adding any server capability.
- `/speckit-checklist` (Principle I/IV) generated before implement; PR security review.

## Testing strategy (SC-001…009; CI-constrained)
Red → Green ordering in tasks.md: pure `capacity.ts` tests first; then per-slice failing
e2e before the orchestration lands.
1. **Unit**: `capacity.ts` (cap math, kind, combined headcount); a pure merge/roster
   decision helper where extractable.
2. **e2e (audio + 2-person proxies)**: merge incoming → 3-way audio (SC-001/002);
   add-people meshes a non-initiator (SC-002); cap gate blocks 5th video / 9th audio
   (SC-003); merge leaves a held call intact (SC-004); group-invite merge fits vs blocked
   (SC-009); existing-peer cue (SC-008).
3. **drive (video / real-device)**: promote-1:1-to-3-way video; extend `group-call-4`.
4. Keep ALL existing call e2e/unit green (SC-007).

## Complexity Tracking
No constitution violations — table intentionally empty. The mesh-promotion risk is
tracked in the Constitution Check note and mitigated by design (reuse late-join, not PC
migration) + the US5 robustness tests.
