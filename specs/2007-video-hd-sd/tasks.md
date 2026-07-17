---
description: "Task list for 2007-video-hd-sd"
---

# Tasks: HD/SD video sends are transcoded for real on device

**Input**: Design documents from `/specs/2007-video-hd-sd/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: REQUIRED. Constitution Principle III mandates a bug fix begin with a
failing regression test that reproduces the bug before the fix lands.

**Organization**: By user story. US2 (honest labeling) is device-independent and
fully automatable; US1 (real transcode) is automatable on the happy path in Chromium
and verified on-device for the iOS-HEVC-4K case (research Decision 3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- File paths are exact.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Test fixtures the regression suite needs.

- [ ] T001 [P] Add a small, real, **downscalable** H.264 mp4 fixture (**1920×1080**, 2–3 s, audio track present) at `e2e/fixtures/sample-1080p.mp4` for transcode tests. Its longest edge (1920) MUST exceed **both** the HD cap (1280) **and** the SD cap (640) so HD downscales to ≤1280, SD to ≤640, and Original/HD/SD yield three distinct sizes. (A ≤1280 source would be *already within* HD and correctly labeled Original — it would not exercise the HD path.) Document its origin in `e2e/fixtures/README.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend the dev-only test hook so both stories can drive a REAL video send and read back the *achieved* facts. Blocks the e2e tests in US1 and US2.

**⚠️ CRITICAL**: No story e2e can be written until this is done.

- [ ] T002 [US-shared] Extend `window.__ringTest` in `src/services/testhook.ts`: add `sendRealVideoQuality(chatId, fixtureUrl, quality)` that `fetch`es the fixture URL (e.g. `/fixtures/sample-1080p.mp4` served by the test Vite), builds a real `Blob`, and sends it through the normal media job (`dbSendMediaMessage(... 'video' ... { quality })`) — NOT the 4-byte stub used by `sendMediaQuality`. (Place the fixture where the test Vite can serve it, e.g. symlinked/copied into `public/fixtures/` or referenced via an absolute test URL.)
- [ ] T003 [US-shared] Extend `mediaInfo(messageId)` in `src/services/testhook.ts` to also return `mediaQuality`, `mediaSize`, `mediaWidth`, `mediaHeight`, and `status`, so e2e can assert achieved quality + size without UI scraping. (Keep returning content-free facts only — ZK checklist CHK006.)
- [ ] T004 [US-shared] Add a poll helper in `e2e/helpers.ts` (or reuse existing) that waits until a media message reaches `status === 'pending'`/`sent` so size/quality assertions run after the encode phase completes.

**Checkpoint**: Harness can send a real clip at a chosen tier and read back achieved quality + size.

---

## Phase 3: User Story 1 - Choosing HD or SD actually shrinks the video (Priority: P1) 🎯

**Goal**: An HD/SD send genuinely downscales resolution and reduces bytes on device before sending; the ffmpeg fallback can never OOM-crash the tab; iPhone 4K HEVC transcodes via WebCodecs instead of silently sending the original.

**Independent Test**: Send `sample-720p.mp4` at SD and Original; assert the SD `mediaSize` is materially smaller and `mediaWidth` ≤ SD cap, while Original is unchanged (size assertion only — label is US2).

### Tests for User Story 1 (write FIRST, must FAIL before impl) ⚠️

- [ ] T005 [P] [US1] e2e `e2e/video-quality.spec.ts`: send `sample-1080p.mp4` at `original`, `hd`, `sd`; assert three **distinct** `mediaSize` values with `sd < hd < original`, and `mediaWidth(sd) ≤ 640`, `mediaWidth(hd) ≤ 1280`, `mediaWidth(original) == 1920`. (Reproduces the bug: today all three are equal. Note: SC-001's "≥60% smaller" is a device/source-specific target verified in T021, not asserted on the synthetic fixture — C4.)
- [ ] T006 [P] [US1] Test the orchestration/fallback **decision** (not the browser engines): in `src/services/media-video.test.ts`, `vi.mock` the `./media-video-webcodecs` and `./media-video-ffmpeg` modules and assert `compressVideoAdaptive` (a) returns the **original blob reference** without throwing when both mocked engines throw / return a not-smaller blob (the "never block the send" contract, FR-006), and (b) returns the smaller blob when a mocked engine succeeds. (A real WebCodecs/ffmpeg run is browser-only and is covered by T005 + T021, not vitest — C2.)

### Implementation for User Story 1

- [ ] T007 [US1] Fix the sample-collection completion race in `src/services/media-video-webcodecs.ts` (`webcodecsTranscode`, ~L171-224): remove the premature `setTimeout(resolve, 0)` success; resolve the extraction promise only when each extracted track has delivered all `nb_samples` (keep a wall-clock timeout that *rejects* as failure, not a premature success), so truncated/empty output no longer trips the "not smaller"/"audio dropped" guards into the OOM-prone ffmpeg leg.
- [ ] T008 [US1] Make encoder-config selection robust in `src/services/media-video-webcodecs.ts`: order candidates main/baseline before High; for each, gate with `isConfigSupported` AND retry without the `hardwareAcceleration` hint; treat a `configure`/`encode`/`flush` rejection as "candidate failed → try next", never an unhandled throw. `console.info` the winning config (codec/profile only — content-free).
- [ ] T009 [US1] Ensure deterministic error propagation in `src/services/media-video-webcodecs.ts`: decoder/encoder `error` callbacks must reject the transcode promise (not throw into the void or hang) so `compressVideoAdaptive` falls through cleanly; keep `hvc1.*` decode validated by actual frame production.
- [ ] T010 [US1] Guard the ffmpeg fallback in `src/services/media-video-ffmpeg.ts`: add a wall-clock timeout and an input byte-size / source-resolution ceiling above which ffmpeg.wasm is skipped (it OOMs on 4K, ~2 GB wall — research Decision 2). On timeout/skip, throw so the orchestrator falls through to the original; never crash the tab.
- [ ] T011 [US1] In `src/services/media-video.ts` (`compressVideoAdaptive`): make the "output not smaller → try next engine" and final "send original" decisions explicit and content-free-logged so an on-device run is diagnosable (which path ran, why it fell through). No behavior change to the WebCodecs→ffmpeg→original order.
- [ ] T011a [US1] FR-009 (progress + responsiveness): confirm the existing `setCompressProgress` reporting still advances during the transcode and the encode runs off the main render path (the media job is already async/sequential). Assert in T005 that the message passes through `status === 'compressing'` before `pending`; verify UI responsiveness during a real 4K transcode in the on-device step (T021). No new progress mechanism — this guards the existing one against the T007 race fix.

**Checkpoint**: Chromium e2e shows SD < HD < Original on the fixture; engine ladder is diagnosable and crash-safe.

---

## Phase 4: User Story 2 - The badge never lies about what was sent (Priority: P1)

**Goal**: `mediaQuality` (sender + recipient badge) reflects the *achieved* result, never the requested tier. A clip that wasn't actually re-encoded reads "Original".

**Independent Test**: Force a no-reduction case (e.g. an already-tiny clip, or stub the engine to return the original) and assert `mediaInfo.mediaQuality === 'original'`; a genuinely reduced send reads `'sd'`/`'hd'` with a consistent reduced `mediaWidth`.

### Tests for User Story 2 (write FIRST, must FAIL before impl) ⚠️

- [ ] T012 [P] [US2] Unit `src/services/media-encode.test.ts`: `achievedQuality(requested, originalSize, uploadedBlob)` — `original`/`undefined` → `'original'`; requested tier but `uploadedBlob.size >= originalSize` (or is the original ref) → `'original'`; requested tier with a genuinely smaller blob → that tier.
- [ ] T013 [P] [US2] e2e in `e2e/video-quality.spec.ts`: a send that does not reduce the file is **never** badged HD/SD (`mediaQuality === 'original'`); a reduced send's `mediaQuality` matches the reduced `mediaWidth` tier (SC-004 / FR-007 / FR-008).

### Implementation for User Story 2

- [ ] T014 [US2] Add the pure `achievedQuality(requested, originalSize, uploadedBlob)` helper to `src/services/media-encode.ts` (no IndexedDB/DOM); single source of truth for the labeling invariant (data-model.md).
- [ ] T015 [US2] Wire it into the chat path `runMediaJob` in `src/db/queries.ts` (~L1541, after the encode phase, before reading meta / `sealMediaAndEnqueue`): set `message.mediaQuality = achievedQuality(message.compressQuality ?? 'original', media.blob.size, uploadBlob)`. (`sealMediaAndEnqueue` already copies `message.mediaQuality` into `MediaRef.quality`, so the recipient badge is corrected for free.)
- [ ] T016 [US2] Wire it into the Posts path `createPost` in `src/db/queries.ts` (~L2065): after `compressImage`/`compressVideo`, set the post media's quality to `achievedQuality(q, opts.media.blob.size, toUpload)` so feed posts are honest too.

**Checkpoint**: No video/photo is ever badged a quality it didn't achieve, on either side.

---

## Phase 5: User Story 3 - Original quality is sent untouched (Priority: P2)

**Goal**: Picking Original sends byte-identical bytes; the achieved-quality change does not regress the passthrough.

**Independent Test**: Send the fixture at Original; assert the delivered `mediaSize` equals the source size and the badge reads "Original".

### Tests for User Story 3 (write FIRST) ⚠️

- [ ] T017 [P] [US3] e2e in `e2e/video-quality.spec.ts`: Original send delivers a `mediaSize` equal to the source and `mediaQuality === 'original'` (regression guard for FR-003 / SC-003).

### Implementation for User Story 3

- [ ] T018 [US3] Confirm/guard the Original path in `src/db/queries.ts`: `compressible` stays false for `original` (no encode phase runs), `achievedQuality` returns `'original'`, and no re-encode touches the bytes. Add a brief comment documenting the passthrough invariant. (Expected: no code change beyond the comment — the test proves it.)

**Checkpoint**: Original is provably untouched; all three stories pass in Chromium.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T019 [P] Add an interactive drive scenario `drive/scenarios/video-quality.mjs` that sends the fixture at Original/HD/SD between two test users and screenshots the three bubbles to `.tmp/drive/` (for visual confirmation + the verify step).
- [ ] T020 Run the full gate suite: `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...`; vitest; `npm run test:e2e -- video-quality`. All green (Principle VII).
- [ ] T021 On-device verification (maintainer iPhone via the dev deployment): `npm run build`, load the installed PWA, and run quickstart.md's on-device steps on the reported 2160p HEVC clip — confirm SD/HD now deliver smaller, lower-resolution files, Original is unchanged, the app stays responsive, and the console shows the WebCodecs path completing. Record the result in the PR.
- [ ] T022 Set `Status: in-progress` (then `in-review`) in `specs/2007-video-hd-sd/spec.md` and run `make roadmap` so ROADMAP.md stays current (Principle VIII / CI guard).
- [ ] T023 Commit with the release-note subject `fix(media): HD and SD video sends now actually shrink the video before sending` (Principle VII — plain-language, no spec/issue refs).

---

## Phase 7: Quality tiers (Full HD / 4K) + suitability filtering (scope extension)

**Goal**: Offer SD / HD / Full HD / 4K / Original (FR-011–013); each non-Original tier
re-encodes to a target resolution+bitrate; the picker shows only tiers the source can
produce (no upscaling), for photos and videos.

- [ ] T024 [P] `media-encode.ts`: add `'fhd'`/`'4k'` to `Quality`; add `QUALITY_TIERS` (single source of truth for caps + labels), `qualityLabel()`, and `availableQualities(longEdge)` (suitability: tier shown iff `longEdge ≥ maxEdge`, + Original). Expand `IMAGE_PRESETS` to all four tiers; generalize `achievedQuality` to any tier.
- [ ] T025 [P] `media-video.ts`: expand `VIDEO_PRESETS` to sd/hd/fhd/4k (4K = 3840 @ 18 Mbps re-encode); widen `compressVideoAdaptive` quality param.
- [ ] T026 `media-video-webcodecs.ts`: add Level 5.1/5.2 encoder candidates so 4K (2160p) is encodable (Level ≤4.0 tops out ~1080p) — keep ≤4.0 first so ≤1080p targets are unaffected.
- [ ] T027 `db/types.ts` + `queries.ts`: widen `compressQuality`/`mediaQuality` and `sendMediaMessage` opts to the new tiers.
- [ ] T028 `ChatDetailPage.vue`: probe source resolution (`maxSourceLongEdge`) before the picker; build the action sheet from `availableQualities` (highest fidelity first, skip the sheet when only Original applies); badge via `qualityLabel`.
- [ ] T029 [P] Tests: unit `availableQualities`/`qualityLabel`/`achievedQuality` for all tiers; e2e suitability assertion + Full HD shrink; drive scenario covers all five tiers on a 4K source.
- [ ] T030 Fix the dead ffmpeg.wasm fallback: ship the **ESM** `@ffmpeg/core` build at `public/ffmpeg/` (the UMD build can't load in @ffmpeg/ffmpeg 0.12's module worker → `failed to import ffmpeg-core.js`, so the universal fallback never worked). Without this, any video WebCodecs can't handle (e.g. HEVC in a non-Safari browser) silently degraded to Original. Verified: forcing the ffmpeg path now transcodes HD/SD on a real clip.
- [ ] T034 Drop deleted media/docs from the gallery (FR-015): `listChatMedia`, `listChatMediaAll`, and `listChatDocs` exclude `mediaCleared` messages, so media/docs deleted to free space no longer leave empty placeholder tiles/rows in the Media/Docs tabs or the fullscreen viewer (the chat bubble still shows "removed to free space"). Freed-with-previews items keep `mediaId` and still show. e2e in `media-cleanup.spec.ts` asserts the gallery/doc counts drop after a delete.
- [ ] T033 Store the SENT copy on the sender, not the original (FR-014): `sendMediaMessage` keeps the original blob during encode/upload (so retries re-encode from it), and `runMediaJob` swaps the local `Media` blob/size/mime to the sent (compressed) blob once the upload succeeds (only when genuinely compressed; 'original' untouched). Fixes overstated storage usage + badge/storage disagreement; sent items stay counted + cleaned up like received. e2e asserts `storedBytes === mediaSize` for compressed sends and full bytes for Original (`mediaInfo.storedBytes` added).
- [ ] T032 Drop the 4K tier (both photos and videos) after on-device testing: 4K video re-encode is unreliable/slow on iOS (stalls then falls back to Original) and 4K photo re-encode barely beats Original. Full HD becomes the top tier. Remove `'4k'` from `Quality`/`QUALITY_TIERS`/presets/persisted types/test-hook params; revert the 4K-only Level 5.1/5.2 encoder candidates; update unit/e2e/drive tests. SD/HD/Full HD verified working on-device (correct resolution/size/metadata).
- [ ] T031 Fix the iPhone-HEVC WebCodecs failure (`cannot read audio config`): in `media-video-webcodecs.ts`, walk the esds descriptor tree for the AAC config instead of a fixed `descs[0].descs[0]` path, and synthesize an AAC-LC `AudioSpecificConfig` from the track's sample rate + channels when the container's esds can't be parsed (`synthAacAsc`). Verified end-to-end on the reporter's real 70 MB HEVC 4K .mov (→ 14.2 MB at Full HD). Unit test pins the synthesized ASC bytes.

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** blocks all story e2e.
- **US1, US2, US3 are independent** and can proceed in parallel after Phase 2. US1's "badge reads SD" cosmetic depends on US2, but US1's *independent* test asserts size only, so it stands alone.
- **Within each story**: tests first (must fail), then implementation (Principle III, Red→Green).
- **Phase 6 (Polish)** after the desired stories are green.

### Parallel Opportunities

- T005, T006 (US1 tests) ∥ T012, T013 (US2 tests) ∥ T017 (US3 test) — different test files.
- T007–T009 all edit `media-video-webcodecs.ts` → **sequential** (same file).
- T010 (`media-video-ffmpeg.ts`) ∥ the webcodecs edits (different files).
- T014 (`media-encode.ts`) ∥ T007–T011, but T015/T016 (`queries.ts`) depend on T014.

---

## Implementation Strategy

**MVP (safest first increment) = User Story 2.** Honest labeling is device-independent
and fully automatable; shipping it alone already kills the "it said HD but sent the
original" trust bug on every platform. Then User Story 1 makes HD/SD genuinely
smaller (Chromium-verified happy path + on-device iOS HEVC verification). User Story 3
is a thin regression guard. Each story is an independent, testable increment.

## Notes

- [P] = different files, no dependency. Same-file tasks (the three webcodecs edits)
  are sequential.
- All new diagnostics are content-free (codec/size/path only) — ZK checklist CHK006.
- No `DB_VERSION` bump, no server/migration/API change, no crypto change.
- Verify each test fails before implementing; commit per logical group.
