# Feature Specification: No light-theme flash returning to the app

**Feature Branch**: `fix/2045-brief-light-theme`

**Created**: 2026-07-19

**Status**: shipped

**Input**: On iOS, occasionally (~1% of app-switcher returns / cold relaunches) Ring
paints in the light theme for one frame before correcting to dark, even though the OS is
in dark mode and the app resolves the theme correctly the rest of the time. Cause:
`useTheme` toggles Ionic's `ion-palette-dark` class only AFTER an async IndexedDB read of
`appearance.theme` (via `useLiveQuery`). On a cold relaunch (iOS silently killed the page,
switcher relaunch), Ionic's CSS applies its default LIGHT palette for the frames before
that async read resolves → a light flash. `index.html` already dark-matches the raw
`html/body` background via `prefers-color-scheme`, but the Ionic component palette (driven
by the class) is not set until Vue mounts + IDB loads.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Returning to the app never flashes the wrong theme (Priority: P1)

Someone in dark mode switches back to Ring from the app switcher (or relaunches it after
iOS killed it) and sees dark immediately — no white flash.

**Why this priority**: A jarring flash on a privacy-focused app reads as a glitch; it's a
visible polish defect on the most common interaction (returning to the app).

**Independent Test**: With `appearance.theme` resolving to dark, the `ion-palette-dark`
class is present on `<html>` at first paint (before any async read), verified by a unit
test of the pre-paint resolver + a check that the inline script runs in `<head>`.

**Acceptance Scenarios**:

1. **Given** the resolved theme is dark (explicit `dark`, or `system` + OS dark), **When**
   the document first paints, **Then** `ion-palette-dark` is already on `<html>` — no
   frame renders in the light palette.
2. **Given** the resolved theme is light, **When** the document first paints, **Then** the
   class is absent (no dark flash on light-mode devices either).
3. **Given** a fresh install with no stored preference, **When** it first paints, **Then**
   the palette follows the OS `prefers-color-scheme` (matches today's default behavior).

### Edge Cases

- Stored preference unreadable / localStorage blocked (private mode): fall back to
  `prefers-color-scheme` — never throw, never block paint.
- Preference changed in-app then relaunched: the mirror is written on each apply, so the
  next cold start reads the up-to-date value synchronously.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The resolved dark/light decision MUST be applied to `<html>` as the
  `ion-palette-dark` class synchronously, before first paint, via an inline script in
  `index.html` `<head>` (no async, no bundle dependency).
- **FR-002**: The pre-paint resolver MUST read the persisted `appearance.theme`
  synchronously — mirrored to `localStorage` by `useTheme` on each apply — and resolve
  `system` against `prefers-color-scheme`.
- **FR-003**: The resolver MUST fail safe: any error (blocked storage, missing key) falls
  back to `prefers-color-scheme`, and never throws or blocks rendering.
- **FR-004**: `useTheme` MUST keep the `localStorage` mirror in sync whenever it applies
  the theme (so the next cold start is correct), without changing IndexedDB as the source
  of truth.
- **FR-005**: Behavior for the common case (already-correct 99%) MUST be unchanged; this
  only closes the cold-relaunch first-paint gap.

### Key Entities

- **Theme mirror**: a synchronous `localStorage` copy of `appearance.theme` used only for
  pre-paint resolution; IndexedDB remains authoritative.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a dark-resolved cold relaunch, zero frames render in the light palette
  (the class is present at first paint).
- **SC-002**: Device confirmation: returning to Ring from the iOS app switcher in dark
  mode shows no light flash across repeated tries.
- **SC-003**: Existing behavior/tests unaffected; `useTheme` still reacts to the Theme
  radio and OS changes.

## Zero-Knowledge Impact

Only the appearance preference (`system`/`light`/`dark`) is mirrored to `localStorage` on
the device — a non-sensitive UI setting, never leaves the device, no server involvement,
no user content. No wire surface.

## Assumptions

- IndexedDB stays the source of truth; the `localStorage` mirror is a read-optimization
  for the pre-paint frame only.
- Ionic's palette is driven by the `ion-palette-dark` class on `<html>` (per `useTheme`
  and `dark.class.css`).
