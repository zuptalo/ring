# Feature Specification: Group "Seen" Receipts — Durable, Private, and Counted

**Feature Branch**: `feat/1010-group-seen-receipts`

**Created**: 2026-06-17

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Rename 'read' receipts to 'Seen' everywhere (hard cutover); make per-member seen durable in groups (survive the sender being offline); wire the currently-inert seen-receipts privacy toggle (default on, reciprocal, client-enforced); add a group progress counter (Delivered X/N → Seen X/N) on the message bubble; and show Seen-by / Delivered / Not-yet-delivered member lists in message info."

## Overview

Ring already tracks group message receipts **per member** on the sender's side
(each outgoing group message carries a roster of `{member, deliveredAt, seenAt}`)
and already shows per-member "Seen by / Delivered to" lists on the message-info
screen. The bubble, however, shows only a single collapsed tick, "read" is the
word used throughout, and one important guarantee is missing: a member's **seen**
confirmation is delivered live-only — if the sender is offline at that moment it
is **lost**, so a group can be fully seen yet never show it.

This feature closes those gaps and makes group receipts feel alive:

1. **Rename "read" → "Seen" everywhere** (a clean hard cutover) so the concept
   reads correctly for voice notes, video notes, photos, and text alike.
2. **Durable per-member seen** — seen survives the sender being offline, the same
   way delivered already reconciles on reconnect.
3. **A reciprocal "Seen receipts" privacy toggle** (default on) — turn it off and
   you neither tell others you've seen their messages nor see theirs on your own.
4. **A group progress counter on the bubble** — "Delivered 3/5", then "Seen 4/5",
   then "Seen" — so progress is visible at a glance without opening message info.
5. **Fuller message info** — Seen by / Delivered / **Not yet delivered** lists
   covering every member, with member avatars.

The zero-knowledge boundary is preserved: durable seen stores the **same shape of
metadata already stored for delivered** (who → whom → which message → when), never
message content, and the privacy preference is enforced entirely on the client.

## Clarifications

### Session 2026-06-17

- Q: Keep "read", or rename? → A: Rename to **"Seen"** everywhere — a **hard cutover** (one-time client storage migration; server is code-only, since read was never persisted).
- Q: Should seen be durable like delivered, or stay live-only? → A: **Durable** — a server seen-store mirroring the existing delivered store, reconciled on reconnect, so "Seen X/N" survives the sender being offline.
- Q: How is the privacy toggle enforced — server withholds, or client suppresses? → A: **Client-side suppression** — when off the client never sends a seen confirmation (you can't leak what you don't send) and never renders others' seen on your messages (reciprocity). The server never learns the preference.
- Q: Group indicator semantics? → A: **Complete-the-tier** — "Delivered X/N" climbs until all N, then "Seen X/N" climbs until all N, then "Seen". Compact on the bubble (group-only, partial-only); avatars live in message info.
- Q: Toggle default + scope? → A: **Default on**, uniform for 1:1 and groups (the old "always sent for groups" rule is dropped).
- Q: Message-info completeness? → A: Also show **"Not yet delivered"** by cross-referencing the full member roster, not just members who have progressed.
- Q: What is the denominator N in "Seen X/N"? → A: **Recipients only** — the sender is excluded (you can't deliver to yourself), matching the per-member roster.
- Q: How should a group with a single recipient (N=1) behave? → A: No special-casing and no minimum group size — because the count shows **only while a tier is partial** (1 ≤ X < N), an N=1 group inherently renders as a plain tick (like 1:1); it starts showing counts once it grows.
- Q: How long does the server keep durable seen records? → A: **Mirror the existing delivered store's** retention/cleanup.
- Q: A message may rest at "Seen X/N" (X < N) forever if members never open it or opted out — OK? → A: **Yes, rest at partial** — the sender can't distinguish "not yet opened" from "opted out", so partial is the honest, privacy-preserving terminal state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Durable "Seen", named consistently (Priority: P1)

The app speaks "Seen" (not "Read") everywhere, and a member's seen confirmation
is reliable: if the sender was offline when a member opened the message, the
sender still shows it as seen once they reconnect. Existing message history keeps
its status after the rename.

**Why this priority**: Reliability + consistent naming is the foundation; the
counter and lists are only trustworthy if seen is durable and uniformly named.

**Independent Test**: With the sender offline, have a member open a message; bring
the sender back online and confirm the message reflects that member as seen.
Confirm older messages that were "read" now display as "Seen" unchanged.

**Acceptance Scenarios**:

1. **Given** an outgoing message and the sender offline, **When** a recipient
   sees it and later the sender reconnects, **Then** the sender shows that
   recipient as seen (the seen state is not lost).
2. **Given** messages that previously had "read" status, **When** the app updates,
   **Then** they display as "Seen" with their original timestamps and no status
   regression.
3. **Given** any seen state in the UI or copy, **When** it is shown, **Then** it
   reads "Seen" (never "Read").

---

### User Story 2 - Group progress counter on the bubble (Priority: P1)

In a group chat, an outgoing message shows how far it has progressed across the
N members: it climbs "Delivered X/N" as members' devices receive it, then "Seen
X/N" as members open it, then settles to "Seen" once everyone has.

**Why this priority**: This is the headline visible value — group progress at a
glance, the thing the current single tick can't convey.

**Independent Test**: In a group of 3, watch the indicator go Sent → Delivered
1/3 → 2/3 → 3/3 → Seen 1/3 → … → Seen as members receive then open the message.

**Acceptance Scenarios**:

1. **Given** a group message not yet delivered to all, **When** members receive
   it, **Then** the bubble shows "Delivered X/N" with X climbing toward N.
2. **Given** a group message delivered to all but not yet seen by all, **When**
   members open it, **Then** the bubble shows "Seen X/N" with X climbing toward N.
3. **Given** a group message every member has seen, **When** it renders, **Then**
   the bubble shows the plain "Seen" tick (no fraction).
4. **Given** a 1:1 message, **When** it renders, **Then** it shows the plain tick
   with no fraction (unchanged from today).

---

### User Story 3 - Reciprocal "Seen receipts" privacy toggle (Priority: P1)

A "Seen receipts" setting (default on) lets the user stop sharing when they've
seen messages. Turning it off is reciprocal: the user no longer tells anyone
they've seen a message, and no longer sees others' seen state on their own sent
messages. It applies the same way in 1:1 and group chats.

**Why this priority**: Consent is core to Ring; seen state must be suppressible
without leaking, and the suppression must be symmetric.

**Independent Test**: Turn the setting off on account A; confirm A reading
messages never advances A's seen state for anyone, and A sees no seen tier on A's
own messages, while two other members with it on still see each other.

**Acceptance Scenarios**:

1. **Given** the setting is on (default), **When** the user sees a message,
   **Then** the sender can see the user reach the seen state.
2. **Given** the user turns the setting off, **When** they see any message,
   **Then** no seen confirmation is sent to anyone (they stay shown as delivered).
3. **Given** the user has the setting off, **When** others see the user's sent
   messages, **Then** the user does not see the seen tier on those messages
   (it caps at delivered), and the setting copy explains this reciprocity.

---

### User Story 4 - Fuller message info with member lists (Priority: P2)

Opening a group message's info shows, for every member, whether they've seen it,
merely received it, or not yet received it — each with the member's name and
avatar.

**Why this priority**: The per-member detail; valuable but secondary to the
at-a-glance counter, and partly built today (it lacks the "not yet delivered"
view).

**Acceptance Scenarios**:

1. **Given** a group message, **When** I open its info, **Then** I see "Seen by",
   "Delivered" (delivered but not yet seen), and "Not yet delivered" lists that
   together account for every group member.
2. **Given** a member who has not received the message, **When** I view the info,
   **Then** that member appears under "Not yet delivered".
3. **Given** more members in a tier than fit, **When** the list renders, **Then**
   it shows a capped avatar stack with a "+N" overflow.

---

### Edge Cases

- **Sender offline at seen time**: the seen state is reconciled on the sender's
  next reconnect (durability), never silently lost.
- **Stale (un-refreshed) client after the rename cutover**: its seen
  confirmations may not register until it refreshes — a transient degradation of
  the seen tier only; delivered and messaging are unaffected and it self-heals on
  update.
- **Upgrade migration failure**: the read→seen storage migration runs inside the
  database upgrade transaction; if it cannot complete it MUST abort atomically,
  leaving existing message data intact at the prior version (retried on the next
  open) rather than partially migrating or losing history.
- **Member with "Seen receipts" off, or who simply never opens it**: counts
  toward delivered but never toward seen, so a group's "Seen X/N" may rest
  permanently below N/N. This partial terminal state is intended — the sender
  cannot distinguish "not yet opened" from "opted out" (the privacy guarantee).
- **Sender with "Seen receipts" off**: their own messages' indicator caps at the
  delivered tier (no seen tier shown), per reciprocity.
- **Roster fixed at send time**: a member who joins the group later is not added
  to an earlier message's counts/lists.
- **A member who left / is unknown**: still resolvable to an avatar via a
  generated fallback; never a broken row.
- **Large groups**: the bubble shows the compact "X/N"; info-page lists use a
  capped avatar stack + "+N".
- **Downloaded-media signal**: remains separate from seen (it is not a displayed
  status) and is unaffected.
- **LTR/RTL + light/dark**: the counter and the avatar stack render and mirror
  correctly in both directions and themes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST use "Seen" (never "Read") consistently in all
  user-facing copy and internal status for what was previously "read" — the
  bubble tick, message info, settings, and the wire/stored status value.
- **FR-002**: Updating the app MUST migrate existing locally-stored messages so
  prior "read" status and timestamps are preserved as "Seen", with no loss of
  history and no status regression.
- **FR-003**: A member's seen confirmation MUST be durable: if the sender is
  offline when the member sees the message, the sender MUST reflect it after
  reconnecting (parity with how delivered already reconciles).
- **FR-004**: In a group chat, an outgoing message MUST present a progress
  indicator using complete-the-tier semantics over **N = the recipient members
  (the sender is excluded)**: Sent → "Delivered X/N" (some but not all delivered)
  → "Seen X/N" (all delivered, some but not all seen) → "Seen" (all seen).
- **FR-005**: The group indicator MUST appear compactly on the message bubble
  (state + "X/N"), **group-only** and **only while a tier is partial** (1 ≤ X < N);
  a fully-seen group message and all 1:1 messages show the plain tick with no
  fraction. A group with a single recipient (N=1) therefore renders as a plain
  tick too (no tier is ever partial) — no special-casing and no minimum group
  size; counts begin once the group has ≥2 recipients.
- **FR-006**: Opening a group message's info MUST present three member lists that
  together cover every member of the message's roster: **Seen by**, **Delivered**
  (delivered, not yet seen), and **Not yet delivered**, each showing the member's
  name and avatar.
- **FR-007**: The user MUST be able to turn "Seen receipts" off via a privacy
  setting (default **on**), applied uniformly to 1:1 and group chats.
- **FR-008**: When "Seen receipts" is off, the user's app MUST NOT send any seen
  confirmation for any message (so no one sees the user reach the seen state).
- **FR-009**: When "Seen receipts" is off, the user MUST NOT see others' seen
  state on the messages they sent (the indicator caps at delivered); the setting
  copy MUST explain this reciprocity.
- **FR-010**: The seen privacy preference MUST be enforced entirely on the client;
  the server MUST NOT be told the preference, and MUST never hold seen state the
  user chose not to send.
- **FR-011**: Counts and lists MUST be correct for the message's member roster as
  of send time; a member who has not received the message MUST appear under "Not
  yet delivered".
- **FR-012**: The downloaded-media signal MUST remain distinct from seen and
  unchanged (it is not a displayed status).
- **FR-013**: All UI MUST use stock Ionic components + existing theme tokens,
  building custom only where no Ionic primitive fits (Constitution XI).
- **FR-014**: Behaviour MUST be correct in LTR and RTL (including the avatar stack
  mirroring) and across light/dark themes, with localizable labels.

### Key Entities *(include if feature involves data)*

- **Seen receipt (per member)**: that member M saw sender S's message MID at time
  T. Relayed live today; now **also durably stored server-side** with the same
  shape as the existing delivered record `(sender, recipient, msg_id, seen_at)`
  and the **same retention/cleanup policy** as that delivered store. No message
  content.
- **Per-member receipt roster** (existing, on the sender's message): one entry per
  member `{member, deliveredAt?, seenAt?, downloadedAt?}`; the source of the
  counts and the info-page lists.
- **Derived group progress**: from the roster — delivered count = entries with
  `deliveredAt`; seen count = entries with `seenAt`; tier + "X/N" follow the
  complete-the-tier rule.

## Zero-Knowledge Impact *(mandatory)*

This feature is **not** client-only (it adds a server seen-store + a wire/status
change), so a `/speckit-checklist` is required (Constitution Principle I; it also
touches Principle V — a local DB migration — and Principle VI — a new server
migration).

- **What crosses the wire / is stored**: a seen confirmation (member → message
  author), now persisted durably as `(sender, recipient, msg_id, seen_at)` — the
  **same metadata shape already stored for delivered** (`deliveries`). No new
  *class* of server-visible metadata is introduced.
- **What is NOT exposed**: no message bodies, media, or profile content; the seen
  store holds only routing ids + a timestamp, minimized to what reconciling a
  receipt requires (Principle I) and symmetric to delivered.
- **Consent / preference**: the "Seen receipts" preference is enforced
  **client-side only** — when off, the client never sends a seen confirmation, so
  the server's seen-store **never holds** an opted-out user's seen (the gate is
  upstream of the store). The server is never told the preference and has no
  preference column. Reciprocity (not seeing others' seen) is also client-side.
- **Rename**: the status value change is metadata only (a label/enum), exposes no
  content, and needs no server data migration (read was never persisted).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a group of 3, an outgoing message's indicator climbs
  "Delivered X/3" as devices receive it, then "Seen X/3" as members open it, then
  shows plain "Seen" once all have. Verified e2e across three accounts.
- **SC-002**: A member sees a message while the sender is offline; after the
  sender reconnects, the message reflects that member as seen (durability).
  Verified e2e.
- **SC-003**: With "Seen receipts" off on account A: A never advances anyone's
  view of A's seen state, AND A sees no seen tier on A's own messages, while two
  other members with it on still see each other. Verified e2e (both directions).
- **SC-004**: For a group message, every member appears under exactly one of
  Seen by / Delivered / Not yet delivered, matching the roster. Verified e2e.
- **SC-005**: After updating, messages that were previously "read" display as
  "Seen" with original timestamps preserved and no status regression. Verified by
  a migration test.
- **SC-006**: 1:1 messages are visually unchanged (plain tick, no fraction).
  Verified.
- **SC-007**: The feature introduces no message content and no new class of
  server-visible metadata — the seen store mirrors the delivered store's shape.
  Verified by inspection of the change set.

## Assumptions

- Builds on existing machinery rather than new subsystems: the per-member
  `receipts[]` roster, the message-info group lists, and the delivered
  durability/reconcile path. Durable seen mirrors durable delivered; the info
  lists gain a "not yet delivered" tier; the bubble gains a derived count.
- The rename is a **hard cutover**; the brief cross-version skew (a stale client
  still using the old value) degrades only the seen tier transiently and
  self-heals on refresh — acceptable per the product decision.
- The member roster for counts/lists is fixed at send time (later joiners are not
  retroactively added to past messages).
- A single combined "Seen receipts" toggle governs both 1:1 and groups (no
  separate group rule); default on.
- The avatar stack is capped at five with a "+N" overflow; "Seen X/N" stays
  compact on the bubble and defers the per-member detail to message info.
