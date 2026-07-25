# Quickstart — Cross-browser media interop (spec 2050)

Client-only hotfix; no server/DB change. TDD: the pure portability decision gets a failing
regression test FIRST (Constitution III for 2001+).

## Build & unit test

```sh
npm run build                                        # vue-tsc typecheck + vite build
npx vitest run src/services/media-portability.test.ts   # portability decisions (regression-first)
```

TDD order:
1. Write `media-portability.test.ts` — `needsMandatoryTranscode('video/webm','original')`→true,
   `('video/mp4','original')`→false, `isPortableVideo`, `isHeic`, `imageNeedsAlphaPreserve`.
2. Implement `media-portability.ts` to pass.
3. Wire it into `compressVideoAdaptive`/`runMediaJob`, then HEIC/PNG/SVG encode paths.

## Visual verification (drive/ against the live dev stack)

```sh
make start
node drive/scenarios/media-interop.mjs
```

The scenario should send, from a NON-Safari sender, and confirm the delivered blob is portable:
- **WebM** (P1): send a webm clip at Original quality → delivered as MP4 (`blob.type` video/mp4),
  plays; force an un-convertible case → a failed-send card, no raw upload. Screenshot.
- **HEIC** (P2): send a .heic image → delivered as JPEG, renders. Screenshot.
- **PNG alpha** (P3): send a transparent PNG → received image keeps transparency (checker the
  alpha, not a black/white fill). Screenshot.
- **SVG** (P4): send an SVG → a thumbnail shows; original opens in the viewer. Screenshot.

Confirm working formats are unchanged: JPEG, WebP (animation), GIF (animation), MP4, audio, files.

## e2e (where a send flow changes)

```sh
make db-up
npm run test:e2e -- e2e/media-interop.spec.ts
```

At least: a webm send results in a `video/mp4` blob (or an honest failure), asserted via the
harness — the interop guarantee, not pixel decoding.

## Zero-knowledge sanity
Confirm no new network: conversion is client-side (ffmpeg-wasm / HEIC-wasm / canvas); the
server still receives opaque bytes and no group/media-aware request. HEIC decoder loads from
the app bundle, not the network.

## Definition of done
- `npm run build` clean; new vitest green; e2e green where a flow changed.
- Drive screenshots confirm webm/heic/png-alpha/svg in light + dark; working formats un-regressed.
- No `DB_VERSION` bump, no server change; `/speckit-analyze` clean + `/speckit-checklist` (Principle I) done.
