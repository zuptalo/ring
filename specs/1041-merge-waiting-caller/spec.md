# Feature Specification: Merge a Waiting Caller into the Ongoing Call

**Feature Branch**: `feat/1041-merge-waiting-caller`

**Created**: 2026-07-12

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "When we have someone on hold to answer another call, we can switch back and forth between them. Add the possibility to merge the calls: if a group video call is ongoing on one side and another video or audio call comes in, we can send that caller a request to join the group call instead. It is up to them to accept, or reject and wait behind the line. If the join request was rejected, the user should not be able to request that person to join the existing call again — only switching back and forth remains possible. If the user decides to do nothing about the incoming call, or isn't around to do so, the call attempt should auto-drop for the caller after the same amount of time as calling someone who doesn't answer, ending with 'No answer'. Also, during joining or leaving a call the user's avatar gets stretched vertically into a long ellipse — fix this as well."

## Clarifications

### Session 2026-07-12

- Q: What media does the waiting caller join with when they accept a join
  request? → A: The media they already consented to — their own original call
  attempt's kind (audio attempt → mic only, camera off; video attempt →
  camera on) — toggling freely once in the call. Accepting a join request
  never lights a camera the caller didn't already offer (the capture-consent
  principle from spec 1039).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Invite the waiting caller into the ongoing call (Priority: P1)

Kamran is in a three-person video call. Sara calls him (video or audio). Along
with today's options (Accept & hold, Decline), Kamran can choose to invite
Sara into the ongoing call instead. Sara receives a join request for the group
call and decides for herself: accept and land in the call with everyone, or
reject and wait behind the line as a normal waiting call. The same invite is
available for a call Kamran has already parked on hold — the "On hold" state
offers merging the held party into the active call.

**Why this priority**: This is the feature itself. Today the only ways to
handle a second caller are serial (hold and swap); merging turns two parallel
conversations into one, which is what users actually want when both calls
belong together.

**Independent Test**: Start a group call between three accounts; call one of
them from a fourth account; use the merge option and accept the join request
on the fourth account; verify the fourth participant appears in the group
call. Repeat rejecting the request and verify the waiting call remains
swappable.

**Acceptance Scenarios**:

1. **Given** an ongoing group call and a new incoming call, **When** the
   callee chooses the merge/invite option, **Then** the waiting caller
   receives a join request for the ongoing call while their call attempt
   keeps ringing/waiting.
2. **Given** a join request was sent, **When** the waiting caller accepts,
   **Then** they join the ongoing call as a regular participant, their
   separate 1:1 call attempt ends (not recorded as missed for either side),
   and everyone in the call sees them join with existing join semantics.
3. **Given** a join request was sent, **When** the waiting caller rejects it,
   **Then** their original call attempt remains exactly as before — the
   callee can still accept & hold, swap, or decline it.
4. **Given** the ongoing call is a 1:1 call, **When** the callee merges the
   waiting caller, **Then** the ongoing call is promoted to a group call
   first (existing add-someone-to-call behavior) and the waiting caller is
   invited into the resulting room.
5. **Given** an audio caller and an ongoing video call (or vice versa),
   **When** they accept the join request, **Then** they join with the media
   of their own original attempt — an audio caller lands mic-only with the
   camera off, a video caller lands with their camera on — and can toggle
   freely in-call; the call type never blocks the merge and acceptance never
   starts a camera the caller didn't already offer.
6. **Given** a call already parked on hold, **When** the callee uses the
   merge option on the held call, **Then** the held party receives the same
   join request with the same accept/reject semantics.

---

### User Story 2 - A rejection is final for this call (Priority: P2)

Sara rejects the join request and waits on the line. Kamran does not get to
ask her again for this call: the merge option for Sara is gone for as long as
this ongoing call lasts, and only the existing hold/swap handling remains. No
repeated join-request nagging.

**Why this priority**: Consent must stick. Without this, a caller can be
spammed with join requests they already declined, which defeats the point of
letting them choose.

**Independent Test**: Reject a join request from the waiting side, then
verify the merge option for that caller is absent/disabled on the callee's
side for the rest of the call, while swap continues to work.

**Acceptance Scenarios**:

1. **Given** the waiting caller rejected a join request, **When** the callee
   looks at the second-call controls again during the same ongoing call,
   **Then** no merge option is offered for that person — only accept & hold /
   swap / decline.
2. **Given** the rejection happened, **When** the callee answers the waiting
   call and swaps between the two calls, **Then** switching works exactly as
   it does today.
3. **Given** the ongoing call has ended and a fresh call situation arises
   later, **Then** the earlier rejection carries no memory — merging may be
   offered again.

---

### User Story 3 - An ignored second call still ends in "No answer" (Priority: P3)

Sara calls Kamran while he is in a group call, and Kamran does nothing — he
does not answer, decline, or send a join request (or he sent one and Sara
never responded and he never answered her call). Sara's call attempt ends by
itself after the same no-answer window as any unanswered call, with the same
"No answer" outcome, and Kamran gets the normal missed-call trace. A pending
join request never keeps a call attempt alive past that window; the request
expires with the attempt.

**Why this priority**: Guard-rail story — it pins the existing timeout
behavior so the new merge path cannot create zombie call attempts that ring
forever or dangling join requests.

**Independent Test**: Call a busy callee and let everything sit untouched;
verify the caller's attempt ends with "No answer" after the standard window.
Repeat with a join request pending and verify the same outcome and that the
join request disappears.

**Acceptance Scenarios**:

1. **Given** a second incoming call the callee never acts on, **Then** the
   caller's attempt ends with the standard no-answer outcome after the same
   window as calling any non-answering user, and the callee records the
   existing missed-call trace.
2. **Given** a join request was sent but the waiting caller neither accepts
   nor rejects and the callee never answers their call, **Then** the call
   attempt still ends within the standard no-answer window and the join
   request expires with it — no lingering join prompt on the caller's device
   afterwards.
3. **Given** the waiting caller hangs up before deciding on the join request,
   **Then** the join request disappears on both sides and the callee's
   second-call prompt clears (existing cancel behavior).

---

### User Story 4 - Avatars keep their shape during call join/leave (Priority: P4)

While a participant is joining or leaving a call, their avatar currently
stretches vertically into a long ellipse for the duration of the transition.
The user's screenshot ([avatar-stretch.png](./avatar-stretch.png), captured in
a three-tile group video call) shows the joining/leaving tile — the one that
overlays the waving-hand emoji on the participant's avatar — rendering the
avatar as an ellipse spanning nearly the tile's full height. Avatars must stay
perfectly round through every call transition — joining, leaving, merging,
tile re-layout.

**Why this priority**: Visible polish bug in the exact UI this feature
touches; fixing it alongside the merge work avoids shipping a new flow on top
of a broken transition.

**Independent Test**: Join and leave a group call repeatedly while watching a
camera-off participant's tile (and record the screen); verify the avatar
remains circular at every animation frame, including during the new
merge-join path.

**Acceptance Scenarios**:

1. **Given** a call participant with an avatar showing (camera off), **When**
   any participant joins or leaves and tiles re-layout, **Then** the avatar
   stays circular throughout the transition — no vertical stretching at any
   point.
2. **Given** the new merge flow adds a participant mid-call, **Then** the
   same holds during that join transition.

---

### Edge Cases

- The ongoing call is already at the participant limit → the merge option is
  hidden/disabled (existing add-to-call limit rules apply); hold/swap remains.
- Two waiting calls in play (one held, one ringing) → each party can be
  offered a merge independently; a rejection only blocks re-requests for the
  party who rejected.
- The waiting caller accepts the join request at the same moment the callee
  swaps to or answers their 1:1 attempt → the system converges on one state
  (they end up either merged into the room or in the 1:1, never both, never a
  dropped call).
- The waiting caller's app version does not understand join requests → the
  merge attempt degrades gracefully: their call attempt continues unchanged
  and ends with the normal no-answer window if unanswered; no error is shown
  to them.
- The ongoing call ends while a join request is pending → the join request is
  withdrawn on the waiting caller's device; their original call attempt keeps
  ringing (the callee is now free to answer normally).
- The callee's device loses connectivity after sending the join request → the
  standard call-attempt timeouts still bound every state; nothing rings
  forever.
- A participant who was rung via merge shows up in the roster with the
  existing invitee tile states (ringing / joined / no answer / declined).
- The join request must not leak call or participant information beyond what
  the existing call signalling already shares with the involved parties; the
  server continues to relay opaque signalling without learning more than it
  does for today's group-call invites.
- Avatar shape must hold on both grid and stacked layouts, both orientations,
  and while the joining participant's tile is animating in and out.

## Requirements *(mandatory)*

### Functional Requirements

**Merge / join request (US1)**

- **FR-001**: While in an ongoing call, the callee MUST be able to send the
  party behind a second incoming call a request to join the ongoing call, as
  an alternative to accept & hold / decline.
- **FR-002**: The same merge action MUST be available for a call already
  parked on hold.
- **FR-003**: If the ongoing call is a 1:1, the merge MUST promote it to a
  group call using the existing add-someone-to-call machinery as part of
  completing the merge. The promotion MUST NOT strand the callee: a rejected
  or expired join request leaves the ongoing 1:1 exactly as it was (the
  conversion may therefore be deferred until the waiting party accepts).
- **FR-004**: The waiting party MUST receive an explicit join request they can
  accept or reject; nothing moves them into the ongoing call without their
  acceptance.
- **FR-005**: On acceptance, the waiting party MUST join the ongoing call as a
  regular participant (existing join/roster/media semantics), and the separate
  1:1 attempt between the two users MUST end without being recorded as a
  missed call on either side.
- **FR-006**: On rejection, the waiting party's original call attempt MUST
  remain intact with all of today's call-waiting handling available.
- **FR-007**: Audio and video call attempts MUST both be mergeable into an
  ongoing call of either kind. The accepting party joins with the media of
  their own original attempt (audio → camera off, video → camera on) and can
  toggle in-call; accepting a join request MUST NOT enable capture the party
  had not already consented to.
- **FR-008**: The merge option MUST be unavailable when the ongoing call
  cannot take another participant (existing participant-limit rules).

**Rejection semantics (US2)**

- **FR-009**: After the waiting party rejects a join request, the callee MUST
  NOT be able to send that same party another join request for the lifetime of
  the ongoing call; the merge affordance for them is removed or disabled.
- **FR-010**: The rejection MUST NOT affect any other capability: accept &
  hold, swap, and decline continue to work unchanged for that party.
- **FR-011**: The rejection's scope MUST end with the ongoing call; it carries
  no memory into future calls.

**Timeouts and lifecycle (US3)**

- **FR-012**: A second incoming call the callee never acts on MUST end for the
  caller with the standard no-answer outcome after the same window as an
  ordinary unanswered call — the callee being busy/in-call MUST NOT extend or
  shorten it.
- **FR-013**: A pending join request MUST NOT extend the waiting caller's
  call-attempt window; if the attempt ends (no answer, cancel, hang-up), the
  join request MUST be withdrawn from their device with it.
- **FR-014**: If the ongoing call ends while a join request is pending, the
  request MUST be withdrawn; the waiting attempt then continues as a normal
  incoming call.
- **FR-015**: The unanswered second call MUST leave the existing missed-call
  trace on the callee's side regardless of whether a join request was sent.
- **FR-016**: All join-request signalling MUST ride the existing end-to-end
  call signalling channels; the server relays it without gaining any new
  knowledge about call content or participants beyond today's group-call
  invites.

**Avatar transition fix (US4)**

- **FR-017**: Participant avatars MUST remain circular (no vertical or
  horizontal distortion) at every frame of call-tile transitions: a
  participant joining, leaving, being merged in, or tiles re-flowing.
- **FR-018**: The fix MUST cover the layouts the call screen supports (grid /
  stacked, portrait / landscape) on the supported platforms.

### Key Entities

- **Join request**: An invitation from the callee to the party behind a
  waiting/held call to enter the ongoing call. States: sent → accepted /
  rejected / expired / withdrawn. Bound to one ongoing call and one waiting
  party; a rejection freezes further requests to that party for that call.
- **Waiting call attempt**: The second incoming (or held) call. Unchanged in
  behavior except that it can now be converted, with consent, into a
  group-call join; its no-answer window is authoritative for expiry.
- **Ongoing call**: The active call (1:1 or group). A 1:1 promotes to a group
  call on first merge, per the existing add-to-call feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user in a call can bring a second caller into that call in at
  most 2 actions (choose merge → other side accepts), without hanging up or
  redialing anything.
- **SC-002**: In end-to-end tests, a merged caller appears in the ongoing
  call's roster and media within 10 seconds of accepting the join request.
- **SC-003**: After a rejection, 0 further join requests can be produced for
  that party during the same call (verified by UI state and by attempting the
  action in tests).
- **SC-004**: An ignored second call ends for the caller within the same
  no-answer window as a normal unanswered call (± a few seconds), with the
  standard "No answer" outcome, in 100% of test runs — with or without a
  pending join request.
- **SC-005**: No join request remains visible on any device after its call
  attempt or the ongoing call has ended.
- **SC-006**: Across recorded join/leave/merge transitions, avatars measure
  visually circular (equal width/height) at every sampled frame — the
  vertical-ellipse artifact no longer reproduces.
- **SC-007**: The server-visible signalling for a merge contains no more
  information than today's group-call invite signalling (verified by
  inspecting relayed frames in tests).

## Zero-Knowledge Impact

- **What crosses the wire**: The join request, its accept/reject, and its
  withdrawal ride the EXISTING sealed call-signalling channels (the same
  class as today's promote/merge `joinroom` signal from spec 1028 and the
  group-invite controls from specs 0004/1030). The server relays opaque
  frames and the routing metadata it already holds for any call signal.
- **What is encrypted**: Everything the request means — which room, which
  kind, who is asking — is sealed end-to-end exactly like existing call
  signalling; display names resolve on-device.
- **What metadata is unavoidably visible**: The server already knows which
  account ids exchange call signalling and which accounts join a room (it
  runs the ring/reminder machinery); this feature adds no new fields, no new
  frame types visible to the server, and no new server-side state.
- **Why**: Merging is client-side policy over existing signalling; the
  avatar fix is pure client CSS. The server learns nothing it does not
  already learn from a hold/swap plus a group-call invite today.

## Assumptions

- The existing call-waiting feature (accept & hold, swap, decline) and the
  existing add-someone-to-call / 1:1-promotion feature are the foundation;
  merge is a new entry point into them, not a parallel system.
- The existing no-answer window (the same one used for ordinary unanswered
  calls) is reused verbatim for the busy/second-call case; this spec pins it
  rather than changing its length.
- "Reject and wait behind the line" means the waiting caller's attempt simply
  continues as it does today; rejecting a join request is not a decline of
  their own call.
- The rejection block is scoped per ongoing call and per party, kept on the
  callee's device; it does not need to survive app restarts beyond the call's
  lifetime.
- Group-call participant limits, invitee tile states, and media rules (camera
  on/off, audio-only participants) are unchanged and govern merged
  participants too.
- The avatar-stretch defect is a client-side visual issue in the call UI's
  tile transitions; fixing it requires no server or protocol change. The
  user's screenshot is preserved next to this spec as `avatar-stretch.png`
  and shows the defect on the joining/leaving (waving-hand) tile of a group
  video call.
