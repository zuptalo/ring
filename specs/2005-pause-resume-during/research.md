# Research: Pause/resume during video-message recording

The product decisions were settled with the user before planning; this records the
rationale and alternatives.

## R1 — Mirror the voice recorder's accumulate-recorded-time accounting

- **Decision**: Track `accumMs` (recorded time banked across pauses) + `segStartMs` (current
  segment start) and compute elapsed as `accumMs + (paused ? 0 : now - segStartMs)`, exactly
  as the voice recorder does (`recActiveMs` in `ChatDetailPage.vue`).
- **Rationale**: The current video recorder uses raw `Date.now() - startMs`, which
  over-counts across a pause and drives a wall-clock auto-stop. The voice recorder already
  ships this accounting and works on the reporter's platform, so reuse the proven shape
  (FR-002, FR-003, FR-007).
- **Alternatives**: (a) Subtract a running "paused total" — equivalent but easier to get
  wrong across multiple cycles. (b) Use `MediaRecorder` timestamps — not reliably exposed.

## R2 — Pause/resume the same take (not stop-to-review, not stop=send)

- **Decision**: The control pauses and resumes the SAME recording; Send finalizes.
- **Rationale**: The user explicitly chose this (parity with the voice Pause/Resume) over a
  stop→review flow or a stop=send shortcut. It's the smallest change that makes the control
  behave as users expect and keeps one continuous clip (FR-001, FR-004, FR-008).
- **Alternatives**: stop→freeze→review/retake (richer but larger: needs recorded-blob video
  playback in the recorder); stop=send (removes the "continue the take" ability the user
  asked for). Both rejected per the user's decision.

## R3 — `MediaRecorder.pause()` / `resume()` + finalize reliability

- **Decision**: Use `recorder.pause()` / `recorder.resume()`; on Send, if paused, call
  `resume()` before `stop()`.
- **Rationale**: The voice recorder relies on the same API on this platform and on the
  resume-before-stop guard ("some browsers won't finalize while paused"). Reusing it keeps
  behavior consistent and avoids a separate code path (FR-006).
- **Alternatives**: Stop-and-restart a fresh recorder per segment + concatenate blobs —
  brittle across container formats; rejected.

## R4 — Extract a pure `recordedMs` helper for TDD

- **Decision**: Move the elapsed math into `src/utils/rec-clock.ts`
  (`recordedMs({ accumMs, segStartMs, paused }, nowMs)`) and unit-test it failing-first.
- **Rationale**: The over-count is the testable core of the bug; isolating it lets vitest
  reproduce and lock it (Principle III) even though the `MediaRecorder`/getUserMedia UI is
  not unit-testable in the harness. Mirrors spec 2004's pure-logic-test + drive-screenshot
  split.
- **Alternatives**: Test only via e2e/drive — weaker regression guard for the math; rejected.

## R5 — Control affordance (glyph + state)

- **Decision**: Replace the inert `<span class="vn-recdot">` with a real
  `<button class="vn-pause">` whose `aria-label`/glyph reflect state (recording → pause;
  paused → resume), keeping a clear paused-vs-recording cue.
- **Rationale**: FR-005 + accessibility (Principle X) — the current `<span>` has no role,
  label, or handler. Mirror the voice recorder's state-aware Pause/Resume button.
- **Alternatives**: Keep the red square purely decorative and rely on Send — rejected: it's
  the exact affordance the user expected to work.

## TDD / verification note

- `recordedMs` gets a FAILING unit test first (paused gap excluded; multi-segment sum;
  resume does not restart).
- The recorder UI + `MediaRecorder` pause/resume is verified via a `drive/` scenario using
  Chromium fake-media flags (`--use-fake-device-for-media-stream`,
  `--use-fake-ui-for-media-stream`) + screenshots — a recorded, justified non-vitest path.
