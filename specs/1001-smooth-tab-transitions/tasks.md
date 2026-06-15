---

description: "Task list for Smooth Tab Transitions (1001)"
---

# Tasks: Smooth Tab Transitions

**Input**: Design documents from `/specs/1001-smooth-tab-transitions/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED here. Per Constitution Principle III (TDD), new user-facing
behavior MUST add/extend e2e specs and the new shared warm-store composable MUST
ship unit tests. Test tasks are ordered BEFORE the implementation they cover and
must be written failing first (Red → Green → Refactor).

**Organization**: Tasks are grouped by user story so each story is independently
implementable and testable. All work is client-side (Vue 3 + Ionic PWA); no
server, no migration, no `DB_VERSION` change.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)
- Exact file paths included in each task

## Path notes

- Single-project client; all paths are repo-root-relative.
- Unit tests are sibling `src/**/*.test.ts` (vitest); e2e is `e2e/*.spec.ts` (Playwright).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the files the rest of the work builds on.

- [ ] T001 Create the warm-stores module skeleton in `src/composables/warmStores.ts` with exported `warmAll()` and `clearWarm()` no-op stubs plus placeholders for the SelfProfile / chats / calls / contacts singletons (typed per `data-model.md`), so downstream tasks have a stable import target.
- [ ] T002 [P] Create empty e2e spec file `e2e/tab-transitions.spec.ts` with the standard `window.__ringTest` harness boilerplate (copy the setup pattern from an existing spec such as `e2e/chat-filters.spec.ts`) and a `test.describe('tab transitions')` block.

**Checkpoint**: New module + e2e file exist and the project still typechecks (`npm run build`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared warm-cache infrastructure every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Write failing unit tests for the warm-store infrastructure in `src/composables/warmStores.test.ts`: `warmAll()` is idempotent and only runs work when unlocked; populates each singleton from the (mocked) `getSecret`/list-query sources; stays live on `idb` change-bus events; `clearWarm()` resets every ref to its cold initial value leaving no decrypted residue (FR-ZK-2/FR-ZK-3); a failed/aborted unlock does NOT warm any store and a mid-warm `getSecret`/query failure leaves that store cold rather than caching a partial/fallback value (FR-ZK-4). Tests MUST fail initially.
- [ ] T004 Implement the singleton warm stores + `warmAll()` / `clearWarm()` in `src/composables/warmStores.ts` to satisfy T003: module-level reactive `SelfProfileStore` (`name`, `avatar`, `warmed`) and list stores (`items`, `loaded`) for chats/calls/contacts, sourced via existing `getSecret('profileName'|'profileAvatar')` and `listChats`/`listCallGroups`/`listContacts`, subscribed to the relevant `idb` stores. `warmAll()` runs only when unlocked and guards each source so a decrypt/query failure leaves that store cold (FR-ZK-4); `clearWarm()` resets all refs to cold initial values with no residue (FR-ZK-2). Never serialize warm values to any clear storage (FR-ZK-1). (depends on T003)
- [ ] T005 Add the optional `warmSource` parameter to `useLiveQuery` in `src/composables/useLiveQuery.ts` per `contracts/warm-stores.md`: when `warmSource()` returns a defined value, use it as the first-paint value and treat `loaded` as already true; otherwise behavior is byte-for-byte unchanged (no breaking change to existing callers). (depends on T001)
- [ ] T006 Wire lifecycle in `src/composables/useKeyGuard.ts` (or the app-entry unlock path): call `warmAll()` when `isUnlocked` transitions to `true` (before the user can navigate tabs) and `clearWarm()` on **every** session-end transition — keystore lock, sign-out, and account removal (FR-ZK-2). Reuse the existing lock/sign-out paths; ensure no session-end path is missed. (depends on T004)

**Checkpoint**: `npm run build` passes and `npm run test:unit` passes T003. Warm caches populate at unlock and clear at lock. User stories can now proceed.

---

## Phase 3: User Story 1 - Tab content appears fully formed on switch (Priority: P1) 🎯 MVP

**Goal**: Switching to a tab shows its header, controls, and list data together in the first painted frame; return visits restore content + scroll instantly.

**Independent Test**: With a populated account, switch into Chats/Calls/Contacts and assert (e2e + frame capture) the search bar, action buttons, filter chips, and list are present together — no title-only intermediate frame; leave and return to a tab and confirm content + scrollTop are preserved with no empty-state render.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [ ] T007 [P] [US1] Extend `e2e/tab-transitions.spec.ts`: on a populated account, after switching to Chats/Calls/Contacts, assert header (search field), action buttons, and (Chats) filter chips and the list rows are present in the same assertion tick — no frame missing them (Invariant R1).
- [ ] T008 [P] [US1] Extend `e2e/tab-transitions.spec.ts`: scroll a tab's list, switch away and back, assert the list content and `scrollTop` are preserved and no empty-state element is rendered on return (Invariant R4 / keep-alive).

### Implementation for User Story 1

- [ ] T009 [US1] Convert the four `/tabs` child routes in `src/router/index.ts` from `() => import()` to static imports so the tab components are eager-loaded (no first-switch chunk stall); leave the auth guard and all other lazy routes unchanged. (depends on Phase 2)
- [ ] T010 [US1] In `src/views/tabs/ChatsPage.vue`, source the base chat list from the shared warm chats store **when the search term is empty** (via `useLiveQuery`'s `warmSource`), and **fall back to the existing `listChats(term)` live query when a search term is present** (data-layer filtering stays server/DB-side — do NOT re-implement search on the client). Keep filter/pagination as page-local `computed`s and preserve the existing `loaded`-gated empty state. (depends on T004, T005; see data-model.md "Search contract")
- [ ] T011 [US1] In `src/views/tabs/CallsPage.vue`, source the base call-groups list from the shared warm calls store **when search is empty** via `warmSource`, and **fall back to `listCallGroups(term)` when a term is present**; `visible` pagination stays page-local and resets on term change as today. (depends on T004, T005; see data-model.md "Search contract")
- [ ] T012 [US1] In `src/views/tabs/ContactsPage.vue`, source the base contacts list from the shared warm contacts store **when search is empty** via `warmSource`, and **fall back to `listContacts(term)` when a term is present**; `visible` pagination stays page-local and the server-invite refresh on `onIonViewWillEnter` stays as-is. (depends on T004, T005; see data-model.md "Search contract")
- [ ] T013 [US1] Verify and, if needed, fix `IonRouterOutlet` keep-alive in `src/views/TabsPage.vue`: confirm `switchTab(path, 'root', 'replace', …)` does not tear down cached pages (no `v-if` on the outlet, pages stay mounted); make T008 pass. Do NOT change `swipeBackEnabled`/`scrollAssist` or the `'root'`/`'replace'` semantics. (depends on T009)
- [ ] T013b [US1] **CONDITIONAL — only if T013 finds keep-alive does NOT retain scroll** under `'root'`/`'replace'`: add a page-local scroll save/restore in each tab page (`src/views/tabs/{Chats,Calls,Contacts,Settings}Page.vue`) — persist `ion-content` `scrollTop` on `onIonViewWillLeave` to an in-memory map and restore it on `onIonViewDidEnter`, so FR-003/SC-004 hold without altering navigation semantics. Skip this task entirely if T013/T008 already pass. (depends on T013)

**Checkpoint**: Tabs (warm) appear fully formed and restore instantly; T007–T008 pass.

---

## Phase 4: User Story 3 - Identity-bearing screens show the real user immediately (Priority: P2)

> Sequenced before US2 because it is self-contained (profile only) and shares no
> files with US2. Implemented after the P1 MVP.

**Goal**: Settings (and every own-avatar/name surface) shows the real photo and name in the first painted frame — never the "You"/initials placeholder when a real profile exists.

**Independent Test**: Open Settings from another tab and assert (e2e) the real display name is present with no intervening "You" text and no placeholder-then-real avatar swap.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [ ] T014 [P] [US3] Add unit test `src/composables/useSelfProfile.test.ts`: two `useSelfProfile()` calls return refs backed by the SAME singleton (shared identity), warm values appear without a per-call cold restart, and fallback semantics (`@username` → "You"; initials avatar) hold while cold/locked. Must fail initially.
- [ ] T015 [P] [US3] Extend `e2e/tab-transitions.spec.ts`: open Settings on an account with a real name/photo set and assert the real display name is shown on first paint with no "You" placeholder text appearing (Invariant R3).

### Implementation for User Story 3

- [ ] T016 [US3] Convert `src/composables/useSelfProfile.ts` from a per-call factory to a singleton-backed composable that returns refs from the shared `SelfProfileStore` (same identity across all callers); keep the exported signature and fallback behavior unchanged so existing call sites need no edits. (depends on T004)
- [ ] T017 [US3] Update `src/views/tabs/SettingsPage.vue` to drop its inlined cold profile `useLiveQuery` reads and consume `useSelfProfile()` for name + avatar, so first paint uses the warm singleton. (depends on T016)

**Checkpoint**: Settings shows real identity on first paint; T014–T015 pass; existing `useSelfProfile` call sites (call tiles, group lists, reply quotes, media captions) still render correctly.

---

## Phase 5: User Story 2 - No layout shift as a screen settles (Priority: P2)

> Touches CallsPage/ContactsPage already edited in US1, so it follows US1 to
> avoid same-file conflicts.

**Goal**: No element moves after a tab's first paint; empty states only appear once absence of data is confirmed.

**Independent Test**: Record a tab switch (and run e2e) confirming no element changes position after the first frame, and that a populated account never flashes "No calls/contacts found" before its list.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [ ] T018 [P] [US2] Extend `e2e/tab-transitions.spec.ts`: on a populated account, assert the "No calls found" / "No contacts found" empty-state elements are never present before their lists render (Invariant R5); and on an empty account they render cleanly once. Must fail for Calls/Contacts initially (they currently lack a `loaded` gate).

### Implementation for User Story 2

- [ ] T019 [US2] In `src/views/tabs/CallsPage.vue`, gate the "No calls found" empty state behind the warm store's `loaded` flag (mirror ChatsPage's `loaded && length === 0`) so it never flashes before data. (depends on T011)
- [ ] T020 [US2] In `src/views/tabs/ContactsPage.vue`, gate the "No contacts found" empty state behind the warm store's `loaded` flag so it never flashes before data. (depends on T012)
- [ ] T021 [P] [US2] Reserve vertical space for asynchronously-arriving header/list regions across `src/views/tabs/CallsPage.vue` and `src/views/tabs/ContactsPage.vue` (and verify Chats/Settings) so nothing reflows after first paint (Invariant R2); use stable min-heights/placeholders, not content-dependent collapse. (depends on T019, T020)
- [ ] T022 [US2] Implement the cold-start fallback presentation (FR-010): when a warm store is genuinely cold (very first launch pre-unlock), show a single stable loading/empty region (reserved space, no empty→placeholder→populated sequence) in `src/views/tabs/CallsPage.vue` and `src/views/tabs/ContactsPage.vue`. (depends on T021)

**Checkpoint**: No post-paint layout shift; no empty-state flash; T018 passes.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [P] Extend `e2e/bidi.spec.ts` (or add an RTL assertion in `e2e/tab-transitions.spec.ts`) to confirm a tab containing RTL content appears fully formed without reflow after the warm-cache change (FR-009 / Invariant R6). **Also cover the theme half of FR-009**: assert tab-switch completeness holds in both light and dark themes (toggle via the existing theme setting / `useTheme`), so the warm-cache change is verified theme-agnostic.
- [ ] T024 [P] Add a rapid-switch stress assertion in `e2e/tab-transitions.spec.ts`: cycle Calls↔Chats↔Contacts↔Settings quickly and assert every tab ends fully rendered with no tab stuck in a placeholder/partial state (FR-007 / Invariant R6).
- [ ] T025 Run the `quickstart.md` manual verification (frame capture of each switch) and confirm Invariants R1–R6; capture before/after notes in the PR description.
- [ ] T025b Zero-knowledge verification (FR-ZK-3 / SC-006): after exercising every tab, inspect clear storage (IndexedDB / `localStorage` / `sessionStorage` / Cache Storage) and confirm no profile/list plaintext is present; then lock and sign out and confirm the warm refs are reset to cold initial values. Record the result in the PR.
- [ ] T026 Final gates: `npm run build` (vue-tsc + vite build), `npm run test:unit` (with coverage floors), and `npm run test:e2e` all green; confirm `registerType: 'prompt'` and the zero-knowledge boundary (no plaintext persisted in the clear; warm cache cleared on lock/sign-out) are intact.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **US1 (Phase 3)**: depends on Phase 2. MVP.
- **US3 (Phase 4)**: depends on Phase 2 (specifically T004/T016). Independent of US1/US2 (profile-only, no shared files).
- **US2 (Phase 5)**: depends on Phase 2 and on US1's edits to CallsPage/ContactsPage (T011/T012) — same files, so it follows US1.
- **Polish (Phase 6)**: depends on the desired user stories being complete.

### Within each user story

- Tests written first and failing, then implementation (Red → Green → Refactor).
- US1: routing eager-load (T009) before page warm-source edits (T010–T012) before keep-alive verification (T013); T013b runs only if T013 finds scroll is not retained.
- US2: `loaded`-gates (T019/T020) before reserve-space (T021) before cold-start fallback (T022).

### Parallel opportunities

- T002 ∥ T001 (different files).
- Test authoring within a story is parallel: T007 ∥ T008; T014 ∥ T015.
- T010 ∥ T011 ∥ T012 (three different tab files) once T004/T005 exist.
- US3 (Phase 4) can run in parallel with US1 (Phase 3) by a second developer — disjoint files (profile vs lists/router), both only need Phase 2.
- Polish T023 ∥ T024.

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
Task: "Extend e2e/tab-transitions.spec.ts — fully-formed first frame (R1)"   # T007
Task: "Extend e2e/tab-transitions.spec.ts — return preserves scroll (R4)"    # T008

# Then page edits (parallel, different files):
Task: "ChatsPage.vue consume warm chats store"      # T010
Task: "CallsPage.vue consume warm calls store"      # T011
Task: "ContactsPage.vue consume warm contacts store" # T012
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL) → 3. Phase 3 US1 →
4. STOP & validate: tabs appear fully formed and restore instantly → demo.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. US1 → the core "feels native" win (MVP) → demo.
3. US3 → real identity on Settings → demo.
4. US2 → no layout shift / no empty flash → demo.
5. Polish → RTL + stress + gates.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- Constitution: this spec touches Principle I (in-memory vs at-rest cache) → run
  `/speckit-checklist` before `/speckit-implement`; `/speckit-analyze` must be
  clean (or findings waived) before implementing.
- Do not change `swipeBackEnabled`/`scrollAssist` or the `switchTab('root',
  'replace')` semantics (they fixed a prior tab-highlight desync).
- No `DB_VERSION` bump, no migration, no server change — keep it that way.
- Commit per task or logical group; each checkpoint is a safe stopping point.
