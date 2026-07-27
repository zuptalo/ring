# Feature Specification: No delivery tick beside an incoming activity in the chats list

**Feature Branch**: `fix/2054-incoming-tick`

**Created**: 2026-07-27

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report (with screenshot): "Why do we see a sent status mark next to the incoming reaction!? Please make sure the message status is only shown on the outgoing messages and not incoming ones!"

## Context: why this hotfix exists

A Chats-list row read **"✓ Kambiz reacted 👍 to 'Finally done bowwo 😁'"** — a delivery tick beside an activity that belongs to *the other person*. A tick means "this is my message and here is how far it got", so putting one next to someone else's reaction is simply wrong.

The row's tick is driven by a denormalized `Chat.lastTick` (spec 1062), kept in step with the newest message so the list can show delivery progress without scanning history. `lastMessageTick` itself is correct — it returns `none` for anything incoming. The defect is that the sites which **replace the row preview with a non-message activity** update `lastMessage` / `lastKind` / `lastMessageTime` but never touch `lastTick`. The row therefore keeps the tick of the *outgoing message it just stopped describing*.

That affects every activity preview, not just the reported one:

- an **incoming reaction** ("Kambiz reacted 👍 to …") — the reported bug,
- your **own** reaction ("You reacted 👍 to …") — a tick belonging to a different message,
- **game** activity ("made a move 🎲", both directions),
- a **call** entry — stored as a message for the timeline but explicitly informational (never enqueued, no receipts), so it can inherit a blue double tick it never earned,
- a **cleared** chat — preview wiped, tick left behind.

The unifying rule: **the row tick describes a receipt-tracked outgoing message. Anything else shows no tick.**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An incoming reaction shows no delivery mark (Priority: P1)

Someone reacts to my message; my chats list shows their reaction as the latest activity, with no tick beside it.

**Why this priority**: The reported defect, and the most visible — reactions are frequent, so the wrong mark shows up constantly.

**Independent Test**: Send a message (row shows a tick), have the peer react, and confirm the row preview becomes their reaction with no tick.

**Acceptance Scenarios**:

1. **Given** my outgoing message is the newest and its row shows a tick, **When** the peer reacts to it, **Then** the row preview becomes their reaction and the tick disappears.
2. **Given** that reaction preview is showing, **When** a late receipt for my earlier message arrives, **Then** no tick reappears beside the reaction.
3. **Given** I then send a new message, **Then** the tick returns and tracks that message normally.

---

### User Story 2 - Other non-message activity carries no tick either (Priority: P2)

Game moves, calls, my own reactions and cleared chats show their preview without a stale delivery mark.

**Why this priority**: Same defect class and the same wrong impression, but less frequent than reactions.

**Independent Test**: Trigger each activity preview and confirm no tick renders.

**Acceptance Scenarios**:

1. **Given** a chat whose latest activity is a game move (mine or theirs), **Then** the row shows no tick.
2. **Given** a chat whose latest entry is a call, **Then** the row shows no tick, in either direction.
3. **Given** I react to someone's message, **Then** my row shows "You reacted …" with no tick.
4. **Given** I clear a chat's history, **Then** the emptied row carries no tick.

---

### Edge Cases

- **A late receipt** for the message an activity replaced MUST NOT restore the tick (the existing "only if it is still the newest" guard covers this — the activity moved `lastMessageTime`).
- **Pinned tiles** read the same `lastTick`, so they must behave identically to list rows.
- **An ordinary outgoing message** MUST be unaffected: pending → sent → delivered → seen still climbs live.
- **A failed send** keeps its existing failed treatment.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: nothing new. This changes only a locally-derived display field.
- **Where processing happens**: entirely on-device, from data already held.
- **Unavoidably-visible metadata**: unchanged — no new endpoint, field, or receipt is sent.
- **Why it stays zero-knowledge**: `lastTick` is a local denormalization of local state; the server has no part in it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chats-list row / pinned-tile delivery tick MUST only ever describe a receipt-tracked **outgoing message**.
- **FR-002**: When a row preview is replaced by a **reaction** (incoming or own), the tick MUST be cleared.
- **FR-003**: When a row preview is replaced by **game** activity (incoming or own), the tick MUST be cleared.
- **FR-004**: A **call** entry MUST never render a tick, in either direction, including when the row summary is recomputed from history.
- **FR-005**: Clearing a chat's history MUST clear its tick.
- **FR-006**: A late receipt MUST NOT restore a tick beside an activity preview.
- **FR-007**: Ordinary outgoing messages MUST keep their existing tick behaviour (pending/sent/delivered/seen, group roster tiers, failed, and the seen-reciprocity gate).

### Key Entities *(include if feature involves data)*

- **Chat summary**: the denormalized row fields (`lastMessage`, `lastKind`, `lastMessageTime`, `lastTick`). This fix makes `lastTick` a first-class part of every summary update rather than something only the message paths maintain. No schema change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An incoming reaction preview never renders a delivery tick.
- **SC-002**: No activity preview (reaction, game, call, cleared) renders a tick, in either direction.
- **SC-003**: Ordinary outgoing messages show no regression in tick behaviour.
- **SC-004**: A late receipt cannot reintroduce a tick beside an activity preview.

## Assumptions

- A call entry carries no delivery semantics — the code already records it as informational with no receipts — so it should never show a tick even though an outgoing call is flagged outgoing.
- Clearing the tick (rather than recomputing it from the newest real outgoing message) is the right behaviour: the row is describing the activity, so a tick for some other message would be misleading regardless of accuracy.

## Out of Scope

- The in-conversation bubble ticks (already correct — they render per message).
- Changing reaction, game, or call previews themselves (wording, ordering, notifications).
- Any change to receipt collection or the seen-reciprocity policy.
