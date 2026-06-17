---
description: "Task list for spec 1010 — Group 'Seen' Receipts (durable, private, counted)"
---

# Tasks: Group "Seen" Receipts — Durable, Private, and Counted

**Input**: Design documents from `/specs/1010-group-seen-receipts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/seen-receipts.md

**Tests**: REQUIRED — Constitution III (TDD): failing tests before implementation.
Server logic + the migration + the counter derivation ship unit tests; new
user-facing behavior adds `e2e/` coverage.

**Organization**: By user story. The **rename + client migration** (the sweeping,
mechanical change every later task assumes) and the server **receipt-case** flip
are the Foundational phase; durable seen, the counter, privacy, and the info
lists build on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete-dependency)
- **[Story]**: US1–US4 (story phases only)

## Path Conventions

Web app, single container: client `src/`, e2e `e2e/`, server `server/`.

---

## Phase 1: Setup

- [ ] T001 Confirm the working baseline is green before the sweeping rename: `npm run build` + `cd server && go test ./...` (record the pre-change state so the rename's diff is isolated).

---

## Phase 2: Foundational (Blocking Prerequisites — rename + migration)

**⚠️ CRITICAL**: the read→seen rename + client migration block every user story.

> Tests first (T002, T003) — write and confirm they FAIL before T004/T005.

- [ ] T002 [P] Client unit test in `src/db/idb.migration.test.ts` (or alongside idb tests): the `DB_VERSION 5→6` transform maps `status 'read'→'seen'`, `readAt→seenAt`, and `receipts[].readAt→seenAt` on existing rows, preserves all other data, regresses no status, and aborts atomically on failure (FR-002; Edge: upgrade failure). (Write first; fails.)
- [ ] T003 [P] Client unit test in `src/services/message-status.test.ts`: the status reducers + group derivation operate on `seen`/`seenAt` (rename), aggregate monotonically. (Write first; fails.)
- [ ] T004 Rename read→seen across the client: `src/db/types.ts` (`MessageStatus 'read'→'seen'`, `ReceiptStatus`, `Receipt.readAt→seenAt`, scalar `readAt→seenAt`), `src/services/message-status.ts` (reducers, `STATUS_ORDER`), `src/services/sync.ts` (`applyReceipt`), `src/services/transport.ts` (`ReceiptFrame` status), `src/db/queries.ts` (roster `seenAt`; `collectUnconfirmedOutgoing`), `src/composables/useSync.ts` (`sendReadReceipts→sendSeenReceipts`), `src/views/detail/ChatDetailPage.vue` (`statusIcon`, `.tick.read→.tick.seen`), `src/views/detail/MessageInfoPage.vue` ("Read by"→"Seen by"). Makes T003 pass.
- [ ] T005 Client `DB_VERSION 5→6` forward migration in `src/db/idb.ts` `onupgradeneeded` (atomic within the upgrade txn; read→seen, readAt→seenAt, receipts[].readAt→seenAt; preserve + no regression). Makes T002 pass.
- [ ] T006 Server: flip the `hub.go` "receipt" case to accept client-originated `'seen'|'downloaded'` (was `'read'`); keep the anti-forgery rejection of client `sent`/`delivered`; `'downloaded'` unchanged.

**Checkpoint**: app speaks "seen" end-to-end; existing data migrated.

---

## Phase 3: User Story 1 - Durable per-member seen (Priority: P1)

**Goal**: a member's seen survives the sender being offline (reconciled on reconnect), mirroring delivered.

**Independent Test**: sender offline, member sees a message, sender reconnects → message reflects that member as seen.

- [ ] T007 [P] [US1] Server seen-store test in `server/internal/ws/seen_test.go` (+ store fake): `RecordSeen` idempotent; `SeenFor` returns one row per member; a client `seen` receipt is relayed (from-stamped) AND recorded; `read`/`sent`/`delivered` from a client are dropped; `downloaded` relays but is NOT recorded. (Write first; fails.)
- [ ] T008 [P] [US1] e2e in `e2e/group-seen-receipts.spec.ts`: a member sees a message while the sender is offline; on the sender's reconnect the seen state is reflected (SC-002). (Write first; fails.)
- [ ] T009 [US1] New server migration `server/internal/db/migrations/NNNN_seen.sql` — `seen` table `(sender, recipient, msg_id, seen_at)`, PK `(sender, recipient, msg_id)` — plus `server/internal/store/seen.go` `RecordSeen` (upsert ON CONFLICT DO NOTHING) + `SeenFor(sender, msgIds)`. Retention mirrors `deliveries`.
- [ ] T010 [US1] Wire `hub.go` "receipt" case to `RecordSeen` when `status=='seen'` (durable, like `ack→RecordDelivery`). Makes T007 pass.
- [ ] T011 [US1] `POST /v1/seen/check` in `server/internal/api/relay_handlers.go` (mirror `deliveriesCheck`) + router; client `src/services/api.ts checkSeen()`.
- [ ] T012 [US1] Client reconcile in `src/composables/useSync.ts` — on 'online', check seen for unconfirmed outgoing and replay synthetic `{t:'receipt',status:'seen',from:recipient}`; extend `collectUnconfirmedOutgoing` (queries.ts) to flag group msgs missing `seenAt`. Makes T008 pass.

**Checkpoint**: seen is durable.

---

## Phase 4: User Story 2 - Group "Seen X/N" counter on the bubble (Priority: P1)

**Goal**: the group bubble shows complete-the-tier progress (Delivered X/N → Seen X/N → Seen).

**Independent Test**: in a group of 3, watch the counter climb as members receive then open the message.

- [ ] T013 [P] [US2] Client unit test in `src/services/message-status.test.ts`: group-progress derivation — N = recipients (excl. sender); 0 delivered→Sent; partial delivered→"Delivered X/N"; all delivered + partial seen→"Seen X/N"; all seen→"Seen"; fraction only while partial (N=1 → plain tick) (FR-004/005). (Write first; fails.)
- [ ] T014 [P] [US2] e2e in `e2e/group-seen-receipts.spec.ts`: 3 accounts — counter climbs Delivered X/2 → Seen X/2 → Seen (SC-001). (Write first; fails.)
- [ ] T015 [US2] Add a group-progress derivation helper in `src/services/message-status.ts` (delivered/seen counts over `receipts[]`, tier + N from recipients). Makes T013 pass.
- [ ] T016 [US2] Render the compact "X/N" next to the tick in `src/views/detail/ChatDetailPage.vue` (group-only, partial-only); `statusIcon`/`.tick.seen` for the seen tier; 1:1 unchanged.

**Checkpoint**: progress visible at a glance.

---

## Phase 5: User Story 3 - "Seen receipts" privacy toggle + reciprocity (Priority: P1)

**Goal**: a default-on, reciprocal, client-enforced toggle.

**Independent Test**: toggle off on A → B sees nothing of A's seen, and A sees no seen tier on A's own messages; others unaffected.

- [ ] T017 [P] [US3] e2e in `e2e/group-seen-receipts.spec.ts`: toggle off ⇒ both-direction suppression (SC-003). (Write first; fails.)
- [ ] T018 [US3] `src/settings/schema.ts`: rename/repurpose `privacy.readReceipts → privacy.seenReceipts` ("Seen receipts", default on; drop the always-for-groups footer; reciprocity copy).
- [ ] T019 [US3] Emit gate + wiring in `src/composables/useSync.ts`: `sendSeenReceipts` is a no-op when off; `applySeenPref()` reads the toggle on start + on settings change (mirror 1009 `applyActivityPref`/`setActivityIndicatorsEnabled`).
- [ ] T020 [US3] Reciprocity display gate in `src/views/detail/ChatDetailPage.vue` (+ `MessageInfoPage.vue`): when off, do not render/aggregate the seen tier on the user's own sent messages.

**Checkpoint**: consent + reciprocity enforced client-side; P1 set complete.

---

## Phase 6: User Story 4 - Message-info per-tier lists (Priority: P2)

**Goal**: Seen by / Delivered / Not yet delivered covering every member, with avatars.

**Independent Test**: open a group message's info → every member appears under exactly one list.

- [ ] T021 [P] [US4] e2e in `e2e/group-seen-receipts.spec.ts`: info lists partition all members into Seen by / Delivered / Not yet delivered (SC-004). (Write first; fails.)
- [ ] T022 [US4] In `src/views/detail/MessageInfoPage.vue`: add the **"Not yet delivered"** list (`chat.participantIds` minus members with `deliveredAt`); rename "Read by"→"Seen by"; render an avatar stack (cap ~5 + "+N") for each tier, reusing `contactMap`/`nameFor`/`avatarFor`/`initialsAvatar`.

**Checkpoint**: full per-member detail.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T023 [P] e2e/assertion: 1:1 messages are visually unchanged (plain tick, no fraction) (SC-006).
- [ ] T024 [P] LTR/RTL + light/dark: the counter and the avatar stack render and mirror correctly; labels localizable (FR-014).
- [ ] T025 [P] ZK inspection: the `seen` table mirrors the `deliveries` metadata shape (no new class, no message content); confirm no server preference column (SC-007).
- [ ] T026 Run all gates green: `npm run build`, `cd server && go build ./... && go vet ./... && go test ./...`, vitest, `npm run test:e2e`; then the `quickstart.md` manual smoke.

---

## Dependencies & Story Completion Order

- **Setup (T001)** → **Foundational (T002–T006)** block everything (rename + migration + receipt-case).
  - T002/T003 (tests) before T004/T005 (impl).
- **US1 (T007–T012)** durable seen — server store + reconcile. **MVP core.**
- **US2 (T013–T016)** counter — renders from `receipts[]`; reliability depends on US1 but the derivation works on whatever's in the roster.
- **US3 (T017–T020)** gates emission/display added by the rename + US1/US2 (do after, or stub the gate and complete here).
- **US4 (T021–T022)** depends only on the foundation + roster.
- **Polish (T023–T026)** last; T026 is the definition-of-done gate.

## Parallel Execution Examples

- Foundational: T002 ‖ T003 (different test files); T004 (sweeping) then T005, T006.
- After foundation: US1 server work (T009–T011) ‖ US2 derivation (T015); the per-story e2e tasks (T008, T014, T017, T021) author in parallel (same file, distinct `describe` blocks).
- Polish: T023 ‖ T024 ‖ T025.

## Implementation Strategy

- **MVP = Foundation + US1 + US2**: app speaks "seen", seen is durable, and the group counter shows reliable progress.
- Then **US3** (consent — required for P1 completeness) and **US4** (info detail, P2).
- **Gate before `/speckit-implement`**: `/speckit-analyze` clean (checklist already clean).
