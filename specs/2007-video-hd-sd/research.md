# Phase 0 Research: HD/SD video sends are transcoded for real on device

**Spec**: [spec.md](./spec.md) · **Branch**: `fix/2007-video-hd-sd` · **Date**: 2026-06-22

## Problem restated (from code inspection)

Two independent defects combine to produce the reported screenshot (Original / HD /
SD all reading `2160p · 0:22 · 66.8 MB`):

1. **The badge lies.** `queries.ts:1413` sets `message.mediaQuality` to the
   *requested* tier and never updates it. `sealMediaAndEnqueue` (`queries.ts:1469`)
   copies that requested value onto the recipient-facing `MediaRef.quality`. The
   bubble label (`ChatDetailPage.vue:1108-1111`, `QUALITY_LABEL[m.mediaQuality]`) is
   therefore "HD"/"SD" even when no transcode happened — on both sender and recipient.

2. **The transcode silently no-ops on the reporting device.** `runMediaJob`
   (`queries.ts:1525-1540`) calls `compressVideo` → `compressVideoAdaptive`
   (`media-video.ts`), whose explicit final fallback is *return the original blob*.
   The resolution/size shown (`queries.ts:1546-1550`) are then read from that
   original blob — hence 2160p and the full byte size. Because the badge is the
   *requested* tier (defect 1), the original is mislabeled HD/SD.

The reporting device is an iPhone (sender side of the screenshot). iPhones capture
4K as **HEVC (H.265) in a .mov container** by default ("High Efficiency").

## Decision 1 — Always label by the *achieved* result, never the request

**Decision**: After the encode phase, compute the *achieved* quality and persist it
to `message.mediaQuality` before metadata + seal. A clip is "sd"/"hd" only if the
encoder genuinely produced a smaller, downscaled blob; otherwise it is "original".

**Rationale**: This is the only change that fully and verifiably satisfies FR-007 /
FR-008 / SC-004 regardless of which engine ran or whether it succeeded. It is
device-independent and unit-testable. `compressVideo`/`compressImage` already return
the *original blob reference* on failure/no-gain, so "did a real transcode happen?"
is a reliable local signal (reference inequality and/or `out.size < original.size`).

**Alternatives considered**: (a) Trust the engine to always succeed and keep the
requested label — rejected: engines legitimately can't reduce some clips. (b) Block
the send when transcode fails and ask the user — rejected in Clarifications
(after-the-fact honesty, never block).

## Decision 2 — Make WebCodecs the reliable primary on iOS; demote ffmpeg.wasm to a guarded last resort

**Findings (sourced, 2026):**

- ffmpeg.wasm's stock `@ffmpeg/core` v0.12.x **does** include the native HEVC
  *decoder* (HEVC decode is built-in; only HEVC *encode* needs libx265, which we
  don't want). So decode isn't the blocker.
  (https://ffmpegwasm.netlify.app/docs/contribution/core/, FFmpeg codec docs.)
- BUT ffmpeg.wasm is **software-only and memory-capped (~2 GB)**; decoding full 4K
  frames reliably triggers `RangeError: Out of Memory` / `abortOnCannotGrowMemory`
  on mobile Safari. A 4K input is very likely to OOM.
  (ffmpeg.wasm issues #876, #299, #420.) **This is the most likely iOS failure for
  the current ffmpeg leg.**
- iOS Safari (16.4+) WebCodecs **`VideoDecoder` decodes HEVC with hardware accel**
  (works even where `<video>` won't play it), and **`VideoEncoder` encodes H.264**
  with hardware accel. Both are supported on the devices Ring targets.
  (webcodecsfundamentals.org/codecs/hevc.html, MDN codec selection.)
- Known WebCodecs sharp edges to design around:
  - `isConfigSupported` can return **true but then fail at decode** for `hev1.*`
    (Annex-B↔hvcC rewriting). Prefer `hvc1.*`; validate by actually decoding a
    frame rather than trusting `isConfigSupported` alone.
    (WebKit commit 8555adfc.)
  - H.264 encode configs can report unsupported / misbehave with `prefer-hardware`
    or aggressive **High** profiles; gate the exact config and fall back without the
    `hardwareAcceleration` hint and to **baseline/main** profiles.
    (w3c/webcodecs #686, #492.)

**Decision**: Keep the WebCodecs-first, ffmpeg-second, original-last ladder, but:

- **Harden the WebCodecs path** so it actually completes on iOS HEVC 4K rather than
  throwing into the OOM-prone ffmpeg leg. Concretely (detail in plan):
  - Fix the **sample-collection completion race** in
    `media-video-webcodecs.ts` (`setTimeout(resolve, 0)` at the end of the
    extraction promise can resolve before all `onSamples` batches arrive, yielding
    truncated/empty output that then trips the "not smaller"/"audio dropped"
    guards). Resolve only when extraction genuinely completes.
  - Make **encoder-config selection robust**: probe candidates (prefer
    main/baseline before High), retry without the hardware hint, and treat a
    configure/encode error as "this candidate failed, try the next / fall through"
    — never let an encoder `error` callback throw into the void.
  - Ensure decoder/encoder errors **reject the transcode promise** (so the ladder
    falls through deterministically) instead of hanging.
- **Guard the ffmpeg fallback** so it cannot crash the tab: add a wall-clock
  timeout and an input-size/resolution ceiling above which ffmpeg.wasm is skipped
  on memory grounds. If neither engine can reduce the clip, fall through to the
  original — which Decision 1 now labels honestly.

**Rationale**: WebCodecs is the only hardware-accelerated, memory-safe route for 4K
on mobile, and the code already attempts it — the fix is correctness/robustness, not
a new dependency. Demoting ffmpeg to a guarded last resort prevents the OOM crash
that currently masquerades as a silent "send original".

**Update (during implementation)**: the ffmpeg fallback was not just unreliable — it
was **completely dead**. We shipped the **UMD** `@ffmpeg/core` build, but
`@ffmpeg/ffmpeg` 0.12 runs the core in a *module* worker, where `importScripts` is
illegal; the worker therefore `await import()`s the core and needs its `default`
export, which the UMD build lacks → `failed to import ffmpeg-core.js`. So on every
device where WebCodecs couldn't handle the input (e.g. HEVC in a non-Safari browser),
there was NO working fallback and the clip silently degraded to Original. Fix: ship
the **ESM** core build. This is the most likely cause of "every video sends as
Original" on non-Safari browsers / HEVC sources.

**Update 2 (the actual iOS culprit, found by running the real file).** Feeding the
reporter's real iPhone clip (HEVC 4K `.mov`, 70 MB, iOS 18.5) through the WebCodecs
path reproduced a hard failure in Chromium: **`cannot read audio config`**. Our
`audioSpecificConfig()` assumed a fixed `esds.esd.descs[0].descs[0].data` path, which
the iPhone `.mov`'s `esds` doesn't match → the whole WebCodecs transcode threw, and
since the 70 MB clip exceeds the ffmpeg ceiling, it fell straight to Original. This
is the real "Full HD chosen → Original sent" on iPhone. Fix: (a) walk the esds
descriptor tree for the `.data` node instead of a fixed path, and (b) when it still
isn't found, **synthesize a standard AAC-LC AudioSpecificConfig** from the track's
sample rate + channel count (iPhone audio is AAC-LC and the audio is copied through
unchanged). Verified end-to-end: the real 70 MB HEVC 4K clip now transcodes
70 MB → 14.2 MB at Full HD via WebCodecs.

**Alternatives considered**: (a) Swap to an HEVC-tuned custom ffmpeg core
(e.g. `imputnet/ffwasm524`) — rejected for now: still software/memory-bound on 4K,
adds a 30 MB+ asset swap and build complexity, and doesn't beat hardware WebCodecs.
Revisit only if WebCodecs proves insufficient on-device. (b) Output HEVC from
WebCodecs when H.264 encode is unavailable — rejected: Chrome/Android recipients
can't reliably decode HEVC, breaking cross-platform playback (FR cross-device).
(c) Server-side transcode — rejected: violates the zero-knowledge boundary
(Principle I); the server must never see plaintext media.

## Decision 3 — Verification split (Chromium-automatable vs. device-only)

**Decision**: 
- **Automated (unit + Playwright/Chromium + e2e)** covers the device-independent
  contract: the achieved-quality labeling logic, and that an H.264 source sent at
  SD/HD yields a genuinely smaller `mediaSize` and reduced resolution while Original
  is byte-identical. Chromium reliably encodes/decodes H.264, so the happy path and
  all of Decision 1 are verifiable here.
- **Manual on-device (maintainer's iPhone via the dev deployment)** covers the
  iOS-HEVC-4K reliability claim (SC-005), which Chromium cannot reproduce. Diagnostic
  `console.info` breadcrumbs in the engine ladder make a device test actionable
  (which path ran, why it fell through).

**Rationale**: Honest about what each harness can prove. The trust half of the bug
(never mislabel) is fully closed and automated; the iOS size-reduction half is made
correct-by-design and confirmed on the actual failing hardware.

## Zero-Knowledge Impact

Unchanged and preserved. All transcoding happens on the sender's device **before**
encryption (`prepareOutgoingMedia` seals the already-reduced blob). The server
continues to relay only opaque ciphertext + a capability-style blob id. No new
metadata crosses the wire; `MediaRef.quality` is already part of the sealed payload
and now simply carries the *achieved* tier instead of the *requested* one. No server,
migration, or API change.
