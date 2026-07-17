# Feature Specification: Call on-hold visualization & 1:1 diagnostics

**Feature Branch**: `fix/2011-hold-ui-and-1to1-diag`

**Created**: 2026-06-25

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Three small call-screen fixes: (1) a video call shows the "On hold" state twice — a big
centered blurred pause overlay AND a small redundant pill near the controls; remove the pill. (2) An
audio call on hold shows only the small pill — give it the same clear treatment as video (blur the
avatar stage, centered large pause + "On hold"). (3) The ⓘ call-diagnostics panel sits at
"collecting…" forever on a 1:1 call (it only populates for group/mesh calls); make it show useful 1:1
info too.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The "on hold" state reads clearly and once (Priority: P1)

When the other side puts the user on hold, the call screen shows a single, clear "on hold"
indication — a blurred stage with a large centered pause icon and "On hold" text — for both video and
audio calls. There is no second, redundant little "On hold" pill near the controls.

**Why this priority**: The duplicate indicator is visual clutter and looks unpolished; the audio case
is worse — it has only the small pill, so a held audio call doesn't read as clearly paused.

**Independent Test**: Put a 1:1 video call on hold → confirm only the centered blurred pause overlay
shows (no bottom pill). Put a 1:1 audio call on hold → confirm the avatar stage is blurred with the
same centered pause overlay, and no bottom pill.

**Acceptance Scenarios**:

1. **Given** a 1:1 video call the other side has put on hold, **When** viewing the call screen,
   **Then** only the centered blurred pause overlay is shown and the small bottom "On hold" pill is
   gone.
2. **Given** a 1:1 audio call the other side has put on hold, **When** viewing the call screen,
   **Then** the avatar stage is blurred and a centered large pause icon + "On hold" text is shown,
   matching the video treatment, with no bottom pill.
3. **Given** the held call resumes, **When** the other side comes back, **Then** the blur and overlay
   clear and the call returns to normal — for both video and audio.

---

### User Story 2 - The ⓘ panel shows live info on a 1:1 call (Priority: P2)

When the user opens the ⓘ call-diagnostics panel during a 1:1 call, it shows live connection info
(codec, up/down bitrate, the current adaptive tier, round-trip/loss) instead of being stuck at
"collecting…". Group calls already show per-leg info; 1:1 should be informative too.

**Why this priority**: The panel is a useful at-a-glance health view; today it's silent on 1:1 calls
(the most common kind), which reads as broken.

**Independent Test**: Open the ⓘ panel during a connected 1:1 call → confirm it shows at least one
live status line that updates over time, not just "collecting…".

**Acceptance Scenarios**:

1. **Given** a connected 1:1 call, **When** the ⓘ panel is open, **Then** it shows a live status line
   (codec + up/down bitrate + tier + RTT/loss) and refreshes periodically.
2. **Given** a group call, **When** the ⓘ panel is open, **Then** it continues to show the existing
   per-leg lines (no regression).

---

---

### User Story 3 - Switching to the other call is an obvious action (Priority: P2)

While on one call with another parked (call waiting), the control to switch between them reads as a
clear, prominent action — a swap icon with "Switch to {name}" — rather than a small passive "On hold ·
{name}" label whose tappability and purpose weren't obvious.

**Why this priority**: Switching calls is a deliberate, occasionally-urgent action; a tiny ambiguous
label makes it easy to miss or mis-read.

**Independent Test**: With a parked call, confirm the switch control shows a swap icon + "Switch to
{name}", is visually prominent (action-tinted), and tapping it swaps the active and held calls.

**Acceptance Scenarios**:

1. **Given** an active call with another on hold, **When** viewing the call screen, **Then** the
   switch control reads as an action (swap icon + "Switch to {name}"), not a passive on-hold label.
2. **Given** that control, **When** tapped, **Then** the active and held calls swap (existing
   `swapCalls` behavior, unchanged).

### Edge Cases

- A held video call where OUR camera fills the screen (we swapped the PiP/main): the on-hold overlay
  still applies to the remote, not our own preview.
- An audio call that upgrades to video while held, or a hold that arrives during connecting: the
  overlay/blur tracks the held state and the active stage type.
- The ⓘ panel before a 1:1 call connects: it may briefly show "collecting…", then the live line once
  stats are available (no error/empty-forever).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A 1:1 call on hold MUST show exactly one on-hold indication — the centered blurred
  pause overlay — and MUST NOT show the small redundant bottom "On hold" pill.
- **FR-002**: An audio 1:1 call on hold MUST blur the avatar stage and show the same centered large
  pause icon + "On hold" text used for video.
- **FR-003**: Resuming a held call MUST clear the blur and overlay for both video and audio.
- **FR-004**: The existing held-call (parked call-waiting) bar and the group per-tile on-hold badge
  MUST be unaffected (this only removes the duplicate active-call pill and adds the audio overlay).
- **FR-005**: On a connected 1:1 call, the ⓘ diagnostics panel MUST show at least one live status
  line (codec, up/down bitrate, current tier, RTT/loss) that refreshes periodically, instead of
  remaining at "collecting…".
- **FR-006**: Group-call ⓘ diagnostics MUST continue to show their existing per-leg lines (no
  regression).
- **FR-007**: The 1:1 diagnostics MUST be client-local only (read from local getStats) — no new data
  leaves the device; the zero-knowledge boundary is unchanged.
- **FR-008**: The call-waiting switch control MUST read as a clear, prominent action (swap icon +
  "Switch to {name}") and, when tapped, swap the active and held calls (existing behavior unchanged).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A held 1:1 video call shows only the centered pause overlay (no bottom pill); a held
  audio call shows the blurred avatar + centered pause overlay (no bottom pill).
- **SC-002**: Resuming clears the held visuals for both call types.
- **SC-003**: The ⓘ panel on a connected 1:1 call shows a live, periodically-refreshing status line.
- **SC-004**: No regression to group-call diagnostics, the parked-call bar, or the group on-hold
  per-tile badge.

## Assumptions

- The big centered overlay (`held-overlay`) and the blur (`held-frozen`) already exist for video; the
  audio case reuses them over the avatar stage.
- The small active-call on-hold pill (`cw-onhold` for `remoteHeld`) is the redundant element to
  remove; the call-waiting parked-call bar is a different element and stays.
- 1:1 diagnostics are derived from the same local getStats the kbps readout already uses; populating
  the panel is a presentation change, not new data collection.
