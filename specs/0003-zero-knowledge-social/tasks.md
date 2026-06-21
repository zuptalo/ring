---
description: "Task list for feature implementation"
---

# Tasks: Zero-Knowledge Social Wall

**Input**: Design documents from `/specs/0003-zero-knowledge-social/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md

**Tests**: REQUIRED. Constitution Principle III mandates TDD (failing tests before implementation) and
Principle IV mandates forgery/replay/out-of-order/skipped-key tests for new crypto. Test tasks are
ordered before the implementation they cover.

**Organization**: Grouped by user story (spec priorities). US1 is largely *reuse* of the existing
`connections` subsystem; the heavy lifting is US2–US7 (posts + engagement).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US7 (foundational/setup/polish carry no story label)

## Path Conventions

Web app, single repo/image: client `src/…`, server `server/internal/…`, e2e `e2e/…`.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Register lazy routes for the new pages in `src/router/index.ts` (`/wall`, `/wall/compose`, `/wall/post/:id`, `/settings/close-friends`) behind the auth gate, mirroring existing detail-route patterns.
- [ ] T002 [P] Add a Wall entry point to navigation (tab or You-tab link) using stock Ionic, consistent with existing tabs; no behavior yet.
- [ ] T003 [P] Create the e2e spec skeleton `e2e/wall.spec.ts` (describe blocks for friend→post→view→react→comment→expire, all `test.skip` initially).
- [ ] T004 [P] Create the drive scenario skeleton `drive/scenarios/wall.mjs` for manual exercise against `make start`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Blocks ALL user stories. Covers storage, the server skeleton, and the pure post-crypto core.

### Client storage & types

- [ ] T005 Bump `DB_VERSION` 8→9 and add `posts` + `postEngagement` object stores (keyPath `id`) in `src/db/idb.ts` `onupgradeneeded`, preserving existing data (Principle V).
- [ ] T006 [P] Add `Post`, `PostEngagement`, and `ViewReceipt` types and extend `Contact` with `closeFriend?: boolean` in `src/db/types.ts` per data-model.md.
- [ ] T007 [P] Add `posts`/`postEngagement` to any store-iteration lists (e.g. `clearStore`/`STORES` wipe sets, expiry-sweep store lists) so account-delete and sweeps include them.

### Server schema & store skeleton

- [ ] T008 Create forward-only migration `server/internal/db/migrations/0021_posts.sql` with tables `posts`, `post_envelopes`, `post_engagement`, `post_views` (opaque columns only) per data-model.md — no edits to shipped migrations (Principle VI).
- [ ] T009 [P] Add the `PostStore` interface to `server/internal/api/router.go` (create/list/delete posts; submit/list engagement; record/list views; with audience+block authorization helpers) at the call site.
- [ ] T010 Implement `PostStore` on `*store.Store` in `server/internal/store/posts.go` (queries against the new tables; fan-out reads `post_envelopes`).
- [ ] T011 [P] Add a fake `PostStore` to the server test harness so handler tests need no DB (mirror existing fake-store pattern).

### Pure post-crypto core (TDD — tests first)

- [ ] T012 [P] Write FAILING unit tests `src/services/crypto/post.test.ts` for: post payload seal/open round-trip; per-recipient `K_post` wrap/unwrap over a Double-Ratchet session; tamper/forgery rejection; replay; out-of-order; skipped-key (Principle IV, Spec §NFR-ZK-2).
- [ ] T013 Implement `src/services/crypto/post.ts` pure helpers (`sealPost`/`openPost`, `wrapPostKey`/`unwrapPostKey`) reusing existing libsodium primitives + the `senderkeys.ts` per-recipient pattern — no new schemes (Principle IV) — until T012 passes (green).
- [ ] T014 [P] Create `src/services/posts.ts` orchestration skeleton (crypto-only; imports `crypto/post.ts`, `media-transfer.ts`; NO chats/contacts store writes — preserve the one-directional `queries.ts → posts.ts` dependency, Principle IV).

**Checkpoint**: storage migrated, server skeleton routable, post-crypto green. User stories can begin.

---

## Phase 3: User Story 1 - Build a friends list with requests (Priority: P1) 🎯 MVP foundation

**Goal**: A mutual friends list via request/accept, reusing the existing `connections` subsystem.

**Independent Test**: A sends a request, B accepts → both list each other as friends; decline/cancel/
block reach correct end states (spec US1).

### Tests for US1

- [ ] T015 [P] [US1] Extend `e2e/wall.spec.ts` with a friend-request acceptance + decline + block scenario (un-skip), asserting both sides' friend lists.
- [ ] T016 [P] [US1] Add a server test in `server/internal/api/connections_handlers_test.go` for FR-007 repeat-request rate-limiting after decline/block.

### Implementation for US1

- [ ] T017 [US1] Add a `listFriends()` query in `src/db/queries.ts` returning contacts whose peer is an accepted connection (derive from `connectedPeers` ledger / `Connected`), as the audience source for posts.
- [ ] T018 [US1] Enforce FR-007 repeat-request rate-limiting in `server/internal/store/connections.go` / `connections_handlers.go` using routing metadata only (no content) until T016 passes.
- [ ] T019 [P] [US1] Confirm/adjust the Contacts-page friend-request UI copy in `src/views/tabs/ContactsPage.vue` to read as "friends" consistently (reuse existing accept/decline/cancel actions).

**Checkpoint**: Friendship works end-to-end (mostly pre-existing); `listFriends()` available for audiences.

---

## Phase 4: User Story 2 - Compose and share a post to friends (Priority: P1) 🎯 MVP

**Goal**: Author composes text/voice/video/image posts to "all friends" with a chosen lifetime; only
the audience receives them, E2EE.

**Independent Test**: With a friendship, author posts each media type; only audience members receive
and decrypt; the server holds no readable content (spec US2).

### Tests for US2

- [ ] T020 [P] [US2] Write FAILING `server/internal/api/posts_handlers_test.go` (fake store): `POST /v1/posts` stores blob+envelopes and rejects non-friend/blocked recipients; `GET /v1/posts` returns the caller's envelope; `DELETE` is author-only.
- [ ] T021 [P] [US2] Add a vitest for `src/services/posts.ts` create/open flow (audience envelope construction over `listFriends()`; media-ref sealed inside the payload).
- [ ] T022 [P] [US2] Un-skip the e2e "post to all friends" path asserting audience-only delivery and a non-friend seeing nothing; cover **all four media types** (text, voice, video, image) rendering for the audience (Spec §SC-004).

### Implementation for US2

- [ ] T023 [US2] Implement `posts_handlers.go` (`POST /v1/posts`, `GET /v1/posts?since=`, `DELETE /v1/posts/{id}`) + routes per contracts/http-api.md, enforcing recipient∈friends and not-blocked, until T020 passes.
- [ ] T024 [P] [US2] Add client API calls `createPost`/`listPosts`/`deletePost` in `src/services/api.ts` matching the contract.
- [ ] T025 [US2] Implement post create in `src/services/posts.ts`: gen `K_post`, seal payload (text + media-ref), upload post blob via `media-transfer.ts`, wrap `K_post` per audience member, call `createPost` (until T021 passes).
- [ ] T026 [US2] Implement post receive/open in `src/services/posts.ts`: unwrap `K_post` from the caller envelope, open payload, persist a `Post` (+ media via existing pipeline) through `src/db/queries.ts`.
- [ ] T027 [US2] Add post orchestration to `src/db/queries.ts` (`createPost`, `receivePost`, `deletePost`) writing to the `posts` store and firing the change bus (queries.ts → posts.ts only). **Offline-first (Spec §FR-016)**: a created post is persisted + queued locally and flushed via the existing outbox/retry path on reconnect.
- [ ] T028 [P] [US2] Add WS `post-new` content-free nudge handling: emit in `posts_handlers.go`; on the client, pull `listPosts` in `src/composables/useSync.ts` on receipt.
- [ ] T029 [US2] Build `src/views/detail/PostComposerPage.vue` (Ionic): text + audience segment (all-friends/close) + lifetime select (24h/7d/keep) + reuse existing media capture/attach for voice/video/image; submit via queries. Text input is bidi-aware (`dir=auto`, reusing the chat-composer approach) per Principle X.
- [ ] T030 [US2] Wire lifetime: set `expiresAt` on the post and extend the existing disappearing-message sweep (`useSync.ts`) to prune expired `posts`/`postEngagement`; add coarse server-side expiry pruning in `posts.go`; **add an e2e assertion that a 24h post disappears for author and viewers after expiry** (Spec §FR-012/FR-023/SC-005).
- [ ] T031 [US2] Enforce FR-008 per-author post-rate limiting in `posts_handlers.go` using routing metadata only.

**Checkpoint**: Posting to all friends works for all media types with lifetime; audience-only, E2EE.

---

## Phase 5: User Story 3 - View friends' posts in a Wall feed (Priority: P1) 🎯 MVP

**Goal**: A reactive Wall feed of received posts with author profile, newest-first.

**Independent Test**: Given posts addressed to the viewer, the Wall lists exactly those with correct
author identity, excludes non-audience posts, updates live (spec US3).

### Tests for US3

- [ ] T032 [P] [US3] Un-skip the e2e Wall-view assertions: feed shows audience posts with author avatar/name/username, excludes non-audience, updates without manual refresh.

### Implementation for US3

- [ ] T033 [P] [US3] Create `src/composables/useWall.ts`: `useLiveQuery` over the `posts` store, newest-first, hydrating author profile from contacts/directory (respecting profile-privacy per FR-022).
- [ ] T034 [US3] Build `src/views/tabs/WallPage.vue` (Ionic list/cards) rendering text + reused media bubbles; reactive via `useWall`.
- [ ] T035 [US3] Build `src/views/detail/PostDetailPage.vue` shell (full-screen post; reaction/comment/view sections added in later stories).

**Checkpoint**: MVP complete — friends → post → view loop works end-to-end.

---

## Phase 6: User Story 4 - React to posts; the audience sees reactions (Priority: P2)

**Goal**: Audience-visible reactions via server fan-out to the post's audience.

**Independent Test**: A viewer reacts; the author and all audience members see the reactor + emoji;
change/remove updates everyone (spec US4).

### Tests for US4

- [ ] T036 [P] [US4] Write FAILING crypto tests in `src/services/crypto/post.test.ts` for engagement seal/open under `K_post`, incl. non-member-key forgery + replay + out-of-order.
- [ ] T037 [P] [US4] Write FAILING `posts_handlers_test.go` engagement cases: fan-out to the post's `post_envelopes` set; reject non-audience/blocked submitters.
- [ ] T038 [P] [US4] Un-skip e2e reaction scenario (audience-visible; offline-author still delivers).

### Implementation for US4

- [ ] T039 [US4] Add `sealEngagement`/`openEngagement` to `src/services/crypto/post.ts` (reuse `K_post`) until T036 passes.
- [ ] T040 [US4] Implement `POST/GET /v1/posts/{id}/engagement` in `posts_handlers.go` with audience+block authz and fan-out to the post's recipient set; FR-008 per-user engagement-rate limit (until T037 passes).
- [ ] T041 [P] [US4] Add client API `submitEngagement`/`listEngagement` in `src/services/api.ts`.
- [ ] T042 [US4] Reaction orchestration in `src/db/queries.ts` + `posts.ts`: seal reaction under `K_post`, submit, persist to `postEngagement`; apply existing reaction caps + LWW-per-actor.
- [ ] T043 [P] [US4] Add WS `post-engagement` nudge (emit server-side; pull `listEngagement` in `useSync.ts`).
- [ ] T044 [US4] Reaction UI on `PostDetailPage.vue`/`WallPage.vue`: emoji react bar + reactor list (profiles), composed from Ionic.

**Checkpoint**: Audience-visible reactions work, author-online-independent.

---

## Phase 7: User Story 5 - Curate a close-friends list (Priority: P2)

**Goal**: An author-private close-friends subset usable as a narrower audience.

**Independent Test**: Mark some friends close; a "close friends" post reaches exactly that set, no
other friend; membership never leaves the device (spec US5).

### Tests for US5

- [ ] T045 [P] [US5] Un-skip e2e close-friends scenario: close post reaches only close friends; a non-close friend sees nothing; assert no `closeFriend` in any request body / server table; assert an engaging viewer **cannot enumerate the audience roster** beyond co-engagers (Spec §SC-010).

### Implementation for US5

- [ ] T046 [US5] Implement `setCloseFriend(id, bool)` + `listCloseFriends()` in `src/db/queries.ts` (writes `Contact.closeFriend`; rides existing encrypted own-sync — never sent to server).
- [ ] T047 [P] [US5] Build `src/views/detail/CloseFriendsPage.vue` (Ionic toggles over the friends list).
- [ ] T048 [US5] Wire the composer's "close friends" audience to encrypt to `listCloseFriends()` only (envelopes restricted to that subset).

**Checkpoint**: Close-friends audience works and stays author-private.

---

## Phase 8: User Story 6 - Comment on a post (audience-visible thread) (Priority: P3)

**Goal**: Audience-visible text comments with deletion by commenter or post author.

**Independent Test**: A viewer comments; author + audience see it attributed/ordered; commenter and
author can delete (spec US6).

### Tests for US6

- [ ] T049 [P] [US6] Extend `posts_handlers_test.go` for comment + tombstone fan-out and author/commenter delete authorization.
- [ ] T050 [P] [US6] Un-skip e2e comment scenario (post + delete by commenter and by post author).

### Implementation for US6

- [ ] T051 [US6] Comment orchestration in `queries.ts` + `posts.ts`: seal comment under `K_post`, submit `kind:'comment'`, persist ordered (timestamp + id tiebreak); deletion as `kind:'tombstone'` by commenter or post author (until T049 passes).
- [ ] T052 [US6] Comment thread UI on `PostDetailPage.vue` (Ionic): list + bidi-aware (`dir=auto`) input + per-comment delete affordances respecting authorization (Principle X).

**Checkpoint**: Audience-visible comments with moderation work.

---

## Phase 9: User Story 7 - See who viewed a post (Priority: P3)

**Goal**: Author-only per-post view list, gated reciprocally by seen-receipts.

**Independent Test**: A receipts-on viewer appears in the author's view list; a receipts-off viewer
does not and gets no view list on their own posts (spec US7).

### Tests for US7

- [ ] T053 [P] [US7] Add `posts_handlers_test.go` cases: `POST /view` records; `GET /views` is author-only (403 otherwise).
- [ ] T054 [P] [US7] Un-skip e2e view-receipt scenario incl. the seen-receipts-off reciprocity.

### Implementation for US7

- [ ] T055 [US7] Implement `POST /v1/posts/{id}/view` + author-only `GET /v1/posts/{id}/views` in `posts_handlers.go` (until T053 passes).
- [ ] T056 [US7] Client: on opening a post, if `privacy.seenReceipts` is on, send a view receipt; gate view-list display reciprocally (mirror `useSync.ts` seen-receipt reciprocity) in `posts.ts`/`useWall.ts`.
- [ ] T057 [US7] View-list UI on `PostDetailPage.vue` for the author only (Ionic).

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T058 [P] Add real, wired post/Wall settings to `src/settings/schema.ts` (default post audience; post/reaction/comment notification toggles) replacing the removed placeholder "Status" rows (Spec §FR-050).
- [ ] T059 Wire post/engagement notifications through the existing model (`src/services/notify*`, `src/sw.ts`) honoring per-item preview privacy and the new settings (Spec §FR-051).
- [ ] T060 [P] Add unfriend/close-friend-removal + post-delete UI copy reflecting the no-clawback limitation (Spec §Edge Cases).
- [ ] T061 Run the crypto/ZK checklist (`checklists/crypto-zk.md`) against the implementation and obtain the required security review (Constitution Principle IV).
- [ ] T062 [P] Run `quickstart.md` validation (ZK spot-checks on Postgres; non-audience negative case).
- [ ] T063 Quality gates: `npm run build`, `cd server && go build ./... && go vet ./... && go test ./...`, vitest + floors, `npm run test:e2e` green (Constitution VII).

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2, BLOCKS all)** → user stories.
- **US1 (P1)**: independent (reuse). **US2 (P1)**: needs Foundational. **US3 (P1)**: needs US2 (posts to view). **US4 (P2)**: needs US2. **US5 (P2)**: needs US2 (audience). **US6 (P3)**: needs US2 + US4 engagement infra. **US7 (P3)**: needs US2.
- **Polish (P10)**: after the desired stories.

### Within a story

- Tests FIRST and FAILING before implementation (Principles III/IV).
- Models/types → services/crypto → endpoints → UI → integration.

### Parallel opportunities

- Setup T002–T004 parallel. Foundational T006/T007, T009/T011, T012 parallel where files differ.
- Per story, `[P]` test tasks run together; client API + server handler tasks for the same story can
  proceed in parallel by different people.

---

## Implementation Strategy

### MVP (Stories US1–US3)

Setup → Foundational → US1 (friendship reuse) → US2 (posting) → US3 (Wall feed). STOP and validate the
friends→post→view loop independently before P2/P3.

### Incremental

Add US4 (reactions) → US5 (close friends) → US6 (comments) → US7 (views), each independently testable,
then Polish (settings/notifications/security review/gates).

## Notes

- `[P]` = different files, no incomplete dependency. `[Story]` = traceability to spec.
- Commit after each task or logical group; keep `queries.ts → posts.ts` one-directional (no cycle).
- Every crypto task carries the adversarial test set; every handler task carries fake-store authz tests.
- The crypto/ZK checklist + maintainer security review (T061) gate `merge` per the constitution.
