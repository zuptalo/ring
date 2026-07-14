# Feature Specification: Join-Call Invite Affordance & Redundant Held Call

**Feature Branch**: `fix/2031-join-call-invite`

**Created**: 2026-07-13

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User bug report (2026-07-13, with screenshots from a real two-call session on iPhone): "Ask Kambiz to join the call doesn't look like a button at all and I accidentally discovered it. Also when the one you have invited to join the call accepts the invite, their existing call should terminate automatically — right now it keeps the 1:1 call alive and even gives you an option to switch between them!"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accepting a join invite retires the now-redundant call (Priority: P1)

Kamran is on a video call. His other call with Kambiz is on hold. He asks Kambiz to join the current call, and Kambiz accepts. From that moment Kamran and Kambiz are together in one call — the old held 1:1 between the same two people serves no purpose. It should end by itself on both sides. Today it stays alive: Kamran keeps a "Switch to Kambiz · On hold · tap to swap calls" control, and tapping it would put him in a phantom second call with someone he is already talking to.

**Why this priority**: Functional defect with real confusion potential — swapping into the stale call splits the two people across two calls again, and the held call keeps consuming a call slot. The reporter hit this in an actual family call.

**Independent Test**: Two devices in a 1:1 call; caller starts or answers a second call (first goes on hold), invites the held party into the active call, and the held party accepts. The moment the invitee joins, the old 1:1 disappears from both devices — no swap pill, no held-call entry, no lingering call screen — and the merged call carries on.

**Acceptance Scenarios**:

1. **Given** Kamran is in call B with a held 1:1 call A to Kambiz, **When** Kambiz accepts the invite and joins call B, **Then** call A ends automatically on BOTH sides, the "Switch to Kambiz" pill disappears from Kamran's screen, and no missed/dropped-call artifact is logged for call A beyond a normal ended call.
2. **Given** the same setup, **When** Kambiz joins, **Then** Kambiz's device shows only the merged call — his old 1:1 with Kamran does not remain as a held call on his side either.
3. **Given** Kambiz DECLINES the invite (or lets it lapse), **Then** nothing changes: the held 1:1 stays exactly as today, swappable.
4. **Given** the invitee accepts but fails to actually connect to the merged call (network death mid-join), **Then** the held 1:1 is not torn down until the invitee's media is established in the new call — never strand both parties with no call at all.
5. **Given** the held call is with a DIFFERENT person than the accepted invitee, **Then** it is untouched (only the redundant same-person call retires).

---

### User Story 2 - The join invite reads as a button (Priority: P2)

The "Ask Kambiz to join this call" control currently renders as a plain dark text pill — visually identical to the passive "Invited" status chip it turns into after tapping. The reporter discovered it was tappable by accident. It must look like an action: styled like the app's other in-call action affordances (e.g. the green swap pill right below it), with a pressed state, and clearly distinct from the non-interactive "Invited" status it becomes.

**Why this priority**: Discoverability defect on a useful feature; cosmetic-plus. Below US1 because nothing breaks — it's just invisible.

**Independent Test**: In the two-call state, the invite control is visually identifiable as a button (color/shape/icon parity with sibling actions), and after tapping, the resulting "Invited" state is visually passive (chip/label) so the two states cannot be confused.

**Acceptance Scenarios**:

1. **Given** a held 1:1 while in another call, **When** the call screen shows the join-invite control, **Then** it looks like a tappable action (button styling consistent with the swap pill: fill/tint, icon, pressed feedback), not a text label.
2. **Given** the invite has been sent, **Then** the control transitions to a clearly passive "Invited" status presentation, and repeated taps do nothing (no duplicate invites).

---

### Edge Cases

- Invitee accepts at the exact moment the inviter manually ends the held call — teardown must be idempotent (no error, no double-ended artifacts).
- Invitee accepts while the inviter's active call is itself ending — the invite resolves against a dying call; the held 1:1 must NOT be torn down in that case.
- Group case: the held "call" with the invitee is a group call containing others — it must NOT auto-end (only a redundant 1:1 with exactly the invitee retires).
- Call history: the retired 1:1 logs as a normal completed call with its real duration, not as missed/cancelled.
- Both sides' UI updates promptly even if the retire signal races the join media (states may arrive in either order).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an invited party accepts a join-call invite and successfully connects to the inviter's active call, the now-redundant held 1:1 call between the same two parties MUST end automatically on both devices, without user action.
- **FR-002**: The automatic retire MUST NOT fire on decline, lapse, or failed join (invitee never establishes media in the new call), and MUST only ever target a held 1:1 whose sole peer is the accepted invitee.
- **FR-003**: The retired call MUST be recorded as a normally-ended call (correct duration, not missed/cancelled) and MUST free its call slot immediately.
- **FR-004**: The join-invite control MUST be visually recognizable as a tappable action, consistent with the in-call action styling (the swap pill family), including a pressed state — composed from stock Ionic primitives per the Ionic-first principle.
- **FR-005**: After sending, the control MUST present as a passive "Invited" status clearly distinct from the actionable state, and further taps MUST NOT send duplicate invites.
- **FR-006**: All teardown/ordering paths MUST be race-safe (accept vs manual hangup, accept vs active-call end) — no state where both calls are gone or both alive with the same peer.

## Zero-Knowledge Impact

- **What crosses the wire**: no new payloads expected — the join/accept signals already exist (sealed call signaling); the retire is a device-local decision on an existing state transition, possibly reusing the existing sealed call-end signal for the old call.
- **Visible metadata**: unchanged; the server continues to relay opaque call signaling.
- **Why**: pure client call-state-machine + UI change. (To be re-verified at plan time; any new signal must ride the existing sealed channel.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the accept-and-join flow, the redundant held 1:1 is gone from both devices within 3 seconds of the invitee's media connecting, in 100% of e2e runs.
- **SC-002**: Decline/lapse/failed-join leave the held call intact in 100% of e2e runs.
- **SC-003**: A usability check (the reporter) confirms the invite control reads as a button at a glance and the Invited state as a status.
- **SC-004**: No regression across the existing call-waiting/merge e2e suites (hold, swap, merge-consent, add-cap and friends stay green).

## Assumptions

- The stated behavior ("their existing call should terminate automatically") is the requirement — no clarification needed on the P1 outcome; the retire fires on JOIN (media established), not on mere accept, to satisfy the stranding edge case.
- Root cause found during implementation (2026-07-14): the pre-2031 retire ran only on receipt of the sealed `joinreq-accept` reply — a single lossable frame (see spec 2033); when it was lost while the active call was already a group, the invitee still meshed into the room via the room signaling and the held 1:1 survived, exactly as reported. The retire is therefore keyed on the server's roster broadcast (the authoritative join signal), which also satisfies the join-not-accept requirement. A second latent defect fell out of the red test: any CONNECTED 1:1 dissolving into a room (merge-accept or ordinary promotion) never closed its Calls-tab record, leaving the callee's provisional "missed" row permanently — a phantom missed call from someone they actually talked to (FR-003 now covers it).
- Real-device verification is required for the final sign-off (the reporter's two-phone setup), since the join flow involves real WebRTC renegotiation; e2e covers the state machine per the established call-suite patterns.
- Scope excludes any redesign of the broader add-people/merge flows beyond the two reported items.
