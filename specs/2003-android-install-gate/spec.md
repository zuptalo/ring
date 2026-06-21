# Feature Specification: Fix Android install-gate false "browser can't install" warning

**Feature Branch**: `fix/2003-android-install-gate`

**Created**: 2026-06-22

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     The directory number sets the category (2001+ = hotfix/bug). -->

**Input**: Android user on current Chrome was blocked at the install gate by a warning
saying their browser "can't install Ring as an app … Update Chrome … or open Ring in a
newer browser," when their browser is in fact fully capable of installing the PWA.

## Overview

Ring gates un-installed visits behind an install guide (it only runs as an installed
PWA). On Android, the guide currently decides a browser is *incapable of installing* — and
shows an alarming "this browser can't install Ring, update Chrome / use a newer browser"
warning — purely because the Chromium `beforeinstallprompt` event did not fire within
**2.5 seconds** of load. That signal is unreliable: a perfectly capable, current Chrome can
fire it later than 2.5s, or not auto-fire it at all (Chrome may suppress/delay it), so
real users are wrongly told their browser is too old and are effectively blocked.

The genuinely-incapable case on Android is an **embedded WebView** (an in-app browser with
no menu to "Install app"), which is identifiable from the user agent. This bug fix makes
the "can't install" determination accurate: warn only for a true WebView, and otherwise
always show the normal install steps (and the one-tap install button if/when the prompt is
available) without the false "update your browser" message.

## Bug & Root Cause

- **Symptom**: On Android Chrome, the install gate shows the warning *"This browser can't
  install Ring as an app, it would only add a shortcut … Update Chrome … or open Ring in a
  newer browser"* even though the browser can install Ring.
- **Root cause**: the gate sets an "install unavailable" flag whenever
  `beforeinstallprompt` has not fired ~2.5s after load. Absence of that event does not mean
  the browser is incapable — it is commonly just delayed or suppressed on a fully capable
  Chrome. The 2.5s timeout is therefore a false-negative source.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capable Android browser is not falsely blocked (Priority: P1)

A person opening Ring in a normal, current Android browser (Chrome, Samsung Internet,
Edge, Firefox, etc.) must NOT be told their browser can't install Ring. They see the
install steps (and a one-tap install button when the browser offers it) and can install.

**Why this priority**: This is the bug — capable users are blocked/misinformed. Fixing it
is the whole point.

**Independent Test**: With a normal Android Chrome user agent and no `beforeinstallprompt`
within several seconds, the gate does not show the "can't install / update your browser"
warning and still presents the install steps.

**Acceptance Scenarios**:

1. **Given** a normal Android browser user agent, **When** the install gate evaluates
   capability and `beforeinstallprompt` has not (yet) fired, **Then** the "can't install"
   warning is NOT shown and the manual install steps are shown.
2. **Given** a normal Android browser where `beforeinstallprompt` later fires, **When** the
   gate updates, **Then** the one-tap install button appears (existing behavior preserved).

### User Story 2 - Genuinely-incapable surface gets accurate guidance (Priority: P2)

A person who opened Ring inside an embedded in-app browser (Android WebView) — which truly
cannot install a PWA — is told accurately to open Ring in their real browser app and
install from there, rather than the misleading "update Chrome."

**Why this priority**: Preserves a useful, *accurate* warning for the one case where it's
true, without the false positives.

**Independent Test**: With an Android WebView user agent, the gate shows the
incapable-surface guidance directing the user to open Ring in a real browser.

**Acceptance Scenarios**:

1. **Given** an Android WebView user agent, **When** the gate evaluates capability, **Then**
   it shows guidance to open Ring in a real browser app (not "update Chrome").

### Edge Cases

- **`beforeinstallprompt` fires after several seconds**: the one-tap button still appears
  when it arrives; the user is never shown the false warning in the interim.
- **Non-Chromium Android browsers (Firefox, Samsung Internet)**: not treated as incapable —
  they can install via their own menu, so the steps are shown without the warning.
- **Desktop / iOS**: unaffected (this fix is scoped to the Android branch of the gate).
- **PWA install criteria genuinely unmet (manifest/SW)**: out of scope — that is a separate
  manifest issue, not a browser-capability one; the gate must not blame the browser for it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The install gate MUST NOT classify an Android browser as "unable to install"
  based on the absence/delay of the `beforeinstallprompt` event.
- **FR-002**: The install gate MUST classify an Android browser as "unable to install" ONLY
  when the user agent identifies a genuinely-incapable surface — specifically an embedded
  Android **WebView**.
- **FR-003**: For any Android browser NOT identified as a WebView, the gate MUST show the
  manual install steps and MUST NOT show the "can't install / update your browser" warning.
- **FR-004**: When `beforeinstallprompt` is available, the gate MUST still offer the one-tap
  install button (existing behavior preserved).
- **FR-005**: The WebView warning copy MUST give accurate guidance — open Ring in a real
  browser app and install from there — and MUST NOT instruct the user to "update Chrome" as
  the remedy.
- **FR-006**: WebView detection MUST be a pure function of the user-agent string so it is
  unit-testable, and MUST correctly classify representative user agents: Android WebView →
  incapable; Chrome / Samsung Internet / Firefox / Edge on Android → capable; non-Android →
  not applicable.

### Key Entities

- *(none — this is a client-side detection fix; no data model change.)*

## Zero-Knowledge Impact

*(Required by Constitution Principle I.)*

- **What new data becomes visible to the server?** None. This is a purely client-side UI/UX
  fix to install-gate detection; no request, payload, or stored data changes.
- **Boundary**: unchanged. No client/server contract is touched.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A normal current-Chrome Android user agent never triggers the "can't install"
  warning, in 100% of evaluations, regardless of whether `beforeinstallprompt` has fired.
- **SC-002**: An Android WebView user agent triggers the (accurate) incapable-surface
  guidance in 100% of evaluations.
- **SC-003**: The one-tap install button still appears whenever `beforeinstallprompt` is
  offered (no regression).
- **SC-004**: WebView-vs-capable classification is verified by a unit test over a
  representative set of real user-agent strings.

## Assumptions

- On Android in the current browser landscape, the only common surface that genuinely
  cannot install a PWA (no "Install app" path) is an embedded WebView; mainstream browsers
  (Chrome, Samsung Internet, Edge, Firefox) can install via their menu.
- Cases where the PWA fails install criteria for manifest/service-worker reasons are
  separate and out of scope for this gate-capability fix.
- Desktop and iOS gate behavior is correct and unchanged.
