# Feature Specification: Camera Off Shows Your Picture to the Call, Not a Black Screen

**Feature Branch**: `fix/2029-camera-off-shows`

**Created**: 2026-07-13

**Status**: in-progress

**Input**: User bug report: "when I stop my camera feed, my profile avatar is only visible to myself and not others, they see a black screen only."

## Bug

Turning the camera off only disables the local video track. A disabled WebRTC track keeps transmitting black frames, and no signal tells the other side anything changed — so their app keeps rendering the (black) video. Locally the avatar shows because the local UI reads the local camera-off state; remotely there is nothing to read. The same gap exists when the adaptive quality controller pauses a leg's video at its lowest tier: the sender detaches its track, the receiver's video goes dark, and the receiver's UI still shows the dark video instead of the person's picture.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Peers see my picture when my camera is off (Priority: P1)

During a video call (1:1 or group), a user turns their camera off. Everyone else's view of them switches to their profile picture, exactly as the user sees themself; their device also stops sending video entirely (no black-frame stream). Turning the camera back on restores their live video for everyone.

**Independent Test**: Two-device video call; device A turns the camera off → device B shows A's avatar (not black); A turns it back on → B shows live video again.

**Acceptance Scenarios**:

1. **Given** a connected 1:1 video call, **When** A turns the camera off, **Then** B's view of A switches to A's profile picture within a moment, and A's device stops sending video frames.
2. **Given** A's camera is off, **When** A turns it back on, **Then** B sees A's live video again within a moment.
3. **Given** a group video call, **When** one participant turns their camera off, **Then** that participant's tile shows their picture on every other device; other tiles are unaffected.
4. **Given** the adaptive quality controller pauses a participant's video (lowest tier), **Then** receivers show that participant's picture instead of a dark tile, and live video returns when quality recovers.

### User Story 2 - Camera-off survives the call's other moves (Priority: P2)

Camera-off must hold its meaning through the call's other features: flipping the camera while off must not secretly resume sending; holding and resuming the call must not resurrect video the user turned off; starting screen share while the camera is off shares the screen (an explicit choice to show something); quality adaptation must never re-enable video the user turned off.

**Acceptance Scenarios**:

1. **Given** A's camera is off, **When** A flips between front/back camera, **Then** nothing is sent until A turns the camera back on, which then uses the newly chosen camera.
2. **Given** A's camera is off, **When** the call is held and resumed (call-waiting swap), **Then** A's camera stays off after resume and B still sees A's picture.
3. **Given** A's camera is off, **When** A starts screen share, **Then** the screen is shared (video on); stopping share returns to the camera's previous state semantics (share implies video on, matching today's behavior).
4. **Given** A's camera is off and the quality controller would raise A's video tier, **Then** no video is sent until A turns the camera on.

### Edge Cases

- The receiver may briefly hold the last decoded frame before the browser reports the track as dark; the picture swap keys off the track's reported state, so the gap is bounded by the browser's report, not by any app polling.
- A user with no profile picture shows their generated avatar disc (same as everywhere else).
- Both directions independently: A off / B on shows A's picture to B and B's live video to A.
- Reconnection (network blip, connection restart) while camera is off must come back still-off on both the wire and both UIs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Turning the camera off MUST stop outgoing video transmission entirely (no black-frame stream) on every connection carrying it (the 1:1 connection or every group leg).
- **FR-002**: Every receiving device MUST render the participant's profile picture while that participant's video is stopped — whether stopped by their camera toggle or by quality adaptation's video pause — and restore live video when it resumes.
- **FR-003**: The camera state MUST reach receivers deterministically and privately: a sealed camera-state signal on the existing end-to-end-encrypted call channel (indistinguishable to the server from any other sealed call signal, like hold/resume), with the media track's own reported dark-state as fallback so calls with older app versions still improve. Rationale: the track-only approach proved browser-dependent — real devices keep the track "live" while receiving black frames, which is this very bug.
- **FR-004**: Camera-off MUST be preserved across camera flip, hold/resume, quality-tier changes, and connection restarts; screen share while off shares the screen (explicit video-on, today's semantics).
- **FR-005**: The local user's own preview behavior is unchanged (avatar shown locally, as today).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a two-device video call, toggling the camera off swaps the remote view to the profile picture; toggling on restores live video — verified by an automated two-browser test that fails on today's code.
- **SC-002**: While the camera is off, the sender's outgoing video bitrate for that call is zero (no black-frame encode).
- **SC-003**: The dark-tile bug during quality-adaptation video pause is fixed by the same change (receiver shows the picture).
- **SC-004**: The server-visible wire is unchanged: the camera-state signal rides the existing sealed call-signal frames (no new frame type, no plaintext, nothing distinguishable to the relay).

## Zero-Knowledge Impact

The camera-state signal is sealed end-to-end inside the existing call-signal frames (the same construction as hold/resume/qos): the server relays opaque ciphertext and cannot tell a camera toggle from an ICE candidate. Net payload goes down — the dead black-frame video stream disappears entirely while the camera is off. No plaintext, no new frame type, no new metadata.

## Assumptions

- "Show my picture" means the same avatar surface already used for audio calls / camera-off tiles (existing components and data; no new UI design).
- Keeping the camera hardware active while off (current behavior: the track is retained, frames are not sent) is unchanged — releasing the camera entirely is out of scope for this fix.
