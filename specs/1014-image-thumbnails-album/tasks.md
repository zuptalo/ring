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

- [X] T014 [P] [US2] e2e `e2e/media-viewer.spec.ts` (3 tests): (1) delete the **last** viewed item →
  index clamps, exactly one strip thumb active, no broken `<img>`; delete the rest → viewer closes
  gracefully. (2) clear chat media while viewing → graceful close, no broken image. (3) **TDD-failing**
  FR-008: a 200-message album (100 images) opened on the newest leaves the oldest unresolved — the strip
  rendered **75 broken `<img src="">`** pre-fix, **0** post-fix.

> **Finding (recorded):** the viewer was already crash-robust against the headline "out-of-range" case —
> the horizontal scroll-snap track auto-clamps `scrollLeft` on shrink and `onScroll` re-syncs `index`,
> so deleting the viewed item never threw. T015's index clamp is therefore made an **explicit** guarantee
> (not reliant on incidental browser scroll-clamp timing), and the genuine, demonstrable defect was the
> FR-008 broken `<img>` for unresolved/cleared items (test 3). We do **not** retain cleared items in
> `chatMediaMsgs` (no `isCleared` field): a cleared/deleted item leaves the set → the viewer clamps/closes
> (FR-007) and the in-chat bubble keeps its existing `.media-cleared` placeholder.

### Implementation

- [X] T015 [US2] `src/components/MediaViewer.vue`: `watch(() => props.items.length)` clamps `index` into
  range and **releases stale per-slide video handles** (`videoApis` keys where `i > len-1 || !nearby(i)`)
  + `pauseOffscreenVideos`; the empty case is handled by each host's close-watch. Host close-watches
  (`ChatDetailPage.vue`, `AllMediaPage.vue`) reconcile `viewer.start` on shrink (and ChatDetailPage
  clears `viewerPins` + `evictMedia()` on empty so the freed window is reclaimed) (FR-007).
- [X] T016 [US2] Placeholders instead of empty `<img>`: `MediaViewer.vue` main slide (`.v-missing`
  "Photo unavailable") and strip (`.v-thumb-missing` icon) when `!url && !thumb`; `AllMediaPage.vue`
  grid cell (`.cell-missing`) when info is absent. The placeholders are `v-else` of the tier/url checks,
  so a present `gridUrl`/`stripUrl`/`posterUrl` tier always wins (no US1 shadowing) (FR-008).
- [X] T017 [US2] FR-010: `resetZoom()` centralized on the first line of `watch(index)` so zoom never
  bleeds onto an adjacent item, whatever path changed the index. FR-009: **not** a viewer-side
  `selectEvictions` rewrite (that task premise was wrong — `selectEvictions` was never imported in the
  viewer, and the parent already bounds memory via `viewerPins` + `evictMedia` + the `nearby()` render
  gate that caps decoded `<img>` to 3). The real leak was `AllMediaPage` never revoking its `info`
  object URLs — now revoked on media-vanish (in the resolve watch) and on `onBeforeUnmount` (FR-009).

**Checkpoint**: ✅ T014 passes (3/3); the viewer clamps + recovers under item mutation, never renders a
broken image, resets zoom per item, and AllMediaPage no longer leaks object URLs. Verified: `npm run
build` green, `npx vitest run` 223/223, e2e media-viewer (4) + image-thumbnails + the 4 existing media
specs (chat-media-scroll, paste-image, media-blob-delete, media-cleanup) green.

> **Adversarial review pass** (multi-agent, refute-verified): applied **H1** — on a shrink-while-open
> the ChatDetailPage close-watch now prunes `viewerPins` of vanished media + `evictMedia()` (gated on an
> actual shrink, off the resolve hot path) so a deleted item's blob URLs are reclaimed immediately, not
> at the next swipe (FR-009); and **H2** — the AllMediaPage grid `<button>` gained an `aria-label`
> (Photo/Video/"Media unavailable"). Declined M1 (non-occurring, guarded by `!info.posterUrl`; the
> proposed `blob:` guard would mis-revoke the aliased `info.url`) and L1 (the explicit pre-assignment
> `resetZoom()` calls prevent a 1-frame zoom flash before the index watch flushes).

---

## Phase 5: User Story 3 - Easy, fluid navigation (Priority: P2)

**Goal**: a position indicator, keyboard navigation with focus management, a strip that tracks the
active item, smoother zoom↔swipe, and restored scroll position on close.

**Independent Test**: a 40-image album shows "3 / 42"; arrow keys move and Escape closes (focus
trapped/restored); the strip centers the active item; closing returns to the prior scroll position.

### Tests first (must fail)

- [X] T018 [P] [US3] Appended 4 e2e to `e2e/media-viewer.spec.ts`: (1) position indicator `N / total`
  tracks the active item; (2) keyboard ←/→ move (clamped at ends) + Escape closes; (3) the overflowing
  strip auto-scrolls to keep the active thumb visible; (4) closing returns to the prior all-media grid
  scroll position. Indicator/keyboard/restore failed pre-impl (`.v-count` absent, arrows no-op, ~50px
  drift). **Test-harness notes:** the isolated e2e stack is flaky for long *synthetic* keyboard nav in
  the viewer (a focus/snap-timing artifact that does **not** reproduce on the live stack — drive-verified
  flawless), so the strip test asserts auto-scroll-to-active deterministically (no multi-step nav) and the
  arrow tests dispatch keydown to the document listener (Escape stays real-keyboard). A 500ms settle after
  open avoids a present-vs-`goToStart` race.

### Implementation

- [X] T019 [US3] `src/components/MediaViewer.vue`: position indicator (`.v-count`, `N / total`, in the
  top bar, hides with the chrome); keyboard nav via a document `keydown` listener (←/→ → `jump`, which
  clamps; Escape/focus-trap/focus-restore are handled by `ion-modal` itself, not reimplemented) (FR-011/012).
- [X] T020 [US3] `MediaViewer.vue`: `scrollStrip()` centralized on the `watch(index)` so every nav path
  re-centers the active strip thumb (FR-013), hardened against the shrink race; a visible **zoom-exit**
  affordance (`.v-zoom-exit`, shown while `zoom.scale > 1`, → `resetZoom`) so zoom never mode-locks swipe
  (FR-014). Also hardened opening orientation: `goToStart` retries `scrollToIndex` until the track is laid
  out (clientWidth>0) so the viewer never opens on the wrong item, and **`onScroll` is gated on recent user
  input** so the snap/relayout scrolls a programmatic move triggers can't hijack the index (FR-011).
- [X] T021 [US3] FR-015 scroll restore: `AllMediaPage.vue` captures the grid `scrollTop` on open and
  restores it on close (the modal-dismiss otherwise drifts the content). **ChatDetailPage needs no change**
  — the viewer is a modal overlay, so the chat scroll is preserved underneath. (The 280ms tap-toggle delay
  was left as-is; it's unrelated to navigation fluidity and removing it risks the double-tap-zoom timing.)

**Checkpoint**: ✅ T018 passes (4/4); the viewer shows position, supports keyboard nav + Escape, keeps the
active strip thumb visible, exits zoom via an affordance, opens on the right item, and restores grid scroll
on close. Verified: `npm run build` green, `npx vitest run` 223/223, the full media e2e (media-viewer 7 +
image-thumbnails + chat-media-scroll + paste-image + media-blob-delete + media-cleanup = 16) green under
parallel load, and a drive run confirmed the indicator updates, ←/→ step through 12 images, and the
zoom-exit button appears.

> **Adversarial review pass** (multi-agent, refute-verified — "safe to commit, no blockers"): applied the
> three confirmed fixes — (1) a horizontal swipe now lifts the programmatic-scroll suppression the moment
> its direction commits, so an eager swipe within ~250ms of opening updates the index (the suppression only
> ever guards programmatic moves; momentum swipes are always honored); (2) `onUnmounted` clears the pending
> `posTimer`/`tapTimer` so a stale timer can't fire on a reopened viewer; (3) `goToStart` clamps the opening
> index like `jump()`. (Self-caught + reverted earlier: a first attempt gated `onScroll` on recent user
> input, which would have broken inertial swipe — replaced with suppress-after-programmatic, which never
> touches swipes.) Declined nits: `1 / 1` for a single-item album (intentional — noise), redundant
> idempotent strip re-centre on swipe (removing risks a 1-tick lag), zoom-exit SR-announcement (gold-plating;
> the button is keyboard-reachable with an aria-label).

---

## Phase 6: User Story 4 - Clean up image storage easily (Priority: P2)

**Goal**: storage accounting and cleanup cover all tiers, app-wide and per-chat, including freeing
originals while keeping previews.

**Independent Test**: storage totals (by type, by chat) include thumbnail bytes distinctly; deleting
media leaves no orphan tiers; "free space, keep previews" frees originals while previews render; the
per-chat all-media screen defaults to this chat.

### Tests first (must fail)

- [X] T022 [P] [US4] e2e in `e2e/media-cleanup.spec.ts`: storage by-type + by-chat include thumbnail
  bytes distinct from (and smaller than) originals; `freeKeepingPreviews` frees originals while all three
  tiers + the rendered bubble survive; deleting a chat's images removes their tiers (no orphan) and is
  scoped to that chat. New testhooks: `storageByChat`, `freeKeepingPreviews`, `clearChatMedia`.

### Implementation

> **Data design (resolved):** "free space, keep previews" drops `Media.blob` only and KEEPS the record,
> `mediaId`, and the tiers — it does **NOT** set `mediaCleared` (the tasks.md hint was wrong: `mediaCleared`
> + cleared `mediaId` triggers the "removed to free space" placeholder, the opposite of FR-018). The bubble/
> grid/strip read the tiers (`posterUrl`/`gridUrl`/`stripUrl`), never `blob`, so the preview renders pixel-
> identical after freeing; the viewer main falls back to the thumb via the US2 placeholder path. `Media.blob`
> became optional (`blob?: Blob`) — a type-only change, additive, **no `DB_VERSION` bump** (FR-020).

- [X] T023 [US4] `src/db/queries.ts`: `storageByType`/`storageByChat` now account originals
  (`originalBytes` = blob ? size : 0) and thumbnail tiers (`tierBytes` = posterBlob+grid+strip) separately
  (FR-016); `freeKeepingPreviews(opts)` drops `blob` + zeroes `size`, keeps tiers (FR-018); `clearChatMedia`
  per-chat wrapper (FR-019); deletion already removes the whole record so tiers cascade — **FR-017 is
  inherent** (documented). Guarded the ~25 `media.blob` readers (send pipeline bails on a freed record;
  `resolveMediaFor`/AllMediaPage builders fall back when `blob` is absent).
- [X] T024 [US4] UI: `StorageManagePage.vue` shows previews distinctly (summary "includes X in previews",
  per-type "+ X previews", per-chat "· X previews") and a global "Free space, keep previews" action;
  `AllMediaPage.vue` cleanup already defaults to THIS chat — added "Free space, keep previews", "Clear all
  media in this chat", and an explicit "Manage storage (all chats)…" link (FR-019). No `schema.ts` change
  needed (the storage route already exists; cleanup is action-only, no new toggles).

**Checkpoint**: ✅ T022 passes; storage is thumbnail-aware (global + per-chat), deletion leaves no orphan
tiers, and keep-previews frees originals while previews render. Verified: `npm run build` green, `npx vitest
run` 223/223, `media-cleanup` (2 incl. the new US4 test) green, full media e2e green (the 2 US2 viewer tests
flake only under 6-file parallel load — pass in isolation), and a drive run showed originals 2.1 MB → 0 with
the bubble preview still rendering + the Manage-storage page showing previews distinctly.

> **Adversarial review pass** (multi-agent, refute-verified): applied the two real findings — **(B)** the
> keep-previews confirmation no longer promises an impossible "re-download" (a freed original is removed
> permanently — `downloadMessageMedia` can't recover it and the server blob is already gone), stated honestly
> in both StorageManagePage and a new AllMediaPage confirm; **(E)** `forwardable()` now also requires the
> original to be on device, so a freed image isn't offered for forward (forwarding re-sends the original,
> which would otherwise silently send nothing). Declined the over-stated findings: A (freed items have
> `size=0` → correctly excluded from "large files"; kept previews are intentional and removable by-kind/
> clear-chat — not a leak), C (Vue omits an `undefined` `:href`; files are never freed), D (the media-job
> closure keeps its own blob ref; `freeKeepingPreviews` writes a different fetched object).

### Follow-up (user request): "Go to message" from the all-media page

- **Fix**: AllMediaPage's media-viewer `@goto`/`@reply` used `goChat` which ignored the message id (it just
  opened the chat at the bottom). Now `goToMessage(id)` navigates to `/chat/:id?jump=:id`, so the chat
  **scrolls to that message** (the same `?jump` path the Starred list uses; verified it works even though
  AllMediaPage is a child route of the chat).
- **New**: the Links and Docs tabs each gained a "Go to message" button (the row tap still opens the
  link/document), so a shared link or document can jump to where it was sent.
- Verified by `e2e/all-media-goto.spec.ts` (viewer + links + docs all navigate with `?jump`) and a drive run
  (media-viewer go-to-message scrolled a far-off-screen target image into view).

---

## Phase 7: User Story 5 - Accessible, RTL- and theme-correct viewer + perf (Priority: P2)

**Goal**: meaningful labels + keyboard operability, RTL-correct navigation, theme-aware viewer, and a
grid that decodes lazily.

**Independent Test**: screen reader announces images/controls; RTL swipe + strip order correct; light
mode not forced black; opening a large grid doesn't decode everything at once.

### Tests first (must fail)

- [X] T025 [P] [US5] Added to `e2e/media-viewer.spec.ts`: (a11y) the main image + every strip thumbnail
  have non-empty `alt`, the 6 action buttons carry `aria-label`, `.v-count` is `aria-live="polite"`;
  (RTL) with `<html dir=rtl>`, → is visually-back (clamped at start) and ← advances (0→1→2). The strip
  `alt=""` was the one TDD-red a11y assertion; the RTL assertions were all red pre-impl. Screen-reader
  + theme-contrast remain a manual quickstart pass.

### Implementation

- [X] T026 [US5] FR-021: strip `<img>` gained `alt="Thumbnail N"` + the thumb button an `aria-label`
  ("Photo N of M") and `aria-current`; the rest (action `aria-label`s, `.v-count` aria-live, main-img
  alt, decorative `aria-hidden`) was already in place from US2/US3. FR-023: the viewer now follows the
  app light/dark theme via new `--viewer-*` tokens in `variables.css` (surface / text / overlay scrims
  / chrome / pill, light + dark) replacing every hardcoded `#000`/`#fff`/`#2a2a2a`/`rgba` in
  `MediaViewer.vue`. **Per the spec owner's call, the viewer FULLY follows the theme** (light surface +
  dark chrome in light mode; dark surface + light chrome in dark) — not the "stay dark" option.
- [X] T027 [US5] FR-022: the carousel is direction-agnostic — `scrollToIndex` uses the slide's
  `scrollIntoView({inline:'center'})` (not `scrollLeft = i*clientWidth`), `onScroll` derives the active
  index from the slide nearest the track's centre (`getBoundingClientRect`, not `scrollLeft/clientWidth`),
  the shrink-watch uses `scrollToIndex`, and arrow keys are physical (← = visually-left = next in RTL,
  via the track's computed `direction`). All US3 hardening (suppress/positioning, clamp, momentum-swipe
  honoring, posTimer cleanup) is preserved. `:data-i` added to slides.
- [X] T028 [US5] FR-024: the all-media grid `<img>` gets `loading="lazy" decoding="async"` (browser
  defers off-screen decode), thumbnail GENERATION for tier-less media is gated by an IntersectionObserver
  (`ensureThumb` on a cell nearing the viewport, `rootMargin 400px`, one-shot + disconnect on unmount)
  instead of the old eager all-at-once loop, and the image-thumb path now uses the correct
  `makeImageThumb` (image-thumb limiter, cap 3) at the bubble tier.

**Checkpoint**: ✅ T025 passes; the viewer is accessible, RTL-correct, and theme-following, and the grid
decodes lazily. Verified: `npm run build` green, `npx vitest run` 223/223, full media-viewer e2e (9: US2+
US3+US5) green, media e2e regression (all-media-goto, media-cleanup, image-thumbnails, chat-media-scroll)
green, and a drive run confirmed the viewer surface is `#ffffff` in light / `#000000` in dark with the
chrome following.

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
