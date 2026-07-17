# Feature Specification: Expanding "Jump to Latest" Pill + Visibility-Driven Seen Receipts

**Feature Branch**: `feat/1013-jump-pill-seen-receipts`

**Created**: 2026-06-19

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Instead of a corner badge, make the scroll-to-latest button grow from a circle into a wider pill (same circular caps) with the unread count inline; it grows as new messages arrive and shrinks back to a circle once they're seen. And as long as there are unseen messages, do not send the 'seen' report to the other party — only send the seen report for a message as it actually appears on screen; and when a message dated today is seen, also send the seen report for all older messages that haven't reported seen yet."

## Overview

This feature evolves the spec-1012 "scroll to latest" control and ties it to **when**
"Seen" receipts are sent, turning two everyday chat behaviors honest:

1. **The control becomes an expanding pill.** Today (spec 1012) the control is a small
   circular disc with a corner count badge. This replaces the corner badge with an
   *expanding* control: at rest (caught up) it is a plain circle showing only the
   down-chevron; when there are messages the user hasn't caught up to, it animates wider
   into a **stadium/pill** — the same fully-rounded caps on both ends — with the count
   shown **inline** next to the chevron. It grows as the count grows and shrinks smoothly
   back to a plain circle once the user has caught up.

2. **"Seen" is reported only for messages actually viewed.** Today the client sends a
   "Seen" receipt for **every** incoming message the moment the user **opens** the chat
   (`sendSeenReceipts` on open/foreground), even messages far above that the user never
   looked at. This changes the *trigger*: a message's Seen receipt is sent only once that
   message has **actually appeared on screen**. As a pragmatic catch-up, when the user
   views a message dated **today**, all older not-yet-reported messages are reported Seen
   too (so the user need not scroll through every old message to clear the backlog).

The two parts are coupled: the pill's count is precisely "messages the recipient hasn't
caught up to / reported Seen", so a glance at the pill says both "you have unread below"
and "the sender hasn't been told you've seen these yet".

**This is a privacy improvement, and the zero-knowledge boundary is unchanged.** Only the
*timing* of an existing receipt changes. The on-the-wire artifact is the same sealed
`receipt` envelope spec 1010 already relays (`{messageId, status:'seen', at, to}`); the
server still only routes opaque receipts and never sees message content. The existing
"Seen receipts" privacy toggle (spec 1010, default on, client-enforced) still gates all
sending: off ⇒ nothing is ever sent.

This builds directly on **spec 1011** (bounded chat-history scroll), **spec 1012**
(the scroll-to-latest control + `unreadSince` / boundary logic), and **spec 1010**
(durable "Seen" receipts, the `receipt` envelope, and the privacy toggle).

## Clarifications

### Session 2026-06-19

- Q: When does a message count as "seen on screen" (firing its Seen receipt)? → A: When
  **≥ 50%** of its bubble is in the viewport while the chat is foregrounded — no dwell
  timer; a thin sliver flying past during a fast fling does not fire it.
- Q: When the user brings on screen a message older than today that hasn't reported Seen,
  what is marked Seen? → A: **Catch up all older too** — viewing ANY message reports Seen
  for that message and every older not-yet-reported incoming message (a uniform "view ⇒
  everything older is seen" rule; the originally-described "today" catch-up is just the
  common case of this rule).
- Q: What does the pill's count represent? → A: **Incoming messages not yet reported
  Seen** — the pill shows how many messages the sender hasn't been told you've seen, and
  shrinks to a plain circle once all are reported.
- Q: When a chat has not-yet-Seen incoming messages, where does it open? → A: At the
  **first not-yet-Seen message** (an unread-divider style landing), not the newest — so the
  catch-up rule advances Seen as the user reads downward (refines spec-1011's
  open-at-bottom for the unread case only).
- Q: Does the recipient's per-message "seen" state persist across app restarts? → A:
  **Yes — persisted locally** (a per-incoming-message "seen-reported" flag), so the pill
  count is stable across restarts and the client does not re-send Seen on reopen. Small
  local storage change (a DB version bump); the wire/server are unaffected.
- Q: What counts as the chat being "foregrounded" for sending Seen? → A: The **chat view
  is the active route and the document is visible** (mobile app foregrounded). Desktop
  window-blur while the tab stays visible still counts; backgrounded/hidden does not.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The control expands to show how far behind you are (Priority: P1) 🎯 MVP

While reading older messages, the user sees the floating control. When new messages they
haven't caught up to exist, the control is a pill showing the count inline (e.g. a chevron
followed by "3"); as more arrive it grows; once the user catches up it shrinks back to a
plain circle (chevron only). Tapping it still returns to the newest / first not-yet-Seen message.

**Why this priority**: This is the headline visible change and is independently shippable
as a pure client-side refinement of the spec-1012 control — it delivers value even before
the receipt-timing change.

**Independent Test**: Open a long chat, scroll up; with no new messages the control is a
plain circle (chevron only). Have the peer send 3 messages → the control animates into a
pill showing "3". Tap it → it returns to the messages and shrinks back to a circle.

**Acceptance Scenarios**:

1. **Given** the user is caught up (at the bottom), **When** the control is shown by
   scrolling up, **Then** it is a plain circle with only the chevron (no count, no pill).
2. **Given** the user is scrolled up, **When** N (N≥1) not-yet-Seen incoming messages exist,
   **Then** the control is a pill with the count shown inline next to the chevron, with
   the same rounded caps on both ends.
3. **Given** the pill shows a count, **When** more not-yet-Seen messages arrive, **Then** the
   count updates and the pill grows to fit it (capped display, e.g. `99+`).
4. **Given** the pill shows a count, **When** the user catches up (count returns to 0),
   **Then** the control animates back down to a plain circle.
5. **Given** the control changes between circle and pill, **When** it animates, **Then**
   the transition is smooth and does not overlap the composer or shift surrounding content.

---

### User Story 2 - The sender isn't told "Seen" until you've actually seen it (Priority: P1)

A recipient opens a chat but does not scroll up to older unviewed messages. The sender is
**not** told those older messages were seen. Only the messages the recipient actually
brings on screen are reported as Seen.

**Why this priority**: This is the core privacy correctness change and the main reason for
the feature; "Seen" should mean *seen*, not *chat opened*.

**Independent Test**: With sender S and recipient R: S sends several messages while R is
away. R opens the chat but stays at the newest message without scrolling to the older
ones. Confirm on S that only the messages visible on R's screen show as Seen, and the
older ones do not — until R scrolls them into view.

**Acceptance Scenarios**:

1. **Given** unseen incoming messages exist above the viewport, **When** the user opens
   the chat but does not scroll them into view, **Then** no Seen receipt is sent for those
   off-screen messages (the sender keeps them as merely delivered).
2. **Given** an unseen incoming message off screen, **When** the user scrolls it into
   view, **Then** a Seen receipt is sent for that message and the sender reflects it as Seen.
3. **Given** a message already reported Seen, **When** it scrolls in and out of view
   again, **Then** no duplicate receipt is sent.
4. **Given** the "Seen receipts" privacy toggle is off, **When** any message appears on
   screen, **Then** no Seen receipt is ever sent (the toggle still fully suppresses).

---

### User Story 3 - Reading down catches up older messages (Priority: P2)

When the user brings any message on screen, that message and all older not-yet-reported
messages are reported Seen — so reading downward naturally clears the backlog and the user
need not dwell on every single older message. (Reaching today's messages is the common
case of this uniform rule.)

**Why this priority**: A usability/honesty refinement on top of US2: advancing to a newer
message is a reasonable signal the user has caught up on everything above it.

**Independent Test**: Seed a chat with a backlog of unseen messages. Bring a message that
is partway down (≥50% visible) on screen. Confirm that message and all older
not-yet-reported messages are reported Seen on the sender, while messages still below
(newer, off screen) remain not-yet-Seen.

**Acceptance Scenarios**:

1. **Given** a backlog of unseen incoming messages, **When** a message partway down
   becomes ≥50% visible, **Then** that message and all older not-yet-reported messages are
   reported Seen, and newer off-screen messages are not.
2. **Given** the backlog up to some point was caught up, **When** the user later scrolls
   back up to those older messages, **Then** no duplicate receipts are sent.

---

### Edge Cases

- **Backgrounded / unfocused**: messages "on screen" while the app/tab is backgrounded or
  the device is locked are not considered viewed and trigger no receipts until the chat is
  actually foregrounded.
- **Privacy toggle off**: counting/pill still works locally (a local affordance), but
  nothing is ever sent — reciprocity unchanged (spec 1010).
- **Offline**: receipts that can't be sent (offline) are retried; viewing while offline
  must not lose the "needs seen receipt" intent once connectivity returns.
- **Groups**: each incoming message is addressed to its own author (spec 1010); the
  visibility trigger and today-catch-up apply per message exactly as in 1:1.
- **Own messages / deleted messages**: never counted in the pill and never generate a Seen
  receipt (outgoing/own and deleted are excluded, consistent with spec 1012's `unreadSince`).
- **Very large backlog**: the pill caps its displayed count (e.g. `99+`) but catch-up
  still reports Seen for all older not-yet-reported messages.
- **Rapid scroll / fling past messages**: a message counts as "appeared on screen" only
  when **≥ 50%** of its bubble is in the viewport, so a thin sliver flying past during a
  fast fling does not fire a Seen receipt (resolved 2026-06-19).
- **Opening at the bottom vs. at the first unread**: because viewing the newest message
  catches up the entire older backlog (uniform rule), where the chat lands on open
  determines whether the backlog is marked Seen immediately; the assumed behavior is to
  open at the first not-yet-Seen message (see Assumptions / Clarifications open item).

## Requirements *(mandatory)*

### Functional Requirements

**The expanding pill control (US1)**

- **FR-001**: The scroll-to-latest control MUST render as a plain circle (chevron only,
  no count) whenever the not-yet-Seen count is zero.
- **FR-002**: When the not-yet-Seen count is ≥ 1, the control MUST render as a pill (a single
  shape with fully-rounded caps on both ends) with the count shown **inline** beside the
  chevron — not as a separate corner badge.
- **FR-003**: The control MUST animate smoothly between the circle and the pill as the
  count changes (grow when it increases, shrink to a circle when it returns to zero), with
  no overlap of the composer and no layout shift of surrounding content.
- **FR-004**: The displayed count MUST cap for display (e.g. `99+`) while the underlying
  catch-up logic still applies to all messages.
- **FR-005**: The control MUST keep the spec-1012 appearance/behavior otherwise: hidden
  near the bottom, fades in when scrolled up, theme-inverted translucent (frosted) disc
  with a solid icon, bottom-trailing above the composer, correct in LTR/RTL and
  light/dark, accessible (labeled, adequate touch target). The accessible name MUST convey
  the count when shown.
- **FR-006**: Tapping the control MUST behave as in spec 1012 (return to the first
  not-yet-Seen message, else the newest).

**Visibility-driven Seen receipts (US2)**

- **FR-007**: A Seen receipt for an incoming message MUST be sent only after that message
  has actually appeared on screen — defined as **≥ 50% of its bubble visible** in the
  viewport while the chat is foregrounded — NOT merely because the chat was opened or
  foregrounded.
- **FR-008**: The system MUST NOT send a Seen receipt for an incoming message that has not
  appeared on screen (e.g. messages above the viewport the user never scrolled to).
- **FR-009**: Each incoming message MUST report Seen at most once (no duplicate receipts on
  re-scroll); a failed send MUST be retried later.
- **FR-010**: All Seen sending MUST remain gated by the existing "Seen receipts" privacy
  toggle (spec 1010): when off, nothing is ever sent, and others' seen of the user's
  messages is not rendered (reciprocity), regardless of on-screen visibility.
- **FR-011**: Messages that are outgoing/own or deleted MUST never generate a Seen receipt
  and MUST never be counted toward the pill.
- **FR-012**: A message viewed while the app/chat is **not** foregrounded MUST NOT be
  treated as seen until the chat is foregrounded and the message is on screen. "Foregrounded"
  means the chat detail view is the active route AND the document is visible (mobile app in
  the foreground); desktop window-blur with the tab still visible still counts as
  foregrounded, but a hidden/backgrounded document does not.
- **FR-013**: The on-the-wire receipt and the server's role MUST be unchanged — the same
  sealed `receipt` envelope spec 1010 relays; no new plaintext crosses the client/server
  boundary (zero-knowledge preserved).

**Catch-up while reading down (US3)**

- **FR-014**: When any incoming message appears on screen (≥50% visible), the system MUST
  report Seen for that message **and for all older** incoming messages that have not yet
  reported Seen (uniform "view ⇒ everything older is seen" rule). Reaching today's
  messages is the common case; there is no special today-only behavior.
- **FR-015**: Catch-up MUST respect the privacy toggle (FR-010) and the once-only and
  exclusion rules (FR-009, FR-011) — i.e. it advances only the not-yet-reported, incoming,
  non-deleted, non-own messages, and only when the toggle is on.

**Pill ↔ unseen relationship**

- **FR-016**: The pill's count MUST be the number of incoming, non-deleted messages that
  have **not yet been reported Seen** (equivalently: messages newer than the user's
  current seen frontier). The control MUST shrink to a plain circle exactly when that count
  reaches zero (all reported Seen).
- **FR-017**: When a chat has not-yet-Seen incoming messages, opening it MUST land the view
  at the **first** such message (an unread-divider style landing), not auto-scroll to the
  newest, so the catch-up rule (FR-014) advances Seen as the user reads downward rather than
  marking the whole backlog Seen on open. A chat with nothing unseen opens at the newest as
  before (spec 1011).
- **FR-018**: The recipient's per-incoming-message "seen-reported" state MUST be persisted
  locally so that the pill's not-yet-Seen count is stable across app restarts and the client
  does not re-send Seen receipts for already-reported messages on reopen. This is a
  client-local store only — no message content, and no change to the wire format or server.

### Key Entities *(include if feature involves data)*

- **Seen frontier** — the newest incoming message the user has brought on screen (≥50%);
  everything at or older than it is (or becomes) reported Seen via the catch-up rule.
- **Not-yet-Seen set** — the incoming, non-deleted messages newer than the seen frontier
  (i.e. not yet reported Seen); this set's size is the pill's count and decides its shape.
- **Seen-reported set** — the incoming messages for which a Seen receipt has already been
  sent; **persisted locally** per message (FR-018), extending spec 1010's in-memory
  `seenReceiptsSent` dedup so the state survives restarts; prevents duplicates and is the
  basis for the not-yet-Seen count.
- **On-screen visibility** — whether ≥50% of a given message's bubble is currently visible
  in the foregrounded chat viewport (the new trigger for sending Seen).
- **Seen receipt** — unchanged from spec 1010: a sealed envelope `{messageId, status:
  'seen', at, to}` routed by the server to the message's author.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a recipient opens a chat and does not bring older unviewed messages on
  screen, 0% of those off-screen messages are reported Seen to the sender.
- **SC-002**: When a recipient scrolls an unseen message into view (chat foregrounded,
  privacy toggle on), the sender reflects it as Seen within 5 seconds.
- **SC-003**: When a recipient brings any message ≥50% on screen, 100% of that message and
  all older not-yet-reported messages are reported Seen within 5 seconds, while newer
  off-screen messages remain not-yet-Seen.
- **SC-004**: The control shows a plain circle whenever the count is 0 and a pill with the
  exact count (capped for display) whenever the count is ≥ 1, in 100% of observed states.
- **SC-005**: The circle↔pill transition animates without visible stutter or composer
  overlap across keyboard open/close and reply/edit-bar states.
- **SC-006**: With the privacy toggle off, 0 Seen receipts are sent regardless of what
  appears on screen (no regression to spec 1010's guarantee).
- **SC-007**: No message content crosses the client/server boundary as a result of this
  feature; the server relays only the same opaque receipts as before.

## Assumptions

- Builds on the merged spec 1012 control and its `unreadSince` / boundary logic, spec 1011
  bounded scroll, and spec 1010 Seen-receipt path (`sendSeenReceipts`, the `receipt`
  envelope, `seenReceiptsSent` dedup, and the privacy toggle). No server, wire-format, or
  stored-ciphertext change is required.
- "Appeared on screen" means **≥ 50%** of the message's bubble is within the visible chat
  viewport while the chat is foregrounded (resolved 2026-06-19).
- Catch-up is uniform: viewing any message reports Seen for it and all older not-yet-Seen
  messages (the "today" case is subsumed). No local calendar-day logic is required.
- The pill's count is incoming-only, non-deleted, and not-yet-reported-Seen (FR-016).
- Display cap for the count is `99+` (consistent with spec 1012), with catch-up unaffected
  by the cap.
- **Initial scroll position** (FR-017, decided 2026-06-19): a chat with not-yet-Seen
  incoming messages opens at the first such message (unread-divider style) rather than the
  newest, so Seen advances as the user reads down; a fully-caught-up chat opens at the
  newest as in spec 1011.
- **Local persistence** (FR-018, decided 2026-06-19): the per-incoming-message
  seen-reported flag is stored client-side so the pill count is stable across restarts and
  Seen is never re-sent on reopen.
- **Foregrounded** (FR-012, decided 2026-06-19): chat detail view active + document
  visible; a hidden/backgrounded document suspends Seen sending.

## Dependencies

- **Spec 1012** — the scroll-to-latest control this evolves (replaces its corner badge).
- **Spec 1011** — bounded chat-history scroll (the message list this observes).
- **Spec 1010** — durable "Seen" receipts, the `receipt` envelope, and the client-enforced
  privacy toggle reused unchanged.

## Zero-Knowledge Impact

This feature changes only the client-side *timing* of an existing receipt; it adds nothing to
the wire and weakens none of the zero-knowledge guarantees established in spec 1010.

- **What crosses the wire**: the same sealed `receipt` envelope spec 1010 already relays —
  `{ messageId, status: 'seen', at, to }` — routed by the server to the message's author. No
  new fields, frames, or endpoints.
- **What the server sees**: unchanged. The server relays an opaque receipt (a capability-style
  message id + target) and never sees message content; it cannot tell *why* or
  *relative-to-viewing-when* a receipt was sent, only that one was relayed.
- **New local-only state**: the per-incoming-message `seenReportedAt` flag (FR-018) lives only
  in the device's IndexedDB. It is never sent to the server and is not part of own-data sync.
  (Cross-device parity, if ever wanted, would be a separate spec.)
- **Metadata change (a net privacy improvement)**: previously a receipt was emitted for every
  message on chat-open; now only when a message is actually viewed — strictly *less* and more
  truthful information to the peer, and nothing more to the server.
- **Privacy toggle**: the existing client-enforced "Seen receipts" toggle (spec 1010, default
  on, reciprocal) still gates all sending; off ⇒ nothing is ever sent.
- **Visibility data**: which messages are on screen never leaves the device; it only decides
  whether/when the existing receipt is sent.

## Out of Scope

- Any change to the receipt wire format, the server's relay/store, or the durable-seen
  reconciliation (spec 1010 already covers these).
- Changes to delivered/downloaded receipts.
- Read receipts for outgoing messages or any new privacy controls beyond the existing toggle.
