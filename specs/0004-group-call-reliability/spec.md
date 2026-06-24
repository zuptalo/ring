# Feature Specification: Group call reliability, adaptive quality, caps, audio cues & busy signalling

**Feature Branch**: `feat/0004-group-call-reliability`

**Created**: 2026-06-23

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Fix the group (and 1:1) audio/video calling behaviour: stop members being auto-re-invited after they leave; start outgoing media at low quality and adapt it up/down per receiver based on real connection health; cap video calls at 4 and audio at 8 (and block audio→video upgrades above 4); add audio cues for every call state; make sure anyone we can't take gets a busy signal; and remove the dead SFU architecture left over from the mesh migration."

> **Related**: Call-waiting (put a call on hold, answer another, swap/drop between two
> concurrent calls) was split into its own spec, `0005-call-waiting-hold`, which builds
> on the busy/second-incoming handling defined here (User Story 2).

## Clarifications

### Session 2026-06-23

- Q: When a quality tier is manually pinned and the link degrades, what should adaptation do? → A: Pin is an **upper bound**; adaptation may still drop below it to keep the call alive (call survival wins).
- Q: How should audio be treated under congestion (vs. video)? → A: **Protect audio** — hold audio at a reliable bitrate, adapt video; under severe congestion suspend video so audio survives.
- Q: Where are the participant caps (4 video / 8 audio) enforced? → A: **Client and server** — the app blocks over-cap start/join in the UI; the server's room registry also refuses an over-cap join (authoritative).
- Q: What should happen to "decline with predefined message" (already exists for 1:1)? → A: **Leave as-is and extend** — keep the 1:1 canned-reply decline; group invites we can't take get a busy signal; the canned-reply list may be editable in Settings.
- Q: What goes in call history when a call is refused/declined/missed? → A: **Both sides** — caller gets an "unavailable/declined" entry, callee gets a "missed call" entry.

## User Scenarios & Testing *(mandatory)*

Ring's group calls now run as a full peer-to-peer mesh: each participant holds one
direct, end-to-end-encrypted connection to every other participant. The behaviours
below all concern how that mesh joins, adapts, bounds itself, signals state, and how
its dead predecessor (the SFU) is removed. Each story is independently shippable.

### User Story 1 - Leaving a call means leaving it (Priority: P1)

A participant who declines, dismisses, or leaves a group call must stay out. Today the
server's group-ring reminder loop keeps re-sending the invite every reminder round, and a
declining/dismissing invitee never tells the server to stop (the client's decline was silent
for group calls). So a dismissed group ring keeps coming back, pulling the user toward a call
they deliberately turned down.

**Why this priority**: It directly contradicts user intent, is disorienting and
privacy-relevant (you can be pulled back into a live call you left), and has a clean,
confirmed root cause. Small fix, high trust impact.

**Independent Test**: Ring a group member; have them decline/dismiss (or join then leave);
confirm the reminder rounds do NOT bring the ring back; confirm a member who simply hasn't
responded yet is still reminded, and a deliberate caller recall still rings.

**Acceptance Scenarios**:

1. **Given** a group invitee who declined or dismissed the invite, **When** subsequent
   reminder rounds would fire, **Then** they are not re-rung.
2. **Given** a member who joined a group call and then left, **When** the call is still
   ongoing and the caller takes no recall action, **Then** they are not re-rung or rejoined.
3. **Given** an invitee who has neither joined nor declined, **When** a reminder round fires,
   **Then** they may still be reminded (the legitimate ring-reminder path is preserved) until
   they respond.
4. **Given** a member who declined or left, **When** the caller explicitly recalls them,
   **Then** they ring again (deliberate recall still works).

---

### User Story 2 - No incoming call is a silent dead-end (Priority: P1)

When someone is already in a call and does not take another, the caller must always get
a clear result — busy/unavailable — instead of ringing endlessly into a void. Today this
works for 1:1 offers, but a group invite to a busy person is silently dropped, leaving
the caller's tile for them ringing forever. This covers 1:1 audio, 1:1 video, and group
invites. The existing 1:1 "decline with a predefined message" affordance is preserved; a
group invite we can't take simply returns busy.

> This is the second-incoming-call contract that the call-waiting spec
> (`0005-call-waiting-hold`) later builds on by offering accept-and-hold as an
> alternative to busy.

**Why this priority**: Endless ringing with no resolution is a confusing failure that
makes the app feel broken; closing this gap is low-risk and independently shippable.

**Independent Test**: Put user A in any call. Have B place a 1:1 audio call, a 1:1
video call, and a group call including A, with A declining/ignoring each. Confirm each
resolves to a busy/unavailable indication on B's side within a few seconds, A is never
forced to interrupt, and the canned-message decline still works for 1:1.

**Acceptance Scenarios**:

1. **Given** A is in a call and declines an incoming 1:1 (audio or video), **When** the
   decline is sent, **Then** B sees a busy/unavailable indication and A is not disturbed.
2. **Given** A is in a call, **When** B starts a group call that includes A and A does
   not join, **Then** A's tile on B's side resolves to "busy/unavailable" rather than
   ringing indefinitely, and the rest of the group is unaffected.
3. **Given** A receives an incoming 1:1 call, **When** A picks a predefined reply (e.g.
   "In a meeting."), **Then** the reply is delivered into the 1:1 chat and the call is
   declined.
4. **Given** A is busy on every device, **When** B calls, **Then** B is told A is
   unavailable rather than ringing indefinitely.

---

### User Story 3 - Calls stay within sane participant limits (Priority: P1)

Video group calls are capped at 4 participants and audio group calls at 8. A person
cannot start or join a call that would exceed its cap, and an audio call with more than
4 participants cannot be upgraded to video. When a cap is reached, the user gets a clear
"call is full" message and a matching audio cue instead of a silent failure or a
degraded, overloaded call. The cap is enforced both in the app (pre-emptive UX) and by
the server (authoritative refusal).

**Why this priority**: The mesh's per-device load grows with participant count; without
a cap a large video call collapses for everyone. The cap is what makes the adaptive
quality work (Story 4) tractable and protects the core experience.

**Independent Test**: Try to start/join video calls of 4 and 5, and audio calls of 8 and
9; confirm the over-cap attempt is refused with a clear message + cue (and that the
server refuses it even if a client tries to bypass the UI). With 5 people in an audio
call, confirm the video upgrade is blocked.

**Acceptance Scenarios**:

1. **Given** a video group call with 4 participants, **When** a 5th tries to join,
   **Then** they are refused with a clear "call is full" message and cue, and the
   existing call is undisturbed.
2. **Given** an audio group call with 8 participants, **When** a 9th tries to join,
   **Then** they are refused with a clear message and cue.
3. **Given** an audio group call with more than 4 participants, **When** anyone attempts
   to turn on video / upgrade the call to video, **Then** the upgrade is blocked with an
   explanation.
4. **Given** a user selecting participants to start a call, **When** they pick more than
   the cap for the chosen call type, **Then** they cannot proceed past the cap.
5. **Given** a client that bypasses the in-app check, **When** it attempts an over-cap
   join, **Then** the server refuses to admit it to the room.

---

### User Story 4 - Calls adapt to real network conditions, per person (Priority: P2)

Calls start sending low-quality video and audio and ramp up only as far as each
connection actually supports — never assuming Full HD. When a link degrades, outgoing
quality steps back down to keep the call connected and intelligible rather than
freezing or dropping; **audio is protected** (held at a reliable bitrate) and, under
severe congestion, **video is suspended so audio survives**. Because each connection is
independent, one participant on a great network can receive high quality from me while
another on a poor network receives low quality from me at the same moment — and my
outgoing quality to each is governed both by my own uplink and by signs that *their*
downlink is struggling.

**Why this priority**: This is the difference between "calls that survive real-world
networks" and "calls that look great until they don't." It's the largest piece of work
and the call still connects without it, so it ranks below the correctness fixes — but
it's the heart of "fix the behaviour."

**Independent Test**: On a constrained/throttled link, confirm a call connects quickly
at low quality, then climbs over time when headroom exists; throttle mid-call and
confirm outgoing video drops (and is suspended at the extreme) while audio stays clear
and the call stays connected. In a 3+ person mesh with one peer throttled, confirm the
throttled peer receives lower quality while the others stay high.

**Acceptance Scenarios**:

1. **Given** a call is starting, **When** media first flows, **Then** outgoing video and
   audio begin at a low tier rather than the maximum.
2. **Given** a call with ample bandwidth and a healthy link, **When** it has run for a
   short while, **Then** outgoing quality has climbed toward a reasonable target tier
   (and only reaches the highest tier when the link clearly supports it).
3. **Given** an active call, **When** the local uplink degrades (rising loss/RTT, the
   browser reports bandwidth as the limiting factor, or available send bitrate drops),
   **Then** outgoing video quality steps down, and at the extreme video is suspended
   while audio remains intelligible and the call stays connected.
4. **Given** a group call where one peer's downlink is poor, **When** quality is
   evaluated, **Then** outgoing quality to that peer is reduced independently while
   quality to healthy peers is unaffected (e.g. 2 peers high, 1 medium, 1 low).
5. **Given** the user has manually pinned a quality tier or enabled "use less data for
   calls", **When** adaptation runs, **Then** the pin / data-saver acts as an upper
   bound, and adaptation may still reduce below it to keep the call alive.

---

### User Story 5 - The app tells you, by ear, what the call is doing (Priority: P3)

Distinct, subtle audio cues mark every meaningful call moment so the user knows what's
happening without staring at the screen: calling, ringing, connecting, connected,
reconnecting, hanging up / ended, mute and unmute, camera on and off, a "call is full"
refusal, and a quiet cue when a chat message arrives while you're in a call. Cues respect
the app's existing tone/mute settings and never become annoying.

**Why this priority**: A clear usability and accessibility improvement layered on top of
working calls; valuable but not blocking.

**Independent Test**: Walk a call through each state and toggle (connect, reconnect,
mute/unmute, camera on/off, hit a cap, receive a message, hang up) and confirm each emits
its distinct, audible-but-subtle cue, and that disabling tones silences them.

**Acceptance Scenarios**:

1. **Given** a call transitions between states (calling → ringing → connecting →
   connected → reconnecting → ended), **When** each transition occurs, **Then** a
   distinct cue plays for it.
2. **Given** an active call, **When** the user mutes, unmutes, turns the camera on, or
   turns it off, **Then** a distinct confirmation cue plays.
3. **Given** an active call, **When** a chat message arrives, **Then** a quiet in-call
   message cue plays (distinct from the normal notification tone).
4. **Given** the user has disabled call/notification tones, **When** any of the above
   occurs, **Then** no cue plays.

---

### User Story 6 - One coherent calling architecture (Priority: P3)

The codebase and operator documentation describe exactly one group-call architecture:
the peer-to-peer mesh. The dead SFU stack (server relay, server-side signalling
handlers, and the client's SFU/insertable-streams modules) is removed, the deployment
guide is rewritten to describe the mesh accurately, and temporary diagnostic
instrumentation from the migration is cleaned up.

**Why this priority**: Reduces confusion and maintenance burden and fixes actively
misleading docs, but is invisible to end users, so it ranks last.

**Independent Test**: Confirm the build/tests pass with the SFU code removed; confirm a
real group call still connects in all supported browsers including iOS/Safari; confirm
the deployment guide no longer references the SFU, VP8-only, or Chromium-only group
calling, and that the migration's temporary diagnostics are gone.

**Acceptance Scenarios**:

1. **Given** the SFU code is removed, **When** a group call is placed (including on
   iOS/Safari), **Then** it connects and carries audio/video end-to-end encrypted.
2. **Given** an operator reads the calling deployment guide, **When** they follow it,
   **Then** it describes the mesh accurately with no SFU/VP8/Chromium-only group
   requirements.
3. **Given** the server starts with calls enabled, **When** it boots, **Then** it does
   not start or advertise an SFU.

---

### Edge Cases

- **Re-invite window**: A member who leaves and is then *legitimately* re-invited by a
  fresh group call (new room) must still ring — only the *stale* invite for the call
  they left must be suppressed.
- **Last person leaves vs. transient blip**: A roster momentarily showing "only me" due
  to a reconnect blip must not be treated identically to everyone genuinely leaving;
  premature "everyone left" teardown and "someone left" toast spam should be avoided.
- **Busy on one of several devices**: Busy must be reported when the callee has no device
  free to take the call (e.g. busy on every device).
- **Cap reached mid-setup**: Two people racing to be the 4th video / 8th audio joiner —
  exactly one succeeds; the other gets "call is full".
- **Adaptation floor**: Quality must never drop below a usable minimum; audio is
  preserved before video, and video is suspended (not sent as a useless trickle) at the
  floor.
- **Late joiner credentials**: A participant joining a long-running call must establish
  its connections with valid (non-expired) relay credentials.
- **Cue fatigue**: Rapid mute/unmute or repeated reconnect blips must not produce a storm
  of cues.
- **Manual pin vs. adaptation conflict**: A user-pinned high tier on a degrading link is
  an upper bound only; call survival wins and quality may drop below the pin.
- **Audio-only call that grows past 4 then wants video**: upgrade stays blocked until the
  call is back within the video cap.
- **Decline-with-message for a group invite**: An ad-hoc group call may have no chat to
  reply into; such an invite is simply declined with busy (no canned-reply path).

## Requirements *(mandatory)*

### Functional Requirements

**Leaving / re-invite (Story 1)**

- **FR-001**: The system MUST NOT re-ring or rejoin a participant into a group call they
  have left, as a result of buffered/held invite delivery.
- **FR-002**: When a group invitee declines, dismisses, or lets an invite lapse, the system
  MUST stop the server's re-ring reminders for that member (the decline/leave notifies the
  server, which cancels that member's reminder loop).
- **FR-003**: The system MUST continue to ring a legitimately-missed invitee (one who was
  offline at ring time and has not joined) when their device next becomes reachable
  within the hold window.
- **FR-004**: A deliberate caller-initiated recall of a not-yet-joined member MUST still
  ring that member.

**Busy / second-incoming handling (Story 2)**

- **FR-005**: When the user does not take an incoming 1:1 call (audio or video) because
  they are already in a call, the caller MUST receive a busy/unavailable signal.
- **FR-006**: When the user does not take an incoming group invite because they are
  already in a call, the inviting caller MUST receive a busy/unavailable signal for that
  user.
- **FR-007**: On the caller side, a busy/unavailable response for a group invitee MUST
  resolve that invitee's state to "busy/unavailable" and stop ringing them, without
  affecting other invitees.
- **FR-008**: Busy signalling MUST behave correctly across multiple devices (a user with
  no free device is reported busy).
- **FR-009**: The system MUST preserve the existing 1:1 "decline with predefined message"
  affordance; the predefined-reply list MAY be editable in Settings.

**Participant caps (Story 3)**

- **FR-010**: The system MUST cap video group calls at 4 participants and audio group
  calls at 8 participants.
- **FR-011**: The client MUST prevent starting a call (including ad-hoc selection) or
  joining one when doing so would exceed the cap for its type, surfacing "call is full".
- **FR-012**: The server MUST authoritatively refuse admitting a participant to a room
  when doing so would exceed the cap, leaving the existing call undisturbed.
- **FR-013**: The system MUST block upgrading a call to video when it has more than 4
  participants.
- **FR-014**: A "call is full" / "can't add video" outcome MUST be surfaced with a clear
  message and a matching audio cue.

**Adaptive quality (Story 4)**

- **FR-015**: Outgoing audio and video MUST start at a low quality tier at call start.
- **FR-016**: The system MUST measure each connection's health (e.g. available send
  bitrate, packet loss, round-trip time, and the browser's quality-limitation reason)
  and adjust outgoing quality accordingly.
- **FR-017**: The system MUST raise outgoing quality gradually toward a reasonable target
  only while the link demonstrably has headroom, reaching the highest tier only when
  clearly supported (Full HD is never the default).
- **FR-018**: The system MUST lower outgoing video quality when a link degrades and MUST
  hold audio at a reliable bitrate; under severe congestion it MUST suspend video so the
  call stays connected and audio remains intelligible.
- **FR-019**: In a group call, the system MUST adapt outgoing quality independently per
  receiving participant, so different participants can simultaneously receive different
  qualities from the same sender.
- **FR-020**: The system MUST reduce outgoing quality to a specific peer in response to
  evidence that *that peer's* receiving link is poor (remote-side feedback), not only the
  sender's own uplink.
- **FR-021**: The manual quality pin and the "use less data for calls" setting MUST act as
  upper bounds; adaptation MAY reduce below them to keep a call alive.
- **FR-022**: Adaptive behaviour MUST apply to both group mesh connections and 1:1 calls.

**Audio cues (Story 5)**

- **FR-023**: The system MUST emit distinct audio cues for the call states: calling,
  ringing, connecting, connected, reconnecting, and hanging-up/ended.
- **FR-024**: The system MUST emit distinct cues for mute, unmute, camera-on, camera-off,
  and a "call is full" refusal.
- **FR-025**: The system MUST emit a subtle, distinct cue when a chat message arrives
  while the user is in a call.
- **FR-026**: All call cues MUST honour the app's existing tone/mute settings and MUST be
  rate-limited so rapid state changes or toggles do not produce a cue storm.

**Architecture cleanup (Story 6)**

- **FR-027**: The system MUST remove the unused SFU server component, its server-side
  signalling handling, and the unused client SFU/per-frame-encryption modules, retaining
  only what the mesh uses.
- **FR-028**: With calls enabled, the server MUST NOT start or advertise an SFU.
- **FR-029**: The operator-facing calling deployment guide MUST be rewritten to describe
  the mesh architecture accurately, removing SFU, VP8-only, and Chromium-only group-call
  statements.
- **FR-030**: Temporary diagnostic instrumentation added during the SFU→mesh migration
  MUST be removed (or, for any on-screen diagnostic deliberately kept, made a permanent,
  intentional feature).

**Call history (cross-cutting)**

- **FR-031**: A refused, declined, busy, or unanswered incoming call MUST create a call-
  history entry on BOTH sides: an "unavailable/declined" entry for the caller and a
  "missed call" entry for the callee.

**Cross-cutting / invariants**

- **FR-032**: All call signalling (SDP/ICE, busy) MUST remain end-to-end encrypted per
  the pair's secure session where it carries pairwise state; the server MUST continue to
  relay only ciphertext and track only room membership and call kind — no plaintext, keys,
  or media.
- **FR-033**: Group calling MUST continue to work in all supported browsers including
  iOS/Safari (no regression from the cleanup or new adaptation logic).
- **FR-034**: Participants joining a long-running call MUST connect using valid,
  non-expired relay credentials.

### Key Entities *(include if feature involves data)*

- **Call**: A 1:1 or group call with a type (audio/video), a set of participants, a
  lifecycle state (idle/calling/ringing/connecting/connected/reconnecting/ended), and a
  per-type participant cap.
- **Participant / Invitee**: A user in or invited to a call; has a per-call state
  including "ringing", "joined", "left", "busy/unavailable", and "not joining".
- **Mesh connection (leg)**: One participant's direct connection to one other
  participant; carries its own quality tier and connection-health measurements.
- **Quality tier**: A bounded outgoing media level (e.g. low/medium/high) applied
  per-leg, governed by measured health, the manual pin, and the data-saver upper bound.
- **Held invite**: A briefly-buffered call invite for an unreachable invitee, with a
  hold window, that must be invalidated once its target joins or leaves.
- **Call-history entry**: A record of a call on each participant's device, including
  missed / declined / unavailable / completed outcomes.
- **Call cue**: A short, synthesized sound mapped to a specific call event.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In repeated trials, a participant who leaves a group call is never
  automatically re-rung or rejoined due to invite buffering (0 occurrences).
- **SC-002**: A caller who cannot be taken (busy, declined, or unanswered — 1:1 audio,
  1:1 video, or group) receives a busy/unavailable indication within 5 seconds in 100%
  of trials, and the callee is never forced to interrupt.
- **SC-003**: Attempts to exceed the caps (5th video participant, 9th audio participant)
  are refused 100% of the time — by the server even when the client check is bypassed —
  and an audio call with >4 participants can never be upgraded to video.
- **SC-004**: On a constrained link, a call connects at low quality and remains connected
  (audio intelligible) through a sustained mid-call bandwidth drop in 100% of trials, with
  video stepping down and suspending rather than the call dropping.
- **SC-005**: In a group call with one throttled peer, that peer receives a measurably
  lower quality than well-connected peers while the well-connected peers are unaffected.
- **SC-006**: No call begins by sending its maximum (Full HD) quality; the top tier is
  only reached after demonstrated link headroom.
- **SC-007**: Every defined call event (state change, mute/unmute, camera on/off,
  call-full, in-call message) produces its distinct cue, and disabling tones silences all
  of them.
- **SC-008**: A refused/declined/missed call produces the correct call-history entry on
  both the caller's and callee's devices.
- **SC-009**: A real group call connects and carries E2EE audio/video on iOS/Safari and on
  Chromium-based browsers after the cleanup (no regression).
- **SC-010**: After cleanup, the codebase contains no reachable SFU/insertable-streams
  group-call code, the server does not start an SFU, and the deployment guide contains no
  SFU/VP8/Chromium-only group-call claims.

## Assumptions

- **Caps**: Video max = 4, audio max = 8, taken as firm product limits. The video-upgrade
  block applies whenever current participants > 4. Caps count *participants in the call*
  (joined + connecting), including the joiner; not merely those rung.
- **Quality target**: "Reasonable" default target is a mid tier (not Full HD); the highest
  tier is opt-in via demonstrated bandwidth, never the starting or default tier. The exact
  tier thresholds and adaptation cadence are an implementation/plan-level detail.
- **Manual pin vs. survival**: A manual quality pin and the "use less data" setting are
  upper bounds; adaptation may reduce below them to keep a call alive.
- **Audio protection**: Audio is held at a reliable bitrate and is the last thing to
  degrade; under severe congestion video is suspended (not trickled) so audio survives.
- **Per-receiver adaptation** is feasible because the group path is a full mesh (one
  independent connection per peer); this spec does not reintroduce an SFU/simulcast.
- **Decline-with-message** stays 1:1-only (a group invite may have no chat); the canned
  list may become editable in Settings but that is optional polish.
- **Cues are synthesized** (consistent with the existing tone system); no audio files are
  added, and cues are intentionally subtle and rate-limited.
- **DND/foreground**: Cues follow the user's existing notification/tone preferences; a
  fully muted profile produces no cues.
- **iOS/Safari support** is a hard constraint — any adaptation technique used must work
  there (the mesh migration exists specifically to support it).
- **Zero-knowledge** is non-negotiable; nothing in this work may expose plaintext, media,
  or keys to the server. The server already tracks room membership and call kind, so
  server-side cap enforcement adds no new plaintext exposure.
- **Call-waiting (hold/swap/drop)** is intentionally NOT in this spec; it lives in
  `0005-call-waiting-hold` and depends on the busy/second-incoming handling defined here.
- **The on-screen diagnostic (ⓘ) panel**'s fate (keep as a permanent feature vs. remove)
  is a maintainer decision deferred to planning; the *temporary migration logging* is
  removed regardless.

## Zero-Knowledge Impact

*(Constitution Principle I — required for every spec.)*

- **What crosses the wire (new/changed)**:
  - `call-full` (server → joiner): only `roomId` + `kind` — both already supplied by the joiner.
  - `call-busy` extended with optional `roomId` (group): only `to` + `roomId` — the
    already-visible fact "this user is unavailable for this room". No call content.
  - `call-join` is **unchanged**; the server reads only the `kind` + roster it already tracks
    to enforce caps. No new field is added.
  - Offer/answer/ICE remain sealed ciphertext relayed verbatim (unchanged).
- **What is encrypted**: All SDP/ICE and any pairwise signalling stays sealed over the pair's
  existing Double Ratchet (`sealForChat`/`openPacket`); the ephemeral call-scoped session for
  non-contact co-members is preserved. Mesh media stays native DTLS-SRTP, end-to-end, never
  transiting the server.
- **Metadata unavoidably visible to the server** (unchanged from today): room membership and
  call `kind` (already tracked by `call.Registry`), and who relays to whom for live frames.
  This feature adds **no new metadata category**.
- **What this feature removes**: the SFU — the only server component that ever touched media
  routing — and its verbose `call-diag` logging of room/participant/stream bindings. Net ZK
  posture **improves**. Adaptive quality and audio cues are entirely client-local and emit no
  frames; per-receiver quality differentiation produces no server-visible signal.
- **Why it's safe**: server-side cap enforcement (FR-012) acts only on data the server already
  holds; no log, metric, error payload, or retained diagnostic (incl. the ⓘ panel) may emit
  plaintext or participant identity server-side (FR-030, FR-041). Verified by the ZK spot-check
  in `quickstart.md` and task T052.
