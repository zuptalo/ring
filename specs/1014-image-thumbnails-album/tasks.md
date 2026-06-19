---
description: "Task list for Multi-Size Image Thumbnails + Album-View Overhaul (spec 1014)"
---

# Tasks: Multi-Size Image Thumbnails + Album-View Overhaul

**Input**: Design documents from `/specs/1014-image-thumbnails-album/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D11), data-model.md,
contracts/thumbnails-and-viewer.md, quickstart.md

**Tests**: REQUIRED (Constitution III). Failing tests precede implementation — vitest for the pure
thumbnail-size/derive helpers and the `migrateMessageToV8` migration; Playwright e2e for the
user-facing behavior (thumbnails before download + tier usage, viewer robustness/navigation, cleanup).

**Scope**: **Client-first.** Reuses the existing media pipeline (media-encode / media-meta /
media-jobs / media-transfer / `Media` store) and the E2EE `MediaRef.poster` data-URL (the same path
the video poster already uses). Persisted change: `Media += posterGrid?, posterStrip?` (`posterBlob`
= the bubble/large tier) behind a `DB_VERSION` 7→8 forward, additive migration. **No server/SQL/wire-
frame change** — the server relays the same sealed envelope (Zero-Knowledge Impact in the spec).

**Organization**: By user story — US1 thumbnails (P1, MVP) · US2 viewer robustness (P1) · US3
navigation (P2) · US4 cleanup (P2) · US5 a11y/RTL/theme + perf (P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1–US5 (Setup/Foundational/Polish carry no story label)
- Exact file paths in each description.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Capture the baseline green gates before any change: `npm run build`, `npx vitest run`,
  `cd server && go build ./... && go vet ./... && go test ./...`, and `make db-up && npm run test:e2e`
  (media specs) — must stay green throughout (Constitution VII).
- [X] T002 [P] If the pure thumbnail-size/derive logic lands in a new `src/utils/*.ts` module, add it
  to `vitest.config.ts` `coverage.include` so it lands under the gated floor (mirror spec 1011/1012/1013).

**Checkpoint**: baseline gates green; coverage gate ready for the new pure module.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the persisted schema + migration and the pure thumbnail helpers that every story uses.
**Blocks all user stories.**

### Tests first (must fail)

- [X] T003 [P] **N/A — no row transform.** The 1014 change adds optional `posterGrid`/`posterStrip`
  Blob fields to `Media` records, which IndexedDB stores without a per-row migration; the existing
  migrations are *message*-store transforms, so there is no `migrateMessageToV8` to test. The
  `DB_VERSION` 7→8 bump (T006) documents the schema add and preserves existing rows unchanged.
- [X] T004 [P] Write a failing vitest for the pure thumbnail-size/derive logic (e.g.
  `src/utils/thumbs.ts` + `thumbs.test.ts`): target max-edge dimensions for the three tiers (strip
  128 / grid 320 / bubble 512) given a source W×H (aspect-preserving, no upscale past source), and the
  tier→tier derive ordering (bubble→grid→strip).

### Implementation

- [X] T005 Add `posterGrid?: Blob` and `posterStrip?: Blob` to the `Media` interface in
  `src/db/types.ts`, documenting `posterBlob` as the bubble/large tier (video poster / image 512)
  (data-model.md).
- [X] T006 Bump `DB_VERSION` 7→8 in `src/db/idb.ts`; add the pure `migrateMessageToV8` (additive,
  never throws) + its `onupgradeneeded` wiring to pass T003 (Constitution V).
- [X] T007 Implement the pure thumbnail-size math in `src/utils/thumbs.ts` to pass T004, and add
  size-parameterized image thumbnail generation + `deriveTiers(posterBlob)` to `src/services/media-meta.ts`
  (with a separate image-thumb concurrency limiter, distinct from the video-poster limiter).

**Checkpoint**: T003/T004 pass; schema + migration ship; thumbnail helpers green and gated.

---

## Phase 3: User Story 1 - Fast image previews everywhere, before download (Priority: P1) 🎯 MVP

**Goal**: every shared image carries persisted bubble/grid/strip tiers (bubble sent E2EE, grid/strip
derived locally); each surface uses its tier; recipients preview before/without downloading the full
image; media-heavy scroll is smooth.

**Independent Test**: with auto-download off, an incoming image shows bubble + grid previews without
fetching the full image; scrolling 100+ images is smooth; reopening the grid is instant.

### Tests first (must fail)

- [X] T008 [P] [US1] Failing→passing e2e in `e2e/image-thumbnails.spec.ts` (two accounts): a shared
  image is downscaled into bubble/grid/strip tiers, the bubble rides the sealed envelope (`hasPoster`),
  the receiver derives grid/strip locally, each tier is right-sized (≤512/≤320/≤128) and distinct, the
  bubble + grid render in their surfaces, and the grid persists across re-navigation. New testhook
  helpers: `sendImage` (real gradient image), `mediaTierDims`, `messages().hasPoster`.

### Implementation

> **File-location note (T009–T011):** this codebase runs the media send/receive job and ingest inside
> `src/db/queries.ts` (not `media-jobs.ts`), and the wire-poster plumbing already lives on the
> `MediaRef.poster` path in `media-transfer.ts`. So the tier generation/persistence landed in
> `queries.ts` (the `sendMediaMessage` image branch, `downloadMessageMedia`, and the auto-download
> ingest) calling new pure helpers in `src/utils/media-meta.ts` (`makeImageThumb`, `deriveTiers`,
> `blobToDataUrl`) — same behavior the tasks specify, at this repo's actual seams.

- [X] T009 [US1] Image bubble (512) tier generated on send (`makeImageThumb`) and put on the wire as
  `MediaRef.poster` via `message.posterData`; on receive (`downloadMessageMedia` + ingest) the wire
  `poster` is decoded back to a Blob and stored as `Media.posterBlob` (`applyThumbTiers`) (D1/D5).
- [X] T010 [US1] `posterGrid` (320) + `posterStrip` (128) derived from `posterBlob` via
  `deriveTiers` + `applyThumbTiers` on both send and receive (images and videos — videos reuse the
  existing poster, no re-encode); off the send path (background image-thumb limiter) (FR-006/FR-006a).
- [X] T011 [US1] Bounded, idempotent backfill `backfillThumbTiers(mediaIds, max)` in `queries.ts`,
  driven at idle from `ChatDetailPage` (`scheduleThumbBackfill`) in small batches that resume across
  chat re-entry; not-yet-downloaded media gets tiers on fetch (FR-006b).
- [X] T012 [US1] `src/views/detail/ChatDetailPage.vue` chat bubble renders the bubble tier
  (`posterUrl` ← `posterBlob`) and the in-bubble album cells the grid tier (`gridUrl` ← `posterGrid`);
  the fixed-frame layout (spec 1011 anchor) is intact; tier object-URLs added to LRU eviction +
  unmount revoke (FR-004).
- [X] T013 [US1] `src/views/detail/AllMediaPage.vue` grid uses `gridUrl` (`posterGrid`) and the viewer
  strip (`MediaViewer.vue` via the parent-built `thumb`) uses `stripUrl` (`posterStrip`); the viewer
  main keeps the full image (FR-004). The existing on-demand generation stays as the legacy fallback
  for media that predates the tiers (backfill upgrades it).

**Checkpoint**: ✅ T008 passes; tiers exist, are sent/derived/persisted, and each surface uses its
tier. Verified: `npm run build` green, `npx vitest run` 223/223, e2e `image-thumbnails` + the 4
existing media specs (paste-image, chat-media-scroll, media-blob-delete, media-cleanup) green, and a
drive run captured bubble/grid/strip surfaces with exact tier dims 1280×960 → 512×384 → 320×240 →
128×96.

---

## Phase 4: User Story 2 - The album view is robust (Priority: P1)

**Goal**: the viewer/grids never break — empty albums, item deleted/cleared mid-view, undownloaded
items, large albums, mixed media.

**Independent Test**: delete/clear the viewed item (or all media) → placeholder or graceful close, no
broken image/crash; a 200-image swipe keeps memory bounded.

### Tests first (must fail)

- [ ] T014 [P] [US2] Write a failing e2e in `e2e/media-viewer.spec.ts`: deleting/clearing the viewed
  item (or all chat media) while the viewer is open → placeholder or graceful close (no broken image /
  out-of-range); an undownloaded/cleared item shows a placeholder; the active item stays correct after
  the item set changes.

### Implementation

- [ ] T015 [US2] In `src/components/MediaViewer.vue`, clamp/guard the index on item-set changes (watch
  items length; reset/close on empty), release stale per-item video-player references, and bounds-check
  the `nearby()` render window (no `items[-1]`) (FR-007).
- [ ] T016 [US2] In `MediaViewer.vue` (and the `viewerItems` source in `ChatDetailPage.vue`/
  `AllMediaPage.vue`), render a clear placeholder for cleared/not-downloaded items instead of an empty
  `<img>` (FR-008).
- [ ] T017 [US2] In `MediaViewer.vue`, reset zoom per item (no fast-swipe bleed) and add full-resolution
  LRU eviction of off-screen viewer images using the already-imported `selectEvictions` util (hold a
  small fixed window; revoke evicted object URLs) to pass T014 (FR-009/FR-010).

**Checkpoint**: T014 passes; the viewer is crash-proof under item mutation and bounded in memory.

---

## Phase 5: User Story 3 - Easy, fluid navigation (Priority: P2)

**Goal**: a position indicator, keyboard navigation with focus management, a strip that tracks the
active item, smoother zoom↔swipe, and restored scroll position on close.

**Independent Test**: a 40-image album shows "3 / 42"; arrow keys move and Escape closes (focus
trapped/restored); the strip centers the active item; closing returns to the prior scroll position.

### Tests first (must fail)

- [ ] T018 [P] [US3] Append failing e2e to `e2e/media-viewer.spec.ts`: a position indicator is shown;
  keyboard left/right moves and Escape closes; the strip keeps the active thumb centered; closing the
  viewer returns to the same grid/chat scroll position.

### Implementation

- [ ] T019 [US3] In `src/components/MediaViewer.vue`, add the position indicator, keyboard navigation
  (←/→ move, Esc/back close), and a focus trap with focus restore to the opener (FR-011/FR-012).
- [ ] T020 [US3] In `MediaViewer.vue`, center the active strip thumb reliably (imperative scroll, not
  timing-fragile `scrollIntoView`) and add a zoom-exit affordance so zoom and swipe don't lock
  (FR-013/FR-014).
- [ ] T021 [US3] Restore the opener's scroll position on close (capture in `AllMediaPage.vue` /
  `ChatDetailPage.vue` before opening the viewer; restore on dismiss); trim the 280ms tap-toggle delay
  (FR-015) to pass T018.

**Checkpoint**: T018 passes; navigation is fluid and orientation is clear.

---

## Phase 6: User Story 4 - Clean up image storage easily (Priority: P2)

**Goal**: storage accounting and cleanup cover all tiers, app-wide and per-chat, including freeing
originals while keeping previews.

**Independent Test**: storage totals (by type, by chat) include thumbnail bytes distinctly; deleting
media leaves no orphan tiers; "free space, keep previews" frees originals while previews render; the
per-chat all-media screen defaults to this chat.

### Tests first (must fail)

- [ ] T022 [P] [US4] Write a failing e2e in `e2e/media-cleanup.spec.ts`: storage usage includes
  thumbnail bytes; deleting a chat's images removes their thumbnails (no orphans); "free space, keep
  previews" removes originals while bubble/grid previews still render; per-chat cleanup is scoped to
  the current chat.

### Implementation

- [ ] T023 [US4] In `src/db/queries.ts`, extend `storageByType`/`storageByChat` to sum
  `blob + posterBlob + posterGrid + posterStrip` (originals vs thumbnails distinct); make deletion
  remove all tiers (no orphans); add `freeKeepingPreviews` (delete `blob`, set `mediaCleared`, keep
  tiers) and a `clearChatMedia(chatId, …)` per-chat path (FR-016/FR-017/FR-018).
- [ ] T024 [US4] Wire the UI: `src/views/detail/StorageManagePage.vue` shows thumbnail totals and
  per-chat row actions incl. "free space, keep previews"; `src/views/detail/AllMediaPage.vue` cleanup
  defaults to THIS chat with an app-wide toggle; add any `src/settings/schema.ts` entries (FR-019) to
  pass T022.

**Checkpoint**: T022 passes; storage is thumbnail-aware, global + per-chat, with keep-previews.

---

## Phase 7: User Story 5 - Accessible, RTL- and theme-correct viewer + perf (Priority: P2)

**Goal**: meaningful labels + keyboard operability, RTL-correct navigation, theme-aware viewer, and a
grid that decodes lazily.

**Independent Test**: screen reader announces images/controls; RTL swipe + strip order correct; light
mode not forced black; opening a large grid doesn't decode everything at once.

### Tests first (must fail)

- [ ] T025 [P] [US5] Add e2e/assertions (in `e2e/media-viewer.spec.ts`) for meaningful `alt`/aria
  labels on viewer images/controls and correct RTL carousel direction (e.g. set RTL and assert
  next/prev moves the right way); note theme + screen-reader items for the quickstart manual pass.

### Implementation

- [ ] T026 [US5] In `src/components/MediaViewer.vue` (and grid cells in `AllMediaPage.vue` /
  `ChatDetailPage.vue`), add meaningful `alt`/ARIA labels and make the viewer respect the app
  light/dark theme via theme tokens instead of a hardcoded black background (FR-021/FR-023).
- [ ] T027 [US5] Make the `MediaViewer.vue` carousel RTL-correct using direction-agnostic navigation
  (`scrollIntoView` on the active slide / logical CSS) instead of physical `scrollLeft` (FR-022).
- [ ] T028 [US5] In `src/views/detail/AllMediaPage.vue`, gate grid thumbnail decode on viewport
  visibility (IntersectionObserver) and cap concurrent decodes via the image-thumb limiter (FR-024) to
  pass T025.

**Checkpoint**: T025 passes; the album view is accessible, RTL/theme-correct, and decodes lazily.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Verify no regression to spec-1011/1012/1013 chat scroll + media rendering (momentum,
  no-yank, the scroll-to-latest pill, seen receipts) given the bubble image-source swap.
  (`src/views/detail/ChatDetailPage.vue`)
- [ ] T030 [P] Run the quickstart manual smoke (`specs/1014-image-thumbnails-album/quickstart.md`),
  including the **backfill** of existing media and real-device feel (swipe/zoom/strip).
- [ ] T031 Definition-of-done gate (Constitution VII): `npm run build`; `npx vitest run`;
  `cd server && go build ./... && go vet ./... && go test ./...` (unchanged); `make db-up && npm run
  test:e2e` (incl. the new media specs). All green = done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2)** → Setup. **Blocks all stories** (schema + migration + thumbnail helpers).
- **US1 (P3)** → Foundational. **MVP** (tiers generated/sent/derived/persisted + per-surface usage).
- **US2 (P4)** → Foundational (US2 can proceed in parallel with US1, but both touch `MediaViewer`/
  `ChatDetailPage`/`AllMediaPage`, so sequence the shared-file edits).
- **US3 (P5)** → US2 (extends the same viewer).
- **US4 (P6)** → Foundational (needs the tier fields) + US1 (tiers exist to account for).
- **US5 (P7)** → US2/US3 (hardens the same viewer/grid).
- **Polish (P8)** → the stories it verifies.

### Within-story dependencies

- Each story: its e2e (fail first) → implementation tasks. `MediaViewer.vue`, `ChatDetailPage.vue`,
  `AllMediaPage.vue`, `queries.ts`, `media-jobs.ts`, `media-transfer.ts` are shared across stories →
  edits to the same file are sequential.
- `e2e/media-viewer.spec.ts` is created in US2 (T014) and appended by US3 (T018) and US5 (T025).

### Parallel opportunities

- **Setup**: T001 ∥ T002. **Foundational tests**: T003 ∥ T004.
- **Across stories**: US1 (pipeline/transfer/jobs) and US2 (viewer robustness) are largely different
  files and can progress in parallel after Foundational, merging at the shared view files.
- **Polish**: T029 ∥ T030; T031 is the final gate.

---

## Implementation Strategy

### MVP first

Setup → Foundational → **US1** (thumbnails) → **STOP & VALIDATE** (T008 e2e: preview before download,
per-tier usage, grid persistence, smooth scroll). This delivers the headline ask.

### Incremental delivery

- + US2 → the viewer never breaks (P1 robustness).
- + US3 → fluid navigation.
- + US4 → thumbnail-aware cleanup (global + per-chat, keep-previews).
- + US5 → a11y / RTL / theme / lazy grid.
- + Polish → 1011/1012/1013 no-regression, backfill smoke, all gates.

---

## Notes

- TDD: verify each test FAILS before implementing (Constitution III).
- Client-only: no server/SQL/wire-frame change; the only persisted change is `Media += posterGrid/
  posterStrip` + the `DB_VERSION` 7→8 forward migration (Principle V).
- Zero-knowledge: thumbnails ride the existing E2EE `MediaRef.poster`; the server relays opaque
  ciphertext. **`/speckit-checklist` (zero-knowledge) is REQUIRED** before `/speckit-implement`
  (Principle I).
- Commit after each task or logical group; each story is an independently testable increment.
- This is a large feature — prefer shipping US1 (+US2) first and layering US3–US5.
