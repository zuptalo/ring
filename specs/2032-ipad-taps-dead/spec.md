# Feature Specification: iPad Taps Dead on Send & Quick-React

**Feature Branch**: `fix/2032-ipad-taps-dead`

**Created**: 2026-07-13

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User bug report (2026-07-13): "On iPad, send button doesn't work and tapping the emoji button to react on a message also doesn't open anything! But they work fine on my iPhone!"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every tap works on iPad (Priority: P1)

On an iPad, tapping Send delivers the typed message and tapping the react affordance opens the quick-react bar, exactly as on iPhone. No control in the chat screen may be dead on any supported device class.

**Independent Test**: On the reporter's iPad: type a message, tap Send → it sends; tap the react button on a bubble → the emoji bar opens. Regression fence: same actions still work on iPhone and desktop.

**Acceptance Scenarios**:

1. **Given** a chat with a typed draft on iPad, **When** Send is tapped by finger, **Then** the message sends.
2. **Given** a received message on iPad, **When** the react affordance is tapped, **Then** the quick-react bar opens and picking an emoji applies it.
3. **Given** the fix, **Then** iPhone and desktop behavior is unchanged (including the keyboard staying open while reacting, which is what the current pointerdown-prevent idiom protects).

## Diagnosis state (from the initial investigation, 2026-07-13)

Two live hypotheses; the discriminating test needs the physical iPad:

- **H1 — stale installed-PWA shell (most likely given context)**: the iPad points at the dev deployment whose `dist/` was rebuilt many times that evening; an installed app that never accepted the update prompt can hold a precached shell referencing renamed hashed chunks. Symptom signature matches: the controls whose code-split chunk fails to load go dead while the rest of the app works, and the freshly-updated iPhone is fine. **Discriminator**: compare Settings → About version on iPad vs iPhone; accept any pending update / close-and-reopen; if versions match and taps still fail → H2. A remote-inspector console (Safari on a Mac) showing failed chunk loads confirms H1 outright.
- **H2 — iPadOS input-pipeline difference**: both dead controls (composer Send, bubble react button) carry `@pointerdown.prevent` (the spec-1045 keyboard/selection-protection idiom) + `@click`. Canceling `pointerdown` for a touch pointer suppresses compatibility mouse events per the Pointer Events spec; iPhone Safari's legacy touch→click synthesis still delivers the click, and Chromium+touch demonstrably works (drive/scenarios/ipad-send-repro-2032.mjs → touch tap sends). iPadOS desktop-mode Safari may follow the stricter path. **Not reproducible headless here** (Playwright WebKit unsupported on this macOS); needs the device or a newer Mac.

If H2: the candidate fix is replacing `@pointerdown.prevent` with `@mousedown.prevent` on the affected controls (protects focus/selection on all pointer types without ever being able to cancel a touch click), verified on iPad + iPhone + desktop. If H1: no code change — but consider whether the install-gate auto-update behavior should extend to installed-PWA dev channels.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Send and quick-react MUST respond to touch taps on iPadOS (Safari and installed PWA), with iPhone/desktop behavior unchanged.
- **FR-002**: Per the hotfix rule (constitution III), the fix MUST start from a failing regression test where the cause is automatable; if the cause proves environmental (H1), the spec documents the root cause and any preventive follow-up instead.
- **FR-003**: The keyboard-preservation behavior the current idiom protects (reacting without dismissing the composer keyboard) MUST survive the fix.

## Zero-Knowledge Impact

None — device-local input handling / caching; nothing touches the wire.

## Success Criteria *(mandatory)*

- **SC-001**: Reporter confirms both actions work on the iPad (the only conclusive gate — the failing configuration cannot be emulated on the dev machine).
- **SC-002**: Existing chat e2e (send, quick-react, reply, mentions) stays green; the chromium-touch drive repro keeps passing.

## Assumptions

- Awaiting the H1/H2 discriminator from the reporter before the pipeline continues (clarify is effectively this one question).
