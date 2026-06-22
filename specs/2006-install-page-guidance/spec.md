# Feature Specification: Install-page guidance for a Play Protect "older Android" block

**Feature Branch**: `fix/2006-install-page-guidance`

**Created**: 2026-06-22

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     Directory number sets the category (2001+ = hotfix/bug). -->

**Input**: A Galaxy S22+ user, installing the Ring PWA, hit Google Play Protect: "Unsafe app
blocked — This app was built for an older version of Android and doesn't include the latest
privacy protections." Investigation: this is a device/Chrome-side WebAPK issue — when Chrome
installs a PWA it asks Google's WebAPK minting server to build the app shell, whose
`targetSdkVersion` (set by Google, tied to the installed Chrome/WebView version) can lag the
device's Android version and trip Play Protect. Ring's manifest is complete and correct; we
cannot set the WebAPK's target SDK. The fix we CAN ship is on-page guidance so an affected
user can self-resolve.

## Overview

Ring's install gate (`InstallGuard`) blocks a plain browser tab until Ring is added to the
Home Screen, with platform-specific steps and a callout for in-app browsers (WebView) that
can't install at all. It says nothing about the case where the browser CAN install but
Android's Play Protect blocks the resulting app as "built for an older version of Android"
/ "unsafe." This change adds a short, calm, secondary help note on the Android install page
explaining that this is a Chrome/Play-Protect quirk (not a Ring problem) and what to do:
update Chrome + Google Play services and retry, or proceed via "More details → Install
anyway."

## Bug & Root Cause

- **Symptom**: on some Android devices (e.g. S22+ on Android 14/15), installing Ring triggers
  Play Protect "Unsafe app blocked — built for an older version of Android."
- **Root cause**: the WebAPK shell Chrome installs is built and signed by Google's WebAPK
  minting server; its `targetSdkVersion` is controlled by Google (and follows the device's
  Chrome / Android System WebView version), not by Ring. When that target lags the device's
  Android API by more than two versions, Play Protect warns/blocks. Ring's web app manifest
  is complete and correct, and there is no Ring-side setting for the WebAPK target SDK — so
  the only Ring-side remedy is to guide the user.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Android user who hit the block can self-resolve (Priority: P1)

An Android user on the install page who sees (or anticipates) Play Protect blocking Ring as
"built for an older version of Android / unsafe" finds a short note explaining it's a
browser/Play-Protect quirk and how to get past it.

**Why this priority**: It's the reported blocker; without guidance the user is stuck at a
system dialog that looks like Ring is malware.

**Independent Test**: Open the Android install page and confirm a calm, secondary help note
is present that names the Play-Protect symptom and gives the resolution steps.

**Acceptance Scenarios**:

1. **Given** the Android install page (a browser that can install), **When** the user reads
   it, **Then** a secondary note explains the "older version of Android / unsafe" block is a
   Chrome/Play-Protect issue (not a Ring defect) and lists the remedy: update Chrome and
   Google Play services and retry, or use "More details → Install anyway."
2. **Given** the note, **When** the user reads it, **Then** it is visually secondary/calm
   (not an alarming error), distinct from the existing WebView "can't install here" callout.

### User Story 2 - The note is shown only where it's relevant (Priority: P2)

The note appears only on Android where a real install (and thus a WebAPK / Play Protect) is
possible — not on iOS/desktop, and not as a duplicate of the in-app-browser (WebView)
callout, which already tells the user to open Ring in a real browser.

**Why this priority**: Showing it on platforms where Play Protect can't occur would be
confusing noise.

**Independent Test**: Confirm the note shows on the Android installable page and not on iOS,
desktop, or the WebView-unavailable state.

**Acceptance Scenarios**:

1. **Given** iOS or desktop, **When** the install page renders, **Then** the Play-Protect note
   is not shown.
2. **Given** an Android in-app browser (WebView, install unavailable), **When** the page
   renders, **Then** the WebView callout is shown and the Play-Protect note is not duplicated.

### Edge Cases

- **Wording stays calm**: the note must not read as an error/alarm (the system dialog already
  alarms); it reassures that Ring is fine and gives steps.
- **No detection promised**: Ring cannot detect whether Play Protect will block (it's a
  post-install system dialog), so the note is informational guidance, always available on the
  relevant Android page rather than triggered by the block.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Android install page MUST include a secondary help note covering the Play
  Protect "built for an older version of Android" / "unsafe app blocked" case, stating it is a
  Chrome/Play-Protect quirk (not a Ring problem).
- **FR-002**: The note MUST give the resolution: update Chrome and Google Play services and
  try again, or proceed via the dialog's "More details → Install anyway."
- **FR-003**: The note MUST be visually secondary/calm (muted), distinct from the existing
  warning-styled WebView "can't install here" callout.
- **FR-004**: The note MUST be shown only on Android where a real install is possible (not
  iOS/desktop, and not duplicating the WebView-unavailable callout).
- **FR-005**: No change to the WebAPK, the manifest, or any build/target-SDK setting (none is
  available to Ring); this is install-page copy only.

### Key Entities

- *(none — static install-page UI copy; no data, no stored entity.)*

## Zero-Knowledge Impact

*(Required by Constitution Principle I.)*

- **What new data becomes visible to the server?** None. This is static client-side copy on
  the install gate; no client/server contract, payload, or stored data changes. The crypto/ZK
  checklist is therefore **not required**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Android installable install page shows the Play-Protect help note (symptom +
  remedy), styled as a calm/muted secondary note.
- **SC-002**: The note does not appear on iOS, on desktop, or as a duplicate in the Android
  WebView-unavailable state.
- **SC-003**: No WebAPK/manifest/build change is made (verified by diff — install-page copy
  only).

## Assumptions

- The browser that successfully reaches a WebAPK install is recent enough that "update Chrome
  / Play services and retry" is the effective remedy; "Install anyway" covers the rest.
- The existing `InstallGuard` platform detection (`platform`, `installUnavailable`) is the
  correct gate for where to show the note.
- Already-shipped device behavior (Play Protect) is outside Ring's control; this spec only
  adds guidance.
