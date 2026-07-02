# Feature Specification: Finish Add-to-Call — Kind Upgrade, Join Cue, Group Merge, Robustness

**Feature Branch**: `feat/1030-finish-call-kind`

**Created**: 2026-07-02

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Finish the add-to-call work (completes spec 1028): kind auto-upgrade on merge, a 'joined the call' cue, group-invite merge, and churn robustness."

## Overview

Spec 1028 delivered the core of growing a live call: adding people to a group
call, promoting a 1:1 into a mesh, merging an incoming direct caller, and the
per-kind size caps (4 video / 8 audio). Four pieces were deliberately deferred to
keep that work shippable and to give the risky WebRTC changes a real-device check.
This spec finishes them:

1. **Kind upgrade on merge** — when the person you merge in was on a different kind
   of call (a video caller into your audio call, say) and everyone still fits under
   the video limit, the call offers to become video for everyone; otherwise it stays
   audio and the new person joins audio-only.
2. **A "joined the call" cue** — when someone new appears in the call, a brief
   "{name} joined the call" message, instead of a tile silently appearing.
3. **Group-invite merge** — "Add to call" now works for an incoming *group* invite
   too, folding its people into the call you're already on (within the limit).
4. **Robustness under churn** — growing a call stays correct when people join and
   leave at once, when two people add the same person, when an invitee reloads
   mid-ring, and when a promoted peer never follows in.

Everything is client-only and mesh-only: no new server capability, no new wire
frame, and all kind reconciliation reuses the existing per-participant group-video
mechanism rather than inventing anything.

## Clarifications

### Session 2026-07-02

- Q: When a merge makes an audio call eligible to become video (≤ 4 people), how does
  the switch to video happen, given Ring group calls have no room-wide consent? → A:
  Offer it PER PARTICIPANT — the merge makes the call video-capable, and each person
  turns on their camera via the normal control; NO camera is enabled without that
  person's own tap (no auto-camera, no room-wide consent prompt). This is the existing
  group-video model; the 1:1 `requestVideoUpgrade` consent flow is NOT used for the
  merged (group) call.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The call becomes video when it makes sense (Priority: P1)

You're in an audio call. You merge in someone who was video-calling you. If the
combined call has room for video (4 or fewer people), the call becomes video-capable
and each person can turn their camera on with the normal control — no one's camera
turns on by itself. If the call is already bigger than the video limit, it stays
audio and the new person simply joins audio-only.

**Why this priority**: Completes the merge behaviour promised in 1028 (clarification
2) and avoids the surprise of a video caller silently landing as audio with no path
to video.

**Independent Test**: Merge a video caller into a small audio call and confirm the
consent-gated video upgrade runs and the call ends up video; repeat with the call
already over the video limit and confirm it stays audio with the new person
audio-only.

**Acceptance Scenarios**:

1. **Given** an audio call with a combined headcount of 4 or fewer after the merge,
   **When** a video caller is merged in, **Then** the call becomes video-capable and
   each participant may enable their own camera via the normal control (no camera is
   auto-enabled).
2. **Given** an audio call whose combined headcount would exceed the video limit,
   **When** a video caller is merged in, **Then** the call stays audio-only and the
   merged person joins audio-only (video is not enabled for anyone).
3. **Given** a video call, **When** an audio-only participant is merged in, **Then**
   the call stays video and that participant may turn on their camera via the normal
   control.

---

### User Story 2 - A cue when someone joins (Priority: P1)

While you're in a call and a new person joins — whether a 1:1 you promoted, a person
you added, or a merged caller — you see a brief "{name} joined the call" message.
People re-connecting after a network blip do not trigger it, and you never see a cue
for your own arrival.

**Why this priority**: Without it, a new participant appears with no acknowledgement;
the cue makes growing a call legible (1028 SC-008).

**Independent Test**: Add a person to a call and confirm every existing participant
sees a "{name} joined the call" cue naming the joiner; force a reconnect of an
existing participant and confirm no cue fires.

**Acceptance Scenarios**:

1. **Given** you are in a call, **When** a genuinely new participant joins, **Then**
   a brief "{name} joined the call" cue is shown (naming the joiner, or "Someone" for
   a non-contact).
2. **Given** a participant briefly disconnects and reconnects, **When** their leg
   recovers, **Then** no join cue is shown (it is not a new arrival).
3. **Given** you join or promote a call yourself, **When** you enter, **Then** no cue
   is shown for your own arrival.

---

### User Story 3 - Merge an incoming group invite (Priority: P2)

You're in a call and a group invite comes in. "Add to call" now appears for it too
(alongside Hold and Decline). Choosing it folds the invite's people into your current
call — promoting your 1:1 first if needed — as long as everyone fits under the limit;
if not, it's blocked with a clear reason and both calls are left as they were.

**Why this priority**: The richer merge case from 1028 US6; more complex (two rosters,
combined cap) and less common than a direct caller, so it lands after US1/US2.

**Independent Test**: With a call in progress, receive a group invite and choose Add
to call; confirm the invite's members are rung into your call and join within the
limit, a shared member resolves to one participant, and an over-limit fold is blocked
with a reason.

**Acceptance Scenarios**:

1. **Given** you're in a call and receive a group invite, **When** you choose Add to
   call, **Then** the invite's not-yet-present members are rung into your current call
   (your 1:1 promoted first if needed) and join on accept, and you leave the invite's
   own room.
2. **Given** folding the invite would exceed the kind cap on the combined distinct
   headcount, **When** you try, **Then** it's blocked with a clear reason and both your
   call and the invite are unchanged.
3. **Given** a person is in both your call and the incoming invite, **When** the groups
   fold, **Then** they resolve to a single participant with one connection.

---

### User Story 4 - Merge never disturbs a held call (Priority: P2)

Merging a caller into your active call leaves any separate call you're holding fully
intact and swappable. Adding or merging while a swap is imminent completes (or cancels)
cleanly, never leaving a half-open connection.

**Why this priority**: The new merge/add paths must not break the existing
hold/swap/drop guarantees (specs 0005/2009).

**Independent Test**: Hold call Y, be active on call X, merge a caller into X, then
swap to Y — confirm Y was untouched and still swaps correctly, and the single-held
rule held throughout.

**Acceptance Scenarios**:

1. **Given** an active call and a held call, **When** you merge an incoming caller,
   **Then** the held call is unchanged and still swappable, and at most one call is
   ever held.
2. **Given** an add/merge is in progress, **When** a swap is triggered, **Then** the
   add/merge completes or cancels cleanly first and no connection is left half-open.

---

### User Story 5 - Correct under churn (Priority: P2)

Growing a call converges to the right state even under pressure: someone joins while
another leaves, two people add the same new person at once, an invitee reloads
mid-ring, or a promoted peer never follows in. No stuck "ringing" tiles, no duplicate
participants, no orphaned connections.

**Why this priority**: The add/merge/roster/leg lifecycle is where mesh calls are most
fragile; this is the hardening the "robusten" ask targets.

**Independent Test**: Script the churn cases on an audio mesh and assert the final
roster, tiles, and connectivity are correct on every device with no orphaned state.

**Acceptance Scenarios**:

1. **Given** a participant is joining, **When** another leaves simultaneously, **Then**
   every device converges to the correct roster with no stuck tile.
2. **Given** two participants add the same new person at once, **When** they join,
   **Then** that person resolves to a single participant with one connection.
3. **Given** an invitee reloads while ringing, **When** they return and accept, **Then**
   they join cleanly with no duplicate (reusing the existing invite recovery).
4. **Given** you promote a 1:1 but the existing peer never follows into the room,
   **When** the follow times out, **Then** the half-formed room is left cleanly with no
   stuck ringing or orphaned tile.

### Edge Cases

- **Nobody turns on video after a merge makes the call video-capable**: it simply
  behaves as an audio call until someone enables their camera (no forced state).
- **Merge that would exceed the video cap**: never becomes video-capable past 4; the
  call stays audio for everyone.
- **Group-invite fold with a shared member**: deduped to one participant/one leg.
- **Group-invite fold over the combined cap**: blocked with a reason; nothing changes.
- **Cue for a burst of joiners**: each genuinely-new participant is acknowledged; a
  reconnect is not a joiner.
- **Promotion timeout / peer never follows**: clean fallback, no orphaned room.
- **Merge while holding a call**: held call untouched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After any merge whose combined headcount is at most the video cap (4),
  the system MUST make (or keep) the call video-capable — regardless of the merged
  party's original call kind — so each participant can enable their own camera via the
  existing per-participant control; NO camera is enabled without that participant's own
  action (no auto-camera, no room-wide consent prompt).
- **FR-002**: When the combined headcount would exceed the video cap, the system MUST
  NOT make the call video-capable; the merged party joins audio-only and the call stays
  audio for everyone.
- **FR-003**: Kind reconciliation MUST behave coherently whether the active call was a
  just-promoted 1:1 or an already-group call, and MUST reuse the existing
  per-participant group-video mechanism (no new upgrade scheme, and NOT the 1:1
  `requestVideoUpgrade` consent flow).
- **FR-004**: When a genuinely new participant joins the active call (promotion,
  add-people, or merge), the system MUST show a brief transient "{name} joined the call"
  cue naming the joiner (or a generic "Someone joined the call" for a non-contact).
- **FR-005**: The join cue MUST NOT fire for the local user's own arrival, nor for a
  participant re-connecting after a transient disconnect (only genuinely new roster
  members).
- **FR-006**: "Add to call" MUST be offered for an incoming GROUP INVITE (alongside Hold
  and Decline), and choosing it MUST fold the invite's not-yet-present members into the
  current call — promoting a 1:1 first if needed — ringing them in; added members ring
  and consent by answering (no silent pull-in).
- **FR-007**: Folding a group invite MUST be blocked with a clear reason when the
  combined DISTINCT headcount would exceed the kind cap, leaving both the current call
  and the invite unchanged; a member present in both MUST resolve to a single
  participant/one connection.
- **FR-008**: After folding a group invite, the user MUST leave the invite's own room so
  they are never in two rooms at once.
- **FR-009**: Merging or adding MUST leave any separately HELD call fully intact and
  swappable, preserving the single-held-slot rule.
- **FR-010**: An add/merge in progress MUST complete or cancel cleanly before a swap
  parks the active call — no half-open connection (an add-in-flight guard).
- **FR-011**: Growing a call MUST converge every device to the correct roster, tiles,
  and connectivity under: concurrent join/leave, simultaneous adds of the same person
  (dedup to one participant/one connection), an invitee reloading mid-ring (reuse the
  existing invite recovery), and a promotion timeout where the peer never follows
  (leave the half-formed room cleanly). No stuck ringing, no duplicates, no orphaned
  connections.
- **FR-012**: The existing 4-video / 8-audio caps MUST be preserved (reused, enforced
  pre-emptively on the client and authoritatively by the server) and the single
  active + single held call rule MUST be preserved.
- **FR-013**: The feature MUST add NO new server capability, no new wire frame or field;
  signalling stays sealed over the per-pair session and newly-added members use the
  existing same-room key gate. A verification MUST confirm the server tree is unchanged.

### Key Entities *(include if feature involves data)*

- **Merge (kind reconciliation)**: the decision, from the active call's kind, the merged
  party's kind, and the combined headcount, of whether the call becomes video-capable
  (combined ≤ 4 — cameras allowed per participant) or stays audio-only (> 4).
- **Join cue**: a transient, informational message naming a genuinely-new participant;
  derived from a roster diff (new members only), never persisted.
- **Combined roster (group-invite merge)**: the distinct union of the current call's
  participants and the incoming invite's members, gated by the kind cap.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

- **What crosses the wire**: Nothing new. Making a call video-capable reuses the
  existing per-participant group-video path (a participant enabling their camera
  renegotiates their own legs, as today); the cue is purely local (a roster diff already
  delivered); group-invite merge reuses the existing ring/roster/leg signalling. No new
  frame, field, or request.
- **What is encrypted / protected**: All SDP/ICE stays end-to-end encrypted over each
  pair's session; media is peer-to-peer. The server never sees media or content.
- **What metadata is unavoidably visible**: Unchanged from today's group calls — the
  server sees room membership and enforces the cap, exactly as it already does. A folded
  group invite makes people room members, which the server already sees for any group.
- **Why this is safe**: A client-only presentation + orchestration layer composing
  existing encrypted signalling; the crypto core and messaging path are untouched, and
  the server tree is verified unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Merging a video caller into an audio call makes the call video-capable
  (cameras allowed, per-participant) in 100% of trials where the combined headcount is
  ≤ 4, and keeps it audio-only in 100% of trials where the headcount is > 4; no camera
  is ever auto-enabled.
- **SC-002**: Every existing participant sees a "{name} joined the call" cue for a
  genuinely-new joiner in 100% of trials, and 0 cues fire for a reconnect or the local
  user's own join.
- **SC-003**: Folding a group invite yields one combined call within the cap, or is
  blocked with a clear reason when over the cap — verified in both the fits and
  doesn't-fit cases, with a shared member deduped to one participant.
- **SC-004**: Merging into the active call leaves a separately held call intact and
  swappable in 100% of trials, with at most one call ever held.
- **SC-005**: Under scripted churn (concurrent join/leave, simultaneous same-person add,
  invitee reload, promotion timeout), every device converges to the correct roster/tiles
  with 0 stuck ringing tiles, 0 duplicate participants, and 0 orphaned connections.
- **SC-006**: All existing call e2e + unit tests stay green; the new behaviours are
  covered by Playwright e2e (audio meshes + 2-person proxies) and drive scenarios (the
  video paths), and the server tree diff is empty.

## Assumptions

- **Builds on 1028's shipped code**: `ensureActiveIsRoom`, `mergeIncoming`,
  `convertActiveToRoom`, `sendJoinRoom`, `addPeople`, the capacity gate, and the
  `joinroom` signal already exist (this spec depends on the merged 1028 promotion/merge
  work).
- **Kind reconciliation reuses the existing per-participant group-video mechanism**
  (making the call video-capable so each person's camera toggle works); no new upgrade
  mechanism, and not the 1:1 `requestVideoUpgrade` consent flow.
- **The cue reuses the existing toast/cue infra** and resolves names from contacts / the
  roster owner map.
- **Caps unchanged** (4 video / 8 audio) and the **single-held-slot** rule unchanged.
- **CI cannot run a 3-person+ video mesh headless**: video paths (upgrade result, video
  churn) validated via drive scenarios / real device; audio meshes + 2-person proxies +
  pure unit tests carry the e2e.
- **Mesh only**: no SFU / server media.

## Out of Scope

- An SFU or server-side media (mesh only) — and therefore raising the 4/8 caps.
- More than one held call at a time.
- Transferring an in-progress call to another device.
- Anything already shipped in 1028's earlier PRs (add people, promotion, direct-caller
  merge, the cap gate).
- A settings toggle for the join cue (informational, always on for now).
