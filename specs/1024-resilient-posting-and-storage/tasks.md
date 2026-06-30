# Tasks: Resilient posting & on-device storage management

**Feature**: `specs/1024-resilient-posting-and-storage/` · **Branch**: `feat/1024-resilient-posting-and-storage`

TDD per Constitution Principle III — failing tests precede the implementation they cover. Client-only
feature; server untouched. `[P]` = parallelizable (different files, no incomplete deps).

## Phase 1 — Setup (shared infrastructure)

- [X] T001 [P] Add `OutboxPost` + `OutboxItem` types in `src/db/types.ts` (per data-model.md)
- [X] T002 Bump `DB_VERSION` and create the `outbox` object store (keyPath `id`) in `onupgradeneeded` in `src/db/idb.ts`

## Phase 2 — Foundational (blocking prerequisites for all stories)

- [ ] T003 [P] Outbox unit tests (vitest) — enqueue persists record+blobs; `listOutbox` ordering; per-item `blobId` confirmation gating; cleanup deletes record+blobs — in `src/db/outbox.test.ts`
- [ ] T004 Outbox CRUD in `src/db/queries.ts`: `enqueueOutboxPost`, `listOutbox`, `getOutbox`, `updateOutboxItem`, `deleteOutbox` (writes via the change-bus)
- [ ] T005 `useOutbox` composable (reactive pending list via `useLiveQuery('outbox')`) in `src/composables/useOutbox.ts`

## Phase 3 — User Story 1: Share and move on; the post finishes itself (P1) 🎯 MVP

**Goal**: Share dismisses the composer instantly; a pending post with progress shows atop the Wall and
finalizes to a real post (createdAt at confirmation) without blocking the user.

**Independent test**: Stage media → Share → composer closes immediately + pending card visible → it
becomes a normal post with a fresh countdown only after all items upload.

- [ ] T006 [US1] e2e (failing first): share → composer dismisses immediately; `.outbox-pending` card with `ion-progress-bar` at top of Wall; finalizes to a real post whose `createdAt` ≈ confirm time — in `e2e/resilient-posting.spec.ts`
- [ ] T007 [US1] Upload worker `drainOutbox()` in `src/services/outbox.ts`: per item → encode/resize (reuse `media-video`/compress) → `uploadBlob` → set `item.blobId` (skip already-confirmed); when all confirmed → seal + `createPost` → on 2xx write the real `Post` (`createdAt=now`) and delete the outbox row + every `item.blob`
- [ ] T008 [US1] Composer Share handler → `enqueueOutboxPost(...)` then dismiss immediately (no awaiting encode/upload) in `src/views/detail/PostComposerPage.vue`
- [ ] T009 [US1] Render pending Wall posts at the top (thumbnails + `ion-progress-bar` + per-item state); merge outbox items into the feed in `src/composables/useWall.ts` + `src/views/tabs/WallPage.vue`
- [ ] T010 [US1] Kick `drainOutbox()` on enqueue and on reconnect/`online` (wire alongside `useSync`) in `src/services/outbox.ts` + `src/composables/useSync.ts`

## Phase 4 — User Story 2: Pick up where it left off after the app closes (P1)

**Goal**: Interrupted uploads auto-retry once on reopen; still-failing posts offer Retry/Cancel and
resume only unconfirmed items; cached copies survive source removal.

**Independent test**: Kill mid-upload → reopen auto-resumes/finishes; force failure → Retry/Cancel
appear, Retry re-sends only unconfirmed, Cancel removes record+blobs; remove the source after Share →
post still completes.

- [ ] T011 [US2] e2e (failing first): kill mid-upload → reopen auto-retries once and finishes; forced failure surfaces Retry/Cancel; Retry resumes only unconfirmed items; Cancel removes; source-removal-after-Share still completes — extend `e2e/resilient-posting.spec.ts`
- [ ] T012 [US2] `resumeOutboxOnStart()` (auto-retry each interrupted post once, guarded by `attempts`; then mark `failed`) in `src/services/outbox.ts`; call on keystore unlock in `src/App.vue` (the `isUnlocked` watcher)
- [ ] T013 [US2] Retry/Cancel affordances on `failed` pending posts (stock `ion-button`) with `retryOutboxPost`/`cancelOutboxPost` wired, in `src/views/tabs/WallPage.vue`
- [ ] T014 [US2] Storage-exhaustion + network failures set `status='failed'` + `error` (free-space hint) without partial posts, in `src/services/outbox.ts`

## Phase 5 — User Story 3: Warned before running out of space (P2)

**Goal**: At media selection (chat + Wall), warn up front when the encode/upload won't fit free space;
never start a half-finished share.

**Independent test**: Simulate low free space → select a large batch → up-front warning, no encode begins.

- [ ] T015 [P] [US3] Unit test: `hasRoomFor` returns false when `free < bytes×2.5` (floor 50 MB); returns true (best-effort) when `navigator.storage.estimate` is absent — in `src/services/storage-estimate.test.ts`
- [ ] T016 [US3] e2e: low free space → up-front warning + no encode/stage starts — extend `e2e/resilient-posting.spec.ts`
- [ ] T017 [P] [US3] `hasRoomFor(bytes)` via `navigator.storage.estimate()` in `src/services/storage-estimate.ts`
- [ ] T018 [US3] Guard media selection (warn + abort) in `src/views/detail/PostComposerPage.vue` and the chat media picker in `src/views/detail/ChatDetailPage.vue`

## Phase 6 — Polish & cross-cutting

- [ ] T019 [P] Chat parity (FR-012): `enqueueOutboxPost(target='chat')` from `ChatDetailPage` send; render the pending media message inline with progress + Retry/Cancel; reuse the same worker
- [ ] T020 [P] Verify no leftover `outbox` row or cached blob after finalize/cancel (SC-006) — assert in unit + e2e
- [ ] T021 Run `/speckit-checklist` (REQUIRED — Principle I/ZK) and resolve every finding (confirm cached-blob at-rest stance)
- [ ] T022 Gates: `npm run build`, `npx vitest run`, `npm run test:e2e`, `cd server && go test ./...` — all green; fix any fallout

## Dependencies / order

- **Setup (T001–T002)** → **Foundational (T003–T005)** → stories.
- **US1 (T006–T010)** is the MVP and unblocks US2.
- **US2 (T011–T014)** depends on US1's worker + pending UI.
- **US3 (T015–T018)** is independent of US1/US2 (selection-time guard) — can run in parallel after Foundational.
- **Polish (T019–T022)** last; T021 (checklist) gates `/speckit-implement` completion.

## Parallel opportunities

- T001 ∥ (types) and T003 (tests) can start together; T015/T017 (storage) ∥ the US1/US2 work.
- T019/T020 ∥ in polish.

## MVP scope

**US1 only** (T001–T010) delivers a shippable increment: share-and-move-on with a self-finishing Wall
post. US2 (resilience) and US3 (storage guard) layer on top.
