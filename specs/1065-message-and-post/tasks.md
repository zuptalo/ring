---

description: "Task list for spec 1065 — Message and Post Audience Insight"
---

# Tasks: Message and Post Audience Insight

**Input**: Design documents from `/specs/1065-message-and-post/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/engagement-and-views.md), [checklists/crypto-zk.md](./checklists/crypto-zk.md)

**Tests**: REQUIRED. Constitution Principle III mandates TDD, so every behavioural task is preceded by a failing test. Pure functions are tested with vitest, server handlers with Go table tests against the in-memory fake store, and user-facing behaviour with Playwright.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Every task names exact file paths

## Path Conventions

Monorepo: Vue PWA at the repo root (`src/`, `e2e/`, `drive/`), Go server under `server/`.

---

## Phase 1: Setup

**Purpose**: One shared helper and one tidy-up that everything else leans on.

- [ ] T001 [P] Collapse the divergent local `ago()` in `src/views/detail/PostDetailPage.vue` (lines ~416-422) onto the canonical `ago()` in `src/utils/post-time.ts`, so every relative time in this feature formats identically
- [ ] T002 [P] Add the `AudienceRow` type to `src/db/types.ts` per data-model §4 (`id`, `name`, `avatar`, `when?`, `emoji?`, `note?`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared audience surface that FR-001 requires all four uses to share. Nothing in Phase 3 onward can land without it.

- [ ] T003 Write failing vitest for a pure paging helper in `src/utils/audience-page.test.ts`: a bounded first window, growth by a fixed step, a stable most-recent-first order with a deterministic tiebreak (FR-004, FR-005)
- [ ] T004 Implement `src/utils/audience-page.ts` to satisfy T003
- [ ] T005 [P] Create `src/components/AudienceRow.vue`: a stock `ion-item` with `ion-avatar` + `UserAvatar`, name, optional pre-formatted `when`, optional emoji in the start slot, optional `note`. Styled only with `--app-*` tokens from `src/theme/variables.css` (FR-003, Principle XI)
- [ ] T006 Create `src/components/AudienceSheet.vue`: a stock `ion-modal` with `:initial-breakpoint="0.6"` and `:breakpoints="[0, 0.6, 1]"`, copying the structure of `src/components/ChatListsSheet.vue`; renders a paged `ion-list` of `AudienceRow` driven by `audience-page.ts` and grown by `ion-infinite-scroll`; takes a title, a count, and rows; shows a plain empty state (FR-001, FR-002, FR-004, FR-006)
- [ ] T007 Retire `src/components/ReactionDetails.vue` onto `AudienceRow`, keying by user id rather than array index, and update its only caller `openReactionDetails` in `src/views/detail/ChatDetailPage.vue` (~line 2747) so chat reaction details keep working unchanged (FR-001)

**Checkpoint**: the shared surface exists and the existing chat reaction popover still behaves as before.

---

## Phase 3: User Story 1 — per-member receipt times (Priority: P1)

**Goal**: Every member row in a group message's tiers shows when it reached them and when they saw it, and each tier opens into the full list.

**Independent test**: Send to a group, have members receive and open at staggered times, open message info, confirm each member carries the right moment and each tier opens.

**No server change and no storage change.** `Message.receipts` already holds these timestamps.

- [ ] T008 [US1] Write failing vitest in `src/services/message-status.test.ts` for a pure `clampedSeen(receipt, message, now)`: a `seenAt` before that member's own `deliveredAt` clamps to `deliveredAt`; a `seenAt` before the message's `sentAt` clamps to `sentAt`; a future `seenAt` clamps to now; a sane value passes through; the tolerance is `CLOCK_SKEW_TOLERANCE_MS` (FR-034, data-model §4)
- [ ] T009 [US1] Implement `clampedSeen` in `src/services/message-status.ts` to satisfy T008, display-only, leaving stored receipts untouched (checklist CHK046)
- [ ] T010 [US1] Write failing vitest in `src/services/message-status.test.ts` for tier derivation from the **send-time roster**: a member added to the chat after the send appears in no tier; a member in `receipts` but absent from `participantIds` is flagged as having left (FR-011, research §R5)
- [ ] T011 [US1] Fix `notDeliveredIds` in `src/views/detail/MessageInfoPage.vue` (~line 417) to derive from `message.receipts` rather than the live `chat.participantIds`, and add the derived `hasLeftGroup` predicate (FR-011, research §R5)
- [ ] T012 [US1] Rewrite the three tiers in `src/views/detail/MessageInfoPage.vue` (~lines 131-192) as tappable summary rows: count, capped avatar preview, opening `AudienceSheet` with per-member rows carrying `clampedSeen`/`deliveredAt` formatted through `ago()`, a plain "Not yet" for undelivered, and a "no longer in this group" note where applicable (FR-002, FR-007, FR-008, FR-009, FR-011)
- [ ] T013 [US1] Keep the seen-receipts suppression intact: with `privacy.seenReceipts` off, no seen tier, no seen moments anywhere (FR-010)
- [ ] T014 [US1] Add `e2e/message-audience.spec.ts`: staggered group receipts, assert each tier's count and that opening a tier lists members with times; assert the post-send joiner does not appear under "Not yet delivered"; assert suppression with seen receipts off. First test to render `MessageInfoPage.vue` (SC-002)
- [ ] T015 [P] [US1] Add `drive/scenarios/audience-receipts.mjs` following the quickstart US1 script, with screenshots

**Checkpoint**: US1 is independently shippable.

---

## Phase 4: User Story 2 — author-only post view count (Priority: P1)

**Goal**: The author sees how many people have seen their post and who, stamped with each person's first sighting. Nobody else sees any of it.

**Independent test**: Post to several accounts, have some scroll past and some open, confirm the author's count and list, confirm non-authors see nothing including by direct request, confirm a repeat viewer keeps their first time.

**No server change.** The endpoint already returns `viewedAt` and already enforces strict author equality.

- [ ] T016 [US2] Fix `listPostViews` in `src/db/queries.ts` (~line 4526) to return `{viewer, viewedAt}` pairs instead of discarding the timestamp (FR-017)
- [ ] T017 [US2] Write failing vitest in `src/utils/feed-impression.test.ts` for the pure impression rule: at least half visible for a continuous 1000 ms counts; leaving before the dwell elapses does not; a post already reported never counts again (FR-014, FR-017a)
- [ ] T018 [US2] Implement `src/directives/seen-in-feed.ts` as a single module-level `IntersectionObserver` at `threshold: 0.5` with a per-element dwell timer, unobserving once reported, guarded by `'IntersectionObserver' in window`, following `src/directives/autoplay-visible.ts` (FR-014, research §R10)
- [ ] T019 [US2] Add the persisted already-reported set (`wall.viewsReported`) in `src/db/queries.ts`, bounded and pruned by `sweepExpiredPosts`, so a post costs one request for all time (FR-017a, data-model §1)
- [ ] T020 [US2] Wire the directive into the feed rows in `src/views/tabs/WallPage.vue` (~line 103) calling `recordPostView`, preserving the existing early return on your own post (FR-014, FR-017b)
- [ ] T021 [US2] Add the author-only "Seen by N" row to `src/views/detail/PostDetailPage.vue`, replacing the comma-joined "Viewed by" line (~line 143), opening `AudienceSheet` with viewers and their first-seen moments; wording must not imply total reach (FR-012, FR-016, FR-017)
- [ ] T022 [US2] Add the same author-only summary to the feed card in `src/views/tabs/WallPage.vue`, fetched lazily so the feed does not issue a request per own-post on render (FR-012, FR-036)
- [ ] T023 [US2] Add `e2e/post-audience.spec.ts` part one: author sees the count and list with times; a non-author sees nothing and receives 403 from a direct request; a repeat viewer does not change the count or the stamp; the author is absent from their own list (SC-004, SC-005, FR-017b)
- [ ] T024 [P] [US2] Add `drive/scenarios/post-views.mjs` per the quickstart US2 script, including the fast-scroll negative case

**Checkpoint**: US2 is independently shippable.

---

## Phase 5: User Story 3 — attributed post reactions (Priority: P2)

**Goal**: The author can open a post's reactions and see who reacted, with what, and when.

- [ ] T025 [US3] Write failing vitest in `src/utils/reaction-groups.test.ts`: grouping by emoji ordered most-used first; a person who changed emoji appears once with the current one and the change moment; a removed reaction is absent from both list and count (FR-020, FR-021, FR-022)
- [ ] T026 [US3] Implement the grouping helper in `src/utils/reaction-groups.ts` to satisfy T025
- [ ] T027 [US3] Make the reaction pills in `src/views/detail/PostDetailPage.vue` (~lines 94-99) open `AudienceSheet` for the author only, grouped by emoji; non-authors keep today's tap-to-toggle with no sheet (FR-018, FR-019)
- [ ] T028 [US3] Add the FR-033a honesty note to the code as a comment where attribution is gated, recording that this is a presentation rule over data the whole audience holds, not a server-enforced protection (checklist CHK031)
- [ ] T029 [US3] Extend `e2e/post-audience.spec.ts` with part two: attributed list for the author, emoji change collapses to one row, removal disappears, non-author sees only pills (SC-003)

**Checkpoint**: US3 shippable.

---

## Phase 6: Server engagement paging (Foundational for Phase 7)

**Purpose**: Bounded engagement loading. Lands before threads so replies never depend on an unbounded fetch.

- [ ] T030 Add `server/internal/db/migrations/0030_engagement_paging.sql` creating `post_engagement_page_idx (post_id, created_at, id)` and dropping `post_engagement_post_idx`, forward-only (Principle VI, research §R6)
- [ ] T031 Write failing Go tests in `server/internal/api/posts_handlers_test.go` for paging per contract §7: `limit` caps the page; `before` walks backwards with no gaps or repeats across rows sharing a `created_at`; an unparseable `before` and an out-of-range `limit` are 400s; a request with neither param still returns a working `items` array
- [ ] T032 Implement keyset paging in `ListEngagement` in `server/internal/store/posts.go` (~line 512), newest-first with the `(created_at, id)` tiebreak
- [ ] T033 Implement `limit`/`before` parsing and the `{items, cursor, hasMore}` response in `listEngagement` in `server/internal/api/posts_handlers.go` (~line 407), keeping the existing `CanSeePost` gate (contract §1)
- [ ] T034 Add the paging params to `apiListEngagement` in `src/services/api.ts` (~line 205) and make `syncEngagement` in `src/db/queries.ts` (~line 4225) fetch a bounded page instead of the whole history, with on-demand reach-back when a reply's parent is older than the window (FR-035, FR-031a)
- [ ] T035 Stop `src/composables/useWall.ts` (~line 49) holding every engagement row for every post in memory to render feed summaries (FR-036)

**Checkpoint**: `go test ./...` green, feed and post open with bounded fetches.

---

## Phase 7: User Stories 4 and 5 — comment replies and comment reactions (Priority: P2, P3)

**Goal**: Reply to a specific comment and react to a specific comment, with the parent reference sealed.

**This is the phase the crypto/ZK checklist governs.** Tasks T036-T041 are the zero-knowledge core and must land before any UI.

- [ ] T036 [US4] Write failing vitest in `src/services/crypto/post.test.ts` for constant-length reaction padding: every sealed reaction produces the same ciphertext length whether or not it carries a parent; an over-budget payload is refused rather than sent unpadded or truncated; the emoji length bound is enforced (FR-031d, checklist CHK014-CHK018)
- [ ] T037 [US4] Implement the padding constant and the pad/refuse logic in `src/services/posts.ts` and `src/services/crypto/post.ts`, applied to every reaction including post-level ones (FR-031d)
- [ ] T038 [US4] Add `parent?: string` to `PostEngagement` in `src/db/types.ts`, and to `CommentData` and `ReactionData` in `src/db/queries.ts`, sealed only. No `DB_VERSION` bump: it is an optional field on an existing store (data-model §1, Principle V)
- [ ] T039 [US4] Write failing vitest for the one-level nesting invariant: replying to a reply stores the top-level ancestor as `parent`, so the stored tree is never deeper than one level (FR-025, data-model §1, checklist CHK022)
- [ ] T040 [US4] Implement `replyToComment` in `src/db/queries.ts` alongside `commentOnPost` (~line 4471), resolving the ancestor per T039, sealing `parent`, and keeping `kind: 'comment'` on the wire so the server sees no new row type (FR-023, FR-025, research §R7)
- [ ] T041 [US5] Implement comment reactions in `src/db/queries.ts` alongside `reactToPost` (~line 4160), local id `${postId}:reaction:${actor}:${parent}:${emoji}`, sealing `parent`, keeping `kind: 'reaction'` (FR-024, data-model §1)
- [ ] T042 [US4] Write failing Go tests in `server/internal/api/posts_handlers_test.go` for the `notify` hint per contract §7: a non-audience entry is a 400 with no push sent; three entries is a 400; the actor is stripped; a valid hint pushes to exactly `{author} ∪ notify` deduplicated; `notify` never appears in the stored row; `notify` is never written to a log line (FR-031b, checklist CHK004, CHK011, CHK045)
- [ ] T043 [US4] Implement `Notify []string` on `engagementReq` and its validation and push routing in `server/internal/api/posts_handlers.go` (~lines 226, 359-393), reusing `NotifyPostActivity` and the existing `activity` class so recipients' opt-outs keep working (contract §2, research §R8)
- [ ] T044 [US4] Send the wake hint from `replyToComment`: the post owner, plus the person answered, deduplicated, never yourself (FR-029a, FR-029b)
- [ ] T045 [US4] Write failing vitest in `src/services/wall-activity-policy.test.ts` for the extended predicate: a reply answering my comment alerts me even though the post is not mine; my own reply alerts nobody; a muted post stays silent; the post owner answered on their own post gets one alert, not two (FR-029a, FR-029b)
- [ ] T046 [US4] Extend `wallActivityAlert` in `src/services/wall-activity-policy.ts` (~line 48) with the "answers my comment" input, keeping it pure (research §R12)
- [ ] T047 [US4] Extend `classifyPostActivity` in `src/services/sw-inbox.ts` (~line 1774) to open comment payloads and read the sealed parent, so a closed app can say "replied to you"; on a missing post key or a failed decrypt, fall through to the generic rather than guessing, and stay inside the wake deadline (research §R9, §R12, checklist CHK038, CHK041)
- [ ] T048 [US4] Write failing vitest for FR-029c: deleting a comment produces exactly one deletion marker for the comment itself and none for its reactions, and each device drops that comment's reactions locally from the sealed parent (checklist CHK021)
- [ ] T049 [US4] Implement FR-029c in `deleteComment` in `src/db/queries.ts` (~line 4499) and in the render path (FR-027, FR-029, FR-029c)
- [ ] T050 [US4] Create `src/components/CommentThread.vue`: one-level nesting, replies in send order under their parent, a bounded number shown with a plain way to reveal the rest, a "This comment was deleted" placeholder that keeps replies readable, and held replies attaching when their parent arrives (FR-023, FR-026, FR-027, FR-028)
- [ ] T051 [US4] Wire `CommentThread` into `src/views/detail/PostDetailPage.vue` (~lines 102-141), replacing the flat list, with a reply affordance per comment that names who is being answered (FR-023, FR-025)
- [ ] T052 [US5] Add the per-comment reaction tally to `CommentThread`, opening `AudienceSheet` for the comment's own author and the post owner only, tally-only for everyone else (FR-024, FR-022a)
- [ ] T053 [US4] Add `e2e/comment-threads.spec.ts`: reply attaches for every audience device; a reply to a reply stays at one level and names who it answers; a deleted parent keeps its replies under a placeholder; comment reactions tally on the right comment only; attribution visibility matches FR-022a (SC-006)
- [ ] T054 [P] [US4] Add `drive/scenarios/comment-threads.mjs` per the quickstart US4/US5 script

**Checkpoint**: US4 and US5 shippable.

---

## Phase 8: Polish and Cross-Cutting

- [ ] T055 [P] Run the quickstart zero-knowledge check against the dev database and confirm uniform reaction payload lengths, no new `kind` value, `target` null except on tombstones, and no `notify` column (SC-007, quickstart §ZK check)
- [ ] T056 [P] Confirm every list, tier, and thread has a written empty state, and review all new copy for the house voice: no em-dashes, no semicolons, no internal jargon (SC-011, FR-006)
- [ ] T057 [P] Scale pass per SC-003 and SC-008: a post with several hundred reactions and comments opens with a bounded window and the author's viewer list pages rather than loading whole
- [ ] T058 [P] Accessibility and bidi pass on the new sheet and thread rows: labels, focus order, mixed RTL/LTR names (Principle X)
- [ ] T059 Docker Scout review of the current published image; apply any vulnerability that has a fix version and let it ride this branch as a `fix`/`security` commit (constitution, Development Workflow)
- [ ] T060 Flip `**Status**:` in `specs/1065-message-and-post/spec.md` to `shipped` and run `make roadmap`

---

## Dependencies

```
Phase 1 (setup)
  └─> Phase 2 (shared audience surface)   BLOCKS everything below
        ├─> Phase 3  US1   independent, no server, no storage
        ├─> Phase 4  US2   independent, no server
        ├─> Phase 5  US3   needs Phase 2 only
        └─> Phase 6 (server paging)
              └─> Phase 7  US4 + US5
                    └─> Phase 8 (polish)
```

- US1, US2, and US3 are mutually independent once Phase 2 lands, and each is shippable alone.
- US5 depends on US4 only for the parent mechanism (T038, T041).
- Phase 6 must precede Phase 7 so threads never rest on an unbounded fetch.

## Parallel opportunities

- **Phase 1**: T001 and T002 together.
- **Phase 2**: T005 alongside T003/T004.
- **Across stories**: once Phase 2 lands, Phase 3, Phase 4, and Phase 5 can proceed in parallel by different people, touching mostly different files. The one shared file is `PostDetailPage.vue` (T021, T027, T051), so sequence those three.
- **Phase 7**: the server side (T042, T043) is parallel to the client crypto side (T036-T041).
- **Phase 8**: T055 through T058 all in parallel.

## Implementation strategy

**MVP is Phase 1 + Phase 2 + Phase 3.** That delivers the original request, per-member delivered and seen times on group messages, with no server change, no storage change, and no wire change. It could ship on its own.

**Second increment: Phase 4.** Author-only post view counts, still with no server change.

**Everything after that** is additive and can be cut without invalidating what shipped before it.

## Task count

60 tasks: 2 setup, 5 foundational, 8 US1, 9 US2, 5 US3, 6 server paging, 19 US4/US5, 6 polish.
