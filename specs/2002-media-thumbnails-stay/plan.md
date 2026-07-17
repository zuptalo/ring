# Implementation Plan: Media Thumbnails Stay Thumbnails (2002)

**Branch**: `fix/2002-media-thumbnails-stay` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)

## Summary

Video thumbnails are `<img>` posters (correct), but **poster generation** spun up
a decoding `<video>` per posterless clip with no bound — `ChatDetailPage`'s
`messages` watcher fired one per video, and `AllMediaPage` had its own bespoke
per-cell generator. A media-heavy chat therefore ran dozens of decoders at once →
lag, freeze, crash. Fix: route **all** poster generation through one shared,
concurrency-bounded limiter (max 2), persist posters so each clip is generated
once, and remove the duplicate generator (Ionic-first / DRY, Principle XI).

## Technical Context

**Language/Stack**: TypeScript, Vue 3 + Ionic PWA (client-only change).
**Touched**: `src/utils/concurrency.ts` (new limiter), `src/utils/media-meta.ts`
(`generateVideoPoster` → through the limiter), `src/views/detail/AllMediaPage.vue`
(reuse the shared bounded helper + persist), tests.
**Testing**: vitest (`concurrency.test.ts` regression), typecheck, manual device check.
**No** server / DB-schema / wire change. Poster persistence uses the existing
`Media.posterBlob` field + `idb` store.

## Constitution Check

- **I. Zero-Knowledge** — PASS: client-only; posters derived from already-decrypted
  media, cached on-device via existing `posterBlob`; nothing new crosses the wire.
- **III. TDD** — PASS: a failing regression test (`createLimiter` caps concurrency)
  precedes the fix; it reproduces the unbounded-storm behavior.
- **V. Offline-First** — PASS: reuses the existing `media` store + `posterBlob`; no
  new object store, no `DB_VERSION` bump.
- **XI. Ionic-First / no duplication** — PASS: removes `AllMediaPage`'s bespoke
  poster generator, unifying on the shared helper.
- **VII. Quality gates** — PASS: typecheck + unit green.

Gate result: PASS — no violations.

## Approach

1. `createLimiter(max)` — generic async concurrency limiter (queue + slot release).
2. `generateVideoPoster` runs its work through a module-level `createLimiter(2)`, so
   however many callers fire at once, ≤2 decoders run; the rest queue.
3. `AllMediaPage` drops its bespoke `<video>` generator and calls the shared
   `generateVideoPoster(blob)`, persisting the result to `Media.posterBlob` (cache
   once), matching `ChatDetailPage`.
4. Thumbnail surfaces remain `<img>` posters with a play overlay (already true);
   the viewer still mounts a real player only for the current slide + neighbors.

## Project Structure

```text
src/utils/concurrency.ts        # new: createLimiter
src/utils/concurrency.test.ts   # new: regression (caps concurrency)
src/utils/media-meta.ts         # generateVideoPoster → posterLimiter(2)
src/views/detail/AllMediaPage.vue  # reuse shared helper + persist posterBlob
```
