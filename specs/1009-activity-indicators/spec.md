# Feature Specification: Ephemeral Activity Indicators (Typing & Recording)

**Feature Branch**: `feat/1009-activity-indicators`

**Created**: 2026-06-17

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Add activity indicators that show a chat peer what you're doing while you compose — 'typing…', 'recording audio…', or 'recording video…'. Unified scope covering all three (voice messages and video notes already ship). The signal must be ephemeral and privacy-preserving: relayed live to the peer like a read receipt, never stored or pushed, gated by a privacy toggle with read-receipt-style reciprocity. Show it in the 1:1 chat header, in the chats-list row, and per-sender in group chats."

## Overview

Ring already lets people compose three kinds of message activity that take a
moment and that a peer would naturally want feedback on: typing text, recording
a voice message, and recording a round video note. Today none of that is visible
to the other side — a 1:1 chat header only ever shows "Online" / "last seen …",
and the chats list only shows the last message. There is no "is typing…"
affordance anywhere.

This feature adds **ephemeral activity indicators**: while a peer is actively
composing, the user sees a transient line — **"typing…"**, **"recording
audio…"**, or **"recording video…"** — that appears as it happens and vanishes
the moment the peer stops, sends, or goes away. It surfaces in the 1:1 chat
header (replacing the status line), in the chats-list row (replacing the
last-message preview), and per-sender in group chats ("Alice is typing…").

The defining constraint is Ring's zero-knowledge boundary. Activity is delivered
as a **live, relay-only signal modeled on read receipts** — addressed to the
peer, relayed to their currently-connected devices, and dropped if they are
offline. It is **never stored, never queued, never pushed, and adds no new
server-visible metadata** beyond the sender↔recipient relay path the server
already sees for every message. It is **not** modeled as server-computed
presence. Emission is consent-gated by a privacy setting that is reciprocal,
exactly like Read receipts: turn it off and you neither send nor see activity.

## Clarifications

### Session 2026-06-17

- Q: How granular should the privacy control be? → A: A single combined "Typing & recording indicators" toggle (beside Read receipts) governs all three activity kinds.
- Q: Should the recording indicator reveal the media type, or stay generic? → A: Distinct — "recording audio…" for a voice message and "recording video…" for a video note (the kind stays sealed/opaque to the server).
- Q: How long after the last signal should a stale indicator auto-clear? → A: Approximately 6 seconds.
- Q: In a group, how should multiple concurrent composers be shown? → A: Up to two names, then collapse to "several people are typing…".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a 1:1 peer typing (Priority: P1)

While viewing a one-to-one chat, when the other person is typing a message, the
user sees a "typing…" indicator in place of the usual online/last-seen line; it
disappears as soon as the peer stops typing, sends the message, or clears their
draft.

**Why this priority**: This is the headline behavior and the most common case;
it is the minimum viable slice that delivers the feature's value on its own.

**Independent Test**: With two connected accounts in the same chat, have one
account type; confirm the other sees "typing…" within about a second, and that
it clears shortly after they stop or on send.

**Acceptance Scenarios**:

1. **Given** two connected users with the chat open, **When** the peer begins
   typing, **Then** the chat header shows "typing…" in place of the
   online/last-seen line.
2. **Given** the peer was typing, **When** they stop and do nothing further,
   **Then** the indicator clears within a few seconds and the prior status line
   returns.
3. **Given** the peer was typing, **When** they send the message, **Then** the
   indicator clears immediately and the message arrives.

---

### User Story 2 - See a 1:1 peer recording audio or video (Priority: P1)

While viewing a one-to-one chat, when the other person is recording a voice
message or a video note, the user sees a distinct indicator — "recording audio…"
for a voice message, "recording video…" for a video note — which clears when the
peer sends or cancels the recording.

**Why this priority**: Voice messages and video notes already ship and are common;
recording takes visible time, so the "recording…" cue is as valuable as typing and
completes the headline scope.

**Independent Test**: With two connected accounts, have one start a voice
recording, then (separately) a video note; confirm the other sees "recording
audio…" and "recording video…" respectively, clearing on send or cancel.

**Acceptance Scenarios**:

1. **Given** the chat is open, **When** the peer starts recording a voice
   message, **Then** the user sees "recording audio…".
2. **Given** the chat is open, **When** the peer starts recording a video note,
   **Then** the user sees "recording video…".
3. **Given** the peer is recording, **When** they send or cancel, **Then** the
   indicator clears promptly.
4. **Given** the peer switches from typing to recording, **When** the recording
   starts, **Then** the indicator replaces "typing…" rather than showing both.

---

### User Story 3 - Privacy control with reciprocity (Priority: P1)

The user can turn activity indicators off in privacy settings (alongside Read
receipts). When off, the app never tells anyone what the user is doing; and,
reciprocally, the user no longer sees others' activity. When on (the default),
both directions work.

**Why this priority**: Consent and the zero-knowledge boundary are core to Ring;
the feature must not leak activity without an explicit, reciprocal opt-out, so
this ships with the indicator itself, not later.

**Independent Test**: Toggle the setting off on account A; confirm account B
never sees A's typing/recording, and A never sees B's, while two other accounts
with the setting on still see each other.

**Acceptance Scenarios**:

1. **Given** the setting is on (default), **When** either user composes, **Then**
   the other sees the matching indicator.
2. **Given** the user turns the setting off, **When** they type or record,
   **Then** no indicator is ever sent to anyone.
3. **Given** the user has the setting off, **When** a peer types or records,
   **Then** the user does not see the peer's indicator (reciprocity), and the
   setting explains this.

---

### User Story 4 - Activity shows in the chats list (Priority: P2)

In the chats list, a conversation whose peer is currently composing shows the
activity ("typing…" / "recording audio…" / "recording video…") in place of the
last-message preview, reverting to the preview when the activity ends.

**Why this priority**: Lets the user notice activity without opening the chat; a
familiar, high-value touch, but secondary to the in-chat indicator.

**Acceptance Scenarios**:

1. **Given** a chat row showing the last message, **When** that chat's peer
   starts composing, **Then** the row subtitle shows the activity instead of the
   preview.
2. **Given** the row shows activity, **When** the activity ends, **Then** the row
   reverts to the last-message preview.

---

### User Story 5 - Per-sender activity in group chats (Priority: P2)

In a group chat, the indicator attributes activity to the specific member(s)
composing — "Alice is typing…", and when several are active, a coalesced form
("Alice, Bob…", then "several people are typing…") — reusing each member's
existing display name and colour.

**Why this priority**: Groups are a primary surface, but per-sender attribution
and coalescing add complexity beyond the 1:1 case, so it follows the P1 slices.

**Acceptance Scenarios**:

1. **Given** a group chat is open, **When** one member types, **Then** the
   indicator names that member ("Alice is typing…").
2. **Given** a group chat, **When** multiple members compose at once, **Then**
   the indicator shows up to two names and then collapses to "several people are
   typing…" rather than stacking one line per member.
3. **Given** a group member recording a voice message, **When** they record,
   **Then** the indicator attributes "Alice is recording audio…".

---

### Edge Cases

- **Peer offline**: if the peer is not currently connected, no signal is shown,
  none is queued, and no notification/push is produced — activity is "right now"
  only.
- **Peer disconnects mid-activity**: a "typing…/recording…" indicator must
  auto-clear shortly after the last signal so a dropped or crashed peer never
  leaves a stuck indicator.
- **Reconnect / reload / re-open**: opening or reloading a chat never restores a
  past indicator; an indicator appears only for activity happening at that moment.
- **Rapid composing**: continuous typing reads as a steady "typing…" without
  flicker; the user does not emit a burst per keystroke.
- **Recording cancelled**: starting then cancelling a recording clears the
  indicator just like sending does.
- **Multiple devices**: a user composing on more than one device appears as a
  single indicator to the peer (no duplicate or flicker).
- **Blocked relationship**: activity is neither sent to nor shown for a blocked
  party.
- **Setting off**: with the privacy setting off, nothing is emitted and nothing
  is shown (both directions), per User Story 3.
- **App backgrounded / chat left**: leaving the chat or backgrounding the app
  ends the user's own outgoing activity promptly.
- **No established session**: if the user has no encryption session with the peer
  yet (so the activity kind cannot be sealed), the activity signal is suppressed
  entirely — it is never sent unsealed (fail closed).
- **LTR/RTL and light/dark**: the indicator reads correctly in both text
  directions and both themes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While a 1:1 chat is open and the peer is actively composing, the
  app MUST show an activity indicator that distinguishes three kinds: typing,
  recording audio (voice message), and recording video (video note).
- **FR-002**: The indicator MUST appear promptly after the peer begins an
  activity (target: about one second while both are connected) and MUST clear
  promptly when the peer stops, sends, or cancels.
- **FR-003**: In a 1:1 chat the indicator MUST transiently replace the
  online/last-seen status line in the chat header; when activity ends the prior
  status line MUST return.
- **FR-004**: In the chats list, a row whose peer is composing MUST show the
  activity in place of the last-message preview while active, reverting when it
  ends.
- **FR-005**: In group chats the indicator MUST attribute activity per sender and
  MUST coalesce multiple concurrent senders into a single line — showing up to two
  names and then collapsing to "several people are typing…" — reusing each
  sender's existing display name and colour.
- **FR-006**: Activity signals MUST be ephemeral — never stored on device or
  server, never part of message history, and never delivered after the fact; they
  MUST NOT survive a reconnect, reload, app restart, or navigation away.
- **FR-007**: An indicator MUST auto-clear if no further signal is received within
  approximately 6 seconds of the last signal, so a disconnected or crashed peer
  never leaves a stuck indicator.
- **FR-008**: The user MUST be able to turn activity indicators off via a single
  combined "Typing & recording indicators" setting presented alongside Read
  receipts, governing all three activity kinds; when off, the app MUST NOT emit
  any activity signal for any conversation.
- **FR-009**: The privacy setting MUST be reciprocal — a user who does not share
  their activity MUST NOT see others' activity — and the setting copy MUST explain
  this, mirroring the Read receipts behaviour.
- **FR-010**: Activity MUST NOT be sent to, or displayed for, a blocked party.
- **FR-011**: A user composing on multiple devices MUST appear to the peer as a
  single activity indicator (no duplicate or flicker).
- **FR-012**: The peer MUST be shown an indicator only while they have the
  conversation live; if they are offline the signal is simply not shown — no
  catch-up, no stored copy, no notification, and no push.
- **FR-013**: Outgoing activity MUST be debounced/coalesced so ordinary composing
  reads as a steady indicator rather than a flickering stream, and so it does not
  produce a per-keystroke burst.
- **FR-014**: All UI MUST use stock Ionic components + existing theme tokens,
  building custom only where no Ionic primitive fits, composed from Ionic
  (Constitution XI).
- **FR-015**: Behaviour MUST be correct in LTR and RTL and across light/dark
  themes, and indicator text MUST be localizable.

### Key Entities *(include if feature involves data)*

- **Activity signal** (ephemeral, never persisted): represents "this participant
  is doing X in this conversation right now," where X is one of typing /
  recording-audio / recording-video. It exists only in transit and in volatile
  in-memory UI state for the duration of the activity; it has no stored
  representation on the device or server and never enters message history.

## Zero-Knowledge Impact *(mandatory)*

This feature is **not** client-only — it crosses the wire — so a
`/speckit-checklist` is required (Constitution Principle I, Zero-Knowledge
Boundary).

- **What crosses the wire**: an ephemeral activity signal addressed from the
  composing user to the conversation peer(s). It is relayed **live** to the peer's
  currently-connected devices and dropped if none are connected — modeled on the
  existing read-receipt relay, **not** on server-computed presence. The server
  stamps the authenticated sender (the existing receipt anti-forgery rule carries
  over); a client cannot forge activity "from" another user.
- **What is encrypted**: the activity **kind** (typing vs recording-audio vs
  recording-video) MUST be sealed so it is opaque to the server, the way other
  sealed peer-to-peer control payloads already are. Only the routing identities
  (who → whom), which relaying physically requires, are visible.
- **Metadata**: the only thing the relay observes is "this connection sent an
  ephemeral control frame to that peer at time T" — the **same tuple** the
  existing message and read-receipt relay already exposes. Per Principle I
  (metadata minimized to what relaying requires) and Principle IX (zero-knowledge
  is the floor), this introduces **no new server-visible metadata**. The two
  residual side-channels — keepalive cadence (roughly reveals composing duration)
  and the count of per-recipient frames in a group (reveals fan-out size, which
  the per-message relay already exposes) — are bounded by the debounce/keepalive
  cadence and the group fan-out cap, and add nothing the message relay does not.
- **What is explicitly NOT added**: no durable storage, no offline queue, no push
  notification, no database migration/table/column, and no new server-computed or
  server-aggregated signal. Modeling activity as broadcast presence (gated by the
  contact graph) is **rejected** because it would make the server author a new
  aggregated signal — more than relaying requires.
- **Consent**: emission is gated entirely client-side. With the privacy setting
  off, the client emits nothing (you cannot leak what you never send), and the
  reciprocal rule prevents one-way visibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With two connected accounts in the same chat, when one begins
  typing the other sees "typing…" within 1 second, and it clears within a few
  seconds of stopping (immediately on send). Verified e2e between two accounts.
- **SC-002**: When a peer records a voice message the other sees "recording
  audio…"; when recording a video note, "recording video…"; each clears on send
  or cancel. Verified e2e.
- **SC-003**: Activity never persists — after an indicator shows, reloading or
  reconnecting the recipient shows no indicator unless activity is ongoing, and no
  activity entry appears in message history or device storage. Verified e2e plus a
  storage/inspection assertion.
- **SC-004**: With the privacy setting off on account A, account B never sees A's
  activity and A never sees B's, while two other accounts with it on still see
  each other. Verified e2e.
- **SC-005**: A peer that disconnects mid-typing leaves no stuck indicator — it
  auto-clears within ~6 seconds. Verified e2e (drop the connection, assert the
  indicator is gone within the window).
- **SC-006**: In a group of three, concurrent typers are attributed and coalesced
  into a single line (up to two names, then "several people…"), and an offline
  member produces no indicator. Verified e2e.
- **SC-007**: The feature adds no server-side storage for activity — no new
  database migration, table, or column — and the relay path is live-only.
  Verified by inspection of the change set.

## Assumptions

- Builds on Ring's existing ephemeral signalling rather than new subsystems: the
  client holds activity state in volatile memory (like presence) and the server
  relays it live (like a read receipt); voice-message and video-note recording
  already exist and emit start/stop activity when the user records.
- A single combined privacy toggle ("Typing & recording indicators", default on)
  governs all three activity kinds and inherits the reciprocity model of the
  existing Read receipts toggle; it is presented in the same privacy group.
- Timing: the indicator appears on activity start and auto-expires ~6 seconds
  after the last signal; continuous composing is kept alive (without a
  per-keystroke burst) so it does not flicker off during natural pauses.
- Group fan-out is bounded/rate-limited because the server holds no group object,
  consistent with how group-call invitations fan out today.
- The 1:1 chat header status line and the chats-list row subtitle are the baseline
  surfaces; an above-composer bar is an acceptable alternative the design may add,
  but is not required by this spec.
- Indicators are shown only to conversation participants the user already messages
  with; the feature introduces no new audience or relationship.
