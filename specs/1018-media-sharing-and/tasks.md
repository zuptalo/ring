---
description: "Task list for Media Sharing & Viewer Improvements (spec 1018)"
---

# Tasks: Media Sharing & Viewer Improvements

**Input**: Design documents from `specs/1018-media-sharing-and/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/media-ref.md, quickstart.md

**Tests**: INCLUDED — the plan commits to TDD (Constitution Principle III). US1 is a defect, so it
begins with a failing regression test. Test tasks are ordered before the implementation they cover.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories); Setup/Foundational/Polish have no story label
- Exact file paths included per task

## Path Conventions

Single client project (Vue 3 PWA at repo root): `src/`, `e2e/`, `drive/`. No `server/` changes.

---

## Phase 1: Setup (Shared)

**Purpose**: Establish a green baseline and confirm no new infrastructure is needed.

- [ ] T001 Verify baseline gates pass on `feat/1018-media-sharing-and` before changes: run `npm run build` and `npm run test:unit`; record that no new dependency, object store, `DB_VERSION` bump, or server change is introduced (per plan.md / data-model.md).

**Checkpoint**: Baseline green; ready for story work.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None blocking. The three user stories touch disjoint files (video transcode services,
thumbnail utils, viewer component) and are fully independent — they may be implemented in any order
or in parallel. No shared foundational code is required before starting.

**Checkpoint**: Proceed to user stories in priority order (US1 → US2 → US3) or in parallel.

---

## Phase 3: User Story 1 - Shared videos appear upright for everyone (Priority: P1) 🎯 MVP

**Goal**: Portrait/rotated videos play upright for the recipient (FR-001..FR-004), with matching
thumbnail orientation.

**Independent Test**: Send portrait/landscape/180°/sideways videos from device A; confirm on device B
that playback orientation, aspect ratio, and thumbnail all match A (SC-001/SC-002).

### Tests (write first — must fail before implementation)

- [ ] T002 [US1] Add failing unit tests for video-orientation correctness in `src/services/media-video.test.ts` (and `src/services/media-video-webcodecs.test.ts`): for source rotations 0°/90°/180°/270°, assert the compressed output's **display** dimensions are upright (90/270 swap w/h) and that a 0°/no-matrix source is left untouched (no double-rotation, FR-003). Use synthetic/fixture inputs that carry a display matrix.

### Implementation

- [ ] T003 [US1] In `src/services/media-video-webcodecs.ts` (~L114-118), read the MP4 track **display matrix / rotation** from the mp4box demuxer and derive the rotation angle (0/90/180/270); document the exact field used in `research.md` (US1 "Open verification").
- [ ] T004 [US1] In `src/services/media-video-webcodecs.ts` (~L114-191), apply the rotation during the canvas re-encode: for 90°/270° swap target `tw/th` and rotate+translate the 2D context before `drawImage`; for 180° rotate without swap; 0° unchanged. Keep encoder `codedWidth/Height` consistent with the oriented canvas.
- [ ] T005 [US1] Ensure the **display (oriented)** dimensions propagate to `mediaWidth`/`mediaHeight` and the poster: check `readVideoMeta` in `src/utils/media-meta.ts`, the orchestration in `src/services/media-video.ts`, and where dims are stored in `src/db/queries.ts` (~L1574-1589). Bubble/grid layout must use upright dims (FR-002).
- [ ] T006 [P] [US1] Verify the ffmpeg fallback in `src/services/media-video-ffmpeg.ts` (~L76) still bakes correct orientation (default auto-rotate); add a guard/assertion test so a future flag change can't silently regress it.
- [ ] T007 [P] [US1] Confirm `src/components/VideoPlayer.vue` applies **no** extra rotation (plays the already-oriented bytes faithfully); add a brief code comment documenting the invariant.
- [ ] T008 [US1] Add a `drive/scenarios/media-1018-orientation.mjs` (or extend an e2e media spec) reproduction note + a real-device checklist entry in `quickstart.md` for portrait/landscape/upside-down send→receive (headless fake-media can't fully exercise capture orientation).
- [ ] T009 [US1] Make T002 pass; run `npm run build` + `npm run test:unit`; confirm 0°/no-matrix sources are untouched and old (pre-1018) videos still render (FR-008/SC-007).

**Checkpoint**: Portrait videos arrive upright for the recipient — US1 independently shippable.

---

## Phase 4: User Story 2 - Crisp image & video thumbnails (Priority: P2)

**Goal**: Image and video thumbnails render crisp on high-density displays (FR-005), within a ~40KB
per-message budget (FR-007), with no schema change and old posters still rendering (FR-008).

**Independent Test**: Send representative photos/videos; inspect bubble/list/grid thumbnails on a
high-DPI capture — no visible pixelation (SC-003) and poster ≤ ~40KB (SC-004).

### Tests (write first — must fail before implementation)

- [ ] T010 [US2] Add failing unit tests in `src/utils/media-meta.test.ts` (new): `generateImageThumb` and `generateVideoPoster` produce a poster with longest edge ~512px and encoded size ≤ ~40KB, stepping JPEG quality down (e.g. 0.8→0.7→0.6) when a busy image would exceed the cap; generation failure returns `undefined` (fail-open).

### Implementation

- [ ] T011 [US2] Raise `generateImageThumb` in `src/utils/media-meta.ts` (~L170) from `maxEdge=400, quality=0.7` to ~512px / ~0.8 with the ~40KB quality-stepping cap from T010.
- [ ] T012 [US2] Raise `generateVideoPoster` in `src/utils/media-meta.ts` (~L80) from `maxEdge=480, quality=0.6` to ~512px / ~0.8 with the same ~40KB cap (keep the 0.2s frame skip + decoder concurrency limit).
- [ ] T013 [US2] Reconcile the tier definitions in `src/utils/thumbs.ts` (bubble 512 / grid 320 / strip 128) with the new generation params so the wire poster is consistently the 512px bubble tier and grid/strip derive from it.
- [ ] T014 [P] [US2] Confirm rendering paths consume the crisper poster without change and old low-res posters still display: `src/views/detail/ChatDetailPage.vue` (~L254-259) and `src/views/detail/AllMediaPage.vue` (~L36-42); add a regression note/test for FR-008.
- [ ] T015 [P] [US2] Add `drive/scenarios/media-1018-thumbnails.mjs`: send photos + a video, screenshot the chat list, message bubble, and media grid for crispness review (SC-003).
- [ ] T016 [US2] Make T010 pass; run `npm run build` + `npm run test:unit`; spot-check a typical photo poster stays ≤ ~40KB with no noticeable send/sync slowdown (SC-004).

**Checkpoint**: Thumbnails are crisp within budget — US2 independently shippable.

---

## Phase 5: User Story 3 - Smooth, native-feeling zoom & pan (Priority: P3)

**Goal**: The full-screen viewer gains iOS/iPadOS-smooth pinch-centering, momentum pan, rubber-band
overscroll, and per-item zoom reset (FR-009..FR-013), holding 60fps (SC-005). Enhancement of existing
vanilla-JS gesture code; no new dependency.

**Independent Test**: Open a photo from a bubble and from the media grid; pinch/pan/double-tap feel
fluid with rubber-band + inertia; paging resets zoom; a pinch never pages/dismisses (FR-011/FR-012/FR-013).

### Tests (write first)

- [ ] T017 [US3] Extend `e2e/media-viewer.spec.ts` (and/or add a `drive/scenarios/media-1018-zoom.mjs`) to assert the **same** viewer path is used from a message bubble and from the media grid (FR-011), and that zoom state **resets to fit-to-screen** when paging between items (FR-012). Note in `quickstart.md` that 60fps feel + rubber-band/inertia need a real-device check.

### Implementation (all in `src/components/MediaViewer.vue`)

- [ ] T018 [US3] Make pinch zoom centered on the gesture midpoint: adjust `zoom.tx/ty` so the focal point stays under the fingers during `onTouchMove` (pinch mode, ~L393-424).
- [ ] T019 [US3] Replace the hard `clampPan` (~L358-366) with **rubber-band/overscroll**: allow limited pan past bounds with increasing resistance, then animate back to the bound on release.
- [ ] T020 [US3] Add **momentum/inertia** on pan release: capture velocity and decay translation in a `requestAnimationFrame` loop with friction, settling within bounds (interacts with T019's rubber-band).
- [ ] T021 [US3] Guarantee zoom resets to `{ scale:1, tx:0, ty:0 }` on current-item change (FR-012), and confirm the existing limits (max ~5× pinch ~L420; double-tap ~2.5× ~L475) match FR-009.
- [ ] T022 [US3] Verify gesture disambiguation (FR-013): a two-finger pinch never triggers horizontal item-paging or vertical swipe-to-dismiss; drive transforms off rAF and keep the CSS transition disabled during active gestures (~L350-351) so motion stays at 60fps (SC-005).
- [ ] T023 [US3] Make T017 pass; run `npm run build` + `npm run test:e2e`; real-device pass for the 60fps/feel checks per `quickstart.md`.

**Checkpoint**: Viewer feels native — US3 independently shippable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T024 Run `/speckit-checklist` (REQUIRED for Principle I — touches the E2EE media payload) and resolve any findings before implementation sign-off.
- [ ] T025 Full gate pass: `npm run build`, `npm run test:unit`, `npm run test:e2e` (with `make db-up`); confirm no regression to existing media send/transfer behavior (SC-007).
- [ ] T026 Real-device validation sweep per `quickstart.md` across US1 (orientation), US2 (crispness/budget), US3 (zoom feel); record results.
- [ ] T027 Write user-facing commit subjects as plain-language release notes (Principle VII), e.g. `fix(media): shared videos no longer arrive sideways`, `feat(media): sharper photo & video previews`, `feat(media): smoother pinch-to-zoom when viewing photos`.

---

## Dependencies & Execution Order

- **Setup (Phase 1)** before everything. **Foundational (Phase 2)** is empty (no blockers).
- **US1, US2, US3 are independent** (disjoint files) — implement in priority order P1→P2→P3, or in
  parallel across people/agents. Each is a standalone, shippable increment.
- **Within each story**: the test task comes first (must fail), then implementation, then the
  "make tests pass + gates" task.
- **Polish (Phase 6)** after the stories that are being shipped. T024 (`/speckit-checklist`) should run
  before final implementation sign-off.

## Parallel Opportunities

- The three stories run fully in parallel: `media-video-webcodecs.ts` (US1), `media-meta.ts` (US2),
  `MediaViewer.vue` (US3) are disjoint.
- `[P]` within stories: T006/T007 (US1, different files), T014/T015 (US2, rendering check vs. drive
  scenario). Tasks editing the **same** file (e.g., T011+T012+T013 share `media-meta.ts`/`thumbs.ts`;
  T018–T022 share `MediaViewer.vue`) are sequential.

## MVP Scope

**US1 alone is the MVP** — it fixes a real defect (sideways received videos) and delivers standalone
value. US2 and US3 are quality/experience increments layered on top.

## Task Summary

- **Total**: 27 tasks (T001–T027)
- **US1 (P1)**: 8 (T002–T009) · **US2 (P2)**: 7 (T010–T016) · **US3 (P3)**: 7 (T017–T023)
- **Setup**: 1 (T001) · **Foundational**: 0 · **Polish**: 4 (T024–T027)
- **Test-first tasks**: T002 (US1), T010 (US2), T017 (US3)
