# Implementation Plan: RTL Name Truncation (spec 2030)

**Branch**: `fix/2030-rtl-names-truncate` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

## Summary

Browsers place `text-overflow: ellipsis` by the element's computed `direction`; `unicode-bidi: plaintext` (already present on some name elements) reorders glyphs but leaves `direction: ltr`, so RTL names clip at their beginning. Fix: `dir="auto"` on each single-line name element — the attribute sets computed directionality from content (first strong character), which moves both render order AND the ellipsis to the correct side, per engine spec. Keep each element's existing `text-align` so nothing shifts; drop now-redundant `unicode-bidi: plaintext` only where the attribute supersedes it on the same element.

## Surfaces (from audit)

`ChatDetailPage.vue:46` `.chat-header-name` · `ChatListItem.vue:29` name `<h2>` · `PinnedChatsGrid.vue:26` `.pin-name` · `CallActivePage.vue:11` `.incoming-name`, `:72/:127` `.cw-text strong`, `:175` `.tile-label`, `:323` `.name` · `IncomingCallOverlay.vue:11` `.ring-name` · `MinimizedCall.vue:22` `.mini-name`.

## Constitution Check

I: no wire impact — PASS. II: spec 2030 hotfix band — PASS. III: red-first e2e (`:dir(rtl)` resolution + header/tile coverage) — PASS. X: this IS the bidi mandate — PASS. XI: attribute on existing elements — PASS.

## Regression test (red first)

`e2e/rtl-name-truncation.spec.ts`: create a group named with a long Persian string, open the chat → assert `.chat-header-name:dir(rtl)` matches (and a Latin-named chat's header matches `:dir(ltr)`); pin the group → assert `.pin-name:dir(rtl)` on its tile. Fails today (no `dir` attribute → everything `:dir(ltr)`).

## Verification

`npm run build`, `npx vitest run`, new e2e red→green + `pinned-grid` suite; drive screenshot with the reporter's exact group name for the PR.
