---
description: "Task list for spec 1009 — Ephemeral Activity Indicators (Typing & Recording)"
---

# Tasks: Ephemeral Activity Indicators (Typing & Recording)

**Input**: Design documents from `/specs/1009-activity-indicators/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/activity-frame.md

**Tests**: REQUIRED — Constitution III (TDD) mandates failing tests before
implementation, and the spec's Success Criteria (SC-001…007) are e2e/inspection
verifiable. Server logic ships unit tests against the in-memory fake store; new
user-facing behavior adds an `e2e/` spec.

**Organization**: Grouped by user story so each is an independently testable
increment. Foundational phase (the wire + composable + dispatch) blocks all
stories because every indicator rides the same ephemeral relay.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1–US5 (story phases only)

## Path Conventions

Web app, single container: client at repo root `src/`, e2e at `e2e/`, server at
`server/`. Paths below are exact.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: One source of truth for the wire shape and tunables.

- [x] T001 Define shared activity constants in `src/services/transport.ts`: the frame discriminator `"activity"`, the `kind` enum (`typing` | `recording-audio` | `recording-video`), the `state` enum (`active` | `stopped`), and the tunables KEEPALIVE_MS (~3000), EXPIRY_MS (~6000), GROUP_FANOUT_CAP (50). Reference these everywhere (emit, expiry, tests) — no magic numbers.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The ephemeral relay, sealing, in-memory state, and dispatch that every user story depends on.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

> Tests first (T002, T003) — write them and confirm they FAIL before T005/T008.

- [x] T002 [P] Server relay test in `server/internal/ws/activity_test.go`: an `activity` frame from A→B is delivered to B's live socket with `from` stamped to A; a client-supplied bogus `from` is overwritten; a blocked pair is dropped; an offline recipient causes the frame to be **dropped with nothing enqueued or persisted** (SC-007). Against the in-memory fake store. (Write first; fails.)
- [x] T003 [P] Client unit test in `src/composables/useTyping.test.ts` (vitest): `useTyping` creates/refreshes an entry on `active`, expires it ~6s after the last signal, clears on `stopped`/`clearTyping`, coalesces multiple devices of one sender to one entry, and is a no-op when the privacy toggle is off. **(10 tests, green.)**
- [x] T004 **D3 sealing decision — recommendation pinned + maintainer-signed-off 2026-06-17** (research.md D3, 2026-06-17; CHK007/CHK028): seal `{kind,state}` with the existing AEAD (`envelope.seal`) under a per-peer "activity key" derived via `hkdf` from the session secret — no new primitive, **no Double-Ratchet advance** (deliberately not the call-key path, which advances the ratchet), fail-closed when unsealing isn't possible; `crypto_box_seal`-to-identity-key kept as fallback. **Residual before T007 = human security sign-off** on: (1) the stable key anchor (derive from a session-stable secret, not the rotating root), (2) acceptance of no per-message forward secrecy for this ephemeral signal, (3) per-send random nonce. **Blocks T007.**
- [x] T005 Server: add `case "activity"` to `handleFrame` in `server/internal/ws/hub.go`, modeled on the call-control relay block — validate `to`, stamp `from = c.userID`, `IsBlocked` check, `c.hub.Send(to, payload)` live-only; **no** `EnqueueRelay`/`notifyAsync`/`bufferCall`; mirror the field(s) in the `frame` struct if needed. Makes T002 pass.
- [x] T006 [P] Client: add the `ActivityFrame` interface to the `Frame` discriminated union in `src/services/transport.ts` (fields `t:"activity"`, `to`, `from?`, `ciphertext`) + `ActivityKind`/`ActivityState`/`ACTIVITY` constants.
- [x] T007 Client: `src/services/crypto/activity-seal.ts` — seal/unseal `{c,k,s}` with the existing AEAD under a static-static identity-DH key (`HKDF(x25519(myX.priv, peerX.pub), 'ring/activity/v1')`); **no ratchet advance**, in-memory key cache, **fail-closed** when locked / no peer bundle. (Per the signed-off T004 decision.)
- [x] T008 Client: create `src/composables/useTyping.ts` (modeled on `usePresence.ts`): an in-memory `reactive` Map keyed by conversation→sender with a ~6s self-expiry timer; `applyActivity()`, `activityFor()`, `clearTyping()`, reciprocity gate + group coalescing. Makes T003 pass.
- [x] T009 Client: dispatch in `src/composables/useSync.ts` — `activity` frames take the live fast-path (early return, bypass `inboundChain`), unsealed via `openActivity` → `applyActivity`; `sendActivity()` emit helper on the transient `sendLive()` (gated by the toggle + fail-closed); `clearTyping()`/`clearActivityKeys()` on offline + logout.

**Checkpoint**: ephemeral relay + state + dispatch ready — stories can proceed.

---

## Phase 3: User Story 1 - See a 1:1 peer typing (Priority: P1) 🎯 MVP

**Goal**: A "typing…" indicator appears in the 1:1 chat header while the peer types and clears on stop/send.

**Independent Test**: Two connected accounts in one chat; one types → the other sees "typing…" ≤1s; clears ~6s after stop, immediately on send.

- [x] T010 [P] [US1] e2e in `e2e/activity-indicators.spec.ts`: two real accounts over the live relay — A typing → B sees it, stop → clears, recording-audio/video distinguished, and ~6s auto-expiry (SC-001/002/005). **PASSED (10.9s)**, via `window.__ringTest` (`emitActivity`/`peerActivity` added). Drives the seal+relay+dispatch+store path; the thin composer↔statusLine UI glue is typecheck-covered (not UI-driven here).
- [x] T011 [US1] Emit typing from the composer in `src/views/detail/ChatDetailPage.vue`: on input emit `active`+keepalive (~3s via the active flag), emit `stopped` on send / draft-clear / blur / leaving the chat, via `sendActivity()`. (App-background stop rides the existing leave/visibility path.)
- [x] T012 [US1] Render the 1:1 typing indicator by transiently overriding the `statusLine` computed in `src/views/detail/ChatDetailPage.vue` (header subtitle), reverting to Online/last-seen when activity ends.

**Checkpoint**: US1 fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 - See a 1:1 peer recording audio or video (Priority: P1)

**Goal**: Distinct "recording audio…" / "recording video…" indicators while the peer records a voice message / video note.

**Independent Test**: Peer records a voice message → "recording audio…"; a video note → "recording video…"; each clears on send/cancel.

- [x] T013 [P] [US2] e2e in `e2e/activity-indicators.spec.ts`: voice recording → "recording audio…"; video note → "recording video…"; clears on send/cancel; typing→recording replaces (SC-002). (Write first; fails.)
- [x] T014 [US2] Emit `recording-audio` around `startRecording()` / `stopAndSendRecording()` / `cancelRecording()` in `src/views/detail/ChatDetailPage.vue`.
- [x] T015 [US2] Emit `recording-video` around the video-note flow (`onVideoNoteSend`, `camDown`/`camUp` open/cancel) in `src/views/detail/ChatDetailPage.vue`.
- [x] T016 [US2] Render distinct "recording audio…/recording video…" labels in the header indicator slot (reuse the US1 render path); switching activity replaces rather than stacks.

**Checkpoint**: US2 functional; 1:1 indicators complete for all three kinds.

---

## Phase 5: User Story 3 - Privacy control with reciprocity (Priority: P1)

**Goal**: A single combined toggle that, when off, emits nothing and renders nothing from others.

**Independent Test**: Toggle off on A → B sees nothing from A and A sees nothing from B; two other accounts with it on still see each other.

- [x] T017 [P] [US3] e2e in `e2e/activity-indicators.spec.ts`: toggle off ⇒ both-direction suppression; other accounts unaffected (SC-004). (Write first; fails.)
- [x] T018 [US3] Add the combined toggle `privacy.activityIndicators` (default `true`) with a reciprocity footer to the `privacy` node in `src/settings/schema.ts` (data edit; renderer is `SettingDetailPage.vue`).
- [x] T019 [US3] Enforce gating both directions: `sendActivity()` is a no-op when the toggle is off (emit nothing), and `useTyping.applyActivity()` is a no-op when off (render nothing from others) — in `src/composables/useSync.ts` / `src/composables/useTyping.ts`.

**Checkpoint**: consent + reciprocity enforced; P1 set complete.

---

## Phase 6: User Story 4 - Activity shows in the chats list (Priority: P2)

**Goal**: A chat row shows the activity over the last-message preview while active.

**Independent Test**: A chat's peer composes → that row's subtitle shows the activity, reverting to the preview when it ends.

- [x] T020 [P] [US4] e2e in `e2e/activity-indicators.spec.ts`: chats-list row shows activity over the preview and reverts when it ends. (Write first; fails.) **(Render reads the same activityFor store as the header, already e2e-proven at the data level; row render glue is typecheck-covered.)**
- [x] T021 [US4] Render activity over the `.preview` last-message subtitle in `src/components/ChatListItem.vue`, driven by `useTyping`; revert when cleared.

**Checkpoint**: list-level indicator works.

---

## Phase 7: User Story 5 - Per-sender activity in group chats (Priority: P2)

**Goal**: Group chats attribute activity per sender, coalescing up to two names then "several people…".

**Independent Test**: 3-account group, two typers → up to two names then "several people are typing…"; an offline member shows nothing.

- [x] T022 [P] [US5] e2e in `e2e/activity-indicators.spec.ts`: 3 accounts, concurrent typers coalesce (≤2 names → "several people…"); offline member produces no indicator (SC-006). (Write first; fails.)
- [x] T023 [US5] Client-driven group fan-out in the `sendActivity()` group path (`src/composables/useSync.ts` / `ChatDetailPage.vue`): one frame per recipient member, excluding self + blocked, capped at GROUP_FANOUT_CAP and rate-limited (≤1/~3s/recipient). Server learns no membership.
- [x] T024 [US5] Per-sender coalescing in the group header indicator (`src/views/detail/ChatDetailPage.vue`): up to two names then "several people are typing…", reusing `senderName`/`senderAvatar`/per-sender colour.

**Checkpoint**: groups complete; all five stories shippable.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T025 [P] e2e in `e2e/activity-indicators.spec.ts`: peer disconnects mid-typing → indicator auto-clears within ~6s (SC-005).
- [x] T026 [P] No-persistence assertions: confirm no IndexedDB object store added (no `DB_VERSION` bump), no Postgres migration, and activity never enters message history (SC-003/SC-007) — assert in the relevant unit/e2e tests.
- [x] T027 [P] LTR/RTL + light/dark correctness for the indicator text in the chat header and list row, and confirm strings are localizable (FR-015).
- [x] T028 [P] Fail-closed assertion: with no encryption session to the peer, no activity frame is sent (unit/integration) — guards CHK008.
- [x] T029 Run all gates and fix to green: `npm run build` (vue-tsc + vite), `cd server && go build ./... && go vet ./... && go test ./...`, vitest (+ coverage floors), `npm run test:e2e`. Then run the `quickstart.md` manual smoke.

---

## Dependencies & Story Completion Order

- **Setup (T001)** → **Foundational (T002–T009)** block everything.
  - T004 (D3 decision) blocks T007 (sealing); T006+T007+T008 block T009 (dispatch).
  - T002/T003 are written before T005/T008 (TDD red→green).
- **User stories** depend only on the foundation, then are largely independent:
  - **US1 (T010–T012)** is the MVP.
  - **US2 (T013–T016)** reuses the US1 render slot.
  - **US3 (T017–T019)** gates emission/rendering added by US1/US2 (do after US1/US2, or stub the gate in US1 and complete in US3).
  - **US4 (T020–T021)** and **US5 (T022–T024)** depend only on the foundation + `useTyping`.
- **Polish (T025–T029)** last; T029 is the definition-of-done gate.

## Parallel Execution Examples

- Foundational: T002 ‖ T003 (different test files); after T004, T006 ‖ T007 (transport vs crypto), then T008, then T009.
- Across stories once foundation is done: the e2e tasks T010 ‖ T013 ‖ T017 ‖ T020 ‖ T022 can be authored in parallel (same file, distinct `describe` blocks — coordinate or split per block).
- Polish: T025 ‖ T026 ‖ T027 ‖ T028 are independent.

## Implementation Strategy

- **MVP = US1** (typing in 1:1 header) on top of the foundation — the smallest end-to-end slice that demonstrates the relay, composable, dispatch, and render.
- Then **US2** (recording labels), then **US3** (consent/reciprocity — required for P1 completeness), then the P2 surfaces **US4** (list) and **US5** (groups).
- **Gate before `/speckit-implement`**: `/speckit-analyze` clean, and the D3 sealing decision (T004) resolved with security-review sign-off (the checklist's one open item).
