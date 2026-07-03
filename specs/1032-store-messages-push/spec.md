# Feature Specification: Messages store on push so the app opens warm

**Feature Branch**: `feat/1032-store-messages-push`

**Created**: 2026-07-03

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "When a web push notification arrives while the Ring app is
closed, the service worker should not just preview the queued messages read-only — it should
pull them, decrypt them, store them directly into the device database, show the notification
in detailed or generic mode per the existing privacy rules, and then acknowledge the frames
to the server. When the user later opens the app, it opens fully warm — chats list, unread
pills, and tab badges already correct at first paint. On open, the app still checks for and
pulls anything that was missed during push notification events."

## Context: what happens today

When a message arrives while the app is closed, the push wakes the device's background
worker, which fetches the waiting sealed messages and decrypts them just enough to show a
notification — then throws the result away. Nothing is saved. The messages are saved only
later, when the user opens the app and it reconnects. The visible symptom this spec removes:
the app opens "cold" — the chats list, per-chat unread pills, and tab badges lag for a
moment while the app re-fetches and re-decrypts everything the notification already handled,
and the app-icon badge can briefly disagree with the badges inside the app.

Ring is a single-device-per-user product: registering the app on a new device replaces the
old device's push registration, so exactly one device is ever woken for a user's messages.
This is what makes it safe for that device to confirm receipt on the server's behalf while
the app is closed.

## Clarifications

### Session 2026-07-03

- Q: Should the rollout setting be user-visible in Settings, or an internal flag? → A:
  Internal flag — a hidden device-local flag, not in the Settings UI. Enabled via dev
  tooling on the development deployment during the soak, then flipped default-on in a later
  release and eventually removed. Notification-time storage is a delivery mechanism, not a
  user preference.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app opens warm (Priority: P1)

I got message notifications while my phone was in my pocket. When I open Ring, everything is
simply there: the conversations are already in place with the new messages in them, the
chats list shows the right previews and unread counts, and the badges inside the app match
the badge I saw on the app icon. There is no visible catch-up or re-fetch.

**Why this priority**: This is the reported gap — the work of receiving a message is done
twice today (once for the notification, again on open), and the user sees the seam. Storing
messages when the notification arrives is the whole point of the feature.

**Independent Test**: With account B's app closed (and A connected), A sends B two messages.
B's device shows notifications. Before the app reconnects to the server, verify on B's
device that both messages are stored locally, the chat's unread count is 2, and the server
no longer holds the two frames as pending. Open the app with networking delayed: the chat
list and both messages render correctly from local data alone.

**Acceptance Scenarios**:

1. **Given** B's app is closed and B receives push notifications for two messages from A,
   **When** B opens the app, **Then** the chats list already shows A's chat on top with the
   correct preview and unread count of 2, before any server round-trip completes.
2. **Given** messages were stored at notification time, **When** the app later connects and
   the server re-checks for pending messages, **Then** no duplicates appear — each message
   exists exactly once and unread counts are unchanged.
3. **Given** a message carrying a photo arrives while the app is closed, **When** the user
   opens the app, **Then** the message is already in the conversation and the photo loads
   (its download may complete after open; the message itself is never missing).
4. **Given** the app-icon badge showed N after a burst of notifications, **When** the user
   opens the app, **Then** the total of the in-app badges equals N.

---

### User Story 2 - Privacy behavior is unchanged (Priority: P2)

Notifications keep behaving exactly as I configured them. If my app is protected by a PIN or
passkey, notifications stay generic ("New message") and nothing is stored while locked. If a
conversation is hidden or set to generic previews, its notifications stay generic. Nothing
about this feature sends any readable content to the server — it only changes when my own
device does its local bookkeeping.

**Why this priority**: This feature touches the message-receiving pipeline, which is the
most privacy-sensitive path in the product. It must be provably behavior-preserving for
every privacy posture before the convenience is worth anything.

**Independent Test**: Enable the PIN lock on B; A sends a message. Verify B's notification
is generic, nothing new is stored locally while locked, and the message is still waiting on
the server; unlock and open — the message arrives through the normal open-the-app path.
Repeat with a hidden conversation: generic notification, no readable preview anywhere.

**Acceptance Scenarios**:

1. **Given** B has a PIN/passkey lock, **When** a message arrives while the app is closed,
   **Then** the notification is generic, nothing is stored, the server still holds the
   message, and opening + unlocking the app delivers it exactly as today.
2. **Given** a conversation is configured for generic previews (e.g. hidden chats), **When**
   a message in it arrives while the app is closed, **Then** the notification shows no
   sender or content, matching today's behavior.
3. **Given** any message handled by this feature, **When** it is stored and confirmed,
   **Then** the server has seen only the same sealed data and receipt signals it sees today
   — no readable content, no new metadata.

---

### User Story 3 - Nothing is lost, nothing is doubled (Priority: P3)

Whatever happens — the background work is cut short mid-way, the message is an unusual kind
the background path doesn't handle, my device has no support for the required coordination —
the outcome is never worse than today: the message waits on the server and arrives when I
open the app. And a message is never applied twice, even when the background path and the
open-app path both see it.

**Why this priority**: Guard rails. The feature's value is convenience; its risk is
correctness of message delivery. Every failure path must degrade to today's shipped
behavior, and the two delivery paths must agree on exactly-once application.

**Independent Test**: Simulate each fallback: a message from a stranger (first contact), a
reaction/edit/control frame, an interrupted background run, and the open-app path racing the
background path. In every case the end state is: every message present exactly once, unread
counts correct, server queue empty only for messages that are safely stored.

**Acceptance Scenarios**:

1. **Given** the background handling is interrupted before a message is safely stored,
   **When** the user opens the app, **Then** the message is delivered through the normal
   open-the-app path — never lost, never half-applied.
2. **Given** a message was safely stored but its receipt confirmation to the server was
   interrupted, **When** the message is presented again, **Then** the device recognizes it
   as already applied, confirms it, and stores nothing twice.
3. **Given** a message the background path does not handle (first message from a new
   contact, reactions, edits, group/contact cards, control messages), **When** it arrives
   while the app is closed, **Then** the user still gets the same notification as today and
   the message is applied when the app opens.
4. **Given** the app is already open and visible when a push arrives, **Then** the app
   handles it exactly as today (in-app banner, immediate storage) and the background path
   stays out of the way.

---

### Edge Cases

- Background work cut short by the platform mid-run (workers get only seconds): any message
  not yet safely stored simply waits on the server; any message stored but not yet confirmed
  is recognized and confirmed later without duplication.
- A large backlog (more than one fetch's worth of pending messages): the background path
  stores what it fetched; the remainder arrives on open. No ordering anomalies visible to
  the user.
- The app is open-but-frozen in the background (e.g. iOS suspends it) while a push arrives:
  the background path must not fight the frozen app for shared state; if it cannot proceed
  promptly it falls back to notification-only for that wake.
- The app is alive in the background while the background path stores messages: the app's
  views must reflect the new data when it comes back to the foreground (no stale chat list
  contradicting the notification the user just tapped).
- Device/browser lacks the required cross-context coordination capability: the feature
  silently stays off; behavior is exactly today's.
- A message arrives while the user is mid-call (the call and the message share the same
  secure channel per contact): storing the message must never disrupt the call's signalling.
- Storage full / write failure: nothing partial is kept, no confirmation is sent, the
  message waits on the server.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a push arrives while no app window claims it, the device MUST fetch the
  waiting messages and, for eligible ones (see FR-004), store them locally — the message
  itself, the conversation's updated preview/recency, and its unread count — before the app
  is next opened.
- **FR-002**: The device MUST confirm receipt of a message to the server only after that
  message is durably stored locally; messages never confirmed remain on the server and are
  delivered on next app open.
- **FR-003**: Message application MUST be exactly-once across both delivery paths
  (notification-time and app-open): re-presentation of an already-applied message results in
  re-confirmation only, with no duplicate row and no double unread count.
- **FR-004**: Eligible for notification-time storage: ordinary messages (text, and media
  references whose bytes may download later) in existing conversations from existing
  contacts, including group messages. Everything else (first contact, contact/group cards,
  reactions, edits, deletions, poll votes, control messages) MUST fall back to today's
  notification-only handling and be applied on app open.
- **FR-005**: All local bookkeeping (message store, conversation summaries, unread counts,
  the secure-channel state advance, and the exactly-once ledger) for one message MUST be
  committed atomically — an interruption leaves either the complete result or nothing.
- **FR-006**: The notification shown MUST follow the existing privacy rules unchanged:
  detailed or generic per app-level and per-conversation settings; on a PIN/passkey-locked
  device the background path MUST NOT decrypt or store anything and MUST show today's
  generic notification.
- **FR-007**: The two contexts that can update the secure channel with a contact (the open
  app and the background worker) MUST never do so concurrently; coordination MUST be
  device-local, and if the background path cannot acquire its turn promptly it MUST fall
  back to notification-only handling for that wake.
- **FR-008**: Every failure or unsupported-capability path (no coordination primitive, lock
  timeout, decrypt failure, storage failure, interrupted run) MUST degrade to exactly
  today's shipped behavior for the affected messages.
- **FR-009**: After notification-time storage, the app-icon badge and the in-app badge
  totals MUST agree; messages already stored MUST NOT be counted twice in any badge.
- **FR-010**: An app window that is alive (foreground or background) while the background
  path stores messages MUST reflect the new data in its views without requiring a reload.
- **FR-011**: The feature MUST ship behind an internal device-local flag (not exposed in
  the Settings UI), default off, so it can be proven on the development deployment before
  being enabled broadly; with the flag off, behavior is byte-for-byte today's. The flag is
  a rollout vehicle, expected to become default-on and eventually be removed.
- **FR-012**: The server MUST require no changes and MUST see no new information: the same
  sealed messages, the same fetch, the same receipt confirmations — only their timing
  changes. The zero-knowledge boundary is untouched.

### Key Entities

- **Queued message (frame)**: a sealed envelope waiting on the server for this user; deleted
  from the server only when the device confirms durable receipt.
- **Conversation summary**: the chat's preview line, recency ordering, and unread count —
  what the chats list renders at first paint.
- **Exactly-once ledger**: the device's record of which frames have been applied, shared by
  both delivery paths; the arbiter that prevents duplication.
- **Secure-channel state**: the per-contact cryptographic state that advances as messages
  are received; exactly one context may advance it at a time.
- **Deferred frame**: a queued message the background path chose not to apply (ineligible or
  failed); it keeps today's notification behavior and is applied on app open.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After receiving messages while the app is closed, opening the app shows the
  correct chats list (ordering, previews, unread counts) at first paint with zero network
  round-trips required for those messages.
- **SC-002**: 100% of messages handled at notification time appear exactly once after the
  app opens and reconnects — zero duplicates, zero double-counted unread, across all tested
  interruption points.
- **SC-003**: Zero message loss in every fallback and failure scenario: any message not
  durably stored remains deliverable on app open (interrupted runs, storage failures,
  locked devices, ineligible types).
- **SC-004**: The app-icon badge and the sum of in-app badges agree immediately on open in
  100% of tested notification scenarios.
- **SC-005**: For every privacy posture (default, generic previews, hidden conversations,
  PIN/passkey lock), notification content is identical to today's behavior.
- **SC-006**: With the feature setting off, all existing message, notification, and call
  test suites pass unchanged.

## Assumptions

- Single device per user is a product invariant: registering push on a new device replaces
  the previous device's registration, so no second device can be push-woken to confirm (and
  thereby consume) this user's queued messages. If multi-device ever ships, this feature's
  confirmation rule must be revisited first.
- Confirming receipt at notification time gives the stored copy the same durability class as
  messages received with the app open today (device-local storage); the server's queue
  (with its multi-week retention) continues to back only unconfirmed messages. This is
  accepted as symmetric with existing behavior, not a regression.
- The existing receipt-confirmation channel is idempotent and usable outside an open app
  session; no server work is planned.
- The device platforms that support Ring's push notifications also support the required
  device-local cross-context coordination; where they don't, the feature silently stays off.
- The approved design (locking discipline, atomic commit, eligibility list, fallback
  ladder) recorded in the implementation plan accompanying this spec is the agreed technical
  approach; this spec intentionally describes outcomes, not mechanisms.
- v1 eligibility deliberately excludes first-contact messages and non-message frames; the
  open-app path remains their delivery vehicle. Widening eligibility is future work.
