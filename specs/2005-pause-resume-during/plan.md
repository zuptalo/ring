# Implementation Plan: Pause/resume during video-message recording

**Branch**: `fix/2005-pause-resume-during` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2005-pause-resume-during/spec.md`

## Summary

> **Design revision (2026-06-22, after on-device testing):** the original plan was
> pause/resume the same take. In testing, the resume (▶) glyph misled the user into
> expecting *playback review*, and the clip auto-sent at max length. Per the user's
> decision, the design changed to **Stop → review → Send/Retake**: tapping Stop ENDS the
> take and plays it back for review; the user then Sends or Retakes; nothing is ever
> auto-sent (max-length stops into review). This removed the pause/resume machinery (and
> the `rec-clock.ts` helper/tests — recording is now a single continuous take). The
> camera-clean-start (FR-009), right-sized capture (FR-010), and gallery-exclusion
> (FR-011/012) work below is unchanged. See spec.md for the current FRs/SCs.

Replace the inert red square in the round video-note recorder (`VideoNoteRecorder.vue`)
with a working **Stop** control that ends recording and enters a **review** state (the
recorded clip plays back), offering **Send** or **Retake**. The clip is never sent without
an explicit Send, and reaching the max length stops into review rather than auto-sending.
No server, crypto, or stored-data change.

## Technical Context

**Language/Version**: TypeScript / Vue 3 + Ionic (client PWA only). No server change.

**Primary Dependencies**: browser `MediaRecorder` (already used here and in the voice
recorder), the existing `VideoNoteRecorder.vue`. No new dependencies.

**Storage**: none (in-memory recorder state; no IndexedDB, no migration).

**Testing**: `vitest` for an extracted pure elapsed-accounting helper (failing-first);
`vue-tsc` + `vite build`; a `drive/` scenario with Chromium fake-media flags for the UI.

**Target Platform**: installable PWA. Pause/resume relies on `MediaRecorder.pause/resume`,
already working in the voice recorder on the reporter's platform.

**Project Type**: client UI bug fix.

**Constraints**: Ionic-First (Principle XI) — reuse stock Ionic `ion-icon` + theme; no
zero-knowledge impact; forward-only (no migration).

**Scale/Scope**: one component (`VideoNoteRecorder.vue`) + one tiny extracted pure helper
(+ its test).

## Constitution Check

*GATE: re-checked after Phase 1 — passing.*

- **I. Zero-Knowledge Boundary** — PASS (N/A). Local recorder UI + timing only; the video
  message is encrypted and sent via the unchanged media pipeline. Spec's Zero-Knowledge
  Impact = none; crypto/ZK **checklist not required**.
- **II. Spec-Driven Development** — PASS. Full pipeline; branch/commits/PR trace to 2005.
- **III. Test-Driven Development** — PASS with a noted limit. The over-counting bug is
  captured by a FAILING-first unit test on an extracted pure helper (`recordedMs(...)`).
  The recorder's `MediaRecorder` wiring + UI isn't unit-testable in the harness (no
  getUserMedia/DOM-recorder in vitest); verified via a `drive/` scenario with Chromium
  fake-media flags + screenshots — a justified, recorded deviation (same as spec 2004). This
  is a bug fix (2001+); the regression test reproduces the paused-gap over-count.
- **IV. Crypto Discipline** — PASS (N/A). No crypto.
- **V. Offline-First** — PASS (N/A). No object-store change.
- **VI. Forward-Only Migrations** — PASS (N/A). No DB migration.
- **VII. Quality Gates** — PASS. `vue-tsc` + `vite build` + `vitest`.
- **VIII. Traceable Delivery** — PASS. `taskstoissues` → `Closes #N`.
- **IX. Privacy & Data Minimization** — PASS (N/A).
- **X. Accessibility & i18n** — PASS. The control becomes a real `<button>` with a
  state-aware `aria-label` (Pause / Resume), an improvement over the current inert `<span>`.
- **XI. Ionic-First UI** — PASS. Stock `ion-icon` glyphs + existing theme tokens; the
  recorder is a bespoke full-screen overlay that already exists (not a new pattern).

**Gate result: PASS.**

## Design Overview

### The bug today (`VideoNoteRecorder.vue`)
- Elapsed is `elapsed.value = (Date.now() - startMs) / 1000` on a 100ms interval — it would
  over-count across any pause, and the 60s auto-stop (`if (elapsed >= MAX) stopAndSend()`)
  fires on wall-clock, not recorded, time.
- The action bar is Delete · `<span class="vn-recdot">` (inert) · Send. No pause path.

### Mirror the voice recorder's proven accounting
The voice recorder (`ChatDetailPage.vue`) already solves this:
```
recAccumMs            // recorded time banked across pauses
recSegStart           // Date.now() at the start of the current recording segment
recActiveMs = recAccumMs + (paused ? 0 : Date.now() - recSegStart)
// pause:  recAccumMs += Date.now() - recSegStart; recorder.pause()
// resume: recSegStart = Date.now(); recorder.resume()
// send:   if (paused) recorder.resume() first (some browsers won't finalize while paused)
```
Apply the same to the video recorder.

### Changes
1. **Extract a pure helper** (testable; the TDD seam) — e.g. `src/utils/rec-clock.ts`:
   `recordedMs({ accumMs, segStartMs, paused }, nowMs): number` returning
   `accumMs + (paused ? 0 : nowMs - segStartMs)`. Unit-test it failing-first (paused gap
   excluded; multi-segment sum; not-restarted-on-resume). The voice recorder MAY later adopt
   it too, but this spec only needs it for the video recorder.
2. **`VideoNoteRecorder.vue` state**: add `paused = ref(false)`; replace `startMs` with
   `accumMs` + `segStartMs`; drive `elapsed` from `recordedMs(...)` on the existing 100ms
   tick; the progress ring already derives from `elapsed`, so it freezes automatically.
3. **The control**: replace `<span class="vn-recdot">` with a `<button class="vn-pause">`
   (state-aware `aria-label` "Pause"/"Resume", glyph: pause bars while recording → resume
   glyph while paused; a paused cue distinct from the live red dot) calling `togglePause()`:
   - recording → `accumMs += now - segStartMs; recorder.pause(); paused = true`
   - paused → `segStartMs = now; recorder.resume(); paused = false`
   Guard when `recorder` is null (still in the 3-2-1 countdown) → no-op.
4. **Auto-stop**: `beginRecording`'s interval compares `recordedMs(...)/1000 >= MAX` (recorded
   time), so a paused recording never auto-finalizes while paused.
5. **`stopAndSend`**: if `paused`, `recorder.resume()` before `recorder.stop()` (finalize
   reliability), and compute duration from `recordedMs(...)` (not raw elapsed). `teardown`/
   `cancel`/`flip` reset `paused`/`accumMs`/`segStartMs` and still stop the recorder + tracks.
6. **Styling**: a `.vn-pause` button styled from existing tokens. **Decision (locked):**
   FOLD the recording cue INTO the button — there is no separate decorative red dot. The
   single control shows the live-recording state (a red square/●) when recording and a
   resume (▶) glyph when paused, so one element both signals state and is the tap target.

## Project Structure
```text
specs/2005-pause-resume-during/
├── plan.md  research.md  data-model.md  quickstart.md  tasks.md
```
Source touched: `src/components/VideoNoteRecorder.vue`, `src/utils/rec-clock.ts` (new) +
`src/utils/rec-clock.test.ts` (new).

## Phasing
- **Phase 0 — research.md**: decisions (mirror voice accounting; pause/resume vs.
  stop-to-review; control glyphs; platform support). Done.
- **Phase 1 — data-model.md / quickstart.md**: no data model (state it); quickstart =
  verification recipe (vitest + drive fake-media). No contracts/ (no external interface).
- **Phase 2 — tasks.md**: `/speckit-tasks` (TDD: `recordedMs` test first).

## Complexity Tracking
Only the noted TDD/e2e limitation (recorder `MediaRecorder`/UI verified via a drive
fake-media scenario, not vitest) — justified by the harness's lack of a recordable media
device in vitest. The over-count logic itself is unit-tested via the extracted pure helper.
