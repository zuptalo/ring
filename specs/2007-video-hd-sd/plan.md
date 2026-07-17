# Implementation Plan: HD/SD video sends are transcoded for real on device

**Branch**: `fix/2007-video-hd-sd` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2007-video-hd-sd/spec.md`

## Summary

Choosing HD or SD when sharing a video currently relabels the clip but ships the
original bytes (reported: 2160p · 0:22 · 66.8 MB identical across Original/HD/SD).
Two defects combine: (1) the badge is set to the *requested* tier and never
reconciled with reality, and (2) on iPhone 4K HEVC the on-device transcode silently
falls through to the original (WebCodecs path throwing into an OOM-prone ffmpeg.wasm
leg). The fix has two device-independent-then-device-verified parts: **(A) label by
the achieved result, never the request** — a small, fully testable correctness fix
that closes the "it lied" half on every platform; and **(B) make the WebCodecs
transcode actually complete on iOS HEVC 4K** and guard the ffmpeg fallback so it can
never OOM-crash the tab, so HD/SD genuinely shrink the file. No server, API, schema,
or crypto change — transcoding stays entirely client-side, pre-encryption.

## Technical Context

**Language/Version**: TypeScript (ES modules, `@/`→`src/`), Vue 3 `<script setup>` + Ionic. Go server **untouched**.

**Primary Dependencies**: Existing only — WebCodecs (`VideoDecoder`/`VideoEncoder`/`OffscreenCanvas`), `mp4box` (demux), `mp4-muxer` (mux), `@ffmpeg/ffmpeg` + bundled `@ffmpeg/core` 0.12 (fallback). No new dependency.

**Storage**: IndexedDB (`media`, `messages` stores). No `DB_VERSION` bump, no new store, no server migration.

**Testing**: vitest unit (pure functions in `media-encode.ts` / engine helpers), Playwright e2e under `e2e/` (Chromium, real send flow), manual on-device (maintainer iPhone via the dev deployment) for the iOS-HEVC-4K claim.

**Target Platform**: Installed PWA on iOS Safari 16.4+ and Android/Chromium. Server unchanged.

**Project Type**: Web (Vue 3 PWA client + Go server) — this change is client-only.

**Performance Goals**: A ~20–30 s 2160p clip transcodes on a current iPhone without freezing the UI or losing the send (SC-005); SD ≥60% smaller than original (SC-001); HD < original and > SD (SC-002).

**Constraints**: Zero-knowledge (Principle I) — transcode before encryption, server sees ciphertext only. Send is never blocked by transcode failure (FR-006). ffmpeg.wasm ~2 GB memory wall on mobile — must not crash the tab. Output must be H.264 in mp4 so both iOS and Chrome/Android can play it.

**Scale/Scope**: Localized to the outgoing-media encode path. Touched files: `media-video.ts`, `media-video-webcodecs.ts`, `media-video-ffmpeg.ts`, `media-encode.ts`, `queries.ts` (encode-phase labeling in `runMediaJob` + the Posts path in `createPost`). No UI component change (the badge already reads `mediaQuality`).

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero-Knowledge Boundary | ✅ PASS | Transcode is client-side, pre-encryption. Server still relays opaque ciphertext + blob id. No new wire metadata; `MediaRef.quality` already exists and now carries the *achieved* tier. See spec **Zero-Knowledge Impact** + research.md. |
| II. Spec-Driven | ✅ PASS | Full pipeline followed; `2007` hotfix band; branch `fix/2007-video-hd-sd`. |
| III. Test-Driven | ✅ PASS (planned) | Bug fix ⇒ a **failing regression test first**: unit test for `achievedQuality` + an e2e that an SD send produces a smaller `mediaSize` than Original and is not mislabeled. tasks.md will order Red→Green. |
| IV. Crypto Discipline | ✅ N/A | No crypto touched; `messaging.ts` untouched; `queries.ts → messaging.ts` direction preserved. |
| V. Offline-First Data | ✅ PASS | No store/`DB_VERSION` change; reuses existing fields; resume via `compressQuality` preserved. |
| VI. Stateless Server / Migrations | ✅ N/A | No server or migration change. |
| VII. Quality Gates | ✅ PASS (planned) | `npm run build`, `go build/vet/test`, vitest, e2e gates apply. Release-note subject planned: `fix(media): HD and SD video sends now actually shrink the video before sending`. |
| VIII. Traceable Delivery | ✅ PASS | `/speckit-taskstoissues` → issues; PR lists `Closes #N`; ROADMAP regenerated. |
| IX. Privacy & Data Minimization | ✅ PASS | Strictly reduces transmitted data; no telemetry added. |
| X. A11y / i18n | ✅ PASS | Badge text only ("Original/HD/SD"), already-existing surface; no direction/label regression. |
| XI. Ionic-First UI | ✅ N/A | No new UI; badge rendering unchanged. |

**Principle I — checklist requirement**: `/speckit-checklist` is REQUIRED for specs touching Principle I. This change does *not* alter the zero-knowledge boundary (no new plaintext or metadata crosses the wire; transcode is pre-encryption), so the touch is confirmatory, not substantive. A short crypto/ZK checklist will be generated during `/speckit-checklist` to document that the boundary is unchanged. **No gate violations; Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/2007-video-hd-sd/
├── plan.md              # This file
├── spec.md              # Feature spec (+ Clarifications)
├── research.md          # Phase 0 — engine root-cause + decisions
├── data-model.md        # Phase 1 — requested vs achieved quality
├── quickstart.md        # Phase 1 — how to verify (automated + on-device)
├── checklists/
│   └── requirements.md   # spec quality checklist (+ ZK checklist from /speckit-checklist)
└── tasks.md             # Phase 2 — created by /speckit-tasks
```

No `contracts/` directory: this feature exposes no new external interface (no API,
no server endpoint). The only "contract" is the internal semantic that
`MediaRef.quality` is the *achieved* tier — documented in data-model.md.

### Source Code (repository root) — files touched

```text
src/services/
├── media-encode.ts            # + achievedQuality() pure helper; keep compress* fallbacks
├── media-video.ts             # orchestrator: clearer fallthrough + ffmpeg size/time guard
├── media-video-webcodecs.ts   # fix sample-collection race; robust encoder-config probe;
│                              #   deterministic error propagation; hvc1 handling
└── media-video-ffmpeg.ts      # wall-clock timeout + input-size ceiling (no OOM-crash)

src/db/
└── queries.ts                 # runMediaJob: set mediaQuality = achievedQuality(...) after
                               #   encode (chat path); createPost: same for the Posts path

tests:
src/services/*.test.ts         # unit: achievedQuality(), engine helper behavior
e2e/                           # e2e: SD/HD send produces smaller mediaSize, honest badge;
                               #   Original is byte-identical
```

## Implementation approach (detail for /speckit-tasks)

### Part A — Honest labeling (device-independent, fully testable)

1. Add a pure `achievedQuality(requested, originalSize, uploadedBlob)` to
   `media-encode.ts` (see data-model.md). Returns `'original'` when no real
   reduction occurred (requested was original/undefined, or `uploadedBlob.size >=
   originalSize` / it is the original reference), else the requested tier.
2. In `runMediaJob` (`queries.ts`), after the encode phase and before reading meta /
   sealing, set `message.mediaQuality = achievedQuality(message.compressQuality ??
   'original', media.blob.size, uploadBlob)`. Because `sealMediaAndEnqueue` copies
   `message.mediaQuality` into `MediaRef.quality`, the recipient badge is corrected
   for free.
3. Apply the same reconciliation in the Posts path (`createPost`, `queries.ts:2065`).
4. Unit-test `achievedQuality` exhaustively; e2e-assert the badge never shows HD/SD
   when bytes weren't reduced.

### Part B — Make HD/SD actually transcode (iOS HEVC 4K)

5. **WebCodecs sample-collection race** (`media-video-webcodecs.ts` ~L171-224):
   replace the `setTimeout(resolve, 0)` "safety" resolve, which can fire before all
   `onSamples` batches arrive (truncated/empty output → trips the "not smaller" /
   "audio dropped" guards → falls into ffmpeg). Resolve only on genuine extraction
   completion (track per-track sample counts to `nb_samples`; keep a real timeout
   as a *failure*, not a premature success).
6. **Robust encoder-config probe**: order candidates main/baseline before High;
   for each, gate with `isConfigSupported` *and* fall back to a config without the
   `hardwareAcceleration` hint; treat a `configure`/`encode`/`flush` rejection as
   "candidate failed → try next", never an unhandled throw. Surface which config
   won via `console.info` for device diagnosis.
7. **Deterministic error propagation**: ensure decoder/encoder `error` callbacks
   reject the transcode promise so the ladder falls through cleanly instead of
   hanging; keep `hvc1.*` decode (don't trust `isConfigSupported` blindly — the
   existing decode-then-mux already validates by producing frames).
8. **Guard ffmpeg.wasm** (`media-video-ffmpeg.ts`): add a wall-clock timeout and an
   input byte-size / source-resolution ceiling above which ffmpeg is skipped (it
   would OOM on 4K). On timeout/skip, throw so the orchestrator falls through to the
   original — now labeled honestly by Part A. Never let it crash the tab.
9. **Orchestrator** (`media-video.ts`): keep WebCodecs→ffmpeg→original order; make
   the "output not smaller → next engine" and final "original" decisions explicit
   and logged so an on-device run is diagnosable.

### Part C — Verification (see quickstart.md)

10. Automated (Chromium/vitest/e2e): Part A fully; Part B happy path with an H.264
    sample (Chromium encodes H.264 reliably) → SD smaller than HD smaller than
    Original; Original byte-identical.
11. On-device (maintainer iPhone, dev deployment, `npm run build` then load the
    installed PWA): the reported 2160p HEVC .mov at SD/HD now yields a smaller,
    lower-resolution clip; Original unchanged; diagnostics confirm the WebCodecs
    path completed.

## Complexity Tracking

No constitution violations — table intentionally omitted.
