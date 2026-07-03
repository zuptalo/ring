# Tasks: Wall notifications go to the owner only

**Input**: Design documents from `/specs/1031-wall-notifications-only/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/push-and-handlers.md

**Tests**: REQUIRED — constitution Principle III (TDD): every phase orders failing tests
before the implementation that turns them green (Red → Green → Refactor).

**Organization**: grouped by user story; US1 alone is a shippable MVP (the noise fix).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 from spec.md

---

## Phase 1: Setup

**Purpose**: mark the work in progress; no scaffolding is needed (no new projects,
stores, or migrations).

- [x] T001 Set `**Status**: in-progress` in specs/1031-wall-notifications-only/spec.md and run `make roadmap` to regenerate ROADMAP.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared pieces every story builds on — the new push type, the pure alert
predicate, and the engagement-sync return value. Tests first.

- [x] T002 [P] Write FAILING Go tests in server/internal/api/posts_handlers_test.go: extend the recording fake notifier with `NotifyPostActivity(ctx, userID, postID)` and assert the contract in specs/1031-wall-notifications-only/contracts/push-and-handlers.md — comment by B on A's post → exactly one activity push to A (and NO `NotifyPost` push to anyone); reaction by B → one activity push to A; tombstone → no push; self-engagement by A → no push; audience member C never pushed; WS `post-engagement` frames unchanged (all audience except actor) in every case
- [x] T003 [P] Write FAILING vitest tests in src/services/wall-activity-policy.test.ts covering every predicate rule: alerts only when `isOwnPost`; actor === self → skip; type `view` or `deleted` (removal/tombstone) → skip; stale (> 5 min) → skip; `activityEnabled` false → skip; `tempMuted` true → skip; `alreadyNotified` → skip; fresh comment and fresh reaction on own post → alert; per-user mute is NOT an input (posts-only, per clarification)
- [x] T004 Add `NotifyPostActivity(ctx, userID, postID string)` to server/internal/push/push.go with payload `{"t":"post-activity","post":"<id>"}` and per-post collapse topic (base64url SHA-256 prefix of postID, ≤32 chars; TTL/urgency mirroring the post tickle), and add the method to the `ws.Notifier` interface in server/internal/ws/ (plus the `fakeNotifier` implementations in server/internal/ws/*_test.go so the package still compiles)
- [x] T005 Change `submitEngagement` in server/internal/api/posts_handlers.go per the contract: keep the WS fan-out as is; drop the `req.Kind == "comment"` audience push; for `kind ∈ {reaction, comment}` resolve `h.Posts.PostAuthor` and call `h.Notifier.NotifyPostActivity(ctx, author, postID)` only when `author != uid`; a `PostAuthor` error skips the push without failing the request → T002 goes green; run `cd server && go build ./... && go vet ./... && go test ./...`
- [x] T006 Implement the pure predicate module src/services/wall-activity-policy.ts (dependency-free, mirroring src/services/notify-policy.ts style: typed input struct, single exported function returning 'alert' | 'skip', why-comments) → T003 goes green; run `npm run test:unit -- wall-activity-policy`
- [x] T007 Make `syncEngagement` in src/db/queries.ts return the engagement items it newly applied (`{type, actor, emoji?, text?, at, deleted?}[]`, additive — existing callers in src/composables/useSync.ts, src/db/queries.ts:2581 and src/services/testhook.ts ignore the return value and keep working); run `npm run build`

**Checkpoint**: server routes activity pushes to owners only; the alert decision exists
and is unit-proven; nothing user-visible yet.

---

## Phase 3: User Story 1 — Stop notifying people about posts they don't own (P1) 🎯 MVP

**Goal**: comments alert ONLY the post owner — in-app banner when open, system
notification when closed; bystanders (audience, other commenters) get silence but still
see the content. This alone removes the reported noise.

**Independent Test**: 3 accounts — A posts, B comments → A banners, B and C show nothing;
C still sees the comment on the post (quickstart.md steps 1–3).

### Tests for User Story 1 (write first, must FAIL)

- [ ] T008 [P] [US1] Write FAILING Playwright spec e2e/wall-activity-notify.spec.ts (style of e2e/wall.spec.ts, 3 contexts, no WebRTC): A posts; B comments → A shows an in-app banner naming B with "commented on your post"; B shows no banner; C shows no banner; C's post detail still shows the comment (FR-003/FR-005, TC-02)
- [x] T009 [P] [US1] Write FAILING vitest tests in src/services/sw-inbox.postactivity.test.ts for the comments path of `previewPostActivity` (mirror src/services/sw-inbox.preview.test.ts's fetch/IDB mocking): fresh comment by another actor on an `outgoing` post → one note titled with the actor's name, body "commented on your post", url `/wall/post/<id>`, tag `ring:post:act:<id>`; actor === self → no note; post missing or not `outgoing` → no note; already in the `sw.wallActShown` ledger → no note; older than 10 min → no note; displayed notes are added to the ledger

### Implementation for User Story 1

- [x] T010 [US1] Add `notifyPostActivity(postId, fresh)` to src/db/queries.ts beside `notifyNewPost`: consult the T006 predicate per fresh item (inputs: post.outgoing, actor vs `getSelfUserId()`, `notifications.wall.activity` setting, `isWallTempMuted()`, 5-min freshness, session `notifiedEngagementIds` dedupe set); on 'alert' resolve the actor's contact name/avatar and `notifyIncoming({ kind:'system', name, body:'commented on your post', avatar, url:'/wall/post/<postId>' })`
- [x] T011 [US1] Wire src/composables/useSync.ts `post-engagement` branch: `const fresh = await syncEngagement(f.post); void notifyPostActivity(f.post, fresh)` (serialize inside the existing async IIFE pattern like the `post-new` branch)
- [x] T012 [US1] Implement the comments path of `previewPostActivity(postId)` in src/services/sw-inbox.ts beside `previewPosts`: read the post row from IDB (require `outgoing` + skip otherwise), GET `/v1/posts/{id}/engagement` with the session token, filter cleartext-`kind` comment rows by actor ≠ self + 10-min recency + `sw.wallActShown` ledger (CONN_SHOWN_KEY-style cap/prune), name actors via `connName`, collapse to one actor-named note (or "New activity on your post" when several actors) → T009 comments cases go green
- [ ] T013 [US1] Extend src/sw.ts: `pushKind()` recognizes `{t:'post-activity', post}`; new push branch — live clients get `postMessage({type:'ring:posts'})` and the SW stays silent; no clients → honor `setting('notifications.wall.activity', true)` → `previewPostActivity(post)` → `showConnNotes`-style display with tag `ring:post:act:<postId>`; update the `showPostNotification`/`previewPosts` doc comments to "new posts only" (engagement no longer rides the `post` tickle); run `npm run build` and `npm run test:e2e -- wall-activity-notify` → T008 goes green

**Checkpoint**: the reported problem is fixed end-to-end for comments; US1 is shippable.

---

## Phase 4: User Story 2 — The owner hears about reactions on their post (P2)

**Goal**: reactions alert the owner (in-app and closed-app), removals and emoji churn
never do, bursts coalesce.

**Independent Test**: B reacts 👍 to A's post → A banners "reacted 👍 to your post";
B removes it → silence; A's closed device shows the reaction notification (quickstart.md
steps 4–5, 8).

### Tests for User Story 2 (write first, must FAIL)

- [x] T014 [P] [US2] Extend src/services/sw-inbox.postactivity.test.ts with FAILING reaction cases: fresh reaction row whose sealed payload opens with `remove: false` → note "reacted to your post"; `remove: true` → no note; payload that fails to open (locked/cold) → no note (never spurious); mixed fresh comment + reaction from different actors → single collapsed "New activity on your post" note
- [ ] T015 [P] [US2] Extend e2e/wall-activity-notify.spec.ts with FAILING scenarios: B reacts → A banners naming B and the emoji; C and B show nothing; B removes the reaction → no new banner for A (TC-01, FR-002)

### Implementation for User Story 2

- [x] T016 [US2] Implement the reactions path of `previewPostActivity` in src/services/sw-inbox.ts: open reaction payloads with `openPostEngagement` under the post row's `postKey` (libsodium is already initialized for message previews — reuse that init/await pattern), skip `remove: true` and undecryptable payloads, include survivors in the collapse logic → T014 goes green
- [x] T017 [US2] Reaction banner copy in src/db/queries.ts `notifyPostActivity`: body `reacted <emoji> to your post` for fresh non-deleted reactions (the T006 predicate already skips removals since `deleted` is set on the applied row); confirm `syncEngagement`'s fresh-items include `emoji` and `deleted`; run `npm run test:e2e -- wall-activity-notify` → T015 goes green

**Checkpoint**: owners get the full engagement picture; removals stay silent everywhere.

---

## Phase 5: User Story 3 — Self-actions silent, settings respected (P3)

**Goal**: the "Activity on your posts" toggle exists, roams via own-data sync, and gates
everything; self-actions never alert; per-person mute stays posts-only.

**Independent Test**: A self-comments/reacts → silence; toggle off → B's comment shows no
banner but appears on the post; A mutes B → B's comment still banners (quickstart.md
steps 6–7).

### Tests for User Story 3 (write first, must FAIL)

- [ ] T018 [P] [US3] Extend e2e/wall-activity-notify.spec.ts with FAILING scenarios: A comments and reacts on A's own post → no banner on any account (TC-07/08); A sets `notifications.wall.activity` to false (via the `__ringTest` settings hook) → B comments → no banner for A while the comment is visible on A's post detail; A mutes B on the Wall (mute ledger) → B comments → A STILL banners (clarified posts-only mute)

### Implementation for User Story 3

- [x] T019 [P] [US3] Add the toggle to src/settings/schema.ts Wall group: `{ type:'toggle', title:'Activity on your posts', key:'notifications.wall.activity', default:true }` and update the group footer to cover both toggles in the About-page voice (plain, warm, no em-dashes or semicolons): "Get notified when a friend shares a new post on their Wall, and when someone reacts to or comments on your posts."
- [x] T020 [P] [US3] Add `'notifications.wall.activity'` to `SYNCED_PREF_KEYS` in src/services/ownsync-keys.ts (and update src/services/ownsync.test.ts if it asserts the key list)
- [ ] T021 [US3] Verify both alert paths honor the toggle + temp mute and ONLY those (page: predicate inputs in `notifyPostActivity`; SW: the `notifications.wall.activity` gate in src/sw.ts) — self-exclusion and mute semantics are already predicate-enforced (T003/T006); run `npm run test:e2e -- wall-activity-notify` → T018 goes green

**Checkpoint**: all three stories independently verified; acceptance TCs 01/02/05-flat/06/07/08/09-flat pass.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T022 Full gate sweep: `npm run build`, `npm run test:unit`, `cd server && go build ./... && go vet ./... && go test ./...`, `npm run test:e2e -- wall-activity-notify` (plus e2e/wall.spec.ts to confirm no regression in existing Wall flows)
- [ ] T023 [P] Re-read every touched user-facing string against the UI copy voice (About-page tone, no em-dashes/semicolons): banner bodies, SW notification bodies, settings title/footer
- [ ] T024 Set `**Status**: in-review` in specs/1031-wall-notifications-only/spec.md, run `make roadmap`, and verify `git status` shows only intended files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: none
- **Foundational (P2)**: after Setup; **blocks all stories** (T004/T005 need T002 red first; T006 needs T003 red first)
- **US1 (P3)**: after Foundational — MVP
- **US2 (P4)**: after Foundational; builds on US1's `previewPostActivity`/`notifyPostActivity` (T016/T017 extend files created in T010/T012)
- **US3 (P5)**: after Foundational; T021 verifies gates wired in US1/US2 code, so run last
- **Polish (P6)**: after all desired stories

### Within stories (Red → Green)

- T002 → T004 → T005 (server); T003 → T006 (predicate); T007 independent after T003
- T008/T009 → T010 → T011 → T012 → T013
- T014/T015 → T016 → T017
- T018 → (T019 ∥ T020) → T021

### Parallel Opportunities

- T002 ∥ T003 (Go vs vitest, different files)
- T004 ∥ T006 ∥ T007 once their tests are red
- T008 ∥ T009; T014 ∥ T015; T019 ∥ T020
- US2 test-writing (T014/T015) can start while US1 implementation is in review

---

## Implementation Strategy

**MVP first**: Setup + Foundational + US1 = the reported noise is gone and comment alerts
are owner-only. Ship-worthy on its own.

**Incremental**: add US2 (reactions) → validate → add US3 (settings/guards) → validate →
Polish. Each checkpoint leaves `develop`-mergeable behavior; no story breaks a previous
one (US2/US3 only extend files US1 created).

**Single-developer order** (this feature): straight through T001 → T024; the [P] markers
matter mainly for batching test-writing before implementation.
