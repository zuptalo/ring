# Quickstart / Verification: HD/SD video sends are transcoded for real

**Spec**: [spec.md](./spec.md) · **Branch**: `fix/2007-video-hd-sd`

## Automated (proves the device-independent contract)

### Unit (vitest)

```sh
npm run build        # vue-tsc typecheck + vite build (the client gate)
npx vitest run src/services/media-encode.test.ts
```

Covers `achievedQuality()`:
- requested `original`/`undefined` → `'original'`.
- requested `sd`/`hd` but uploaded blob is the original (size not reduced) →
  `'original'` (honest fallback).
- requested `sd`/`hd` and uploaded blob genuinely smaller → that tier.

### e2e (Playwright, Chromium, real send flow)

```sh
make db-up
npm run test:e2e -- video-quality   # the new spec
```

Asserts, using an H.264 mp4 fixture (Chromium encodes H.264 reliably):
- Sending at **SD** results in a delivered `mediaSize` materially smaller than the
  original and a reduced resolution; badge reads "SD".
- **HD** is smaller than Original and larger than SD; badge reads "HD".
- **Original** delivers a byte-identical file; badge reads "Original".
- A clip that cannot be reduced is **never** badged HD/SD — it reads "Original"
  (the core anti-mislabel guarantee, SC-004).

### Interactive Chromium check (drive/ harness)

```sh
make start
HEADED=1 node drive/scenarios/<video-quality scenario>.mjs   # added with the feature
```

Drives two test users, sends the same fixture at Original/HD/SD, screenshots the
three bubbles to `.tmp/drive/` and reads back `mediaSize`/`mediaWidth` to confirm
three distinct sizes.

## On-device (proves the iOS HEVC 4K reliability claim — SC-005)

Chromium cannot reproduce the iPhone HEVC path, so the maintainer verifies on the
actual device via the dev deployment (client changes need a rebuild to show on the
installed PWA — see project memory):

```sh
npm run build        # dist/ is what ring-dev serves to the phone
```

Then on the iPhone PWA:
1. Share the reported 2160p / 0:22 clip at **SD** → recipient (e.g. Macbook) gets a
   visibly smaller file at a lower resolution; badge reads "SD" with the reduced
   resolution/size.
2. Repeat at **HD** → between SD and Original in size/resolution; badge "HD".
3. **Original** → byte-identical to source; badge "Original".
4. Confirm the app stays responsive during the transcode and the send never hangs.
5. Diagnostics (Safari Web Inspector console) show the WebCodecs path completing
   (`[video] webcodecs output … vs …` smaller) rather than falling through to
   ffmpeg/original.

**Expected contrast with today**: the three sends produce three different sizes
(today all three were 66.8 MB), and HD/SD report lower resolution than 2160p.
