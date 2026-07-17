---
description: "Task list for Hidden Chats Locked Behind a PIN"
---

# Tasks: Hidden Chats Locked Behind a PIN

**Input**: Design documents from `specs/1019-hidden-chats-pin/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md

**Tests**: INCLUDED — Constitution Principle III (TDD) is a mandate. Failing unit
tests precede implementation; new user-facing behavior gets an e2e spec.

**Organization**: Grouped by user story (spec priorities). US1+US3 together are
the MVP. This is a **client-only** feature — no `server/` tasks, no SQL migration,
no `DB_VERSION` bump.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US7 (maps to spec user stories); Setup/Foundational/Polish have none
- Exact file paths included. FR/SC refs point back to spec.md.

## Path Conventions

Single-project Vue PWA: client under `src/`, e2e under `e2e/`, unit tests as
`*.test.ts` siblings (vitest). Spec docs under `specs/1019-hidden-chats-pin/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding the new modules and test surfaces this feature adds.

- [ ] T001 Create the new service stub `src/services/hidden-chats.ts` exporting the signatures in [contracts/internal-api.md](./contracts/internal-api.md) (membership, PIN, reset, startHiddenChat) as typed no-op/throw stubs so dependents typecheck.
- [ ] T002 [P] Create the new composable stub `src/composables/useHiddenChats.ts` exporting `{ revealed, reveal, revealWithBiometric, relock }` per the contract.
- [ ] T003 [P] Create the e2e spec skeleton `e2e/hidden-chats.spec.ts` (2-account flow scaffold via `window.__ringTest`; describe blocks per user story, all `test.fixme` initially).
- [ ] T004 [P] Add the `privacy-hidden-chats` settings screen scaffold under the `privacy` hub in `src/settings/schema.ts` (enable toggle `privacy.hiddenChatsEnabled` default false; placeholders for PIN/reset/biometric/grace, filled in per story).

**Checkpoint**: New files exist and `npm run build` typechecks with stubs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The membership store, the separate PIN, and the single chat-list
choke-point exclusion. **No user story can be implemented until this is done.**

**⚠️ Implements the core security requirements (FR-009/010/014/015/021/022).**

- [ ] T005 [P] Unit test `src/services/hidden-chats.test.ts`: the hidden set is a master-key-wrapped (`sealJson`) blob in `settings` key `privacy.hiddenChats`; round-trips through `getHiddenSet/addHidden/removeHidden`; is NEVER added to the synced `chats` row (FR-009, Research §R1).
- [ ] T006 [P] Unit test (same file): `verifyHiddenPin` succeeds only on the correct PIN via decryption (AEAD), uses a separate salt/key from the app PIN (FR-015), and fails closed on corrupt/absent state (FR-021); a wrong PIN reveals no "exists" signal (FR-004/SC-006).
- [ ] T007 [P] Unit test `src/db/queries.test.ts`: `listChats()` excludes ids in the hidden set by default and includes them only when a reveal flag is passed/active (FR-002/FR-004); a hidden chat's synced row is byte-identical to a non-hidden one (FR-014/SC-004).
- [ ] T008 Implement the hidden-set storage + accessors in `src/services/hidden-chats.ts` (`getHiddenSet/isHidden/addHidden/removeHidden`) using `crypto/envelope.ts` `sealJson/openJson` under the master key; lazily create the record on first hide (data-model §1). Makes T005 pass.
- [ ] T009 Implement the separate-PIN material + `enableHiddenPin/verifyHiddenPin/changeHiddenPin/hasHiddenPin/hiddenPinLength` mirroring `src/services/crypto/identity.ts` `wrapSecret/verifyPin`, with independent `hiddenPinSalt/hiddenPinWrapped/hiddenPinLength` kept out of sync; Argon2id cost is the brute-force mitigation (FR-022). Makes T006 pass.
- [ ] T010 Wire the exclusion into the single choke point `src/db/queries.ts` `listChats()` (consult `getHiddenSet()`; add an "include hidden" parameter for the revealed path) so every filter chip in `src/services/chat-filters.ts` inherits it. Makes T007 pass.
- [ ] T011 Confirm `src/services/ownsync.ts` `SYNCED` and the profile/prefs bundle still exclude all hidden-chats keys (`privacy.hiddenChats*`, PIN material, prefs); add a guard/assertion test in `src/services/ownsync.test.ts` that none of these appear in a push payload (FR-009, SC-004).

**Checkpoint**: Hidden set + PIN + global exclusion exist and are unit-tested.
Hidden chats can be hidden/excluded programmatically; UI stories can begin.

---

## Phase 3: User Story 1 — Hide a conversation behind a PIN (Priority: P1) 🎯 MVP

**Goal**: From a conversation, hide it behind the dedicated PIN; it leaves the
Chats tab and search.

**Independent test**: Hide a 1:1 → it vanishes from Chats tab + search; first hide
prompts PIN creation.

- [ ] T012 [P] [US1] e2e in `e2e/hidden-chats.spec.ts`: first "Hide chat" prompts PIN creation; after confirm, the chat is absent from the Chats tab and from search-by-name (spec US1 AC1–AC3).
- [ ] T013 [US1] Add a "Hide chat" action to `src/components/ChatActionsSheet.vue` (and ensure it's reachable from `ChatListItem.vue` "More"); on first use, route through a PIN-creation flow that requires **entering and confirming** the PIN (double-entry; reject mismatch) before calling `enableHiddenPin` then `addHidden` (FR-003).
- [ ] T014 [US1] Add the "Set / change PIN" action rows to the `privacy-hidden-chats` screen in `src/settings/schema.ts`, wired to `enableHiddenPin/changeHiddenPin` (FR-013); change-PIN re-wraps the set with no unprotected window (security CHK018).
- [ ] T015 [US1] Verify `useChatFilters`/`listChats` reactivity: hiding a chat fires the change-bus so the list updates live (no manual refresh); extend `src/db/queries.test.ts` if a gap is found.

**Checkpoint**: A conversation can be hidden and disappears everywhere in the chat list.

---

## Phase 4: User Story 2 — A hidden chat coexists with the normal chat (Priority: P1)

**Goal**: A hidden chat is a distinct conversation (2-person group) that coexists
with the normal 1:1 with the same person.

**Independent test**: Start a hidden chat with a contact you already have a 1:1
with; both exist independently; histories never merge.

- [ ] T016 [P] [US2] Unit test `src/services/hidden-chats.test.ts`: `startHiddenChat(contactId)` creates a distinct group (own id) via `createGroup('', [contactId])`, adds it to the hidden set, and leaves any existing 1:1 with that contact untouched (FR-017, SC-008).
- [ ] T017 [P] [US2] e2e in `e2e/hidden-chats.spec.ts`: with a visible 1:1 present, a hidden chat with the same contact coexists; messages in one never appear in the other; the counterpart sees a normal separate conversation (FR-018, US2 AC1–AC4).
- [ ] T018 [US2] Implement `startHiddenChat(contactId)` in `src/services/hidden-chats.ts` wrapping `createGroup` (queries.ts:1091) + `addHidden`. Makes T016 pass.
- [ ] T019 [US2] Add a "New hidden chat" entry point (e.g., from the contact detail / new-chat surface) that calls `startHiddenChat` and lands the user in the revealed conversation; reuse existing Ionic navigation. Keep it non-discoverable when the feature is disabled.

**Checkpoint**: Coexisting hidden + visible conversations with the same person work.

---

## Phase 5: User Story 3 — Reveal & unhide with the PIN + grace window (Priority: P1) 🎯 MVP

**Goal**: Reveal hidden chats by typing the PIN in the search bar; sticky grace
window across brief backgrounding; full close always re-locks; unhide is permanent.

**Independent test**: Type PIN in searchbar → hidden chats appear; background
briefly → still revealed; full close → re-locked even on instant reopen; unhide →
returns to normal list.

- [ ] T020 [P] [US3] Unit test `src/composables/useHiddenChats.test.ts`: reveal session starts locked on cold load; correct PIN → revealed; grace window keeps revealed across simulated background within the window and re-locks after elapsed time measured by actual elapsed time, not wall-clock the user can manipulate (FR-005/FR-023); explicit relock works; an app auto-lock event ends the reveal session (FR-025).
- [ ] T021 [P] [US3] e2e in `e2e/hidden-chats.spec.ts`: PIN-in-searchbar reveals hidden chats; a wrong/normal query just returns normal search results with no signal (FR-004/SC-005/SC-006); simulated full close re-locks (FR-005/SC-009); unhide returns the chat to the Chats tab (US3 AC1–AC6).
- [ ] T022 [US3] Implement `useHiddenChats.ts`: in-memory `revealed` ref + grace timer mirroring `src/composables/useAutoLock.ts` (`visibilitychange`, elapsed-time check); never persist anything that auto-reveals on cold start; subscribe to the app-lock event to force relock (FR-005/FR-020/FR-023/FR-025). **Verify first** that `useAutoLock` exposes a consumable lock event/state; if it does not, add the minimal lock signal it needs and note the added wiring (resolves analyze finding U2). Makes T020 pass.
- [ ] T023 [US3] Wire the reveal gesture in `src/views/tabs/ChatsPage.vue`: when the searchbar query is all-digits matching `hiddenPinLength`, attempt `reveal(pin)`; on success show hidden chats merged into the list (pass the "include hidden" flag to `listChats`); non-matching input behaves as normal search (FR-004).
- [ ] T024 [US3] Add the grace-window `choice` row (`privacy.hiddenChatsGrace`: `immediately`/`1m`/`5m`, default `1m`) to `src/settings/schema.ts` and read it in `useHiddenChats.ts` (FR-020).
- [ ] T025 [US3] Add an "Unhide" action to the revealed-chat surface (`ChatActionsSheet.vue`) calling `removeHidden` (FR-006); confirm it survives a re-lock (chat stays visible).

**Checkpoint**: MVP complete — hide (US1), coexist (US2), reveal/unhide + grace (US3).

---

## Phase 6: User Story 4 — Private notifications for hidden chats (Priority: P2)

**Goal**: Hidden-chat notifications carry no sender/avatar/content and never
deep-link into the hidden chat; fail-safe to generic when status is unknown.

**Independent test**: Message a hidden chat from another account → notification is
content-free; tapping lands on Chats tab without revealing the chat.

- [ ] T026 [P] [US4] Unit test `src/services/sw-inbox.test.ts`: `noteForPayload()` for a chat in the hidden set yields a generic title/body (no sender/avatar/preview) and `url: '/tabs/chats'` (FR-007/FR-008); when hidden status can't be determined (no unlock), it defaults to generic (FR-021/CHK029); burst-coalescing still aggregates without surfacing identity (US3/US4 AC3–AC4).
- [ ] T027 [P] [US4] e2e in `e2e/hidden-chats.spec.ts`: a message into a hidden chat produces a notification with no preview and a tap that does not open/reveal it (US4 AC1–AC2). (Headless-CI-safe; skip if push can't be driven, leave a `log()` note.)
- [ ] T028 [US4] Implement the hidden branch in `src/services/sw-inbox.ts` `noteForPayload()` (consult the hidden set via `getHiddenSet` post device-unlock): generic note + `/tabs/chats` url; ensure `src/sw.ts` `notificationclick` routing needs no change (it routes by `data.url`). Makes T026 pass.
- [ ] T029 [US4] Verify interaction with per-chat `notifyContent` and the global preview toggle: hidden status overrides both deterministically (CHK033); add an assertion to T026 if needed.

**Checkpoint**: Hidden chats never leak through notifications.

---

## Phase 7: User Story 5 — Hidden chats leave no trace in call history (Priority: P2)

**Goal**: Placed/received/missed calls in hidden chats are absent from the Calls
tab and missed-call badge; incoming calls show a generic pre-answer caller.

**Independent test**: Place & miss calls in a hidden chat → none appear in Calls
tab; incoming call shows a generic caller.

- [ ] T030 [P] [US5] Unit test `src/db/queries.test.ts`: `listCallGroups()` excludes calls whose `contactId` ∈ hidden set (group calls carry `contactId = hidden groupId`), and `markCallsSeen`/missed-badge computation ignores them (FR-019, US5 AC1–AC2/AC4).
- [ ] T031 [P] [US5] e2e in `e2e/hidden-chats.spec.ts`: a call in a hidden chat does not appear in the Calls tab; a visible chat's call still does (US5 AC1).
- [ ] T032 [US5] Implement the Calls-tab exclusion in `src/db/queries.ts` `listCallGroups()` (filter by `getHiddenSet()` before grouping) and exclude hidden chats from the missed-call badge/count. Makes T030 pass.
- [ ] T033 [US5] Branch `src/composables/useCall.ts` incoming-offer handling (and the call-waiting/second-incoming branch) to substitute a generic `callMeta` identity (no name/avatar) when the originating conversation ∈ hidden set, so `IncomingCallOverlay.vue` shows nothing identifying (FR-019, US5 AC3).

**Checkpoint**: No call-history or pre-answer leak for hidden chats.

---

## Phase 8: User Story 6 — Optional biometric unlock (Priority: P3)

**Goal**: Biometric unlock for the reveal gesture, with PIN always as fallback.

**Independent test**: Enable biometrics → reveal without typing the PIN; on
failure/unsupported, PIN still works.

- [~] T034 [P] [US6] WON'T DO — biometric unlock isn't a priority for hidden chats; PIN-only stays the permanent design (#523).
- [~] T035 [US6] WON'T DO (#524).
- [~] T036 [US6] WON'T DO (#525).

**Checkpoint**: Biometric convenience layer works; PIN remains authoritative.

---

## Phase 9: User Story 7 — Reset the PIN: wipe + block re-sync (Priority: P3)

**Goal**: Reset permanently wipes hidden conversations locally and blocks them
from re-syncing on this device, behind an explicit destructive warning.

**Independent test**: With hidden chats present, reset → warned → confirmed →
local history gone and does NOT reappear after a sync pull.

- [ ] T037 [P] [US7] Unit test `src/db/tombstones.test.ts`: a local-only "do-not-resync" block is recorded per wiped id, is consulted at ingest, and is NEVER returned by `listTombstones()` / never uploaded (FR-016, Research §R8).
- [ ] T038 [P] [US7] Unit test `src/services/hidden-chats.test.ts`: `resetHiddenChats()` deletes messages/sessions/sender-keys/chat-rows for every hidden id, records the local-only block per id, clears the set + PIN material, and a subsequent `pullOwnData()` does not re-add them (FR-016/SC-007); the wipe leaves no partially-visible state (FR-024).
- [ ] T039 [US7] Add a local-only tombstone variant in `src/db/tombstones.ts` (e.g. `localOnly: true`) recorded by a new helper and excluded from `listTombstones()`. Makes T037 pass.
- [ ] T040 [US7] Consult the local-only block in `src/services/ownsync.ts` `pullOwnData()` ingest so blocked ids are skipped (alongside the existing `isTombstoned` check). 
- [ ] T041 [US7] Implement `resetHiddenChats()` in `src/services/hidden-chats.ts` (atomic wipe order: block → delete data → clear set/PIN, so an interruption keeps chats hidden, FR-024). Makes T038 pass.
- [ ] T042 [US7] Add the "Reset PIN" danger action with an explicit destructive `confirm` to the `privacy-hidden-chats` screen in `src/settings/schema.ts`; the warning states permanent deletion of hidden conversations before confirmation (FR-012, US7 AC1).
- [ ] T043 [P] [US7] e2e in `e2e/hidden-chats.spec.ts`: reset shows the destructive warning, wipes the hidden conversation, and it does not reappear after a sync round-trip (US7 AC1–AC3).

**Checkpoint**: Reset is permanent and device-local; other devices/server untouched.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature guarantees, a11y, gates, and the mandated review.

- [ ] T044 [P] Add a zero-knowledge boundary test (`src/services/ownsync.test.ts` or a dedicated `src/services/hidden-chats.zk.test.ts`): the push payload for a conversation is identical before and after hiding it, and no hidden-chats key is ever uploaded (SC-004, security CHK001–CHK003).
- [ ] T045 [P] Audit for leak surfaces missed: chat pickers, recents, share/forward targets, quoted-reply pickers, and global search all exclude hidden chats (FR-002); add tests where a surface bypasses `listChats`.
- [ ] T046 [P] Grep for and remove any log line / debug aid that could emit hidden state or set contents in client code (Constitution §I, security CHK006).
- [ ] T047 [P] Accessibility & bidi for the reveal/PIN UI and the settings screen: labels, focus, contrast via `--ring-*` tokens; RTL-correct (Constitution §X/§XI).
- [ ] T048 Update `e2e/hidden-chats.spec.ts`: remove all `test.fixme`, keep flows to 2 accounts (3-person mesh too flaky for headless CI — project memory), ensure it boots within the isolated e2e stack.
- [ ] T049 Run full gates: `npm run build` (typecheck + build), `cd server && go build ./... && go vet ./... && go test ./...` (must stay green/untouched), `npm run test:e2e` (needs `make db-up`).
- [ ] T050 Re-check the `security.md` checklist items against the finished spec/code paths; complete the **mandated human security review** of at-rest wrapping, separate-PIN handling, reveal lifecycle, and the local-only block (Constitution §IV; checklist CHK048).
- [ ] T051 Flip spec `Status` to `in-progress` (now) / `in-review` (at PR) and run `make roadmap`; ensure the eventual commit subject is plain-language release-note copy (Constitution §VII).
- [ ] T052 [P] Implement + unit-test the disable-safety behavior (FR-013a): toggling `privacy.hiddenChatsEnabled` off removes the entry points only — it hides the "Hide chat" action and makes the searchbar reveal gesture inert (T019/T023), while already-hidden conversations stay hidden, protected, and unrevealed (no unhide/wipe/surface). Add a test in `src/services/hidden-chats.test.ts` asserting disable does not mutate the hidden set or reveal state.

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → **Foundational (Phase 2)** blocks everything below.
- **MVP = US1 + US3** (and US2 for the coexistence promise). All three are P1.
  - US1 (Phase 3) needs Foundational.
  - US2 (Phase 4) needs Foundational (set) + `createGroup`.
  - US3 (Phase 5) needs Foundational (PIN verify) + US1's hide path to test against.
- **US4 (P2)**, **US5 (P2)** each need only Foundational (the hidden set via
  `isHidden`/`getHiddenSet`) → can be built in parallel after Phase 2.
- **US6 (P3)** needs US3 (the reveal composable).
- **US7 (P3)** needs Foundational + the deletion helpers; independent of US4–US6.
- **Polish (Phase 10)** last.

### Parallel opportunities

- Phase 2: T005, T006, T007 (tests) in parallel; then T008/T009 in parallel, T010
  after T007/T008, T011 independent.
- After Phase 2: US4 (Phase 6) and US5 (Phase 7) can proceed concurrently with
  US2/US3 work since they touch different files (`sw-inbox.ts`, `useCall.ts`,
  `listCallGroups`).
- Within each story, `[P]` test tasks precede their implementation task.

## Implementation Strategy

1. **Land the MVP first**: Phase 1 → 2 → US1 → US3 (+ US2). This delivers the
   headline value (hide, reveal, coexist) and is independently shippable.
2. **Then privacy hardening**: US4 (notifications) and US5 (call history) close the
   leak paths — ship together as the "no trace" increment.
3. **Then convenience + safety**: US6 (biometric), US7 (reset) as P3 increments.
4. **Gate every increment** on `npm run build` + relevant unit/e2e (Constitution
   §VII). Do not start `/speckit-implement` until `/speckit-analyze` is clean and
   the security review (T050) is scheduled.
