# Feature Specification: Robust Calls + Add-to-Call (Merge Incoming, Add People)

**Feature Branch**: `feat/1028-robust-audio-and`

**Created**: 2026-07-02

**Status**: shipped
<!-- The four deferred items (kind upgrade on merge, join cue, group-invite merge,
     churn robustness) are completed by spec 1030 (feat/1030-finish-call-kind);
     both specs ship with that branch's PR into develop. -->
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Evaluate and robusten the audio/video calls and the scenarios around them. Today we can put a call on hold and answer another while keeping them waiting and swap between them; I also want the option to accept an incoming caller and ADD them to the existing call, and while in a call to add a 3rd or 4th (or more) person to the ongoing call. The 4-person limit is for video calls and the 8-person limit for audio calls. Use Playwright as much as possible and test the behaviours."

## Overview

Ring's calling is a peer-to-peer WebRTC **mesh**: a 1:1 is a single encrypted
connection, a group call is one connection per pair of people, and the
zero-knowledge server only relays sealed signalling — it never sees or mixes
media. On top of that, call waiting already works: you can put a call on hold,
answer a second one, swap between them, and drop either (specs 0004/0005/2009).

What's missing is **growing a call**. Today the only way to have more people on a
call is to invite them all when it starts; once a call is running there is no way
to bring a new person in, and a second incoming caller can only be held and
swapped — never joined into the conversation you're already having. This feature
adds two ways to grow a live call, keeps the existing per-kind size limits (a
video call tops out at 4 people, an audio call at 8), and does a broader
reliability pass over the add/merge/roster machinery.

1. **Merge an incoming caller into your current call.** When someone calls you
   while you're already in a call, alongside today's "accept and hold" you get a
   third choice: **add them to this call**. A 1:1 becomes a small group; a group
   call gains one more person. You keep using the same microphone and camera — no
   second setup, no dropped audio.

2. **Add people to an ongoing call.** From inside a call, an **Add people** action
   lets you pick one or more contacts and ring them into the call you're already
   on. They ring like any call invite and can decline; when they accept, they join
   the mesh and everyone sees them appear.

Both paths respect the existing limits: a **video call never exceeds 4
participants and an audio call never exceeds 8**. Those limits are already
enforced by the server; this feature makes the client refuse an over-limit add
*before* it's attempted, with a clear reason, instead of letting it fail after
the fact.

This is a mesh-only feature by design (Ring has no media server), so the size
limits exist because every added person adds a connection to everyone else. The
server learns nothing new: it already relays group-call signalling and enforces
room size; growing a call reuses exactly that.

## Clarifications

### Session 2026-07-02

- Q: When a 1:1 is promoted to a group by merging a 3rd person, what does the
  EXISTING peer experience? → A: Their device auto-follows into the group
  (it follows the new roster, the same path a late joiner already uses) AND shows a
  brief "{name} joined the call" cue — no consent prompt (they are already in the
  call with you). The added person consents by answering the ring.
- Q: Merging a caller whose kind differs from the current call — what kind results?
  → A: Upgrade to video if either side wants it, subject to the 4-person video cap.
  Merging a video caller into an audio call triggers the EXISTING consent-gated
  video-upgrade flow when the combined call has ≤ 4 people; if it already has more
  than 4, no upgrade — the merged person joins audio-only and the call stays audio.
- Q: Does "Add to call" also apply to an incoming GROUP invite, not just a direct
  1:1 caller? → A: Yes. You can merge an incoming group invite into your current
  call too, folding the two rosters into one call, subject to the kind cap on the
  combined distinct participants (if it wouldn't fit, the merge is blocked with a
  clear reason, per the US3 pre-emptive gate). The direct second caller remains the
  primary, simplest path.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Merge an incoming caller into the call you're on (Priority: P1)

You're on a call with Ana. Ben calls you. The incoming banner offers **Add to
call** in addition to Hold and Decline. You tap Add to call: Ben rings in, and
when he answers, you, Ana, and Ben are all in one call together. Your mic and
camera keep working the whole time; you never had to hang up or re-setup.

**Why this priority**: This is the headline capability the user asked for and the
one with no equivalent today (a second caller can only be held/swapped).

**Independent Test**: Three accounts. A calls B (they connect). C calls A. A
chooses "Add to call". Assert all three end up connected to each other in one
call and media flows among them, with A's existing stream reused (no second
capture).

**Acceptance Scenarios**:

1. **Given** you're in a 1:1 call, **When** a third person calls and you choose Add
   to call, **Then** the 1:1 becomes a group call containing all three and media
   flows among everyone.
2. **Given** you're in a group call, **When** another person calls and you choose
   Add to call, **Then** they are rung into the existing call and join the group on
   accept.
3. **Given** you merge an incoming caller, **When** they are added, **Then** your
   microphone/camera keep running uninterrupted (the existing capture is reused).
4. **Given** the incoming caller declines to be added or doesn't answer, **When**
   the ring lapses, **Then** your existing call is unaffected and continues.
5. **Given** a 1:1 is promoted to a group, **When** the third person joins, **Then**
   the existing peer's device auto-follows into the group and shows a brief
   "{name} joined the call" cue (no consent prompt for them).
6. **Given** you're in an audio call and merge a video caller, **When** the combined
   call has 4 or fewer people, **Then** the existing consent-gated video-upgrade
   flow runs; **when** it already has more than 4, the merged person joins audio-only
   and the call stays audio.

---

### User Story 2 - Add people to an ongoing call (Priority: P1)

You're in a call and want to pull in a couple more friends. You tap **Add people**,
pick them from your contacts, and confirm. They ring into the call; as each
accepts, they appear in the call and everyone can hear/see them.

**Why this priority**: The second half of "grow a live call" — proactively adding,
not just reacting to an incoming caller. No path exists today for someone not
invited at the start.

**Independent Test**: A and B are in a call. A uses Add people to invite C. C's
device rings with a call invite; on accept, C joins the mesh and media flows among
A, B, C. Assert B (who didn't initiate) also meshes with C.

**Acceptance Scenarios**:

1. **Given** you're in a call, **When** you open Add people, **Then** you can select
   one or more contacts who aren't already in the call.
2. **Given** you confirm an add, **When** the invitee accepts, **Then** they join
   the call and mesh with every existing participant (not just you).
3. **Given** an invitee declines or doesn't answer, **When** the ring ends, **Then**
   the call continues unchanged and the invitee is not shown as a participant.
4. **Given** you add someone, **When** they join, **Then** the participant list and
   tiles update for everyone already in the call.

---

### User Story 3 - Size limits are respected before you add (Priority: P1)

A video call can hold 4 people and an audio call 8. When adding another person
would exceed the limit for the call's type, the add is blocked up front with a
clear explanation — you never watch someone ring only to be rejected.

**Why this priority**: The user stated the limits explicitly; enforcing them
*pre-emptively* is the difference between a clean UX and a confusing after-the-fact
failure. The limits already exist server-side, but the new add paths must gate
before attempting.

**Independent Test**: Fill an audio call to 8 and a video call to 4; assert Add
people and Add-to-call are disabled/blocked with a reason at the limit, and allowed
just below it. Assert an over-limit attempt that somehow reaches the server is
still refused (defense in depth).

**Acceptance Scenarios**:

1. **Given** a video call with 4 participants, **When** you try to add another,
   **Then** the action is unavailable with a clear reason ("Video calls are limited
   to 4 people").
2. **Given** an audio call with 8 participants, **When** you try to add another,
   **Then** the action is unavailable with a clear reason.
3. **Given** an add-people picker, **When** selecting contacts, **Then** you cannot
   select more than the remaining capacity for the call's type.
4. **Given** any add path, **When** the limit would be exceeded, **Then** the
   existing authoritative server refusal remains as a backstop and the local call is
   left undisturbed.

---

### User Story 4 - Merge coexists with call waiting (Priority: P2)

Add-to-call is a distinct choice from hold/swap. Merging brings the caller into
your **active** call; any separate call you're holding is untouched. You still have
your one hold slot and can swap to it afterwards.

**Why this priority**: The two features must not collide. Users who rely on
hold/swap (spec 0005) must keep it, and the single-held-slot rule (spec 2009) must
stay intact.

**Independent Test**: A is in call X and holding call Y. C calls A. A chooses Add
to call → C merges into X; Y stays held and can be swapped to. Assert Y's media is
still paused and resumes correctly on swap.

**Acceptance Scenarios**:

1. **Given** you have an active call and a held call, **When** you merge an incoming
   caller, **Then** they join the active call and the held call is unchanged.
2. **Given** you merged a caller into the active call, **When** you swap to the held
   call, **Then** hold/swap behaves exactly as before (the merged group call is now
   the held one, paused; the other becomes active).
3. **Given** the single-held-slot rule, **When** merge and hold are both available,
   **Then** at most one call is ever held.

---

### User Story 5 - Robust under churn (Priority: P2)

Growing a call is reliable even when things happen at once: someone joins while
someone else leaves, two people are added close together, an invitee reloads
mid-ring, or you add a person right before swapping calls. Tiles, participant
lists, and connections converge to the correct state without stuck "ringing"
placeholders, duplicate tiles, or dropped legs.

**Why this priority**: The add/merge/roster/leg lifecycle is where mesh calls are
most fragile; the "evaluate and robusten" goal targets exactly these races.

**Independent Test**: Scripted churn on an audio mesh (add C while D leaves; add two
at once; invitee reloads mid-ring then rejoins) and assert the final roster, tiles,
and connectivity are correct on every device, with no orphaned ringing state.

**Acceptance Scenarios**:

1. **Given** a participant is joining, **When** another leaves at the same moment,
   **Then** every device converges to the correct roster with no stuck tile.
2. **Given** an invitee reloads while ringing, **When** they come back and accept,
   **Then** they join cleanly (reusing the existing invite-recovery behaviour) with
   no duplicate.
3. **Given** you add a person then immediately swap to a held call, **Then** both the
   add and the swap complete correctly and no leg is left half-open.

---

### User Story 6 - Merge an incoming group invite into your call (Priority: P2)

You're in a call and a group invite comes in. Instead of only being able to hold it
or let it be busy, you can **Add to call** — folding the invite's people into the
call you're already on, so the two groups become one, as long as everyone fits under
the call's size limit.

**Why this priority**: The richer merge case the user asked for. It's the most
complex (two rosters, combined cap math), so it's built and tested after the direct-
caller merge (US1) proves out; it reuses the same promotion + roster machinery.

**Independent Test**: A is in a call with B. C starts a group call inviting A (and D).
A chooses Add to call on C's invite. Assert the combined call ends with A, B, and C's
group folded into one call within the kind cap, everyone meshed; assert it is blocked
with a clear reason when the combined distinct headcount would exceed the cap.

**Acceptance Scenarios**:

1. **Given** you're in a call and receive a group invite, **When** you choose Add to
   call, **Then** the invite's not-yet-present members are rung into your current call
   and join the mesh on accept, folding the two groups into one.
2. **Given** merging a group invite would exceed the kind cap on the combined distinct
   participants, **When** you try, **Then** the merge is blocked with a clear reason and
   both your call and the invite are left as they were.
3. **Given** a member appears in both your call and the incoming invite, **When** the
   groups fold, **Then** they resolve to a single participant with one set of legs (no
   duplicate).

### Edge Cases

- Adding a person who is **already in the call** (or already ringing) is a no-op, not
  a duplicate.
- Adding someone you're **not connected to**: handled by the existing same-room key
  gate (they can fetch each other's keys for the call's duration) — reuse it; no new
  connection requirement.
- **Merging an incoming group invite** (US6): folds the invite's roster into the
  current call; a member already present resolves to one participant; blocked with a
  clear reason if the combined distinct headcount exceeds the kind cap.
- **Both parties add each other / simultaneous adds** of the same new person:
  converge to one participant, one set of legs.
- **Video limit reached mid-upgrade**: an audio call above 4 people cannot switch to
  video (reuse the existing upgrade block), so merging a video caller there keeps the
  call audio (merged person joins audio-only); adding a person to a 4-person video
  call is blocked.
- **The one who is added** must consent — added people ring and can decline (no
  silent pull-in).
- **Promoting a 1:1 to a group**: the existing peer auto-follows into the group (their
  device follows the roster, the late-joiner path) and sees a brief "{name} joined the
  call" cue — no consent prompt for them.
- Merge/add during **poor connectivity** or reconnect (spec 2012/2013) must not
  corrupt the held-slot or roster state.

## Requirements *(mandatory)*

### Functional Requirements

**Merge (US1)**

- **FR-001**: While in a call, an incoming **direct caller** MUST offer an **Add to
  call** action alongside the existing Hold and Decline choices; an incoming **group
  invite** MUST also offer Add to call (US6).
- **FR-002**: Choosing Add to call on a **1:1** MUST promote it to a group (mesh)
  call containing the existing peer, yourself, and the new caller, reusing the
  current microphone/camera capture (no second capture prompt). The existing peer's
  device MUST auto-follow into the group and show a brief "{name} joined the call"
  cue — with no consent prompt for them (the added party consents by answering).
- **FR-003**: Choosing Add to call while in a **group** call MUST ring the new caller
  into the existing call; on accept they join the mesh.
- **FR-003a**: Choosing Add to call on an incoming **group invite** MUST fold the
  invite's not-yet-present members into the current call (ringing them into it),
  resolving any member already present to a single participant, subject to FR-010's
  cap on the combined distinct headcount (US6).
- **FR-004**: If the merged-in caller declines or does not answer, the existing call
  MUST continue unaffected.
- **FR-005**: Merge MUST apply only to the **active** call; a separately held call
  MUST be left untouched (US4).
- **FR-005a**: **Kind reconciliation** — when the merged caller's kind differs from
  the active call, the combined call MUST upgrade to video via the existing
  consent-gated upgrade flow **when the combined headcount is ≤ the video cap (4)**;
  otherwise the call stays audio and the merged participant joins audio-only. A
  video call absorbing an audio participant keeps video (that participant may enable
  their camera under the same consent flow).

**Add people (US2)**

- **FR-006**: While in a call, an **Add people** action MUST let the user select one
  or more contacts who are not already participants and ring them into the call.
- **FR-007**: An added invitee MUST ring like any call invite and be able to decline;
  on accept they MUST mesh with **every** existing participant, not only the inviter.
- **FR-008**: The participant list and tiles MUST update for all existing
  participants as invitees join or fail to join (no stuck "ringing" placeholder after
  a decline/timeout).

**Size limits (US3)**

- **FR-009**: A **video** call MUST never exceed **4** participants and an **audio**
  call MUST never exceed **8** (the existing caps — reused, not redefined).
- **FR-010**: Every new add path (merge and add-people) MUST enforce the cap
  **pre-emptively on the client** — blocking the action with a clear, kind-specific
  reason before anyone is rung — while the existing authoritative server refusal
  remains as a backstop.
- **FR-011**: The add-people picker MUST prevent selecting more contacts than the
  remaining capacity for the call's kind.
- **FR-012**: The existing rule that an audio call above the video cap cannot switch
  to video MUST remain consistent with the new add paths (adding a person that would
  make video impossible is handled coherently).

**Robustness (US5) + hardening**

- **FR-013**: Adding/merging MUST be correct under churn — concurrent join/leave,
  simultaneous adds of the same person, and an invitee reloading mid-ring — converging
  every device to the correct roster, tiles, and connectivity with no orphaned state.
- **FR-014**: Adding a participant then swapping to a held call MUST leave no
  half-open connection and MUST preserve the hold/swap invariants (US4).
- **FR-015**: Consent is required: no participant is ever added to a call without an
  incoming ring they accept (merge and add-people both ring the added party).
- **FR-016**: Misleading dead references to a removed media-server ("SFU") in the call
  code MUST be corrected to reflect the mesh, and any dead code paths from that
  removal cleaned up (no behaviour change).

**Zero-knowledge / crypto**

- **FR-017**: Growing a call MUST add no new server capability: per-pair signalling
  stays sealed over each pair's existing encrypted session, the server relays opaque
  frames and enforces only room membership + the numeric cap, and adding a participant
  reuses the existing same-room key-fetch gate. No new plaintext reaches the server.

### Key Entities *(include if feature involves data)*

- **Call**: A live conversation with a kind (audio or video) and a set of
  participants. A 1:1 has two; a group has a shared room identity and up to the
  kind's cap. Promoting a 1:1 to a group gives it a room identity.
- **Participant / roster**: Who is actually connected. Distinct from **invited** —
  people who have been rung but haven't joined (shown as "ringing" placeholders).
- **Held call**: At most one call may be held while another is active; merging never
  touches the held one.
- **Capacity**: Remaining slots = kind cap (4 video / 8 audio) minus current
  participants-plus-ringing; gates every add.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

- **What crosses the wire**: Nothing new in kind. Growing a call reuses the existing
  group-call signalling (join/roster/ring/leg offer-answer-ice), all of which the
  server already relays as opaque, sealed frames. Promoting a 1:1 to a group adds a
  room identifier to the signalling — a shape the server already handles for every
  group call.
- **What is encrypted / protected**: All SDP/ICE stays end-to-end encrypted over each
  pair's existing Double Ratchet session; media is peer-to-peer DTLS-SRTP. The server
  never sees media or call content.
- **What metadata is unavoidably visible**: Unchanged from today's group calls — the
  server sees room membership (who is in which call room) and enforces the numeric
  size cap, exactly as it already does. Adding a participant makes them a room member,
  which the server can already see for any group call; it learns nothing about content.
- **Key fetch for added, unconnected people**: Reuses the existing same-room gate that
  already lets ad-hoc call co-members fetch each other's prekey bundles for the call's
  duration — no new server permission.
- **Trust of the `joinroom` signal**: It is only accepted from an authenticated pair
  session (sealed and opened over the existing per-pair Double Ratchet), so it cannot be
  forged or replayed by the server or a third party. A `joinroom` carrying an
  unexpected room id is inert on its own — a device only ever participates in mesh legs
  it can establish and decrypt, so a spurious room id pulls it into nothing it can
  observe. Being added still requires the added party to answer their own ring
  (FR-015).
- **Why this is safe**: Mesh-only, no server media, no new frame types or fields, no
  new server capability — the feature composes existing encrypted signalling and the
  existing membership/cap enforcement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user in a 1:1 can merge an incoming caller into the call, ending with
  all three connected and media flowing among them, in under 10 seconds from accept.
- **SC-002**: A user in a call can add a contact who joins and meshes with **every**
  existing participant (verified from a non-initiator's device), not just the inviter.
- **SC-003**: 100% of over-limit add attempts (5th on a video call, 9th on an audio
  call) are blocked before ringing, with a clear kind-specific reason; the existing
  call is never disturbed.
- **SC-004**: Merging a caller into the active call leaves a separately held call
  fully intact and swappable in 100% of trials.
- **SC-005**: Under scripted churn (concurrent join/leave, simultaneous add, invitee
  reload mid-ring), every device converges to the correct roster and tiles with **zero**
  orphaned "ringing" placeholders or duplicate participants.
- **SC-006**: The reused microphone/camera is never re-prompted or interrupted during a
  merge or add (a single capture for the session).
- **SC-007**: All existing call e2e and unit tests stay green; the new behaviours are
  covered by Playwright e2e (audio meshes + 2-person proxies) and drive scenarios
  (video path), per the CI constraint.
- **SC-008**: On a 1:1 → group promotion, the existing peer auto-follows into the
  group and sees the "{name} joined the call" cue in 100% of trials, with no consent
  prompt shown to them.
- **SC-009**: Merging an incoming group invite folds both rosters into one call within
  the kind cap, or is blocked with a clear reason when the combined headcount would
  exceed it — verified in both the fits and doesn't-fit cases.

## Assumptions

- **Consent model reused**: Added people (merge or add-people) always ring and may
  decline — same as today's group invite; there is no silent pull-in.
- **1:1 → group promotion for the existing peer** (clarified): they auto-follow into
  the group (their device follows the roster, the existing late-joiner path) and see a
  brief "{name} joined the call" cue — no consent prompt, since they're already on the
  call with the promoter.
- **Kind reconciliation on merge** (clarified): upgrade to video via the existing
  consent-gated flow when the combined call is ≤ 4; otherwise stay audio (merged party
  audio-only). No new upgrade mechanism is invented.
- **Group-invite merge** (clarified, US6): supported but is the most complex path;
  built/tested after the direct-caller merge proves out, reusing the same
  promotion/roster machinery, and blocked when the combined headcount exceeds the cap.
- **Merge targets the active call only**; the held call (if any) is never merged into
  and never disturbed.
- **Caps are the existing 4 video / 8 audio**, enforced server-side already; this spec
  adds the pre-emptive client gate on the new mid-call add paths and does not change
  the numbers.
- **CI cannot run 3-person+ video mesh reliably headless**: add-to-call flows are
  e2e-tested primarily on **audio** meshes (3–4 people) and 2-person proxies; the video
  path is validated via drive scenarios / real devices. Pure decision logic (cap gate,
  roster/merge decisions) is unit-tested.
- **Mesh only**: no SFU / server media mixing is introduced (constitution).

## Out of Scope

- An SFU or any server-side media mixing/relay of call content (mesh only, by
  constitution) — and therefore raising the 4/8 caps.
- PSTN / telephony bridging (calling non-Ring phone numbers is spec 1029's
  native-dialer hand-off, not this).
- More than one held call at a time (the single-held-slot rule stays).
- Transferring an in-progress call to another device.
- Changing the adaptive-quality, busy-signalling, or invite-recovery behaviour of
  existing specs beyond what robustness fixes require.
