# Feature Specification: @mentions in group chats

**Feature Branch**: `feat/1020-mentions-group-chats`

**Created**: 2026-06-27

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "@mentions in group chats — tag members, mute-bypassing notifications, mention markers and jump-to-mention"

In a busy group, ordinary messages can be muted into the background. **Mentions** let a
sender call out a specific person (or, for admins, everyone) so that person is reliably
notified — even in a muted group — and can quickly find where they were called out.
Mentions are a group-chat concept only; a 1:1 conversation already has a single, obvious
recipient.

Ring is end-to-end encrypted and **zero-knowledge**: the server relays sealed envelopes
and fires content-free push tickles, and must never learn message contents. Everything
below is designed so that *who is mentioned* is known only to the participants' own
devices, never to the server.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tag a member and reach them even when muted (Priority: P1)

A member typing in a group wants to direct a message at one specific person. They type
`@`, pick that person from a member list, and send. The tagged person — even if they
muted the group — gets a notification telling them who mentioned them, and the message
shows the mention as a highlighted name.

**Why this priority**: This is the entire point of mentions and a self-contained MVP:
the sender-side compose loop plus the notification escalation. Without it, the rest
(markers, jump-to, @everyone) has nothing to act on.

**Independent Test**: In a group of three where the recipient has muted the chat, send a
message that mentions the recipient; confirm the recipient receives a notification naming
the sender, while a third, un-mentioned member (same muted group) receives none.

**Acceptance Scenarios**:

1. **Given** a group member composing a message, **When** they type `@`, **Then** an
   autocomplete of current group members appears (display name + @username to
   disambiguate), and selecting one inserts a mention of that member.
2. **Given** a sent message that mentions Bob, **When** Bob's device receives it, **Then**
   the mention renders as a highlighted, tappable name and (because Bob is mentioned) Bob
   is notified — **even if Bob muted the group** — with a notification identifying the
   sender and the group.
3. **Given** the same muted group, **When** a member who was NOT mentioned receives the
   message, **Then** they get no notification (the mute still holds for them).
4. **Given** Bob has muted the group AND set its notifications to "Badge only"/"No
   preview", **When** Bob is mentioned, **Then** the mention notification still surfaces
   and may name the sender (the mention overrides the per-chat content level).
5. **Given** Bob has turned the GLOBAL "Show notifications" master off (or the OS is in
   Do-Not-Disturb), **When** Bob is mentioned, **Then** no notification is shown (mentions
   do not override the global master or the OS).

---

### User Story 2 - See and jump to where I was mentioned (Priority: P2)

A member returning to the app wants to know which groups called them out and go straight
to the message, without scrolling a long history.

**Why this priority**: Mentions you can't find are easy to miss; this is the standard
Telegram-style payoff. It depends on US1 (there must be mentions to mark) but is otherwise
independent.

**Independent Test**: Mention a member, then on their device confirm the group's chat-list
row shows a distinct "@" marker and an unread-mentions count; open the chat and use the
jump-to-mention affordance to scroll to the mentioning message; confirm the marker/count
clear once the mention has been seen.

**Acceptance Scenarios**:

1. **Given** an unread message that mentions me, **When** I look at the chat list, **Then**
   that group's row shows a distinct "@" marker and a mention count that is **separate**
   from the normal unread-message count.
2. **Given** I open a chat that has unread mentions, **When** the chat opens, **Then** a
   "jump to mention" affordance is available, and using it scrolls to the (next) message
   that mentioned me.
3. **Given** I have seen the message(s) that mentioned me, **When** that happens, **Then**
   the "@" marker and the mention count clear for that chat.
4. **Given** a message that mentioned me is deleted (or I leave/am removed), **When** that
   happens, **Then** any pending mention marker/count for it is cleared.

---

### User Story 3 - Control mention escalation per chat (Priority: P2)

A member who is fine being pinged in most groups wants to silence even mentions in one
particularly noisy group.

**Why this priority**: The escalation must be controllable so it doesn't become its own
source of unwanted noise. Small, independent addition to US1.

**Independent Test**: In a muted group, toggle "Notify for mentions even when muted" off
for that chat, then have someone mention the member; confirm no notification arrives. Turn
it back on and confirm a mention notifies again.

**Acceptance Scenarios**:

1. **Given** a chat's notification settings, **When** I view them, **Then** there is a
   "Notify for mentions even when muted" control that is **on by default**.
2. **Given** that control is off for a muted chat, **When** I am mentioned there, **Then**
   I get no notification (only the normal badge/marker behavior).
3. **Given** that control is on, **When** I am mentioned in a muted chat, **Then** the
   mention notification surfaces per User Story 1.

---

### User Story 4 - Admin @everyone (Priority: P3)

A group admin needs to reach the whole group at once (e.g., an announcement), regardless
of individual mutes, without tagging each person.

**Why this priority**: Useful but secondary, and carries abuse/noise risk — hence
admin-only. Cleanly additive on top of US1's escalation rules.

**Independent Test**: As an admin, send `@everyone`; confirm every other member is notified
per the escalation rules (subject to each member's own per-chat toggle and global master);
confirm a non-admin has no `@everyone` option.

**Acceptance Scenarios**:

1. **Given** I am a group admin/owner composing a message, **When** I type `@`, **Then**
   `@everyone` is offered as an option; **Given** I am not an admin, **Then** it is not
   offered and I cannot send it.
2. **Given** an admin sends `@everyone`, **When** members receive it, **Then** each member
   is treated as mentioned and notified per the same escalation + per-chat-toggle + global
   master rules as an individual mention.
3. **Given** a non-admin's message that claims `@everyone`, **When** a recipient processes
   it, **Then** it is NOT honored as a broadcast mention (the sender's admin status is
   re-checked against the group roster on the recipient's device).

---

### Edge Cases

- **Member left / was removed after being mentioned**: the mention is retained in the
  message as sent; rendering falls back to the member's last-known name; no new
  notification is produced for a non-member.
- **Display-name change**: a mention is stored by stable member id and rendered with the
  member's CURRENT display name (consistent with how names resolve elsewhere).
- **Editing a message**: adding a mention on edit MAY notify the newly-mentioned member
  once; removing a mention does not retroactively un-notify.
- **Self-mention**: mentioning yourself never notifies you and does not raise a
  marker/count on your own device.
- **Blocked sender**: a mention from a blocked peer is dropped like any other message from
  them (no escalation).
- **Not yet decrypted (push path)**: if the service worker cannot decrypt the message, it
  shows the existing generic, content-free notification; once decrypted (foreground or a
  later fetch), mention escalation applies and may upgrade the generic notification.
- **Active in the chat**: being mentioned in the chat you're currently viewing does not
  raise a separate notification (you've seen it), but still resolves the mention marker.
- **Multiple unread mentions**: the count reflects how many unseen messages mention me;
  jump-to advances through them.

## Requirements *(mandatory)*

### Functional Requirements

**Composing**

- **FR-001**: In a group composer, typing `@` MUST open an autocomplete listing current
  group members, searchable by display name, with @username shown to disambiguate
  same-named members; 1:1 composers MUST NOT offer mentions.
- **FR-002**: Selecting a member from the autocomplete MUST insert a mention of that
  member into the message such that the recipient can render it and detect being
  mentioned.
- **FR-003**: A single message MUST be able to mention multiple distinct members.
- **FR-004**: `@everyone` MUST be offered in the autocomplete ONLY to group
  admins/owners, and a message MUST carry it as a distinct broadcast-mention indicator.

**Encoding (zero-knowledge)**

- **FR-005**: Mention targets (the set of mentioned member ids and/or the `@everyone`
  indicator) MUST be carried inside the end-to-end-encrypted message payload and MUST NOT
  be exposed to the server in cleartext or as metadata.
- **FR-006**: The server MUST NOT be given any new information about who is mentioned; the
  push tickle MUST remain content-free, exactly as for any other message.

**Rendering**

- **FR-007**: A mention MUST render in the message bubble as a visually-distinct,
  tappable element that opens the mentioned member's profile/contact view.
- **FR-008**: A mention of the current user MUST be visually emphasized (distinct from
  mentions of others) so a member can spot "this is about me" at a glance.
- **FR-009**: Mentions MUST render using the member's current display name, resolving by
  stable id (not by a name captured at send time).

**Notification escalation (recipient-side)**

- **FR-010**: When a received message mentions the current user (individually or via an
  honored `@everyone`), the system MUST escalate notification handling for that message:
  it MUST surface a notification **even if the chat is muted**.
- **FR-011**: A mention notification MUST be allowed to include who mentioned the user
  even when the chat's content level is set to "No preview"/"Badge only" (the mention
  overrides the per-chat content level).
- **FR-012**: Mention escalation MUST still respect the GLOBAL "Show notifications" master
  switch and the operating-system Do-Not-Disturb state — it MUST NOT override those.
- **FR-013**: Each chat MUST expose a "Notify for mentions even when muted" control,
  defaulting to ON; when OFF, a mention MUST NOT escalate past the chat's normal (muted)
  behavior.
- **FR-014**: A recipient MUST honor `@everyone` only when the sender is an
  admin/owner per the recipient's view of the group roster; otherwise it MUST be ignored
  as a broadcast (and not escalate).
- **FR-015**: Escalation MUST be applied entirely on the recipient's device and MUST work
  on BOTH the in-app/foreground path and the service-worker push path (once the message is
  decrypted).
- **FR-016**: A user MUST NOT be notified for mentioning themselves, nor for a mention in
  a chat they are actively viewing.

**Visual indicators & navigation**

- **FR-017**: A chat with one or more unseen mentions of the current user MUST show a
  distinct "@" marker on its chat-list row.
- **FR-018**: The system MUST track a per-chat unread-MENTIONS count that is separate from
  the normal unread-message count.
- **FR-019**: A chat with unseen mentions MUST offer a "jump to mention" affordance that
  scrolls to the (next) message mentioning the user.
- **FR-020**: The "@" marker and mention count for a chat MUST clear once the user has
  seen the mentioning message(s), and MUST also clear if those messages are deleted or the
  user is no longer a member.

### Key Entities *(include if feature involves data)*

- **Mention (within a message)**: the set of mentioned member ids and/or an `@everyone`
  indicator, carried inside the encrypted message payload. Empty for ordinary messages.
- **Unread-mention state (per chat, per device)**: whether the current user has unseen
  mentions in the chat, how many, and where the earliest unseen mention is (for
  jump-to) — derived locally from received messages, never shared with the server.
- **Per-chat mention preference**: "Notify for mentions even when muted" (default on),
  alongside the existing per-chat mute / content-level / notification settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a muted group, a mentioned member receives a notification that identifies
  the sender and group 100% of the time when the global notifications master is on and the
  per-chat mention toggle is on; a non-mentioned member of the same muted group receives
  none.
- **SC-002**: With the per-chat "mentions even when muted" toggle OFF, a mention produces
  no notification (only the normal badge/marker), 100% of the time.
- **SC-003**: With the global "Show notifications" master OFF (or OS DND), a mention
  produces no notification, 100% of the time.
- **SC-004**: A member can find a message that mentioned them via the chat-list "@" marker
  and jump-to-mention in at most two taps, without manual scrolling.
- **SC-005**: `@everyone` is selectable only by admins/owners; a forged `@everyone` from a
  non-admin is never honored as a broadcast by recipients.
- **SC-006**: The server stores and relays the same opaque ciphertext + content-free push
  as for a non-mention message — an audit of server-visible data reveals nothing about who
  was mentioned (verifiable: no plaintext mention field crosses the wire).
- **SC-007**: The unread-mentions count and "@" marker reflect exactly the unseen mentions
  and clear when those messages are seen/deleted.

## Zero-Knowledge Impact

<!-- Required by Constitution Principle I for anything crossing the client/server boundary. -->

- **What the server sees**: unchanged. The message (including its mention data) is sealed
  client-side; the server stores/relays opaque ciphertext and emits the existing
  content-free push tickle. The server is never told who is mentioned, that a chat is
  muted, or that an escalation occurred.
- **Where the logic runs**: mention detection and notification escalation happen only on
  the recipient's device, after decryption, in the client's notification-policy layer
  (the same layer the foreground app and the service worker already share). The service
  worker's push handling continues to show a generic notification when it cannot decrypt,
  and upgrades to a mention notification only after a successful local decrypt.
- **No new server signal**: there is no server-side "mention" concept, no per-recipient
  flag, and no change to push payloads — so the addition cannot leak mention targets or
  mute state to the server or to a network observer beyond what an ordinary message
  already reveals (a sealed envelope to an existing recipient set).
- **`@everyone` trust**: admin/owner gating is enforced on the sender's device at compose
  time and **independently re-validated** on each recipient's device against the group
  roster; the server does not mediate or learn about it.
- **Local-only state**: the unread-mention markers/counts and the per-chat mention
  preference are device-local (the preference rides the existing encrypted own-data sync
  like other per-chat settings); none of it is exposed to the server in cleartext.

## Assumptions

- Group membership and admin/owner roles already exist and are available to the client;
  this feature reads them, it does not define a new roles system.
- Per-chat mute, per-chat content level ("Message content" / "No preview" / "Badge only"),
  and the global "Show notifications" master already exist; mention escalation composes
  with them rather than replacing them.
- Mentionable targets are existing group members chosen from the autocomplete; free-text
  @handles for non-members are out of scope.
- Mentions are supported in text messages and media captions (anywhere a member types a
  message body); they are not a separate message type.
- An unread mention is considered "seen" when its message has been viewed in the chat
  (scrolled into view or the chat opened to it), consistent with jump-to-mention; opening
  the chat does not blanket-clear mentions the user hasn't actually reached.
- The per-chat mention toggle governs ALL mention escalation for that chat, including
  `@everyone`.
- OS-level Do-Not-Disturb and the global notifications master are respected and are not
  overridden by mentions.

## Out of Scope (v1)

- Mentions in 1:1 chats.
- Free-text mentions of people who are not group members.
- `@here`-style "only active members" broadcast, role/group-segment mentions, or
  rate-limiting/anti-spam policy for `@everyone` beyond the admin-only gate.
- Mention-driven search/filter views ("all my mentions across chats").
