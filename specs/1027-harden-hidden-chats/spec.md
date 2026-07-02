# Feature Specification: Harden Hidden Chats + One-Hidden-One-Visible Per Person

**Feature Branch**: `feat/1027-harden-hidden-chats`

**Created**: 2026-07-02

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Investigate the current hidden-chat implementation — it is buggy. Find the bugs and fix them and make the implementation robust and secure so when a chat is hidden, by default nothing except the knock-knock call and the badge update is shown on the device. We also want to be able to have a hidden chat with one person and a separate non-hidden chat with the same person; if a hidden chat with that person already exists, the second chat can no longer be set to hidden. At most one hidden and one non-hidden chat with the same person. Use Playwright as much as possible and test all the behaviours."

## Overview

Ring already ships a **Hidden Chats** privacy layer (spec 1019): a user can take a
conversation out of the visible chat list and tuck it behind a dedicated PIN,
revealed only by typing the PIN into the search bar. It is a purely local,
on-device visibility layer on top of Ring's end-to-end encryption — the server is
never told a chat is hidden and learns nothing new.

The shipped implementation is **buggy and incomplete**. This feature is an
investigate → fix → harden pass over the existing behaviour, plus one deliberate
model change:

1. **A tight privacy contract.** When a chat is hidden, *nothing* about it appears
   on the device by default — no chat-list row, no message notification content, no
   preview, no sender identity, no search hit, no call-history entry — with exactly
   two intentional exceptions: the **knock-knock call** (a live incoming call still
   rings with full identity, because you must be able to answer) and the **badge /
   unread count** (subject to the user's badge preference). One platform-forced
   carve-out: a push-woken delivery must show *some* notification or the platform
   revokes push for the whole app, so that path shows a banner byte-identical to
   the global previews-off generic — indistinguishable from ordinary
   previews-off activity (FR-012).

2. **One hidden and one visible chat per person.** A person may have at most two
   conversations with you: exactly one hidden and exactly one visible. "Hide chat"
   *moves* the current conversation into the hidden set; once hidden, if it was the
   only chat with that person, nothing remains visible for them until you reveal
   with the PIN. A fresh visible chat is (re)created only when you next start a
   conversation with that person. If a hidden chat with that person already exists,
   the visible one **cannot** be hidden — the Hide action is blocked with a clear
   reason.

3. **Robustness and security.** Every surface that consults hidden state fails
   closed (hidden chats never flash into view before the hidden set decrypts) but
   without collaterally suppressing unrelated visible data. Wrong PIN reveals
   nothing and gives no oracle. The hidden set, the lock state, and the PIN never
   leave the device and never enter any sync payload.

This spec supersedes the visibility model in 1019: where 1019 said the visible
chat is "never removed or altered" when a hidden chat exists, 1027 makes hiding a
**move** — the hidden chat and a later, separately-started visible chat coexist,
but hiding the last visible chat leaves nothing visible for that person.

## Clarifications

### Session 2026-07-02

- Q: When a message arrives for a hidden chat while the app is in the background,
  what should the device show? → A: Split by delivery path, dictated by web-push
  platform rules (a push-woken service worker MUST show a user-visible
  notification or the browser eventually revokes the push subscription, killing
  notifications for ALL chats; a badge update alone does not count). Push-woken
  deliveries show a generic notification **byte-identical** to the one used when
  message previews are off globally ("Ring / New message" → Chats tab), so an
  observer cannot distinguish hidden-chat activity from a previews-off visible
  chat. Every path the platform does not force — foreground, or backgrounded but
  WebSocket-connected without a push wake — is fully silent, badge only. Bursts
  coalesce into a single generic banner with no count.
- Q: What happens when the user tries to unhide a hidden chat while a visible chat
  with that same person already exists? → A: Unhide is blocked with a clear
  user-facing reason; the user must first delete the visible chat. The one-visible
  invariant is never broken and histories are never merged.
- Q: If the reveal grace window expires (or relock triggers) while the user is
  inside an open hidden chat? → A: Kick out immediately — relock navigates away
  from the open hidden chat to the Chats list at once; nothing hidden stays on
  screen past the grace window.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hide a chat and it disappears (Priority: P1)

A user long-presses a conversation and taps **Hide chat**. If no hidden PIN exists
yet, they are asked to create one. The conversation immediately leaves the chat
list, search, pickers, and call history. If that was the only chat with that
person, the person is now entirely absent from every visible surface. The hidden
conversation keeps receiving messages silently in the background.

**Why this priority**: This is the core promise of the feature and the thing that
is buggy today. Without a correct, complete hide, nothing else matters.

**Independent Test**: With two accounts, hide the 1:1 with a peer, confirm it is
gone from Chats / search / Calls, send a message from the peer, and confirm the
device shows no chat-list row and no notification content — only the badge.

**Acceptance Scenarios**:

1. **Given** a visible 1:1 chat and no hidden PIN yet, **When** the user taps Hide
   chat, **Then** they are prompted to create a PIN and, on success, the chat
   leaves every visible surface (Chats, search, contact/group pickers, Calls tab).
2. **Given** a hidden chat that is the only chat with a peer, **When** the peer
   sends a message, **Then** no chat-list row appears, nothing revealing is shown
   (silent, or the generic previews-off banner only if push-woken — see FR-012),
   and the badge/unread count updates (per preference).
3. **Given** a hidden chat, **When** the app is fully closed and reopened, **Then**
   the chat stays hidden with no flash of it appearing during load.

---

### User Story 2 - Reveal with the PIN, then relock (Priority: P1)

A user types their hidden PIN into the Chats search bar. Hidden chats appear
(visually marked as revealed) and sort to the top. They stay revealed through a
short grace window across quick app-switches, then relock — and any full app close
relocks immediately, leaving no trace.

**Why this priority**: Hiding is only useful if the owner can reliably get back in,
and relock is the other half of the privacy guarantee.

**Independent Test**: Hide a chat, type the PIN in the search bar, confirm it
appears; background and foreground within the grace window and confirm it is still
revealed; exceed the grace window (or fully close) and confirm it relocks.

**Acceptance Scenarios**:

1. **Given** hidden chats exist, **When** the user types the correct PIN into the
   search bar, **Then** hidden chats become visible, marked as revealed, and sorted
   to the top, and the search box clears.
2. **Given** a wrong PIN is typed, **When** it is entered, **Then** nothing is
   revealed and there is no visible, audible, or timing difference that confirms the
   PIN was wrong (no oracle).
3. **Given** chats are revealed, **When** the grace window elapses or the app is
   fully closed, **Then** the chats relock and disappear again — and if a hidden
   chat is open on screen at that moment, the app navigates away from it to the
   Chats list immediately.

---

### User Story 3 - One hidden and one visible chat with the same person (Priority: P1)

A user has a normal visible chat with a friend. They hide it — it moves into the
hidden set and disappears. Later they start a fresh conversation with the same
friend; a new visible chat appears. Now they have exactly one hidden and one
visible chat with that friend, each with its own history, routed independently. If
they try to hide the second (visible) chat while the hidden one still exists, the
Hide action is unavailable and explains why.

**Why this priority**: This is the new model the user explicitly asked for and the
main behavioural change of this spec.

**Independent Test**: Hide the 1:1 with a peer, start a new chat with the same
peer, confirm both exist (one hidden, one visible) with separate histories, then
confirm the Hide action on the visible chat is blocked while the hidden one exists.

**Acceptance Scenarios**:

1. **Given** a hidden chat with a peer already exists, **When** the user starts a
   new conversation with that same peer, **Then** a fresh visible chat is created
   and both coexist, each receiving only its own messages.
2. **Given** a hidden chat with a peer already exists, **When** the user opens the
   actions for the visible chat with that peer, **Then** Hide chat is blocked /
   disabled with a clear reason ("You already have a hidden chat with this person").
3. **Given** a person with whom the user has no hidden chat, **When** the user hides
   their only chat, **Then** nothing remains visible for that person until reveal,
   and a later new conversation with them succeeds as a fresh visible chat.
4. **Given** both a hidden and a visible chat with the same peer, **When** either
   side sends a message in one of them, **Then** it lands only in that thread and
   never leaks into or duplicates the other.

---

### User Story 4 - Only the knock-knock call and badge surface (Priority: P1)

While a chat is hidden, the device stays silent about it except for two things: a
live incoming **call** from that peer rings normally with full caller identity
(name + avatar) so the user can answer, and the **badge/unread count** updates
according to the user's badge preference. Message notifications show nothing
revealing, the lock screen shows no sender, and there is no call-history entry that
names the hidden peer.

**Why this priority**: This is the precise privacy contract the user specified and
the behaviour most likely to leak if it regresses.

**Independent Test**: With a hidden chat, place a call from the peer and confirm the
incoming-call screen shows their real name/avatar; send a message from the peer and
confirm the notification is generic/silent with no sender or preview; confirm the
badge updates and that the ended call leaves no history entry naming the peer.

**Acceptance Scenarios**:

1. **Given** a hidden chat, **When** the peer places a call, **Then** the incoming
   call rings with full caller identity and can be answered normally.
2. **Given** a hidden chat and the app was woken by a push, **When** the peer
   sends a message, **Then** the notification shown is byte-identical to the
   generic previews-off notification ("Ring / New message" → Chats tab) — no
   sender, avatar, content, or preview — regardless of preview or mention
   settings, and bursts coalesce into one such banner.
3. **Given** a hidden chat and the app is in the foreground (or backgrounded but
   still connected without a push wake), **When** the peer sends a message,
   **Then** nothing is shown at all — no banner, no sound — and only the badge
   updates per preference.
4. **Given** a hidden chat, **When** a call with that peer ends, **Then** no
   call-history entry that reveals the hidden peer is shown while relocked.
5. **Given** the badge preference is `always`, `never`, or `revealed`, **When** a
   hidden chat has unread messages, **Then** the badge reflects that preference and,
   for `never`/`revealed`, hidden unreads are excluded **without** suppressing the
   count of unrelated visible chats.

---

### User Story 5 - Reset wipes hidden state and cannot be re-materialized (Priority: P2)

From Settings, a user resets hidden chats. All hidden-chat local state — the hidden
set, the PIN, and the hidden conversations' local data — is destroyed, and the
wiped conversations cannot silently reappear, including from a live inbound message
that arrives right after the reset.

**Why this priority**: A reset that leaves a way for a hidden chat to re-appear
breaks the plausible-deniability promise; it is a real bug in the current code.

**Independent Test**: Hide a chat, reset hidden chats, then send a message from the
peer and confirm no chat (hidden or visible) re-materializes from that inbound
message and no notification reveals the peer.

**Acceptance Scenarios**:

1. **Given** hidden chats and a PIN exist, **When** the user confirms reset, **Then**
   the hidden set, PIN, and hidden conversations' local data are all destroyed.
2. **Given** a chat was just reset, **When** a new message for that conversation
   arrives over the live relay, **Then** it does not re-create the conversation as a
   visible chat and reveals nothing about the peer.

---

### User Story 6 - Robust, no-flash, no-collateral behaviour (Priority: P2)

Hidden state is consulted correctly on every surface. During the brief window
before the hidden set decrypts at cold start, hidden chats never flash into view,
yet the app never over-suppresses: visible chats, their unread counts, and their
notifications all behave normally throughout.

**Why this priority**: The fail-closed logic exists today but over-reaches in at
least one place (whole-badge suppression), and a stray NUL byte in a core data file
signals latent fragility.

**Independent Test**: Cold-start the app with hidden chats present and confirm no
hidden row ever paints; simultaneously confirm visible chats and their badges are
correct from the first frame.

**Acceptance Scenarios**:

1. **Given** hidden chats exist, **When** the app cold-starts, **Then** no hidden
   chat is ever briefly visible in the list, search, or badge.
2. **Given** the hidden set has not yet decrypted, **When** the chat list and badge
   render, **Then** visible chats and their unread counts are shown correctly (no
   collateral blanking of the whole list or badge).

---

### Edge Cases

- **Hiding when a hidden chat already exists for the peer**: blocked with a clear
  reason; never produces two hidden chats with the same person.
- **Starting a new chat when only a hidden chat exists**: resolves to a fresh
  visible conversation, never silently reopens or reveals the hidden one, and never
  requires the PIN to create the visible one.
- **Inbound message for a hidden 1:1**: lands in the existing hidden conversation
  (silently), and never spawns a duplicate visible chat for that peer.
- **Inbound message after reset**: does not re-materialize the wiped conversation.
- **Reveal expiring mid-interaction**: relocking while a revealed hidden chat is
  open on screen navigates away to the Chats list immediately; nothing hidden stays
  visible past the grace window.
- **Unhide when a visible chat exists**: blocked with a clear reason; the user must
  delete the visible chat first. Histories are never merged.
- **Silent-push subscription safety**: hidden-chat handling never swallows a
  push-woken delivery without showing a notification, so the platform never revokes
  the push subscription.
- **Group chat hidden**: the same hide/reveal/relock and notification rules apply to
  a hidden group; the one-hidden-one-visible rule is defined per person for 1:1s and
  per conversation for groups.
- **Badge preference `never`/`revealed` during the pre-decrypt window**: the visible
  unread total is still correct; only hidden unreads are withheld.
- **Wrong PIN entered repeatedly**: no lockout signal, no oracle, no state change.

## Requirements *(mandatory)*

### Functional Requirements

**Hiding and the per-person model**

- **FR-001**: The system MUST provide a user-reachable "Hide chat" action on a
  conversation (available only when the Hidden Chats feature is enabled).
- **FR-002**: Hiding a chat MUST move that conversation into the hidden set so it is
  removed from every visible surface (chat list, search, pickers, Calls/call
  history) and, if it was the only chat with that person, leave nothing visible for
  that person until reveal.
- **FR-003**: The system MUST allow at most one hidden and one visible chat per
  person (per 1:1 peer). It MUST block the Hide action on a visible chat when a
  hidden chat with that same person already exists, with a clear user-facing reason.
- **FR-004**: The system MUST let a user start a fresh visible conversation with a
  person for whom only a hidden chat exists, creating a new, independent visible
  chat without revealing or reopening the hidden one and without requiring the PIN.
- **FR-005**: Coexisting hidden and visible chats with the same person MUST route
  messages independently: a message sent or received in one thread MUST appear only
  in that thread and never leak into or duplicate the other. (The plan MUST define
  the channel mechanism, given Ring keeps one Double Ratchet session per peer; the
  existing distinct-conversation channel — a group-modeled conversation created via
  `startHiddenChat`/`createGroup`, currently only reachable from the test harness —
  is the expected basis, and MUST be wired into a real, user-reachable flow.)
- **FR-006**: The system MUST provide an "Unhide chat" action that returns a hidden
  conversation to visible. If a visible chat with the same person already exists,
  unhide MUST be blocked with a clear user-facing reason (the user must first delete
  the visible chat); histories are never merged and the one-visible-per-person
  invariant is never broken.

**Reveal, relock, PIN**

- **FR-007**: The system MUST reveal hidden chats only when the correct dedicated
  hidden PIN is entered via the Chats search bar, and MUST visually mark revealed
  chats and sort them to the top while revealed.
- **FR-008**: A wrong PIN MUST reveal nothing and MUST NOT produce any visible,
  audible, or timing signal that distinguishes wrong from right (no oracle).
- **FR-009**: Revealed state MUST persist only in memory, survive a short
  configurable grace window across quick app-switches, and relock after the grace
  window, when the keystore auto-locks, or on any full app close. Relock MUST take
  effect immediately everywhere: if a hidden chat is open on screen when relock
  triggers, the app MUST navigate away from it to the Chats list at once.
- **FR-010**: The hidden PIN MUST be verified without any recoverable copy of the
  PIN and without a fast comparison path (verification is decrypt-succeeds only).
- **FR-011**: The system MUST support creating and changing the hidden PIN, and a
  destructive reset (see FR-018).

**Notifications, calls, badge (the privacy contract)**

- **FR-012**: While a chat is hidden and relocked, message notifications MUST reveal
  no sender name, avatar, content, or preview, overriding preview, mention, and mute
  settings — split by delivery path:
  - **Push-woken (service-worker) deliveries** MUST show a generic notification
    byte-identical to the global previews-off notification ("Ring / New message" →
    Chats tab), because silently swallowing a push risks the platform revoking the
    push subscription for all chats; bursts MUST coalesce into a single generic
    banner with no count.
  - **Every path the platform does not force** — app in the foreground, or
    backgrounded but still connected without a push wake — MUST be fully silent
    (no banner, no sound); only the badge updates per preference.
- **FR-013**: A live incoming call from a hidden-chat peer MUST ring with full
  caller identity (name + avatar) and be answerable normally (the "knock-knock
  call"). Calls are never suppressed by hiding.
- **FR-014**: While relocked, call history MUST NOT show any entry that reveals a
  hidden peer or hidden conversation.
- **FR-015**: The badge / unread count MUST honour the user's hidden-badge
  preference (`always` counts hidden unreads, `never` excludes them, `revealed`
  counts them only while revealed) and MUST NOT, under any preference or timing,
  suppress the unread count of unrelated visible chats.
- **FR-016**: Any pre-answer or notification surface that today attempts a partial
  "no-preview" treatment for hidden-chat *calls* MUST be reconciled with FR-013
  (calls show full identity); dead or contradictory half-built call-preview
  suppression MUST be removed.

**Robustness, security, zero-knowledge**

- **FR-017**: Every surface that consults hidden state (list, search, notifications,
  call history, badge) MUST fail closed so hidden chats never flash into view before
  the hidden set decrypts, while never collaterally hiding unrelated visible data.
- **FR-018**: Resetting hidden chats MUST destroy the hidden set, the PIN, and the
  hidden conversations' local data, and MUST prevent a wiped conversation from
  re-materializing — including from a live inbound message arriving over the relay
  immediately after reset (the tombstone/re-sync block MUST cover the live
  message-relay path, not only the own-data sync path).
- **FR-019**: The hidden set, hidden lock state, and PIN MUST never leave the device
  and MUST never appear in any client→server request or sync payload; the server
  MUST gain no signal that hiding is enabled, that a chat is hidden, or that a PIN
  exists.
- **FR-020**: The stray NUL byte in the core data-layer file (`src/db/queries.ts`)
  MUST be removed and the file kept as clean UTF-8 text.
- **FR-021**: The hide / reveal / relock / unhide / reset transitions and the
  per-person one-hidden-one-visible invariant MUST be implemented as a deterministic,
  unit-tested state machine.

**Testing**

- **FR-022**: All behaviours in this spec MUST be covered by Playwright — both
  `e2e/` tests and `drive/` scenarios — including: hide-moves-and-vanishes; reveal
  via search PIN; relock after grace and across restart; coexistence of one hidden +
  one visible with the same person; Hide blocked when a hidden chat already exists;
  incoming call from a hidden peer rings with full identity while messages stay
  suppressed; notification suppression (generic/silent); badge across
  `always`/`never`/`revealed`; reset wipes and blocks re-materialization from a live
  inbound message; and no cold-open flash of hidden chats.
- **FR-023**: Existing vitest unit tests for hidden chats MUST stay green and be
  extended to cover the new per-person invariant and the fixed bugs.

### Key Entities *(include if feature involves data)*

- **Hidden set**: The device-local, at-rest-sealed set of conversation ids that are
  hidden. Never synced; readable while the app is unlocked so hidden chats can be
  excluded by default.
- **Hidden PIN**: A dedicated PIN (separate from the app passcode) whose only role is
  gating reveal; stored as a verifier that cannot be reversed to the PIN and has no
  fast-compare path.
- **Reveal session**: In-memory-only state that hidden chats are currently revealed,
  with a grace timer; destroyed on relock, keystore auto-lock, or full app close.
- **Conversation (chat)**: A 1:1 or group thread with its own id and history. Per
  person there may be at most one hidden and one visible conversation; the two
  coexisting threads are distinct channels routed independently.
- **Tombstone**: A local-only marker that a conversation was reset/wiped, consulted
  on both the own-data sync path and the live message-relay path to block
  re-materialization.
- **Badge preference**: The user's choice (`always` / `never` / `revealed`) for how
  hidden unreads contribute to the app badge and unread totals.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

- **What crosses the wire**: Nothing new. Hiding, unhiding, revealing, relocking,
  the per-person limit (including a blocked hide/unhide), and reset add no new
  client→server request, field, or payload. Messages for hidden
  chats continue to flow as the same sealed envelopes as any other chat; the server
  cannot distinguish a hidden chat from a visible one.
- **What is encrypted / protected**: The hidden PIN is never stored in recoverable
  form; the hidden set and lock state are protected at rest on the device
  (consistent with Ring's PIN-derived at-rest wrapping), so the hidden designation
  cannot be read off the device without the PIN.
- **Coexisting conversations**: A second, distinct conversation between the same two
  people is — to the server — just another opaque conversation it already relays.
  Group membership is encrypted and invisible to the server, so it cannot tell that
  two conversations share participants, nor which (if any) is hidden.
- **Calls**: The knock-knock call rides the existing call signalling/relay unchanged;
  showing full caller identity is a purely local rendering choice and adds no server
  signal. Hiding a call from history is a local-only concern.
- **Notifications**: The push path already carries no plaintext to the server; the
  generic/silent rule is enforced entirely on the client when rendering, so the
  guarantee does not depend on the server.
- **Reset**: Wiping local hidden state and tombstoning conversations is entirely
  on-device; the server is not told anything was reset.
- **Why this is safe**: This remains a client-only visibility layer over content that
  is already end-to-end encrypted. It never introduces a new thing for the server to
  know.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: While relocked, a hidden chat appears in **zero** user-facing surfaces
  (Chats, search, pickers, Calls/call history, badge per preference), verified across
  all of them — including missed calls.
- **SC-002**: 100% of hidden-chat message deliveries follow the FR-012 split: fully
  silent (badge only) on non-push paths, and on push-woken paths a notification
  byte-identical to the global previews-off generic — no sender, avatar, content, or
  preview — including offline-queued and burst cases (bursts coalesce to one banner).
- **SC-003**: 100% of incoming calls from a hidden-chat peer ring with full caller
  identity and are answerable, verified in an automated call test.
- **SC-004**: A person can have exactly one hidden and one visible chat; attempting a
  second hidden chat with the same person is blocked 100% of the time, and the two
  coexisting threads never cross-contaminate messages (0 leaks across ≥100 test
  messages).
- **SC-005**: After a reset, a wiped conversation re-materializes in **0** cases,
  including when a live inbound message arrives immediately after reset.
- **SC-006**: Across ≥20 cold starts with hidden chats present, a hidden chat flashes
  into view in **0** of them, while the visible chat list and badge are correct from
  the first frame in 100% of them.
- **SC-007**: A wrong PIN yields no distinguishable outcome (visual, audible, or
  timing) in 100% of attempts.
- **SC-008**: All new and existing hidden-chat unit tests and the Playwright e2e +
  drive scenarios listed in FR-022 pass in CI.

## Assumptions

- **Coexistence channel**: True simultaneous hidden + visible chats with the same
  person are realized with two distinct crypto channels — the per-peer 1:1 Double
  Ratchet channel and a separate group-modeled conversation — because a single peer
  has exactly one 1:1 ratchet channel. The plan will decide which of the two threads
  uses which channel and how the "fresh visible chat" is created; the existing
  `startHiddenChat`/group mechanism is assumed available and correct as the basis.
- **Fresh visible chat is user-initiated**: When only a hidden chat exists for a
  person, a new visible chat is created only by an explicit user action (starting a
  conversation), not automatically from an inbound message (which stays in the hidden
  thread).
- **Badge default**: The default badge preference remains `always` (hidden unreads
  counted), matching current behaviour.
- **Grace window default**: Unchanged from the shipped default (short grace, e.g. one
  minute), configurable in settings.
- **Reuse of existing primitives**: Hiding continues to use the existing device-local
  sealed hidden set + dedicated-PIN verifier + in-memory reveal session, and the
  existing search-bar reveal gesture — this spec fixes and extends them rather than
  replacing them.
- **Scope of "person"**: The per-person one-hidden-one-visible rule is defined for
  1:1 conversations keyed by peer identity; group conversations are hidden/revealed
  individually.

## Out of Scope

- **Biometric unlock**: Optional biometric reveal (1019 US6, never implemented) stays
  deferred. This spec does not add it; it MUST also remove or neutralize dangling
  references to an unimplemented biometric path so the codebase and tests are
  consistent.
- Syncing hidden state across a user's own devices.
- A separate encrypted media "vault" distinct from hidden chats.
- Server-side awareness or enforcement of hiding.
- Disappearing-messages behaviour specific to hidden chats.
