# Tasks: Pause/resume during video-message recording

**Branch**: `fix/2005-pause-resume-during` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Input**: plan.md, research.md, data-model.md (no data model), quickstart.md. No contracts/
(internal client UI; no external interface).

**Tests**: TDD per Constitution Principle III. The recorder's `MediaRecorder`/UI is verified
via a `drive/` fake-media scenario (recorded harness limitation — no recordable media device
in vitest); see plan.md Constitution Check.

> **Design revision (2026-06-22):** after on-device testing the design changed from
> pause/resume to **Stop → review → Send/Retake** (never auto-send). T002/T003 (the
> `rec-clock.ts` `recordedMs` helper + tests) and the pause/resume tasks T004–T010 below are
> **superseded**: recording is now a single continuous take; `rec-clock.ts` was removed.
> What shipped, in `VideoNoteRecorder.vue`: a real **Stop** (red square) that finalizes the
> take into a **review** state which plays the clip back, with **Retake · Play/Pause · Send**
> controls; max-length stops into review; nothing is sent without Send. T014–T016 (clean
> camera start, right-sized capture, gallery exclusion) shipped as written. The drive
> scenario (`video-note-pause.mjs`) was updated to verify stop→review→send + no auto-send.
> See spec.md for the authoritative FRs/SCs.

---

## Phase 1: Setup

- [X] T001 Confirm dev gates run clean on the branch baseline: `npm run build` (vue-tsc + vite) and `npx vitest run` both green before any change.

## Phase 2: Foundational (the testable seam — blocks the UI wiring)

- [X] T002 [P] [US1] Add FAILING unit tests in `src/utils/rec-clock.test.ts` for a not-yet-existing `recordedMs({ accumMs, segStartMs, paused }, nowMs)`: (a) recording → `accumMs + (nowMs - segStartMs)` (e.g. `{0,1000,false}@4000 → 3000`); (b) paused excludes the gap (`{3000, 9999, true}@9_999_999 → 3000`); (c) resume continues not restarts (`{3000, 10_000, false}@12_000 → 5000`). Run `npx vitest run` and confirm they FAIL.
- [X] T003 [US1] Implement `recordedMs` in `src/utils/rec-clock.ts` (`accumMs + (paused ? 0 : nowMs - segStartMs)`); re-run `npx vitest run` until green.

## Phase 3: User Story 1 — pause and resume a recording (P1)

**Goal**: the control pauses/resumes the same take; timer + ring freeze and continue.
**Independent test**: record → pause (timer/ring freeze) → resume (continue) → send one clip spanning both segments (drive fake-media, quickstart.md).

- [X] T004 [US1] In `src/components/VideoNoteRecorder.vue`, replace the recorder clock: add `const paused = ref(false)`, replace `startMs` with `accumMs` + `segStartMs`, and drive `elapsed` from `recordedMs({ accumMs, segStartMs, paused: paused.value }, Date.now())` on the existing 100ms tick (the progress ring derives from `elapsed`, so it freezes automatically). Initialize `accumMs=0`, `segStartMs=Date.now()` in `beginRecording`.
- [X] T005 [US1] Add `togglePause()` to `VideoNoteRecorder.vue`: when recording → `accumMs += Date.now() - segStartMs; recorder.pause(); paused.value = true`; when paused → `segStartMs = Date.now(); recorder.resume(); paused.value = false`. No-op when `recorder` is null (still in the 3-2-1 countdown) or `recorder.state === 'inactive'`.
- [X] T006 [US1] Change `beginRecording`'s auto-stop to compare RECORDED time: `if (recordedMs({accumMs, segStartMs, paused: paused.value}, Date.now())/1000 >= MAX) void stopAndSend()`, so a paused recording is never auto-finalized while paused (FR-007).

## Phase 4: User Story 2 — control reflects paused vs recording (P2)

**Goal**: one control that signals state and is the tap target (red dot folded in).

- [X] T007 [US2] In `VideoNoteRecorder.vue` template, replace `<span class="vn-recdot"></span>` with `<button class="vn-pause" :class="{ paused }" :aria-label="paused ? 'Resume recording' : 'Pause recording'" @click="togglePause">` containing a state glyph (recording → red square/● indicator; paused → resume ▶, e.g. `playOutline`/`pause` from ionicons). FOLD the live-recording cue into this button — remove the separate decorative dot (plan.md locked decision, FR-005).
- [X] T008 [US2] Add `.vn-pause` styles in `VideoNoteRecorder.vue` `<style>` (built from existing tokens; reuse the `.vn-btn` sizing): a clear recording state (red) vs paused state (resume affordance), replacing the old `.vn-recdot` rule. Keep the bar layout Delete · Pause/Resume · Send.

## Phase 5: User Story 3 — send/delete from either state (P2)

- [X] T009 [US3] Update `stopAndSend` in `VideoNoteRecorder.vue`: if `paused.value`, call `recorder.resume()` before `rec.stop()` (some browsers won't finalize while paused), and compute `dur` from `recordedMs(...)` rather than raw `elapsed`. Ensure tracks/recorder are still stopped and the overlay closes (FR-006).
- [X] T010 [US3] Update `teardown`, `cancel`, and `flip` in `VideoNoteRecorder.vue` to reset `paused.value=false`, `accumMs=0`, `segStartMs=0`; teardown must still resume-if-paused before stopping so a paused recorder finalizes/releases cleanly, and stop all tracks (no orphaned camera — SC-005).

## Phase 6: Verification & polish

- [X] T011 [US1] Add `drive/scenarios/video-note-pause.mjs` (extend the driver to launch Chromium with `--use-fake-device-for-media-stream` + `--use-fake-ui-for-media-stream`): open the video-note recorder, pause (assert/screenshot timer+ring frozen and the resume affordance), resume (assert they continue), then Send and confirm a clip is sent. Capture screenshots. Covers SC-001/SC-002/SC-004.
- [X] T012 Run the full client gate: `npm run build` (vue-tsc + vite) and `npx vitest run` — both green.
- [X] T013 Set spec `**Status**: in-progress` (→ shipped on merge) and run `make roadmap`; confirm the ROADMAP.md diff is intended (never hand-edit).

## Phase 7: Adjacent video-message fixes (folded in)

- [X] T014 [US4] In `VideoNoteRecorder.vue` `start()`, gate the 3-2-1 countdown + black-fade reveal on the camera's FIRST FRAME: keep the cover fully opaque (and the `<video>` hidden) until the preview fires `loadeddata`/`playing`, then begin the countdown; add a timeout fallback (e.g. ~1.5s) so a camera that never reports a frame doesn't hang. Fixes the scaled-down whole-frame flash (FR-009, SC-006).
- [X] T015 [US5] In `VideoNoteRecorder.vue`, constrain capture: `getUserMedia` video `{ width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: { ideal: 1 }, frameRate: { ideal: 24, max: 30 } }`, and `new MediaRecorder(stream, { mimeType?, videoBitsPerSecond: ~800_000, audioBitsPerSecond: 64_000 })`. Right-sizes video messages for the in-chat circle (FR-010, SC-007).
- [X] T016 [US6] Exclude video notes from the media gallery: in `src/db/queries.ts` `listChatMedia`, filter `m.kind === 'image' || (m.kind === 'video' && !m.videoNote)` (mirrors the viewer's existing `!m.videoNote`), so they don't appear in "Media, links & docs" and have no fullscreen entry point (FR-011/FR-012, SC-008).
- [X] T017 Re-verify: `npm run build` + `npx vitest run` green; re-run `drive/scenarios/video-note-pause.mjs` (clean camera open, pause/resume, send); then rebuild `dist/` so ring-dev (:8443 `STATIC_DIR=dist`) serves the changes for on-device testing.

## Phase 8: Flip-during-recording (folded in after device testing)

- [X] T018 [US?] Make camera flip continue the SAME take (FR-013/SC-009): switch the recorder to a **canvas capture pipeline** in `VideoNoteRecorder.vue` — draw the live camera (centre-cropped square) into an offscreen canvas and record `canvas.captureStream()` + a persistent audio track via `MediaRecorder`. On flip, acquire the other camera and swap only the preview feed; the canvas draw loop, audio track, and recorder keep running, so the clip continues uninterrupted (no restart/countdown). `stopToReview`/`teardown` stop the camera, mic, and canvas streams; the poster is captured from the canvas. Verified by the drive scenario's flip-keeps-recording check.

---

## Dependencies
- T002 (failing test) → T003 (implementation) → everything in Phase 3+ (which consumes `recordedMs`).
- T004 → T005 → T006 (same component clock; sequential).
- T007 → T008 (template then styles).
- T009, T010 depend on T005 (togglePause/paused state exist).
- T011 after the UI wiring (T004–T010).

## Parallel example
- T002 (write failing test) can be authored alongside reading the component, but T003+ wait on it.
- Within the component all edits touch one file (`VideoNoteRecorder.vue`) → sequential.

## MVP
US1 (T002–T006) — the working pause/resume with correct recorded-time accounting.
