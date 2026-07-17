---
description: "Task list for 2002 media thumbnails / no autoplay storm (hotfix)"
---

# Tasks: Media Thumbnails Stay Thumbnails (2002)

**Input**: spec.md, plan.md. **Tests**: required (bug → regression test first).

## Phase 1: Regression test (Red)

- [x] T001 Add failing regression test `src/utils/concurrency.test.ts`: a limiter
  caps concurrent tasks at `max` (reproduces the unbounded poster storm), frees a
  slot on rejection, and runs immediately under the cap. (FR-001 / SC-002)

## Phase 2: Fix (Green)

- [x] T002 Add `src/utils/concurrency.ts` — `createLimiter(max)` (queue + release).
- [x] T003 Route `generateVideoPoster` through a shared `createLimiter(2)` in
  `src/utils/media-meta.ts` so all poster generation is bounded. (FR-001/FR-008)
- [x] T004 Replace `AllMediaPage`'s bespoke per-cell `<video>` poster generator with
  the shared `generateVideoPoster(blob)` and persist the result to
  `Media.posterBlob` (generate once, reuse). (FR-002/FR-004 + Principle XI)

## Phase 3: Verify

- [x] T005 `npx vue-tsc --noEmit` and `npx vitest run` green.
- [ ] T006 Manual device check: open a chat with 10+ posterless videos → responsive,
  no freeze/crash; thumbnails are still posters with a play icon (SC-001/SC-004).

## Notes

- Thumbnail surfaces already use `<img>` posters + play overlay; the viewer mounts a
  real player only for the current slide + neighbors (kept). FR-005 (cancel queued
  on leave) is mitigated by the cap + the existing per-generation timeout; revisit
  if device testing shows residual churn.
