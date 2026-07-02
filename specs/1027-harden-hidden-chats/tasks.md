# Tasks: Harden Hidden Chats + One-Hidden-One-Visible Per Person

**Input**: Design documents from `/specs/1027-harden-hidden-chats/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md, quickstart.md

**Tests**: REQUIRED — constitution Principle III (TDD) and spec FR-022/FR-023 mandate
tests first. Every story orders its failing tests before the implementation that
satisfies them (Red → Green). Bug fixes B1–B6 each begin with a failing regression test.

**Organization**: Grouped by user story (US1–US6 from spec.md). Bug ids (B1–B6) and
design ids (R1–R10, D1–D7, INV-1..3, rule R) refer to research.md / plan.md / data-model.md.

## Format: `[ID] [P?] [Story?] Description`

---

## Phase 1: Setup & Hygiene

**Purpose**: Make `queries.ts` greppable again before everything else touches it (quickstart Slice 0).

- [x] T001 (#594) Add a vitest pinning the contact-card hash for a known name/avatar input (the `${card.name}\u0000${card.avatar}` SHA-256 path) in `src/db/contact-card-hash.test.ts` — must PASS against current code before the byte flip
- [x] T002 (#595) Replace the raw NUL byte at `src/db/queries.ts:3703` with the `\u0000` escape; confirm T001 still passes and `rg` now treats the file as text (FR-020)

---

## Phase 2: Foundational — the invariant core (blocks US1/US3/US5)

**Purpose**: The pure per-person predicate/routing module every story consumes (R8, INV-1..3).

- [ ] T003 (#596) Write failing unit tests for the pure invariant module in `src/services/hidden-pair.test.ts`: `chatsWithPeer` (plain 1:1s + pair conversations counted, multi-member groups excluded), `canHide` (INV-1), `canUnhide` (INV-2), `resolveInboundDirectChat` (rule R steps 2–3; never returns a pair conversation), including the legacy hidden+visible plain-1:1 state (INV-3 violation tolerated read-only)
- [ ] T004 (#597) Implement `src/services/hidden-pair.ts` as a pure leaf (no idb imports; user-facing `reason` copy follows the UI voice rules) until T003 is green

**Checkpoint**: invariant semantics locked in by unit tests — story phases can begin.

---

## Phase 3: User Story 1 — Hide a chat and it disappears (P1) 🎯 MVP

**Goal**: Hiding moves the chat out of every surface AND the hidden thread keeps
receiving silently — no visible resurrection, no spurious re-keys (fixes B1 via rule R).

**Independent Test**: Two accounts; A hides the 1:1 with B; B sends; A's list/search/
calls stay empty of B, no rekey traffic, reveal shows the message in the hidden thread.

### Tests (write first, must FAIL)

- [ ] T005 (#598) [P] [US1] Failing vitest for inbound routing in `src/db/queries.receive.hidden.test.ts` (fake idb): sole 1:1 hidden → inbound frame lands in the hidden chat, creates no new chat row, requests no rekey; group frame from the same peer resurrects nothing; unknown hidden set → frame re-queued (fail closed)
- [ ] T006 (#599) [P] [US1] Failing Playwright e2e in `e2e/hidden-coexist.spec.ts` (part 1): A hides the chat with B (PIN created on first hide), chat leaves list/search, B sends a message, A's chat list stays empty, badge updates, reveal shows the message inside the hidden thread

### Implementation

- [ ] T007 (#600) [US1] Replace the blind `startDirectChat` call in `receiveIncomingInner` (`src/db/queries.ts:4429`) with rule R resolution via `resolveInboundDirectChat` + peer-block check + fail-closed requeue (D2); pre-decrypt session id now always matches the thread that holds the ratchet
- [ ] T008 (#601) [US1] Update the `hadDirectChatBefore` / unsolicited-content cleanup path in `receiveIncomingInner` so a hidden chat is never deleted or exposed by the friends-only trace-removal branch (`src/db/queries.ts:4414`, `:4518`)
- [ ] T009 (#602) [P] [US1] Drive scenario `drive/scenarios/hidden-coexist.mjs` (part 1: hide → inbound lands hidden silently) against the live dev stack

**Checkpoint**: hiding your only chat with a person is safe — MVP fix shipped.

---

## Phase 4: User Story 2 — Reveal with the PIN, then relock (P1)

**Goal**: Reveal via search-bar PIN works as shipped; relock now takes effect
everywhere immediately — open hidden chat is kicked out; deep links blocked (fixes B5).

**Independent Test**: Reveal, open a hidden chat, force relock → app lands on
/tabs/chats; navigating to /chat/<hiddenId> while relocked redirects.

### Tests (write first, must FAIL)

- [ ] T010 (#603) [P] [US2] Failing vitest for the relock hook in `src/services/hidden-state.test.ts`: `registerRelockHook` fires on `setRevealed(false)` and `clearHiddenState`, not on `setRevealed(true)`
- [ ] T011 (#604) [P] [US2] Failing Playwright e2e in `e2e/hidden-privacy.spec.ts` (relock section): reveal → open hidden chat → trigger relock (grace `immediately` + background/foreground via test hook) → route is `/tabs/chats`; direct navigation to `/chat/<hiddenId>` while relocked redirects; wrong PIN in search bar reveals nothing and clears nothing (no oracle, FR-008 — behavioral assertion only; timing parity is architectural, Argon2id runs identically on both outcomes per SC-007)

### Implementation

- [ ] T012 (#605) [US2] Add `registerRelockHook(fn)` to `src/services/hidden-state.ts` (leaf discipline: router imports the leaf, never the reverse) and invoke it from `setRevealed(false)` / `clearHiddenState`
- [ ] T013 (#606) [US2] Register the hook + `beforeEach` guard in `src/router/index.ts`: active route is a hidden conversation on relock → `router.replace('/tabs/chats')`; navigation to a hidden conversation while not revealed → redirect (D5)
- [ ] T014 (#607) [P] [US2] Drive scenario `drive/scenarios/hidden-kickout.mjs`: grace expiry while inside the open hidden chat kicks out to the Chats list

**Checkpoint**: relock is airtight across grace expiry, auto-lock, deep links, back stack.

---

## Phase 5: User Story 3 — One hidden and one visible chat per person (P1)

**Goal**: Fresh visible chat coexists with the hidden one as a distinct channel
(pair conversation); Hide/Unhide blocked per INV-1/INV-2 with clear reasons (fixes B2, D1).

**Independent Test**: With a hidden 1:1 with B, start a new chat with B → fresh
visible thread; both exchange messages with zero cross-contamination; Hide on the
visible thread is blocked; delete visible → Unhide works.

### Tests (write first, must FAIL)

- [ ] T015 (#608) [P] [US3] Failing vitest for `startDirectChat` in `src/db/queries.start-direct.test.ts`: hidden plain 1:1 exists → creates a visible pair conversation (isGroup, single participant) and lifts any `hiddenPeer:` block; visible exists → returns it (never a second visible); hidden pair conversation + no plain 1:1 → creates a plain 1:1
- [ ] T016 (#609) [P] [US3] Failing Playwright e2e in `e2e/hidden-coexist.spec.ts` (part 2): A starts a new chat with B from Contacts → fresh visible thread appears while hidden stays hidden; A↔B exchange messages in BOTH threads (B replies in each) and each message lands only in its own thread; Hide on the visible thread is blocked with the reason; Unhide on the hidden thread is blocked while the visible exists; delete visible → Unhide succeeds

### Implementation

- [ ] T017 (#610) [US3] Extend `startDirectChat` in `src/db/queries.ts:4059` per contract: hidden-chat-with-peer branch creates the visible pair conversation (reuse the `createGroup('', [peer])` mechanism from `src/services/hidden-chats-start.ts`) and calls `clearTombstone('hiddenPeer:<peer>')`
- [ ] T018 (#611) [US3] Gate Hide/Unhide in `src/components/ChatActionsSheet.vue` via `canHide`/`canUnhide` — blocked entry renders disabled with the reason text (stock Ionic only, Principle XI)
- [ ] T019 (#612) [P] [US3] Extend `drive/scenarios/hidden-coexist.mjs` (part 2: coexistence + blocked Hide/Unhide journey), including an SC-004 volume loop — ≥100 messages split across both threads with zero cross-thread leaks asserted

**Checkpoint**: the per-person model is fully user-reachable and enforced.

---

## Phase 6: User Story 4 — Only the knock-knock call and badge surface (P1)

**Goal**: Calls ring with full identity; message paths are silent (non-push) or the
byte-identical previews-off generic (push-woken); badge honors the preference on every
path without collateral suppression (fixes B4, B6; pins FR-012/FR-013/FR-014/FR-015).

**Independent Test**: B calls A (hidden chat) → full-identity ring; B messages A →
silent/generic per path; badge across always/never/revealed; call history clean while relocked.

### Tests (write first, must FAIL)

- [ ] T020 (#613) [P] [US4] Failing vitest in `src/services/notify.hidden.test.ts`: backgrounded-but-connected hidden-chat message produces NO local notification (B6); foreground stays silent and claims the banner
- [ ] T021 (#614) [P] [US4] Failing/pinning vitest in `src/services/sw-inbox.hidden.test.ts` (extend): the hidden generic note byte-equals the previews-off generic (`Ring` / `New message` / `/tabs/chats`) and is decided before mention/mute/content branches; burst frames coalesce under the internal tag
- [ ] T022 (#615) [P] [US4] Failing vitest in `src/services/sw-inbox.badge.test.ts`: SW `unreadCount()` across `always`/`never`/`revealed` × (hidden set readable / locked): `revealed` ≡ `never` in the SW, hidden chats excluded, locked → falls back to `badge.lastCount`, unclassifiable pending frames not counted
- [ ] T023 (#616) [P] [US4] Failing vitest in `src/db/queries.badge.test.ts`: page `countUnread()` persists `badge.lastCount` on success and returns it (not 0) when the set is unknown in `never`/`revealed` modes; visible-chat counts never suppressed (B4)
- [ ] T024 (#617) [P] [US4] Failing Playwright e2e in `e2e/hidden-call.spec.ts` (2-person call per CI constraints): B calls A whose chat with B is hidden → incoming overlay shows B's name and avatar and the call is answerable (knock-knock, FR-013); after hangup the Calls tab shows no entry for B while relocked, and reveal shows it (FR-014)
- [ ] T025 (#618) [P] [US4] Failing Playwright e2e in `e2e/hidden-privacy.spec.ts` (badge/notify section): hidden-chat message produces no visible notification UI while badge reflects ALL THREE modes — `always`, `never`, and `revealed` (hidden unreads counted only during an active reveal, excluded again after relock)

### Implementation

- [ ] T026 (#619) [US4] Remove the backgrounded-but-connected generic bridge from the hidden branch of `notifyIncoming` in `src/services/notify.ts:389` (path becomes badge-only; D6)
- [ ] T027 (#620) [US4] Implement the badge cache in `src/db/queries.ts` `countUnread` (persist + fallback `badge.lastCount`) and add the key to the own-sync exclusion list next to the hidden keys (R5, D4)
- [ ] T028 (#621) [US4] Apply the badge preference in `src/services/sw-inbox.ts` `unreadCount()` per contract (readHiddenSet exclusion, `revealed` ≡ `never`, `badge.lastCount` fallback, unclassifiable pending frames uncounted)
- [ ] T029 (#622) [P] [US4] Update `drive/scenarios/hidden-notify.mjs` for the new fully-silent non-push expectation and `drive/scenarios/hidden-badge.mjs` for the cache-backed modes

**Checkpoint**: the privacy contract (knock-knock + badge only) holds on every delivery path.

---

## Phase 7: User Story 5 — Reset wipes and cannot re-materialize (P2)

**Goal**: Reset blocks the live relay path too — peer-keyed (fixes B3, D3, FR-018).

**Independent Test**: Hide → reset → B sends live → nothing appears anywhere, no
rekey; A explicitly starts a chat with B → works again.

### Tests (write first, must FAIL)

- [ ] T030 (#623) [P] [US5] Failing vitest in `src/services/hidden-chats-reset.test.ts` (extend): reset records `hiddenPeer:<peer>` localOnly tombstones for hidden plain-1:1 peers BEFORE deleting data (FR-024 ordering) and keeps id tombstones for pair/group threads; extend `src/services/hidden-chats.zk.test.ts` so BOTH the `hiddenPeer:` blocks AND `badge.lastCount` are asserted to never enter a sync payload (FR-019)
- [ ] T031 (#624) [P] [US5] Failing vitest in `src/db/queries.receive.hidden.test.ts` (extend): inbound 1:1 frame from a `hiddenPeer:`-blocked peer is acked + dropped — no rekey request, no contact/chat/message writes, no notification; group-card re-creation for a tombstoned group id is dropped
- [ ] T032 (#625) [P] [US5] Failing Playwright e2e in `e2e/hidden-reset.spec.ts`: hide → reset from Settings → B sends a live message → no chat (hidden or visible) appears and nothing identifies B; A starts a new chat with B from Contacts → conversation works (block lifted)

### Implementation

- [ ] T033 (#626) [US5] Write `hiddenPeer:` localOnly tombstones in `src/services/hidden-chats-reset.ts` (step 1, before deletes)
- [ ] T034 (#627) [US5] Consume the peer block in rule R step 4 in `src/db/queries.ts` `receiveIncomingInner` (ack + drop, no trace) and consult group-id tombstones in `ensureGroupChat`/`handleGroupCard`
- [ ] T035 (#628) [P] [US5] Drive scenario `drive/scenarios/hidden-reset-relay.mjs`: reset then live inbound message leaves no trace

**Checkpoint**: FR-018 satisfied end-to-end, including the relay path.

---

## Phase 8: User Story 6 — Robust, no-flash, no-collateral (P2)

**Goal**: Cold-open never flashes hidden chats AND never blanks visible data (pins FR-017; closes the loop on B4's collateral side).

**Independent Test**: Cold-start with hidden chats present: no hidden row ever paints;
visible chats and badge correct from the first frame.

### Tests (write first, must FAIL where behavior changes)

- [ ] T036 (#629) [P] [US6] Failing/pinning Playwright e2e in `e2e/hidden-privacy.spec.ts` (cold-open section): seed hidden + visible chats, then LOOP ≥5 context restarts polling from first paint — hidden row never appears, visible rows and unread badge correct immediately (uses `badge.lastCount` from T027); extend `drive/scenarios/hidden-flash.mjs` to a ≥20-restart soak for the full SC-006 sample
- [ ] T037 (#630) [P] [US6] Pinning vitest in `src/db/hidden-calls.test.ts` (extend): `countMissedUnseen` and call-history exclusion stay fail-closed without collateral loss once the set loads

### Implementation

- [ ] T038 (#631) [US6] Verify/adjust the `listChats` fail-closed nudge path (`src/db/queries.ts:59`, `src/services/hidden-state.ts`) so the T036 first-frame guarantee holds; fix anything T036 exposes

**Checkpoint**: all six bugs (B1–B6) fixed with regression coverage.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T039 (#632) [P] Neutralize dangling biometric references per R9 (keep the never-syncs assertion in `src/services/hidden-chats.zk.test.ts`, drop text implying the feature exists); confirm no `revealWithBiometric`/settings toggle is referenced anywhere in `src/`
- [ ] T040 (#633) [P] Update doc comments: `src/services/hidden-chats.ts` header (per-person model + 1027 cross-reference), `src/services/hidden-chats-start.ts` (no longer test-only), `src/db/queries.ts` rule-R comment block
- [ ] T041 (#634) Run all six existing hidden drive scenarios (`hidden-chats-1019.mjs`, `hidden-notify.mjs`, `hidden-badge.mjs`, `hidden-marker.mjs`, `hidden-pin-pad.mjs`, `hidden-flash.mjs`) against the dev stack and fix regressions — this run also re-verifies FR-007's reveal marker + sort-to-top behavior (unchanged in 1027)
- [ ] T042 (#635) Full gates: `npm run build`, `npx vitest run` (coverage floors), `npm run test:e2e`, `cd server && go build ./... && go vet ./... && go test ./...`
- [ ] T043 (#636) Bump spec `**Status**:` to `in-progress` → run `make roadmap` (start of implement); bump to `in-review` + re-run at PR time
- [ ] T044 (#637) [P] Hardening: seal `HiddenPinRec.length` in `src/services/hidden-chats.ts` under the master key instead of cleartext (auto-verify-at-length reads it only while unlocked, so availability is unchanged); migrate existing records in place on first read (reseal + rewrite) and extend `src/services/hidden-chats.test.ts` for both fresh and migrated shapes

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → story phases.
- **US1 (Phase 3)** requires T004; **US3 (Phase 5)** requires US1's rule R (T007) — sequential.
- **US2 (Phase 4)** is independent of US1/US3 — can run in parallel with Phase 3/5.
- **US4 (Phase 6)** is independent of US1/US3 except T036's badge dependency on T027 (within-phase order handles it).
- **US5 (Phase 7)** requires rule R (T007) for step-4 consumption.
- **US6 (Phase 8)** T036 depends on T027 (badge cache).
- **Polish (Phase 9)** last; T042 gates the PR.

### Parallel opportunities

- T005+T006, T010+T011, T015+T016, T020–T025, T030–T032, T036+T037 (test batches per story).
- US2 (relock) can be built in parallel with US1/US3 by a second contributor.
- Drive-scenario tasks (T009, T014, T019, T029, T035) parallel to their story's e2e.

---

## Implementation Strategy

**MVP = Phase 1–3 (US1)**: the B1 routing fix alone repairs the reported breakage
(hiding a chat no longer resurrects/leaks). Validate independently, then layer
US2 (relock hardening), US3 (coexistence), US4 (notification/badge contract),
US5 (reset), US6 (no-flash), polishing last. Each checkpoint is independently
testable and landable; nothing outside `src/` + tests is touched (server untouched).
