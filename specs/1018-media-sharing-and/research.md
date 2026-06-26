# Phase 0 Research: Media Sharing & Viewer Improvements

All three threads are client-side. This document records the decisions that resolve the open
technical questions, grounded in the current code, plus the Zero-Knowledge Impact note the
constitution requires.

## Zero-Knowledge Impact (Principle I)

- **What plaintext is involved?** Original media bytes, the re-encoded/oriented video, and the
  generated thumbnail/poster — all handled only on the client.
- **What crosses the client/server boundary?** Only the existing sealed `MessagePayload`
  (encrypted by the Double Ratchet) carrying a `MediaRef` whose `poster` field already lives
  inside the ciphertext, plus opaque media blob ids/ciphertext. **Nothing new** is exposed.
- **Does anything let the server read user content?** No. Orientation correction and thumbnail
  generation happen before sealing; the server still sees only ciphertext and capability-style
  blob ids. Raising thumbnail quality changes ciphertext size, not its readability.
- **Net change to the boundary:** none. This is why `/speckit-checklist` (required for Principle I)
  will focus on confirming no plaintext/metadata leak is introduced by the new code paths.

---

## US1 — Video orientation

### Decision
Fix orientation in the **WebCodecs** compression path by reading the MP4 track **display matrix**
(rotation angle) from the mp4box demuxer and applying it during the canvas re-encode: for 90°/270°
swap the target width/height and rotate/translate the 2D context before `drawImage`; for 180°
rotate without swapping. Keep the **ffmpeg fallback** as-is (it auto-rotates by default, baking the
correct orientation into pixels) but add a regression assertion so a future flag change can't
silently break it. Confirm `VideoPlayer.vue` applies **no** extra rotation (it must play the
already-oriented bytes faithfully).

### Rationale
- Root cause confirmed at `src/services/media-video-webcodecs.ts:114-118`: target dimensions come
  from `vTrack.video.width/height` (coded dimensions) with **no display-matrix handling**, and the
  decoder is configured `codedWidth/codedHeight` from the same raw values. A phone "portrait" capture
  is often stored as landscape coded frames + a 90° matrix; ignoring the matrix re-encodes landscape
  bytes, so the recipient sees it rotated. The sender looked fine only because its `<video>` element
  applied the matrix at presentation time.
- Baking rotation into pixels (rather than emitting rotation metadata) matches what the ffmpeg path
  already does and guarantees correctness regardless of the recipient player's metadata support —
  important because `VideoPlayer.vue` is a plain `<video>` with `object-fit: contain` and applies no
  rotation itself.
- mp4box already demuxes the track; the rotation/matrix is available from the track header without a
  new dependency.

### Alternatives considered
- **Emit rotation metadata instead of baking pixels** — rejected: relies on every recipient player
  honoring the display matrix (the current player does not), and WebCodecs `VideoEncoder` does not
  write a container display matrix anyway.
- **Always route video through ffmpeg (which auto-rotates)** — rejected: WebCodecs is the fast,
  preferred path (spec 2007); forcing ffmpeg regresses compression speed/size for everyone to fix a
  metadata bug.
- **Apply a CSS/transform rotation at playback** — rejected: would need the rotation carried as
  metadata to the recipient (re-introduces the same problem) and breaks the media grid/thumbnails.

### Open verification (for tasks/implementation)
- Determine the exact mp4box field exposing the matrix/rotation on the demuxed track and the
  upside-down (180°) and both-sideways (90°/270°) cases. Add fixtures covering all four orientations.
- Confirm "already upright, no matrix" videos are untouched (no double-rotation) — FR-003.

---

## US2 — Thumbnail quality within an encrypted-payload budget

### Decision
Generate the on-wire poster (the "bubble" tier) at **~512px longest edge** with **JPEG quality ~0.8**,
guarded by a **~40KB size cap**: if the encoded poster exceeds the cap, step quality down (e.g.,
0.8 → 0.7 → 0.6) until it fits. Apply the same approach to both `generateVideoPoster`
(`src/utils/media-meta.ts:80`) and `generateImageThumb` (`:170`). The locally-derived `grid` (320px)
and `strip` (128px) tiers in `src/utils/thumbs.ts` continue to derive from the higher-quality bubble
tier, so they improve for free.

### Rationale
- Current generation is the cause of the softness: video poster `maxEdge=480 @ 0.6`, image thumb
  `maxEdge=400 @ 0.7` — both below the 512px the `thumbs.ts` bubble tier already assumes, and on a
  high-density display a 400–480px JPEG at 0.6–0.7 visibly blocks at the displayed size.
- 512px @ ~0.8 is ~2× a typical ~256px bubble render, so it stays crisp on Retina while a JPEG at
  this size is comfortably in the tens-of-KB range — the ~40KB cap keeps payload growth small and
  bounded (FR-007/SC-004).
- A quality-stepping guard makes the cap deterministic and content-independent: busy photos that
  would blow the budget degrade quality slightly rather than bloating the sealed message.

### Alternatives considered
- **Switch posters to WebP/AVIF for better quality-per-byte** — deferred: broader encode/decode
  support and testing surface than this spec warrants; JPEG at 512/0.8 already clears the bar.
  Recorded as a possible future improvement.
- **Larger posters (1024px)** — rejected per clarify: bigger payloads/slower sync for marginal
  on-screen benefit at bubble/grid sizes.
- **Separate plaintext thumbnail blob served by the server** — rejected: violates Principle I; the
  thumbnail must stay inside the sealed payload.

### Backward compatibility
Old messages carry old low-res posters; they keep rendering unchanged (FR-008). No re-processing of
historical media. New sends get the crisper poster.

---

## US3 — Native-feeling zoom & pan

### Decision
Enhance the **existing** vanilla-JS gesture code in `src/components/MediaViewer.vue` rather than adopt
a library. Add: (a) **pinch centered on the gesture midpoint** (zoom toward the pinch point, adjusting
translation so the focal point stays under the fingers); (b) **rubber-band/overscroll** — allow panning
slightly past content bounds with increasing resistance, then animate back to the bound on release
(replacing the current hard `clampPan`); (c) **momentum/inertia** — on pan release with velocity, decay
the translation with friction (rAF loop) and settle within bounds; (d) **guaranteed zoom reset to
fit-to-screen when paging between items** (FR-012). Keep the already-correct limits: max ~5× pinch and
double-tap toggle fit ↔ 2.5× — these already match the clarified FR-009 targets.

### Rationale
- The viewer already implements pinch (`onTouchStart/Move`, max 5×), pan with `clampPan`, double-tap
  (2.5×), wheel zoom, and a 0.22s transition (`MediaViewer.vue` ~L350-520). The gap vs. native is
  *feel*: hard clamping (no rubber-band), no release inertia, and zoom not always centered on the
  pinch. These are incremental additions to existing handlers, not a rewrite.
- Staying vanilla-JS honors the minimal-dependency guidance and avoids a gesture library's bundle and
  behavior-conflict cost; the surface is small and already owned by the component.
- A rAF-driven inertia/rubber-band loop with `transform` (GPU-composited) is the standard path to
  60fps (SC-005); the work is to drive transforms off rAF during fling/settle and disable the CSS
  transition while a gesture is active (already done) so motion tracks fingers without lag.

### Alternatives considered
- **Adopt a gesture/zoom library (hammerjs, swiper zoom, panzoom)** — rejected: new dependency +
  bundle, and it would have to interoperate with the existing swipe-to-next and swipe-to-dismiss
  gestures already hand-tuned here. Higher risk than enhancing in place.
- **Delegate to native CSS (`touch-action: pinch-zoom` / browser zoom)** — rejected: doesn't compose
  with the custom paging/dismiss gestures and gives no control over bounds/inertia or per-item reset.

### Performance/verification notes
- Measure during pinch/fling that frames stay at 60fps (no long-task jank) on a typical device;
  ensure transforms (not layout) drive motion. Gesture disambiguation (pinch vs. page vs. dismiss)
  must remain correct (FR-013) — verify a two-finger pinch never triggers item paging.

---

## Cross-cutting decisions

- **No schema / DB_VERSION change.** All needed fields (`posterData`, `mediaWidth/Height`, the
  `Media` poster tiers) already exist (`src/db/types.ts`).
- **No server, wire-schema, or migration change.** The `MediaRef.poster` field is unchanged in shape;
  only its pixel size/quality (and thus ciphertext length) changes.
- **Fail-open.** Orientation detection or thumbnail generation failures fall back to current behavior
  so a send is never blocked (matches `media-video.ts` returning the original blob on engine failure).
- **Testing strategy.** Unit-test the pure pieces (rotation-dimension math, thumbnail size/quality
  budget) under vitest; use `drive/` scenarios + real-device checks for the visual/gesture behavior
  that headless fake-media can't fully exercise (capture orientation, 60fps feel).
