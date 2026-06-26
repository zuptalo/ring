# Implementation Plan: Media Sharing & Viewer Improvements

**Branch**: `feat/1018-media-sharing-and` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1018-media-sharing-and/spec.md`

## Summary

Three independent client-side improvements to media sharing, each mapping to one user story:

- **US1 (P1, bug)** — Portrait/rotated videos play rotated for the recipient. Root cause: the WebCodecs compression path reads a video's coded dimensions and ignores the MP4 **display matrix** (rotation), so it re-encodes a portrait capture as landscape bytes with no rotation applied. Fix: read the track rotation from the demuxer and bake the correct orientation into the re-encoded frames (swap target dimensions + rotate the canvas draw for 90/180/270). The ffmpeg fallback already auto-rotates (bakes rotation into pixels), so the bug is WebCodecs-specific; verify the fallback stays correct.
- **US2 (P2)** — Message thumbnails are generated at 480px@JPEG-0.6 (video poster) and 400px@0.7 (image), below the intended 512px "bubble" tier, so they look soft/pixelated on Retina. Fix: generate the wire poster at ~512px longest edge with quality tuned to a ~40KB cap (step quality down if over budget). No schema change — the `poster` field and the derived grid/strip tiers already exist.
- **US3 (P3)** — The full-screen viewer already has custom pinch-zoom (max 5×), pan with hard clamp, double-tap (2.5×), and a 0.22s CSS transition. It lacks the native *feel*: momentum/inertia on pan release, rubber-band/overscroll at bounds, pinch centered on the gesture midpoint, and a guaranteed zoom reset when paging between items. Fix: enhance the existing vanilla-JS gesture code in `MediaViewer.vue` for 60fps inertia + rubber-banding; no new library.

All work is strictly client-side; the server continues to relay opaque ciphertext. No server, wire-schema, or DB-version change.

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>` + Ionic; client only. No Go server changes.

**Primary Dependencies**: Existing only — WebCodecs (`VideoDecoder`/`VideoEncoder` + mp4box demux in `media-video-webcodecs.ts`), ffmpeg.wasm fallback (`media-video-ffmpeg.ts`), Canvas 2D for poster/thumb generation (`src/utils/media-meta.ts`), libsodium ratchet sealing (unchanged). No new runtime dependency (US3 stays vanilla-JS gestures).

**Storage**: IndexedDB via `src/db/idb.ts`. Media message fields (`posterData`, `mediaWidth/Height`) and the `Media` store tiers (`posterBlob`/`posterGrid`/`posterStrip`) already exist — **no new object store, no `DB_VERSION` bump**.

**Testing**: vitest unit tests (`npm run test:unit`) co-located as `*.test.ts`; Playwright e2e under `e2e/` (`npm run test:e2e`). Real-device check required for US1 (headless fake-media can't fully exercise capture orientation).

**Target Platform**: Installable PWA on iOS/Android (phones/tablets) + desktop browsers. US3's iOS-smooth feel targets touch devices.

**Project Type**: Web (Vue 3 PWA client). Single-side change (client).

**Performance Goals**: Viewer pinch/pan hold 60fps with no dropped frames on typical devices (SC-005); thumbnails ≤ ~40KB at longest-edge ~512px (SC-003/SC-004); no measurable send/sync regression for a typical photo message.

**Constraints**: Zero-knowledge (all transforms client-side, thumbnail stays inside the sealed envelope); offline-capable (thumbnails + zoom work on already-downloaded media); backward-compatible (old posters/encodings still render); send must never be blocked — orientation/thumbnail failures fall back to today's behavior.

**Scale/Scope**: ~3 service/util files (US1, US2) + 1 component (US3) + tests. No migration, no new endpoint.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1 design.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS. All encode/transcode/thumbnail/orientation work is client-side; thumbnails already ride inside the sealed `MediaRef`. The server sees only ciphertext and opaque blob ids; nothing new crosses the boundary. → **`/speckit-checklist` is REQUIRED** (Principle I), to be run before `/speckit-implement`. A **Zero-Knowledge Impact** note is in research.md.
- **II. Spec-Driven Development** — PASS. specify → clarify (done) → plan (this) → tasks → analyze → taskstoissues → implement. Branch/commit/PR traceable to spec 1018.
- **III. Test-Driven Development** — PASS (committed). `tasks.md` will order failing tests first: a unit test reproducing the WebCodecs rotation bug (US1) before the fix; unit tests for the thumbnail size/quality budget (US2); and an e2e/drive check for viewer gesture behavior (US3, user-facing). US1 is a defect, so it begins with a failing regression test per the TDD mandate.
- **IV. Crypto Discipline** — PASS. No crypto changes; reuses the existing ratchet/sealing path unchanged. The poster stays a field inside the already-encrypted `MessagePayload`.
- **V. Offline-First Data Integrity** — PASS. No new/changed object store → no `DB_VERSION` bump, no migration. Existing messages render unchanged.
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No server code, no SQL migration, no `SECRETS_KEY` impact.
- **VII. Quality Gates Are the Definition of Done** — PASS. `npm run build` (typecheck), `test:unit`, `test:e2e`, plus the real-device orientation check. The PWA stays `registerType: 'prompt'`. User-facing commit subjects written as plain-language release notes.
- **XI. Ionic-First UI** — JUSTIFIED DEVIATION (see Complexity Tracking). The full-screen pinch-zoom/pan surface has no stock Ionic equivalent and already exists as bespoke gesture code; US3 enhances that existing surface with minimal vanilla-JS rather than adding a component or library.

No unjustified gate violations. Proceed.

## Project Structure

### Documentation (this feature)

```text
specs/1018-media-sharing-and/
├── plan.md              # This file
├── research.md          # Phase 0: decisions for rotation, thumbnail budget, gesture feel
├── data-model.md        # Phase 1: media-message / MediaRef fields (no schema change)
├── quickstart.md        # Phase 1: how to validate each user story
├── contracts/
│   └── media-ref.md     # The (unchanged) sealed MediaRef shape + "no server/wire-schema change"
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root) — files this feature touches

```text
src/
├── services/
│   ├── media-video-webcodecs.ts   # US1: read display-matrix rotation; rotate canvas re-encode (root cause ~L114-191)
│   ├── media-video-ffmpeg.ts      # US1: verify auto-rotate stays correct (fallback)
│   ├── media-video.ts             # US1: orchestration; ensure orientation preserved across engine choice
│   └── media-video.test.ts        # US1: failing-first rotation unit test + orientation assertions
├── utils/
│   ├── media-meta.ts              # US2: generateVideoPoster (480→512, q) + generateImageThumb (400→512, q) within ~40KB
│   ├── thumbs.ts                  # US2: reconcile bubble tier (512) with generation params
│   └── media-meta.test.ts         # US2: new — poster/thumb dimension + size-budget tests
├── components/
│   ├── MediaViewer.vue            # US3: inertia, rubber-band, pinch-centering, zoom reset between items
│   └── VideoPlayer.vue            # US1: confirm playback applies no extra rotation (plays oriented bytes)
└── db/types.ts                    # reference only — fields already present, no change

e2e/
└── media-viewer.spec.ts           # US3: extend for gesture behavior where drivable

drive/scenarios/
└── media-1018-*.mjs               # manual/visual validation (rotation, thumbnail crispness, zoom)
```

**Structure Decision**: Single client project (the repo-root Vue PWA). The feature splits cleanly along existing module boundaries: video transcode services (US1), thumbnail-generation utils (US2), and the viewer component (US3). Each user story is independently testable and shippable, matching the spec's P1/P2/P3 slicing. No `backend/` or `server/` changes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Principle XI: bespoke gesture surface in `MediaViewer.vue` (US3) | Native-feel pinch-zoom, momentum pan, and rubber-band overscroll for full-screen media; Ionic ships no zoomable image/viewer component | Stock Ionic components (ion-modal/ion-img) provide no pinch-zoom or inertial pan; `<ion-content scroll>` cannot deliver pinch-centered zoom or rubber-band feel. The bespoke surface already exists (added pre-1018); US3 enhances it with minimal vanilla-JS rather than introducing a gesture library (avoids a new dependency). |
