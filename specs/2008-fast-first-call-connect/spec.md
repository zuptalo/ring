# Feature Specification: Make the first call connect as fast as a call-waiting second call

**Feature Branch**: `fix/2008-fast-first-call-connect`

**Created**: 2026-06-24

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "The second call that lands in the call-waiting queue connects, and shows video/audio for both parties, very fast and snappy. The very first call connection takes way too long by comparison. Make the first call connect (and show media for both sides) as fast as the second one."

## Overview

Call waiting (spec 0005) made a **second** incoming call connect almost instantly: the
moment it is accepted, media appears for both parties with barely any delay. The **first**
call of a session — the one you place or answer from idle — is noticeably slower: after the
callee answers, there is a conspicuous pause before audio is heard and video is seen on both
sides.

The two paths behave differently. The second-call path is fast because, by the time it is
accepted, the groundwork is already done and nothing on the critical path is left to wait on —
early connectivity candidates that arrived before it was ready were kept and applied the instant
it became ready, the camera/microphone were already live, and relay credentials were already in
hand. The first-call path instead does this groundwork **serially, on the critical path**, and
discards early candidates that arrive before it is ready, so the connection and first media are
slow.

This is a perceived-performance fix: bring the first call's **time-to-first-media** down to be
on par with the second call, for both the caller and the callee, without changing the
zero-knowledge boundary or call semantics.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Placing a call connects quickly (Priority: P1)

A user places a 1:1 call from idle. As soon as the other person answers, the caller hears and
sees them within about the same short delay they would experience accepting a second
(call-waiting) call — not the long pause they get today.

**Why this priority**: This is the headline complaint and the most common call action. Fixing
the outgoing first-call connect delivers the bulk of the value and is independently demonstrable.

**Independent Test**: Place a first 1:1 call between two accounts in the test harness, have the
callee answer, and measure the time from "answered" to the caller receiving decoded remote
media; compare against the second-call (call-waiting) path under the same conditions.

**Acceptance Scenarios**:

1. **Given** a user places a first 1:1 audio call, **When** the callee answers, **Then** the
   caller receives the callee's audio within a small margin of the second-call path's time.
2. **Given** a user places a first 1:1 video call, **When** the callee answers, **Then** the
   caller sees the callee's video within a small margin of the second-call path's time.
3. **Given** early connectivity candidates arrive before the call is ready to use them,
   **When** the call becomes ready, **Then** those candidates are applied (none dropped) so the
   connection still completes on the first attempt.

---

### User Story 2 - Answering a call connects quickly (Priority: P1)

A user answers an incoming 1:1 call from idle. Immediately after they accept, they hear and see
the caller as quickly as they would when accepting a second call — and the caller likewise sees
and hears them promptly.

**Why this priority**: The delay is symmetric — both ends wait today. Answering is half of every
call, and the callee's perception matters as much as the caller's. Independently testable.

**Independent Test**: Answer a first 1:1 call in the harness and measure time from "accepted" to
decoded remote media on the answering side (and confirm the caller's side too); compare against
the second-call path.

**Acceptance Scenarios**:

1. **Given** a first 1:1 call is ringing, **When** the user accepts it, **Then** they receive
   the caller's media within a small margin of the second-call path's time.
2. **Given** the callee accepts, **When** the connection establishes, **Then** the caller
   receives the callee's media within a small margin of the second-call path's time (both
   directions are fast, not just one).

---

### User Story 3 - The first group-call leg connects quickly (Priority: P3)

When a user starts or joins a group call from idle, the first peer leg connects and shows media
about as quickly as a second-call connection, rather than lagging.

**Why this priority**: Group calls share the same connection machinery, so the same asymmetry
likely applies; but the headline pain is 1:1, so this is a lower-priority extension confirmed
during implementation. If the group path already connects quickly, this story is a no-op
verification.

**Independent Test**: Start a group call between three accounts in the harness and measure
time-to-first-media on each freshly opened leg; compare against the second-call path.

**Acceptance Scenarios**:

1. **Given** a user starts or joins a group call, **When** a peer leg opens, **Then** that leg
   shows the peer's media within a small margin of the second-call path's per-connection time.

---

### Edge Cases

- **Early candidates either side**: candidates may arrive before the receiving side has created
  its connection (caller's candidates before the callee answers; callee's before the caller
  processes the answer). Both must be buffered and applied, never dropped.
- **Relay-only path**: when a direct path is impossible and traffic must go through the relay,
  the first call must still connect promptly (relay credentials must already be available, not
  fetched on the critical path).
- **Audio-only vs video**: both must improve; a video first call must not be gated on anything an
  audio call wouldn't be.
- **Permission prompt**: if the OS prompts for camera/microphone on a fresh call, the parts of
  setup that don't depend on the captured media must proceed in parallel so the prompt doesn't
  serialize the whole connection.
- **iOS/Safari**: the speed-up must hold on iOS/Safari (the platform the calling stack must keep
  working on), including its camera-track warm-up behavior.
- **No-answer / cancel**: the faster setup must not change ring/cancel/no-answer behavior or
  cause a call to connect media before it is actually accepted.
- **Clean teardown of pre-warmed state**: if a call is declined, cancelled, times out, or fails
  after TURN was warmed (or a peer connection was pre-created), that state must be discarded
  cleanly — no lingering half-open connection, no leftover instrumentation, and nothing that would
  signal call intent to the server beyond what the normal cancel/no-answer flow already does.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST reduce the first 1:1 call's time-to-first-media (first decoded
  remote audio and first decoded remote video) so it is on par with the second/call-waiting
  call path, for both the caller and the callee.
- **FR-002**: The system MUST retain connectivity candidates that arrive before the call's
  connection is ready to consume them, and apply them as soon as it is ready, so none are
  dropped — mirroring the second-call path.
- **FR-003**: The system MUST avoid serializing, on the critical connection path, setup work that
  can run concurrently (capturing camera/microphone, preparing relay credentials, and exchanging
  call setup messages), so the connection is not blocked waiting on independent steps.
- **FR-004**: The system MUST have relay credentials available when the first call needs them,
  rather than fetching them on the critical path at call time.
- **FR-005**: The system MUST NOT introduce any delay between the call being accepted and the
  media tracks being attached/flowing beyond what is technically required to negotiate the
  connection.
- **FR-006**: The faster connection path MUST preserve all existing call semantics —
  ring/answer/decline/cancel/no-answer, the busy and call-waiting behavior, and call logging —
  with no regressions.
- **FR-007**: Media MUST NOT be exchanged before the call is actually accepted (the speed-up
  comes from removing avoidable waits, never from connecting prematurely).
- **FR-008**: The improvement MUST hold on iOS/Safari.

### Zero-Knowledge Impact

- **FR-009**: All call setup messages (session descriptions and connectivity candidates) MUST
  remain end-to-end encrypted exactly as today; the server continues to relay only ciphertext and
  learns nothing new. This fix changes only **client-side timing/ordering** of work — it adds no
  new server message type, no new server-visible metadata, no new stored state, and no change to
  what the relay sees.
- **FR-010**: Warming the TURN credential cache MUST reuse the existing authenticated
  `/v1/turn-credentials` request unchanged (same endpoint, same payload, same response) — only
  *when* it is issued may move earlier. Warming on **incoming ring** MUST NOT reveal any new signal
  to the server: by the time the callee would warm, the server has already relayed the (sealed)
  offer to that device, so a credential fetch correlates to nothing the relay didn't already cause.
  No warming may fire for non-call events (it is triggered only by outgoing call intent or an
  actual incoming offer).
- **FR-011**: The connect-milestone instrumentation MUST be client-local, dev/test-only, stripped
  from production builds, and hold only ephemeral timestamps — never SDP, ICE, keys, media, or peer
  identifiers, and never transmitted off-device.

## Key Entities

- **Time-to-first-media**: the elapsed time from a call being accepted to the first decoded
  remote media frame appearing at the receiver. Measured separately for the caller→callee and
  callee→caller directions, and for audio vs video.
- **Early connectivity candidate**: a network candidate produced by one side before the other
  side's connection object exists to consume it; must be buffered and later applied.
- **Reference (second-call) path**: the call-waiting accept-and-connect path from spec 0005, used
  as the performance benchmark this fix must match.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Under the end-to-end test harness on equivalent conditions, the **median**
  first-call time-to-first-media is **no more than 1000 ms slower than the second-call path**
  (median over at least 5 runs), for both audio and video and for both directions. (This is the
  concrete margin the e2e asserts; the deterministic ordering/overlap invariant in SC-005 is the
  real gate, with this margin as generous validation against CI hardware variance.)
- **SC-002**: After the callee answers a first 1:1 call, both parties receive decoded remote
  media within **2000 ms** on a local/LAN-equivalent connection (down from the current noticeably
  longer pause).
- **SC-003**: First-call connection succeeds on the first attempt in at least 99% of harness
  runs, with no early connectivity candidates dropped.
- **SC-004**: The existing call and call-waiting end-to-end suites, and the calling unit tests,
  all remain green — no regression in connection reliability, call semantics, or the
  zero-knowledge boundary.
- **SC-005**: The first-call connection-setup ordering invariants hold deterministically (the
  primary, non-flaky gate): on the caller, relay-credential preparation is not serialized behind
  media capture; on the callee, connection/SDP setup is not serialized behind media capture. These
  are boolean orderings observed via the connect milestones (false on today's code, true after the
  fix), not wall-clock thresholds.

## Assumptions

- The second/call-waiting connection path (spec 0005) is already acceptably fast and is the
  correct performance benchmark to match.
- "Time-to-first-media" is measured at the receiver as the first decoded remote frame, which the
  real-WebRTC Playwright harness can observe via the existing test hooks (remote stream/track
  readiness).
- The sealed signalling transport (Double Ratchet for contacts, call-scoped key agreement for
  non-contact co-members) and the relay are unchanged; only the client's local sequencing of
  setup work changes.
- The fix targets 1:1 first calls as the priority (P1); the group first-leg case (P3) is included
  only if the same asymmetry is confirmed to exist there.
- No change to participant caps, quality tiers, or any call UI is required by this fix.
