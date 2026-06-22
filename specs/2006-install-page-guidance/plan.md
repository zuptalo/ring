# Implementation Plan: Install-page guidance for a Play Protect "older Android" block

**Branch**: `fix/2006-install-page-guidance` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add a calm, muted secondary help note to `InstallGuard.vue`, shown only on the **Android
installable** install page, that explains the Play Protect "built for an older version of
Android / unsafe app blocked" symptom is a Chrome/Play-Protect quirk (not a Ring problem) and
how to get past it (update Chrome + Google Play services and retry, or "More details → Install
anyway"). No WebAPK/manifest/build change — none is available to Ring (the WebAPK target SDK
is Google's). Copy-only.

## Technical Context

**Language/Version**: TypeScript / Vue 3 + Ionic (client install gate only). No server change.
**Storage**: none. **Testing**: `vue-tsc` + `vite build`; visual check via `drive/` against the
install gate is not straightforward (the gate is bypassed in dev/test), so this is verified by
typecheck + reading the rendered conditions; the change is static copy. **Project Type**: client
UI copy. **Constraints**: Ionic-First; no zero-knowledge impact; no migration.

## Constitution Check — PASS

- **I. Zero-Knowledge** — PASS (N/A): static client copy; no contract/payload/stored-data change.
  ZK checklist not required.
- **II. Spec-Driven** — PASS: full lightweight pipeline; commits/PR trace to 2006.
- **III. TDD** — PASS with limit: this is static copy with no logic seam and the install gate
  isn't exercisable in the unit/drive harness (it's bypassed there); verified by typecheck +
  the conditional render reasoning. Recorded deviation (copy-only, no behavior to unit-test).
- **IV–IX** — PASS (N/A): no crypto/store/migration/privacy surface.
- **X. Accessibility/i18n** — PASS: plain text in the existing muted-note pattern.
- **XI. Ionic-First** — PASS: reuses the existing `InstallGuard` callout/markup + theme tokens.

## Design Overview

`src/components/InstallGuard.vue`:
- Add a muted help block (NOT the warning-styled `.cant-install`) rendered when
  `platform === 'android' && !installUnavailable` (a real Android browser that can install;
  the WebView case already shows its own callout and shouldn't be duplicated). Place it near
  the "How to install" steps / the "Already added it?" note.
- Copy (calm, reassuring): names the symptom ("If Android blocks Ring as 'unsafe' or 'built
  for an older version of Android'"), states it's a Chrome/Play-Protect quirk with installed
  web apps (not a Ring problem), and gives the remedy (update Chrome + Google Play services
  and try again, or tap "More details → Install anyway").
- A `.install-help` muted style (neutral background, `ion-color-medium` text), distinct from
  the warning `.cant-install`.

No other files; no manifest/build/target-SDK change (FR-005).

## Phasing
- Phase 0/1: trivial (no research/data-model/contracts — static copy). This plan + spec suffice.
- Phase 2: tasks.md (below).
