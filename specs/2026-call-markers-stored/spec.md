# Feature Specification: Call markers must never surface as messages

**Feature Branch**: `fix/2026-call-markers-stored`

**Created**: 2026-07-12

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Incoming call announcements are still not working: the first
incoming-call notification bumps the badge by 2, a second generic 'New message' notification
follows, the missed call never appears in the Calls tab, and the 1:1 chat shows 2 empty
messages. Group calls behave the same and never mention an incoming group call at all."

## Root cause (regression analysis)

Spec 1040 introduced sealed `callEvent` marker frames (`ring` at dial time, `ended` at
outcome time) that ride the ordinary queued-message channel. Spec 1032's service-worker
authoritative drain (`sw.fullPersist`, default ON since the rollout completed) predates
them: its eligibility classifier has no rule for `callEvent`, so a marker falls through to
"eligible plain message". The drain then:

- stores the marker as an empty chat message (`kind: 'callevent'`, empty body) → the two
  empty bubbles, the inflated unread count, and the clobbered chat-list preview;
- **acks the frame**, so the page never receives it → `handleCallEvent` never runs → no
  missed-call row in the Calls tab and no in-chat call row;
- shows nothing for a ring marker (its note is intentionally null) → the wake ends with the
  generic "New message" placeholder instead of naming the ring;
- consumes the marker before any later `{"t":"call"}` reminder wake can read it → the
  "Incoming call" notification is never upgraded with the caller's name (1:1 and group).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Markers are side effects again (Priority: P1)

A callee whose app is closed gets a call. The dial-time and outcome markers the caller
sends must act only as side effects (notification naming, badge unit, missed-call trace) —
never as stored chat messages, unread counts, or "New message" notifications.

**Why this priority**: This is the regression itself; everything else follows from it.

**Independent Test**: Unit test on the drain's eligibility classifier; on-device: receive a
call with the app closed, then open the chat.

**Acceptance Scenarios**:

1. **Given** the SW drain is enabled, **When** a `callEvent` frame is classified,
   **Then** it is deferred to the page (never persisted, never acked by the SW).
2. **Given** a missed 1:1 call while the app was closed, **When** the app is next opened,
   **Then** the chat shows no empty bubbles and the Calls tab shows the missed call with
   the caller's name, and the in-chat "Missed call" row exists.
3. **Given** a missed call while the app was closed, **When** the badge settles,
   **Then** it counts exactly one unit for the call (never two).

### User Story 2 - The ring notification gets named (Priority: P2)

The first "Incoming call" alert is undelayed and generic (the push tickle is content-free);
once the caller's dial-time marker arrives — which happens on a later *message* wake, since
the marker send is deliberately deferred off the call-setup hot path — that wake must
upgrade the ring notification in place with the caller (and group) name instead of adding a
generic "New message" alert.

**Why this priority**: Spec 1040's headline behavior ("calls show who is calling") is
currently unreachable on the common path.

**Independent Test**: Unit test the fresh-ring predicate; on-device: call a closed device
and watch the generic ring upgrade to the named ring within seconds.

**Acceptance Scenarios**:

1. **Given** a msg-push wake whose decrypted frames include a fresh `ring` marker,
   **When** the wake completes, **Then** the existing `ring-call` notification shows the
   caller's name (or the group's name with "X is calling") and no extra generic
   notification is added for the marker.
2. **Given** the ring marker's call has already ended (an `ended` marker is also queued),
   **When** the wake completes, **Then** no ring upgrade happens (missed/cancelled shows
   the missed-call replacement as today).

### User Story 3 - Devices already polluted are repaired (Priority: P3)

Devices that ran the buggy drain have empty `callevent` rows stored, inflated unread
counters, and stale chat previews. On next app open they must be cleaned up.

**Why this priority**: Without repair the empty bubbles and wrong counts persist forever on
affected devices (the frames were acked; they will never be redelivered).

**Independent Test**: Seed a chat with junk `callevent` rows + inflated unread, run the
sweep, verify rows gone, unread corrected, preview recomputed.

**Acceptance Scenarios**:

1. **Given** stored messages with `kind: 'callevent'`, **When** the app starts,
   **Then** those rows are deleted, each affected chat's unread count is reduced by the
   number of junk rows removed (floored at 0), and the chat-list preview is recomputed
   from the newest remaining message.

### Edge Cases

- A marker frame arriving in the same wake as a real text message: the text is drained and
  notified normally; the marker defers to the page and still names the ring.
- The old (pre-fix) service worker may stay active until the user accepts the update and
  can keep storing junk rows; the repair sweep therefore runs on every app open, not once.
- Hidden chats: an upgraded ring must stay generic and its badge unit withdrawn (existing
  `previewCallRing` rules apply unchanged).
- Retroactive traces cannot be reconstructed: junk rows carry no callId/outcome, so calls
  missed during the buggy window stay absent from the Calls tab (accepted).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SW authoritative drain MUST defer `callEvent` frames to the page: never
  persist them as messages, never count them as unread, never ack them.
- **FR-002**: A message-push wake that decrypts a fresh (inside the ring window) `ring`
  marker MUST attempt the named in-place upgrade of the `ring-call` notification, using
  the same naming/hidden-chat/badge rules as the call-tickle path (`previewCallRing`).
- **FR-003**: A wake whose only content is a fresh ring marker MUST count the named ring
  upgrade as its visible ending (no additional generic notification).
- **FR-004**: On app start the client MUST remove stored messages with `kind:
  'callevent'`, correct each affected chat's unread count, and recompute its preview.
- **FR-005**: All existing spec-1040 behaviors (badge units, missed-call replacement
  notification, page-side missed-call trace) MUST be restored by FR-001 with no change to
  the marker wire format.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A missed call to a closed device produces exactly: one ring notification
  (named once the marker lands), one missed-call replacement notification, one badge unit,
  one Calls-tab row, one in-chat call row — and zero empty chat messages.
- **SC-002**: Group calls to a closed device produce a ring notification that names the
  group/caller once the marker lands, and a missed group call appears in the Calls tab.
- **SC-003**: Previously polluted devices show no `callevent` bubbles after one app open.

## Assumptions

- The marker send delays (2.5s direct, 8s group) stay as shipped — the hot-path seal rule
  (spec 1040) is untouched; naming the ring a few seconds after the generic alert is the
  designed behavior (FR-004 of spec 1040: the first alert is never delayed).
- No server change is needed: the server already pushes call tickles for 1:1 and group
  invitees; this is purely a client/service-worker regression.
