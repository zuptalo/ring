# Tasks: Cross-browser media interop (spec 2050)

**Feature**: `specs/2050-media-interop` | **Branch**: `fix/2050-media-interop`

Client-only hotfix (Vue 3 + Ionic). Bug fix (2001+): regression test FIRST. Each story is
an independently shippable slice. US1 = P1 WebM · US2 = P2 HEIC · US3 = P3 PNG-alpha · US4 = P4 SVG.

## Phase 1: Setup

- [ ] T001 Confirm baseline: `npm run build` + `npx vitest run` green before changes.

## Phase 2: Foundational — the portability decision (blocks US1–US4)

- [ ] T002 [P] Write failing unit tests in `src/services/media-portability.test.ts`: `needsMandatoryTranscode('video/webm','original')`→true, `('video/mp4','original')`→false; `isPortableVideo` (mp4/mov/m4v); `isHeic` (image/heic|heif); `imageNeedsAlphaPreserve` (PNG+alpha→true, opaque→false).
- [ ] T003 Implement `src/services/media-portability.ts` (pure helpers) to pass T002.

## Phase 3: User Story 1 — WebM (and non-portable video) sends playably (P1) 🎯 MVP

**Independent test**: send a WebM at Original quality from a non-Safari sender → delivered as MP4, plays on Safari/iOS; an un-convertible clip → visible failure, no raw upload.

- [ ] T004 [US1] In `src/services/media-video.ts` `compressVideoAdaptive`: route any container where `needsMandatoryTranscode` is true to the ffmpeg transcode — bypass the mp4-only "as-is" gate (~156) and WebCodecs guard (~178); do NOT return raw bytes for a non-portable container.
- [ ] T005 [US1] In `src/db/queries.ts` `runMediaJob` (~2273/2409): do not skip the encode phase for a non-portable video even at quality `original`.
- [ ] T006 [US1] Honest failure: add `'cant-convert'` to `Message.failReason` (`src/db/types.ts`) and set it when a non-portable video can't transcode (over the ffmpeg input cap / ffmpeg unavailable) instead of uploading raw; render via the existing failed-send card.
- [ ] T007 [US1] Confirm app-recorded WebM video-notes (`VideoNoteRecorder.vue`) flow through the same mandatory transcode (send path reaches `compressVideoAdaptive`/`runMediaJob`).
- [ ] T008 [P] [US1] Drive scenario `drive/scenarios/media-interop.mjs` (US1): send webm at Original → assert delivered `blob.type` is video/mp4; screenshot.
- [ ] T009 [P] [US1] e2e `e2e/media-interop.spec.ts` (US1): a webm send yields a video/mp4 blob (or an honest failure).

**Checkpoint**: US1 independently shippable — the reported bug fixed, no new dependency.

## Phase 4: User Story 2 — HEIC sends viewably (P2)

**Independent test**: from a non-Safari sender, send a .heic → recipient on any browser sees the photo.

- [ ] T010 [US2] Add `src/services/heic-decode.ts` — `decodeHeicToJpeg(blob)`, lazy `import()` of a wasm HEIC decoder (pin an MIT/compatible package; note licence + gzip size in the PR). Client-side only, no network.
- [ ] T011 [US2] In `src/services/media-encode.ts` `compressImage`: when `isHeic(mime)`, decode→JPEG first, then the normal encode; on decode failure set `failReason: 'cant-convert'` (no raw HEIC upload).
- [ ] T012 [P] [US2] Drive (US2): send .heic → delivered JPEG renders; screenshot.

**Checkpoint**: US2 shippable — HEIC viewable everywhere.

## Phase 5: User Story 3 — PNG transparency preserved (P3)

**Independent test**: send a transparent PNG → received image keeps transparency.

- [ ] T013 [US3] In `src/services/media-encode.ts`: detect PNG alpha (IHDR colour-type sniff or canvas sample); when alpha, route through the preserved/alpha-capable path (keep PNG or re-encode WebP) instead of the JPEG flatten. Opaque images keep quality-tier downscaling.
- [ ] T014 [P] [US3] Drive (US3): send an alpha PNG → received image retains transparency; screenshot.

**Checkpoint**: US3 shippable — no more flattened alpha.

## Phase 6: User Story 4 — SVG thumbnail (P4)

**Independent test**: send an SVG → a thumbnail shows; original opens in the viewer.

- [ ] T015 [US4] In `src/utils/media-meta.ts`: rasterize an SVG thumbnail/poster via `<img>`→canvas; keep the original SVG for the viewer.
- [ ] T016 [P] [US4] Drive (US4): send SVG → thumbnail renders; screenshot.

**Checkpoint**: US4 shippable — SVG previews.

## Phase 7: Polish & Cross-Cutting

- [ ] T017 Verify no regression for working formats (JPEG, WebP animation, GIF animation, MP4, audio, files) via drive.
- [ ] T018 Run `/speckit-checklist` (zero-knowledge, Principle I): all conversion client-side, no server change, no new metadata, honest failures.
- [ ] T019 Full gate: `npm run build`, new vitest green, `npm run test:e2e -- e2e/media-interop.spec.ts`; drive screenshots reviewed (light + dark).
- [ ] T020 Update spec `Status` → in-review and `make roadmap` when opening the PR.

## Dependencies & order
Setup → Foundational (T002–T003 block all) → US1 (MVP, no dep) → US2 (adds the HEIC dep) → US3 → US4 → Polish. US1/US3/US4 need no new dependency; US2 introduces the wasm HEIC decoder.

## MVP
US1 (WebM) — the reported bug, no new dependency, reuses the existing ffmpeg path.
