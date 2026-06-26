# Quickstart: Validating Media Sharing & Viewer Improvements

How to build, test, and manually verify each user story. Run the standard gates first, then the
per-story checks.

## Gates (must pass)

```sh
npm run build          # vue-tsc typecheck + vite build
npm run test:unit      # vitest — includes new media-meta/media-video rotation + budget tests
npm run test:e2e       # Playwright — needs `make db-up`; extends e2e/media-viewer.spec.ts
```

## US1 — Video orientation (P1, the bug)

Headless fake-media cannot reproduce real capture orientation, so this needs **fixture-based unit
tests + a real-device check**.

1. **Unit (TDD, fails first):** add fixtures/synthetic inputs for source rotations 0°, 90°, 180°, 270°
   and assert the compressed output's **display** dimensions are upright and a 0°/no-matrix source is
   untouched (no double-rotation). `src/services/media-video.test.ts` (+ webcodecs test).
2. **Real device (sender → receiver):**
   - On a phone, record or pick a **portrait** video and send it to a second account.
   - On the **receiver**, confirm playback is upright with correct aspect ratio, and the bubble/grid
     thumbnail matches.
   - Repeat for a **landscape** video (no regression) and an **upside-down / sideways** capture.
   - Expected: 100% match between sender and receiver orientation (SC-001), zero "received video is
     sideways" cases (SC-002).
3. **Backward-compat:** open an old (pre-1018) video message — it still plays/renders fine (FR-008).

## US2 — Thumbnail quality (P2)

1. **Unit:** assert `generateImageThumb` / `generateVideoPoster` produce a poster with longest edge
   ~512px and encoded size ≤ ~40KB, stepping quality down when a busy image would exceed the cap.
   `src/utils/media-meta.test.ts` (new).
2. **Visual (drive harness):**
   ```sh
   make start
   node drive/scenarios/media-1018-thumbnails.mjs   # sends photos + a video, screenshots bubbles + grid
   ```
   Read `.tmp/drive/*.png` on a high-DPI capture and confirm no visible pixelation in the chat list,
   message bubble, and media grid (SC-003).
3. **Payload budget:** confirm a typical photo message's poster stays within ~40KB and there is no
   noticeable send/sync slowdown vs. before (SC-004).

## US3 — Smooth zoom & pan (P3)

Best judged on a **touch device** (or the drive harness's iPhone-under-chromium emulation for
structure; true feel needs real hardware).

1. **Manual (real device):** open a photo full-screen from a **message bubble**, then from the **media
   grid**:
   - Pinch to zoom — image zooms centered on the pinch point and tracks fingers (no lag).
   - Pan while zoomed — smooth; at the edges it rubber-bands and settles back on release.
   - Release a pan with a flick — momentum carries and decelerates naturally.
   - Double-tap — toggles fit ↔ ~2.5×, centered on the tap.
   - Page to the next item — it starts at fit-to-screen (zoom didn't leak, FR-012).
   - A two-finger pinch never accidentally pages or dismisses (FR-013).
   - Motion holds 60fps with no dropped frames (SC-005) — sample with devtools performance while
     pinching/flinging.
2. **e2e/drive (structure):** extend `e2e/media-viewer.spec.ts` / add a `drive/` scenario to assert
   the same component/behavior path is used from both the bubble and the grid (FR-011) and that zoom
   state resets between items.

## Done when

- All gates green; new unit tests pass (and the US1 test failed before the fix).
- Real-device checks confirm SC-001/SC-002 (orientation), SC-003/SC-004 (thumbnails), SC-005/SC-006
  (zoom feel), and SC-007 (no regression on old media).
