# Feature Specification: Call waiting — hold, swap & drop between two concurrent calls

**Feature Branch**: `feat/0005-call-waiting-hold`

**Created**: 2026-06-23

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Let people put an ongoing call on hold, answer another incoming call, then swap back and forth between them, or drop one and continue with the other — for any combination of 1:1 and group calls."

## Clarifications

### Session 2026-06-23

- Q: Should call-waiting (hold one call, answer another, swap/drop) be supported? → A: **Yes** — accepting a second call holds the current one and connects the new one; the user can swap or drop.
- Q: Which call combinations support hold/swap? → A: **Any combination** — hold/swap any active call (1:1 or group) to take any incoming; holding a group pauses all of that user's legs while the rest of the group continues.
- Q: How many calls can be juggled at once? → A: **Two** (one active, one held); a third incoming call gets busy/unavailable.
- Q: What does the other side of a held call experience? → A: An **"on hold" indication** with its media paused in both directions until resumed.

## User Scenarios & Testing *(mandatory)*

Ring's calls are single-track today: being in a call makes you unavailable to every
other caller (see the companion spec on busy/second-incoming handling). This feature
adds the ability to *take* a second call without losing the first — hold, swap, and
drop — across any mix of 1:1 and group calls. Group calls run as a peer-to-peer mesh
(one direct, end-to-end-encrypted connection per peer), so "holding" a group call means
pausing all of the holder's legs while the other members carry on among themselves.

### User Story 1 - Take a second call without losing the first (Priority: P1)

While in a call, the user receives another incoming call and chooses to accept it. The
current call is automatically put on hold — its media paused in both directions — and
the new call connects. The user is now in two calls: one active, one held.

**Why this priority**: This is the core of the feature; without it there is no call
waiting. It is the minimum that delivers value and is independently demonstrable.

**Independent Test**: With A in a call and B calling, have A choose accept-and-hold;
confirm the first call's media pauses both ways and shows "on hold", and the second
call connects with working media.

**Acceptance Scenarios**:

1. **Given** A is in a call, **When** a second call arrives and A chooses accept-and-hold,
   **Then** the first call is put on hold (media paused in both directions) and the
   second call connects.
2. **Given** A accepts a second call, **When** the first is held, **Then** the held
   call's other party (1:1) or every other member (group) sees an "on hold" indication.
3. **Given** A holds a group call, **When** it is on hold, **Then** all of A's legs in
   that call are paused while the remaining members continue talking to each other.

---

### User Story 2 - Swap back and forth (Priority: P1)

The user toggles between the active call and the held call. The previously active call
goes on hold (media paused), and the previously held call resumes (media restored). This
can be repeated any number of times.

**Why this priority**: Holding without the ability to return to the held call is not
useful; swap is the natural completion of Story 1 and is independently testable.

**Independent Test**: With one active and one held call, swap repeatedly and confirm each
call's media is correctly paused when held and restored when resumed, and the "on hold"
indication tracks the right call each time.

**Acceptance Scenarios**:

1. **Given** A has one active and one held call, **When** A swaps, **Then** the active
   call is put on hold and the held call resumes with media restored in each direction.
2. **Given** A swaps multiple times, **When** each swap completes, **Then** exactly one
   call is active and one is held, and the "on hold" indication follows the held call.
3. **Given** a held group call is resumed, **When** A returns to it, **Then** A's legs
   re-publish and re-subscribe and the other members see A as active again.

---

### User Story 3 - Drop one and continue on the other (Priority: P1)

The user ends either the active or the held call and continues on the remaining one (the
remaining call resumes if it was the held one). When only one call remains, behaviour is
exactly the normal single-call experience.

**Why this priority**: Completing or abandoning one of the two calls is essential to
returning to a normal single-call state; without it the user is stuck juggling.

**Independent Test**: With one active and one held call, end the active call and confirm
the held one resumes and behaves as a normal single call; repeat ending the held call
instead and confirm the active one is undisturbed.

**Acceptance Scenarios**:

1. **Given** A has an active and a held call, **When** A ends the active call, **Then**
   it tears down and the held call resumes as the sole, normal call.
2. **Given** A has an active and a held call, **When** A ends the held call, **Then** it
   tears down and the active call is undisturbed.
3. **Given** the remote party of a held call hangs up while on hold, **When** that
   happens, **Then** that call slot is freed and A is informed, with A's remaining call
   unaffected.

---

### User Story 4 - Only two at a time; further callers get busy (Priority: P2)

When the user is already juggling two calls (one active, one held), any further incoming
call receives a busy/unavailable result — the user is not offered a third slot.

**Why this priority**: Bounds the feature to a sane, implementable limit and prevents an
unusable pile-up; depends on Stories 1–3 existing first.

**Independent Test**: Put A in two calls (active + held). Have a third party call A and
confirm they get a busy/unavailable indication and A is not interrupted with a third
incoming prompt.

**Acceptance Scenarios**:

1. **Given** A has one active and one held call, **When** a third call arrives, **Then**
   the third caller receives a busy/unavailable result.
2. **Given** A is at the two-call limit, **When** a third call arrives, **Then** A is not
   shown an accept-and-hold prompt for it.

---

### User Story 5 - Hear the hold/swap moments (Priority: P3)

Distinct, subtle audio cues mark the call-waiting moments: the second-call (call-waiting)
alert, putting a call on hold, resuming, and swapping. Cues respect the app's existing
tone/mute settings and are rate-limited.

**Why this priority**: A usability/accessibility polish on top of working call-waiting;
valuable but not blocking. (The base call-state cues live in the companion calling spec.)

**Independent Test**: Trigger a second incoming call, accept-and-hold, swap, resume, and
confirm each emits its distinct, subtle cue, and that disabling tones silences them.

**Acceptance Scenarios**:

1. **Given** A is in a call, **When** a second call arrives, **Then** a distinct
   call-waiting alert cue plays (distinct from a normal incoming ring).
2. **Given** A holds, resumes, or swaps, **When** the action completes, **Then** a
   distinct confirmation cue plays for it.
3. **Given** the user has disabled call/notification tones, **When** any of the above
   occurs, **Then** no cue plays.

---

### Edge Cases

- **Held call counts toward the limit**: one active + one held = full; a third incoming
  gets busy.
- **Holding a group call**: the other members continue among themselves and see the
  holder as "on hold"; the holder neither sends nor receives that call's media until
  resumed.
- **Resuming a group call**: the holder's legs must re-establish media (re-publish /
  re-subscribe) cleanly without dropping the other members' ongoing call.
- **Network blip on the held call**: a held call that loses connectivity follows the
  normal grace/recovery rules; if it dies while held, its slot is freed and the user is
  informed.
- **Both calls' remote sides act at once** (one hangs up while the user swaps): resolve
  deterministically without leaving a "ghost" call slot.
- **Participant caps and hold**: caps are per-call; an active and a held call are bounded
  independently (this feature does not change the caps defined in the companion spec).
- **Adaptive quality and hold**: a held call's quality adaptation is suspended while
  paused and resumes from a low tier when the call is resumed (see companion spec).
- **Hold during call setup**: accepting a second call while the first is still
  connecting/ringing must hold or resolve the first sensibly, not strand it.
- **Cue fatigue**: rapid hold/swap must not produce a storm of cues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the user is in a call and another call arrives, the system MUST offer
  to accept-and-hold (in addition to decline).
- **FR-002**: Accepting a second call MUST place the current call on hold — pausing its
  outgoing and incoming media in both directions — and connect the new call.
- **FR-003**: The user MUST be able to swap between the active and held call any number of
  times, with each call's media correctly paused when held and restored when resumed.
- **FR-004**: The user MUST be able to end either the active or the held call independently
  and continue with the other; the remaining call resumes if it was held.
- **FR-005**: Hold/swap MUST support any combination of 1:1 and group calls.
- **FR-006**: Holding a group call MUST pause all of the holder's legs in that call while
  the remaining members continue; resuming MUST cleanly re-establish the holder's media.
- **FR-007**: The other party of a held 1:1 call, and every other member of a held group
  call, MUST be shown an "on hold" indication while the call is paused.
- **FR-008**: The system MUST limit juggling to two calls at once (one active, one held);
  a third incoming call MUST receive a busy/unavailable result and MUST NOT prompt the
  user to hold.
- **FR-009**: If the remote side of a held call ends it while on hold, the system MUST
  free that slot and inform the user without disturbing the remaining call.
- **FR-010**: A held-and-resumed call MUST be logged as a single call in history (hold,
  swap, and resume are not separate calls).
- **FR-011**: The system MUST emit distinct, rate-limited audio cues for the call-waiting
  alert, hold, resume, and swap, honouring the app's existing tone/mute settings.
- **FR-012**: All hold/resume/swap signalling that conveys pairwise state MUST remain
  end-to-end encrypted per the pair's secure session; the server MUST continue to relay
  only ciphertext and track only room membership and call kind — no plaintext, keys, or
  media. Hold/resume MUST NOT expose to the server which call a user is paying attention
  to beyond what room membership already reveals. Specifically:
  - **FR-012a**: A hold/resume signal MUST be indistinguishable to the server from any other
    sealed call signal — it MUST ride an existing sealed call frame (no new frame type) so the
    relay sees only relayed ciphertext, never a "hold" marker or the active-vs-held distinction.
  - **FR-012b**: Holding or resuming MUST NOT change server-tracked room membership — it MUST
    NOT emit a leave/join or otherwise alter the roster the server holds (a held participant
    stays a member); pausing media MUST NOT create any app-server-observable signal (media is
    peer-to-peer over the relay, not the app server).
  - **FR-012c**: No log line, metric, error payload, or debug aid MAY record a hold/resume
    event, its timing, or which of a user's calls is active vs held.
  - **FR-012d**: No hold/swap/resume timestamp or event MAY be persisted anywhere that reaches
    the server (call history is client-local; own-data sync is already encrypted).
  - **FR-012e**: The two-call cap's busy reply to a third caller MUST reveal nothing more than
    the existing single-call busy signal already does (no "two calls"/slot count leaked).
- **FR-013**: Call-waiting MUST work in all supported browsers including iOS/Safari (no
  regression), consistent with the mesh's cross-browser support.

### Key Entities *(include if feature involves data)*

- **Call slot**: One of at most two concurrent calls a user holds (one active, one held);
  the active slot has live media in both directions, the held slot is paused.
- **Hold state**: Per-call indication of whether the user has the call paused; surfaced to
  the other party/members as "on hold".
- **Call**: A 1:1 or group call (as defined in the companion calling spec), now extended
  with an on-hold lifecycle state and the ability to pause/resume its media.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

- **What crosses the wire**: only the new sealed `hold`/`resume` call signals, carried over an
  *existing* sealed call frame (e.g. `call-ice`) — opaque ciphertext relayed between two room
  members, exactly like the offer/answer/ICE that already flow. No media flows for a held call.
- **What is encrypted**: the hold/resume signal payload, end-to-end under each pair's Double
  Ratchet (the established sealed-signal path) — 1:1 to the peer, per-leg for the mesh.
- **What metadata is unavoidably visible to the server, and why**: only what the relay already
  observes — that a sealed call signal was relayed between two members of a room it already
  tracks. The server CANNOT tell a hold from any other sealed signal, cannot tell which of a
  user's two calls is active vs held, and sees no roster change on hold (a held participant
  stays a member) — see FR-012/FR-012a–e. The two-call state is entirely client-local.
- **What is NOT added**: no new server frame type, table, relay/allowlist change, or metric;
  no IndexedDB store or `DB_VERSION` bump (call/hold state is ephemeral, in-memory); no
  `SECRETS_KEY` impact; no hold/swap timing persisted server-side. A held-then-resumed call is
  one client-local history entry (FR-010), and the third-caller busy reply is the existing
  busy signal (no slot count leaked, FR-012e).
- **Media boundary**: call media is peer-to-peer (native DTLS-SRTP) over the TURN relay, never
  the app server; pausing via `replaceTrack(null)` is a local sender change with no
  app-server-observable effect.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can put a call on hold, connect a second call, swap between them at
  least 3 times, and drop one to continue on the other — in 100% of trials, with each
  call's media correctly paused/restored.
- **SC-002**: A held call shows "on hold" to its other party/members and carries no live
  media until resumed, verified in both 1:1 and group cases.
- **SC-003**: While a user holds a group call, the remaining members' call is unaffected
  and the holder appears "on hold" to them; on resume the holder's media returns within a
  few seconds.
- **SC-004**: When a user is at the two-call limit, a third caller receives a
  busy/unavailable result in 100% of trials, with no third prompt shown to the user.
- **SC-005**: When the remote side of a held call ends it, the user's remaining call is
  never disrupted (0 occurrences of the wrong call dropping).
- **SC-006**: Each call-waiting cue (alert, hold, resume, swap) plays distinctly, and
  disabling tones silences them.
- **SC-007**: Call-waiting works on iOS/Safari and Chromium-based browsers with no
  regression to single-call behaviour.

## Assumptions

- **Two-call limit**: At most one active + one held call; a third incoming gets busy. No
  multi-party "conference merge" of the two calls is in scope.
- **Hold semantics**: Holding pauses media in both directions and shows the other side
  "on hold". No hold music; silence (or the existing in-app "on hold" affordance) is used.
- **Any combination**: Hold/swap works for 1:1↔1:1, 1:1↔group, and group↔group; holding a
  group pauses only the holder's legs while the rest of the group continues.
- **Depends on the companion calling spec** (`0004-group-call-reliability`) for: the
  busy/second-incoming signalling it builds on, participant caps (unchanged here), adaptive
  quality (a resumed call restarts low), the base call-state audio cues, and two-sided call
  logging. This spec adds the hold/swap layer on top.
- **No conferencing/transfer**: merging the two calls into one, or transferring a call to a
  third party, is explicitly out of scope.
- **iOS/Safari support** is a hard constraint; any hold/resume technique must work there.
- **Zero-knowledge** is non-negotiable; nothing here may expose plaintext, media, or keys
  to the server.
