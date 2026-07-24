# Feature Specification: Default to dark theme and fix the startup theme flash

**Feature Branch**: `fix/2049-dark-default-flash`

**Created**: 2026-07-24

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Let's also have the theme follow the system's dark or light theme and make dark the default with an option for the user to change to light. The glitch for the starting view is still there."

## Context: why this hotfix exists

Ring already supports three appearance choices — **System** (follow the OS), **Light**, and **Dark** — and the OS-following path works. Two problems remain:

1. **The startup theme flash is still present** despite two prior fixes. Root cause (confirmed): the inline pre-paint script in the app shell sets the correct theme class on the first frame, but the theme composable then re-applies a *guessed* theme synchronously during app mount — before the user's saved preference has loaded from local storage — and briefly reverts to the OS scheme. For any user whose explicit choice differs from their device's OS scheme (e.g. an explicit-Dark user on a Light-OS phone), this repaints the wrong theme for a frame or two on **every** launch. Users whose choice already matches the OS never saw it, which is why earlier fixes looked complete.

2. **The default should lean dark.** New users currently default to "follow system", so a new user on a Light-OS device gets a light app. The product intent is for Ring to default to dark, while still offering an explicit "follow system" choice and a light choice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No theme flash on launch (Priority: P1)

A returning user opens Ring. The app appears immediately in their chosen theme, with no flash of the opposite theme during startup — regardless of whether their choice matches the device's OS setting.

**Why this priority**: This is the reported, recurring defect and the reason the hotfix exists. It affects every cold launch for a whole class of users and undermines confidence that a "fix" landed.

**Independent Test**: With the app set to an explicit theme that is the OPPOSITE of the device OS setting (e.g. app = Dark, device OS = Light), cold-launch the installed app repeatedly and confirm no light frame appears before the dark UI — on the very first paint and through mount, with no visible repaint.

**Acceptance Scenarios**:

1. **Given** my theme is explicitly Dark and my device OS is set to Light, **When** I cold-launch the app, **Then** the UI is dark from the first painted frame through full load, with no light flash.
2. **Given** my theme is explicitly Light and my device OS is set to Dark, **When** I cold-launch the app, **Then** the UI is light from the first painted frame through full load, with no dark flash.
3. **Given** my theme is System, **When** I cold-launch the app on either OS setting, **Then** the UI matches the OS from the first frame with no flash (unchanged behavior).
4. **Given** the app is running, **When** I change my device's OS theme while the app is set to System, **Then** the app follows the change live (unchanged behavior).

---

### User Story 2 - Dark is the default, with a choice to change it (Priority: P2)

A brand-new user (no saved preference) opens Ring and sees a dark app. They can go to appearance settings and choose Light, or System (follow the OS), and the app honors it immediately and on subsequent launches.

**Why this priority**: This is a deliberate default change requested alongside the flash fix. It is smaller and less urgent than eliminating the flash, and it depends on the same theme-resolution code being touched.

**Independent Test**: On a fresh install with no saved theme preference, launch the app and confirm it is dark irrespective of the device OS setting; then switch to Light and to System in settings and confirm each takes effect immediately and persists across a relaunch.

**Acceptance Scenarios**:

1. **Given** a fresh install with no saved theme preference, **When** I launch the app, **Then** the app is dark regardless of the device OS theme.
2. **Given** the default dark app, **When** I choose Light in appearance settings, **Then** the app becomes light immediately and stays light after relaunch.
3. **Given** the default dark app, **When** I choose System in appearance settings, **Then** the app follows the device OS theme immediately and after relaunch.
4. **Given** the default dark app, **When** I choose Dark explicitly, **Then** it stays dark and there is no flash on the next launch even if my device OS is Light.

---

### Edge Cases

- **Explicit choice opposite to OS** — the primary flash case; must be flash-free (Story 1).
- **First-ever launch, no mirror written yet** — the pre-paint script has no saved value to read; it must fall back to **dark**, so the worst case is an imperceptible dark frame on a dark app rather than a white flash.
- **Private mode / storage throws** — pre-paint script must not error and must fall back to dark.
- **One launch immediately after an app update** — a briefly-stale app shell could serve the previous startup script for a single launch until the update activates; this is a known, transient, one-time possibility and is out of scope to eliminate here (documented, not fixed).
- **Existing users with a saved preference** — their saved choice is preserved; the default change only affects users who have never chosen (it does not overwrite anyone's existing selection).

## Requirements *(mandatory)*

### Functional Requirements

**Flash fix (Story 1)**

- **FR-001**: The app MUST NOT apply a guessed or provisional theme that overrides the correct startup theme before the user's saved preference has loaded. The theme applied during startup MUST be the user's actual saved preference (or the documented default when none exists), never a transient wrong value.
- **FR-002**: On every cold launch, the theme MUST be consistent from the first painted frame through full app load — no user whose explicit choice differs from their device OS setting may see a flash of the opposite theme.
- **FR-003**: The System (follow-OS) behavior MUST be preserved, including live response to OS theme changes while the app is open and set to System.
- **FR-004**: The startup pre-paint theme decision and the in-app theme resolution MUST agree for all inputs (explicit Dark, explicit Light, System-on-dark-OS, System-on-light-OS, and the no-preference default), so neither can override the other with a different result.

**Dark default (Story 2)**

- **FR-005**: When a user has no saved theme preference, the app MUST default to Dark, regardless of the device OS setting.
- **FR-006**: The appearance settings MUST continue to offer System, Light, and Dark as explicit choices, and selecting any of them MUST take effect immediately and persist across launches.
- **FR-007**: The default change MUST NOT overwrite or alter the saved preference of any existing user who has already made a choice.
- **FR-008**: The startup pre-paint fallback used when no saved preference is available MUST be Dark (so a missing/blocked mirror yields a dark first frame, not a light one).

**Invariants**

- **FR-009**: No plaintext or user data crosses the client/server boundary as part of this change; theme preference remains a local, client-side setting handled exactly as today (its existing sync behavior, if any, is unchanged).
- **FR-010**: The change MUST NOT regress the existing appearance settings UI or the persistence of the theme choice.

### Key Entities *(include if feature involves data)*

- **Theme preference**: the user's appearance choice — one of System, Light, or Dark — stored locally as today. This hotfix changes only its *default* (to Dark) and the *timing/consistency* of how it is applied at startup, not its storage or options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across repeated cold launches of the installed app with the app theme set opposite to the device OS theme, zero launches show a visible flash of the wrong theme (0 out of at least 10 launches, both directions).
- **SC-002**: A System-themed user sees no change in behavior — theme matches the OS on launch and follows live OS changes, with no flash — verified in both OS settings.
- **SC-003**: A fresh install with no saved preference launches dark on both a Light-OS and a Dark-OS device, on the first painted frame.
- **SC-004**: An existing user with a saved Light (or System) preference retains it unchanged after updating to this build.
- **SC-005**: Choosing each of System, Light, and Dark in settings applies immediately and survives a relaunch, with no flash on the subsequent launch.

## Assumptions

- The three appearance options (System / Light / Dark) and the OS-following mechanism already work and are kept; this hotfix changes the default and the startup application timing only.
- "Make dark the default" is interpreted as changing the default *choice* to Dark (System remains available for users who want OS-following), and making the startup fallback dark. If the intent was instead to keep System as the default and only change the no-signal fallback to dark, that is a one-line variation to be confirmed in clarify/plan.
- The theme preference's existing local persistence and any existing own-data sync of settings are correct and are not modified here.
- Eliminating the single transient stale-shell flash that can occur for one launch right after an app update is out of scope (it self-heals on the next launch).

## Out of Scope

- Any redesign of the appearance settings screen or new theme options beyond System/Light/Dark.
- Changing colors, palettes, or per-component theming.
- The one-launch-after-update stale-shell edge (documented above).
- Server-side or synced theme behavior changes.
