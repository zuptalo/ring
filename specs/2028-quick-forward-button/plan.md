# Implementation Plan: Quick-Forward Button Bottom Alignment (spec 2028)

**Branch**: `fix/2028-quick-forward-button` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

`.fwd-float` (`src/views/detail/ChatDetailPage.vue:5155`) declares `align-self: center` inside the `.bubble-row` flex row (`:4861`), so the button centers against the full height of whatever it accompanies — mid-image on tall media. Change the anchor to the row's end (`align-self: flex-end`) with a small block-end margin so it optically sits at the bubble's bottom corner. Both render paths (single media `:552`, album `:695`) share the class, so one CSS edit covers both. No markup, logic, or visibility changes.

## Technical Context

Vue 3 + Ionic PWA; scoped CSS in `ChatDetailPage.vue`. No server, storage, or crypto surface. The `.sel-mode` pointer-inert rule (`:4876`) and RTL `margin-inline-start` are class-based and unaffected.

## Constitution Check

- I (zero-knowledge): no wire impact — PASS. II: spec 2028 in the hotfix band — PASS. III (TDD): failing e2e regression first (bug-band mandate) — PASS. VII: gates below — PASS. X/XI: no new component; logical properties for RTL — PASS. Others: not touched.

## Regression test (red first)

New `e2e/forward-button-position.spec.ts`: two accounts, A sends B a portrait image (the existing e2e image-send helper used by `image-thumbnails.spec.ts`), on B wait for the media bubble + `.fwd-float`, then compare `getBoundingClientRect().bottom` of the button vs its `.bubble-col` sibling — assert `|Δ| ≤ 8`. Fails on `align-self: center` (Δ ≈ half the media height), passes after the fix.

## Fix

`ChatDetailPage.vue` `.fwd-float`: `align-self: center` → `align-self: flex-end;` + `margin-block-end: 2px;` and update the comment to say why bottom-anchored (matches the caption/footer line; tall media otherwise floats it mid-image).

## Verification

- `npm run test:e2e -- forward-button-position` red → green.
- `npm run build` (typecheck) + `npx vitest run` (no client logic touched; floors hold).
- Drive-harness screenshot of a tall portrait photo for the PR/user (visual confirmation, both a short and a tall message).
