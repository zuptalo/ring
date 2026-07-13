# Implementation Plan: Visible chat doodle background (spec 1047)

**Branch**: `feat/1046-quick-call-tiles` (bundled) | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the sparse inline-CSS shield tile in `ChatDetailPage.vue` with a real
SVG asset (`src/assets/chat-doodle.svg`): a 360×360 tile of ~30 varied
communication-themed line glyphs (shield, bubbles, handset, camera, hearts,
notes, games, …) with neutral mid-grey strokes that read on both themes.
CSS references the asset (`--background: url(...) repeat, var(--ion-background-color)`),
exactly the layering used today. Visual-only; verified by drive screenshots in
light + dark and the existing chat e2e suites.

## Constitution Check

- I (zero-knowledge): N/A — bundled static asset. II: this spec (bundled
  branch, precedent PR #965). III: no logic — no unit surface; behavioural
  coverage stays the existing chat e2e suites (SC-002), screenshot review is
  the acceptance gate. V/VI: N/A. VII: build + e2e green. X: decorative
  background (aria-neutral), contrast of foreground unchanged. XI: no
  components involved.

## Tasks

- T001 Author `src/assets/chat-doodle.svg` (varied glyph defs + jittered grid
  placements, `stroke-opacity` tuned for both themes).
- T002 Point `.chat-content` in `src/views/detail/ChatDetailPage.vue` at the
  asset; drop the giant inline data URL.
- T003 Verify: drive screenshots light + dark vs the user's WhatsApp
  references; `npm run build`; run a chat e2e (e.g. `disappearing` or
  `bidi`) as a smoke check.
