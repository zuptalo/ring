# Feature Specification: Quiet Housekeeping Frames & Smarter Notification Fan-out

**Feature Branch**: `feat/1050-quiet-housekeeping-frames`

**Created**: 2026-07-14

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User field reports while live-testing spec 1048 (2026-07-14): reaction removals surface as a generic "New message"; a freshly created group generically notifies every member; a group reaction rich-notifies the author but generically pings everyone else; a friend-request acceptance produced an OS push while the requester was inside the app.

## Clarifications

### Session 2026-07-14

- Q: May the client attach a one-bit "silent" hint to housekeeping frames so the server skips their push (ZK cost: the server learns "sender deems this frame not notification-worthy" — one bit, no content)? → A: **Yes** — approved with the leak documented; without it the requested behaviors are impossible on iOS (every push must end visibly).
- Q: Friend-request acceptance while the app is closed — silent or a rich push? → A: **Rich push** ("«name» accepted your invitation"); while the app is open, in-app banner only.
- From the report itself: reaction **removals** must produce no push and no in-app banner — the state update syncs passively (silently over the live connection, or on next open). Group **creation** must not notify members — the first message is the first notification. Group **reactions** wake only the reacted-to message's author and prior co-reactors (rich content for both); everyone else learns passively.

## Why this exists (the shared mechanism)

The server relays sealed frames it cannot read, and it pushes a content-free tickle for
every frame delivered to an away device. On iOS a woken service worker must end visibly.
So every "silent" event class — a removal, a group-create card, a reaction addressed to
someone else — degrades into a quiet generic notification on away devices. The fix is a
sender-set, per-recipient **silent hint**: the server still relays and the recipient still
receives (WS drain / next open), but no push fires, so no wake, so nothing to show.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Removing a reaction is invisible (Priority: P1)

Kamran removes his ❤️ from Kambiz's message. Kambiz's devices simply converge: if his app
is open the heart disappears quietly; if closed, it's gone next time he looks. No push, no
banner, no "New message" ghost.

**Independent Test**: two devices; add a reaction (rich notification arrives — spec 1048
behavior unchanged), then remove it with the peer's app closed → no notification of any
kind appears; opening the chat shows the reaction gone.

**Acceptance Scenarios**:

1. **Given** the peer's app is closed, **When** a reaction is removed, **Then** no OS notification appears (not even a generic), and the reaction is gone when the chat next opens.
2. **Given** the peer's app is open, **When** a reaction is removed, **Then** the bubble updates silently — no banner, no sound.
3. **Given** an add followed quickly by a remove, **Then** at most the ADD notification appears (adds keep spec-1048 behavior exactly).

---

### User Story 2 - Group reactions wake only the people they concern (Priority: P1)

In a 20-person group, Kamran reacts to Alice's message. Alice gets the rich notification
(spec 1048). The other 18 members get nothing — their copy of the reaction syncs
passively. Later Bob reacts to the same message: now Alice AND Kamran (a prior co-reactor)
get a rich "Bob also reacted" notification; the other 17 still get nothing.

**Independent Test**: three accounts in a group; C reacts to A's message → A rich-notified,
B gets nothing at all (not even generic, app closed); then B reacts to the same message →
A and C both rich-notified.

**Acceptance Scenarios**:

1. **Given** a group message by A, **When** C reacts, **Then** A receives the spec-1048 rich notification and every other member receives no notification (open app: silent bubble update; closed app: nothing until next open).
2. **Given** C already reacted to A's message, **When** B adds a reaction to it, **Then** A and C are both notified with real content (reactor + emoji + message quote, same masking rules as 1048), and everyone else stays silent.
3. **Given** B removes that reaction, **Then** nobody is notified (US1 applies in groups identically).
4. **Given** the reactor's own devices, **Then** they never notify themselves (unchanged).

---

### User Story 3 - A new group announces itself with its first message (Priority: P2)

Kamran creates "Mural crew" with five friends. Nobody's phone buzzes about the creation
itself — the group just appears in their chat lists. The first actual message notifies
normally, titled with the group name, which tells members everything the creation notice
would have.

**Independent Test**: create a group with two closed-app members → no notification on
either; send the first message → both get the normal group message notification; opening
the app before any message still shows the group in the chat list.

**Acceptance Scenarios**:

1. **Given** members with closed apps, **When** a group including them is created, **Then** no notification appears; the group is present in their chat list on next open.
2. **Given** a member with the app open, **When** the group is created, **Then** the chat list gains the group silently (no banner).
3. **Given** the first group message arrives, **Then** it notifies exactly like any group message (spec 1048/1020 rules).
4. **Given** the separate invite-consent flow (a group the user must ACCEPT), **Then** its "invited you" notification is unchanged — an invitation demands attention; a fait-accompli creation does not.

---

### User Story 4 - Friend-request acceptance lands right (Priority: P2)

Kamran's request to Sara gets accepted. If Ring is open in his hand, one in-app banner —
no simultaneous OS notification. If Ring is closed, one rich OS notification: "Sara
accepted your invitation", tapping it lands on the new contact.

**Independent Test**: two accounts; accept a request while the requester's app is
foregrounded → banner only, nothing in the notification center; repeat with the app closed
→ one rich notification with the accepter's name (not a generic).

**Acceptance Scenarios**:

1. **Given** the requester's app is open and visible, **When** the acceptance arrives, **Then** exactly one in-app banner shows and no OS notification is added.
2. **Given** the requester's app is closed, **When** the acceptance arrives, **Then** a notification names the accepter ("«name» accepted your invitation") — never a bare generic — and tapping it opens the contact.
3. **Given** the acceptance raced a connection blip (delivered via push wake moments after the app went background), **Then** at most one surface shows it.

---

### Edge Cases

- **Silent frame to a device that is also behind on loud frames**: the loud frames' pushes still fire; the silent one rides along in the same drain — silence is per-frame, never per-queue.
- **Co-reactor set staleness**: the reactor's device computes "author + prior co-reactors" from its local reaction state at send time; a concurrent reaction it hasn't seen yet may miss one co-reactor's wake. Their copy still syncs; accepted best-effort.
- **Old clients** (no silent hint): their housekeeping frames keep pushing exactly as today — recipients degrade to current behavior, nothing breaks either direction.
- **Silent hint on a loud frame class**: a malicious/buggy sender could mark a real message silent — the recipient still RECEIVES it (delivery is untouched); they merely aren't woken. Equivalent power to just not sending; no new abuse surface.
- **Push-health**: fewer wakes can never create silent-wake strikes — a frame with no push causes no wake at all; the spec-1048 FR-013 invariant applies only to wakes that happen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The relay MUST accept an optional, sender-set, per-recipient-frame **silent** hint; a silent frame is stored, delivered, drained, and acked exactly like any frame, but never triggers a push tickle.
- **FR-002**: Reaction REMOVALS MUST be sent silent, produce no notification surface anywhere (OS, banner, sound), and converge state passively (live update when connected; on next open otherwise). Reaction ADDS keep spec-1048 behavior byte-for-byte for the reacted-to author.
- **FR-003**: A group reaction ADD MUST be sent loud only to the reacted-to message's author and to members who currently (in the sender's view) have their own reaction on that message; every other member's copy is silent. Recipients in the loud set who are NOT the author MUST get real content ("«name» also reacted …") under the same masking rules as spec 1048; the never-escalates rule carries over.
- **FR-004**: Group CREATION cards (auto-join) MUST be sent silent: no notification to any member; the group appears in the chat list on receipt, and the first ordinary message notifies normally. The consent-based group INVITE flow is unchanged.
- **FR-005**: Friend-request ACCEPTANCE while the requester's app is visible MUST surface exactly one in-app banner and no OS notification; with the app away it MUST surface one rich notification naming the accepter, deep-linking to the contact. The friend-REQUEST notification itself is unchanged.
- **FR-006**: Interop both directions: frames from clients without the hint behave as today; new clients' silent hints degrade to today's behavior on an old server (hint ignored → push fires → existing generic path). No version gate, no migration.
- **FR-007**: The silent hint MUST NOT change delivery semantics in any way — ordering, receipts, dedup, retention, and blocking behavior are identical for silent and loud frames.

## Zero-Knowledge Impact

- **What crosses the wire, new**: one plaintext boolean per relayed frame (absent = loud). Nothing else changes; payloads stay sealed.
- **What the server learns**: "the sender considers this frame not notification-worthy" — it can partition traffic into housekeeping vs attention-worthy. It still cannot read content, and cannot distinguish a removal from a group card from a fanned-out reaction within the silent class. This is a deliberate, user-approved (clarification 2026-07-14) one-bit relaxation, comparable to what frame size and timing already suggest.
- **What it cannot do**: alter delivery. The hint only gates the push tickle; a hostile server ignoring it merely restores today's noisier behavior.
- **Why necessary**: iOS obliges every push-woken service worker to end visibly, and the zero-knowledge server pushes blindly per frame — recipient-side silence is impossible; only the sender can request it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Reaction removal with the peer away produces zero notification-center entries across 10 consecutive tries (real-device check), while the reaction state converges on next open in 100% of e2e runs.
- **SC-002**: In a 3-member group e2e, a first reaction notifies exactly the author (1 loud, 1 silent member), and a second reaction to the same message notifies exactly author + first reactor, with real content for both.
- **SC-003**: Group creation with 2 away members yields zero notifications; the first message then notifies both (e2e + real-device).
- **SC-004**: Acceptance with the app visible yields banner-only (e2e asserts the SW surface stays empty); with the app away, the notification names the accepter (SW unit + real-device).
- **SC-005**: Server: silent frames' delivery paths (store, drain, ack, receipts, blocking) are byte-identical to loud frames in unit tests; only the notify call differs.
- **SC-006**: Old-client interop: a frame without the hint behaves exactly as before this spec (server unit + client regression suites stay green).

## Assumptions

- The silent hint is set per enqueued recipient frame (group fan-out already enqueues per member, letting one reaction be loud for the author and silent for others) — verified at plan time against the actual enqueue shape.
- "Co-reactor" = has ≥1 own reaction on the target message in the sender's local state at send time; best-effort under concurrency.
- The acceptance rich note is composed on-device from the accept card (the server never learns it's an acceptance beyond what the existing connection endpoints already reveal).
- Spec 1048's suppressed-outcome shapes and push-health invariant are untouched; this spec only removes wakes, never adds silent ones.
- `/speckit-checklist` is REQUIRED for this spec (Principle I surface: a wire-visible field).
