# Feature Specification: Push Classes, Conversation Mutes & Notification Routing

**Feature Branch**: `feat/1050-quiet-housekeeping-frames`

**Created**: 2026-07-14

**Status**: in-review
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
- Q (follow-up, after observing that reactions-off still produced generic pushes): extend the silent bit into a coarse frame-CLASS tag (message / reaction / housekeeping) plus per-device class opt-outs stored with the push subscription, so recipient toggles control the pushes themselves? ZK cost beyond the silent bit: the server sees which sealed frames are reaction-class, and learns each device's class preferences. → A: **Yes, approved.**
- Directive (same session): in-app notification banners must dismiss by **swiping up**, replacing the ✕ button (the swipe currently does nothing on banners; quick-reply confirmed working).
- Directive (same session): expand the model to every notify-or-hold scenario in one wire change — per-chat and per-group mutes, following a friend's posts / per-friend new-post alerts, and any analogous toggles (games, global master). Accepted; the additional wire concept this requires (an opaque conversation routing id, below) and its leak are documented in the ZK Impact section for veto.

## Why this exists (the shared mechanism)

The server relays sealed frames it cannot read and pushes a content-free tickle for every
frame delivered to an away device; on iOS a woken service worker must end visibly. So every
event a device would rather not be woken for — a removal, a bystander's reaction, a muted
group's chatter — degrades into a quiet generic ghost, because recipient preferences today
never reach the push decision. This spec gives the push decision exactly the metadata it
needs and no more.

## The routing model (three concepts, one wire change)

1. **Class** — a sender-set, per-recipient-frame coarse tag:
   `message` (default; also every tag-less old-client frame) · `mention` (personally
   directed: an @mention of, or a direct reply to, that recipient — sender computes this
   per recipient) · `reaction` · `activity` (engagement on your wall post) · `game` ·
   `post` (a new wall post) · `housekeeping` (never pushed: removals, group-create cards,
   bystander reaction fan-out, edits/votes/receipts-class signals).
2. **Route id (prid)** — an opaque random id minted per conversation and shared among its
   members inside the sealed channel; frames carry it in plaintext. It lets a recipient
   mute a *conversation* server-side without the server learning anything readable about
   it. Calls keep their existing dedicated push path (never filtered).
3. **Subscription preferences** — each device registers, alongside its push subscription:
   opted-out classes; muted prids (from the existing per-chat mute and per-chat
   "web push off" controls); per-sender `post` overrides (mute this friend's posts /
   always alert this friend's posts).

Server rule, evaluated per frame at push time: `housekeeping` never pushes; `mention`
always pushes (it pierces prid mutes exactly as mentions pierce mutes on-device today —
spec 1020/1048 parity); everything else pushes unless its class is opted out or its prid
is muted. Filtering gates ONLY the tickle: storage, delivery, drain, ack, receipts, and
blocking are identical for every frame, and held frames arrive silently on the next
connection or open.

**Deliberately excluded: hidden chats** (spec 1019). Registering a hidden chat's prid or
muting it server-side would tell the server "this conversation is special to this user" —
the traceless guarantee outranks ghost-avoidance, so hidden chats keep today's generic
behavior and are never referenced in subscription preferences.

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
- **Mixed toggles (1:1 reactions off, group reactions on or vice versa)**: the reaction class is coarser than the two toggles, so pushes stay ON and the device filters rendering — the generic ghost can still appear in exactly this mixed configuration; documented, accepted (opting out fully requires both toggles off).
- **Swipe vs quick-reply gestures**: the banner already owns pull-down (open reply) and in-reply swipe-up (discard); the new dismiss swipe must not fight them — swipe-up on a COLLAPSED banner dismisses, in reply mode it keeps its discard meaning.
- **Hiding a chat that was muted**: preference registration being a full-state replace (FR-011) means the next registration simply no longer contains that prid — indistinguishable from any other preference update, so hiding signals nothing (upholds FR-008c).
- **prid bootstrap for pre-existing conversations**: the first up-to-date member to send in a conversation mints its prid and shares it through the sealed channel (1:1: either side; groups: a sealed control signal). Until members converge, frames may carry class but no prid — class rules still apply and prid mutes simply don't match, i.e. today's behavior, never worse.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The relay MUST accept the optional, sender-set, per-recipient-frame **class** tag and **route id** per the routing model; storage, delivery, drain, ack, receipts, and blocking are identical for every class, and the server's push rule is exactly the model's (housekeeping never; mention always; others gated by class opt-outs and prid mutes).
- **FR-008**: A device MUST be able to register and update, without re-subscribing: opted-out classes, muted prids, and per-sender post overrides. The client MUST derive these from the EXISTING controls — no new settings screens: both reaction toggles off ⇒ `reaction` opt-out; all four game alert toggles off ⇒ `game` opt-out; wall "Show notifications" off ⇒ `post` opt-out; wall "Activity on your posts" off ⇒ `activity` opt-out; global "Show notifications" off ⇒ `message` (+`mention`) opt-out; per-chat mute / per-chat web-push-off ⇒ that chat's prid in the mute list (mute expiry unregisters it); the wall's existing per-person mute ⇒ a per-sender post override. Partially-off toggle groups keep pushes on and the device filters rendering, exactly as today (documented coarseness).
- **FR-008a**: A NEW per-friend "Notify me about new posts" control (contact/wall surface) MUST register an always-alert per-sender post override that wins over the global `post` opt-out — the Telegram-style per-friend follow the reporter asked for. Default off for every contact (current behavior preserved: the global wall toggle governs).
- **FR-008b**: Mention-class frames MUST pierce prid mutes server-side, mirroring on-device escalation (spec 1020/1048). The device's `notifyMentions=false` per-chat pref keeps its rendering-side meaning; that rare mixed configuration may still ghost and is documented.
- **FR-008c**: Hidden chats MUST never appear in subscription preferences (no prid registration, no mutes) — spec 1019's traceless guarantee outranks ghost-avoidance.
- **FR-009**: Frames withheld by any rule (class, prid mute, per-sender override) MUST deliver silently over the next live connection or app open — never lost, never reordered, never re-pushed later.
- **FR-011**: Subscription preferences MUST be registered as an idempotent full-state replacement (never incremental diffs) and MUST be removed with their subscription: a mute expiry or unmute drops the prid on the next registration; deleting a chat drops its prid; deleting the account or pruning a dead subscription deletes every preference with it. Nothing preference-shaped outlives the subscription it belongs to.
- **FR-012**: Mention-class piercing operates within the existing trust boundary only: frames are already accepted solely from connected peers, blocking is evaluated before any push regardless of class, and the per-chat "notify on mentions" control remains the user's lever against a contact who abuses @mentions in a muted conversation. No anonymous or unconnected sender can reach the mention path at all.
- **FR-010**: In-app notification banners MUST dismiss with an upward swipe; the ✕ button is removed from the visual design. Tap-to-open and the quick-reply flow are unchanged, and a non-gestural dismissal MUST remain available to assistive technology (the banner stays screen-reader dismissible).
- **FR-002**: Reaction REMOVALS MUST be sent silent, produce no notification surface anywhere (OS, banner, sound), and converge state passively (live update when connected; on next open otherwise). Reaction ADDS keep spec-1048 behavior byte-for-byte for the reacted-to author.
- **FR-003**: A group reaction ADD MUST be sent loud only to the reacted-to message's author and to members who currently (in the sender's view) have their own reaction on that message; every other member's copy is silent. Recipients in the loud set who are NOT the author MUST get real content ("«name» also reacted …") under the same masking rules as spec 1048; the never-escalates rule carries over.
- **FR-004**: Group CREATION cards (auto-join) MUST be sent silent: no notification to any member; the group appears in the chat list on receipt, and the first ordinary message notifies normally. The consent-based group INVITE flow is unchanged.
- **FR-005**: Friend-request ACCEPTANCE while the requester's app is visible MUST surface exactly one in-app banner and no OS notification; with the app away it MUST surface one rich notification naming the accepter, deep-linking to the contact. The friend-REQUEST notification itself is unchanged.
- **FR-006**: Interop both directions: frames from clients without the hint behave as today; new clients' silent hints degrade to today's behavior on an old server (hint ignored → push fires → existing generic path). No version gate, no migration.
- **FR-007**: The silent hint MUST NOT change delivery semantics in any way — ordering, receipts, dedup, retention, and blocking behavior are identical for silent and loud frames.

## Zero-Knowledge Impact

- **What crosses the wire, new**: a plaintext coarse class per relayed frame (7 values, absent = message); an opaque random route id per frame; per-subscription preference lists (classes, muted prids, per-sender post overrides).
- **What the server learns**: (1) coarse frame kinds — including that a frame personally addresses its recipient (`mention`) — but never content, emoji, targets, or names; (2) a persistent pseudonymous clustering of frames into conversations (prid). Timing and fan-out already reveal conversation clustering statistically; prid makes that correlation explicit and durable, which is the largest single relaxation in this spec and the reason it is listed for veto; the id itself is random and carries no membership roster — the server still never sees a group's name, subject, or list; (3) each device's notification posture: muted conversations (by pseudonym only), muted classes, and which senders' posts a user follows closely or has muted — preference metadata comparable to what any push-filtering messenger stores, now held by a server that can read nothing else. Hidden chats are structurally absent from all of it.
- **All approved in the 2026-07-14 clarification sessions**, with the prid clustering explicitly called out.
- **What it cannot do**: alter delivery. The hint only gates the push tickle; a hostile server ignoring it merely restores today's noisier behavior.
- **Why necessary**: iOS obliges every push-woken service worker to end visibly, and the zero-knowledge server pushes blindly per frame — recipient-side silence is impossible; only the sender can request it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Reaction removal with the peer away produces zero notification-center entries across 10 consecutive tries (real-device check), while the reaction state converges on next open in 100% of e2e runs.
- **SC-002**: In a 3-member group e2e, a first reaction notifies exactly the author (1 loud, 1 silent member), and a second reaction to the same message notifies exactly author + first reactor, with real content for both.
- **SC-003**: Group creation with 2 away members yields zero notifications; the first message then notifies both (e2e + real-device).
- **SC-004**: Acceptance with the app visible yields banner-only (e2e asserts the SW surface stays empty); with the app away, the notification names the accepter (SW unit + real-device).
- **SC-005**: Server: silent frames' delivery paths (store, drain, ack, receipts, blocking) are byte-identical to loud frames in unit tests; only the notify call differs.
- **SC-006**: Old-client interop: a frame without a class tag behaves exactly as before this spec (server unit + client regression suites stay green).
- **SC-007**: With both reaction toggles off, a reaction to the user's message while away produces zero notification-center entries (real device), and the reaction is present on next open (e2e: the frame is held, not pushed — server unit asserts no notify call).
- **SC-008**: A collapsed banner dismisses with one upward swipe in the e2e gesture test; no ✕ is rendered; quick-reply open/discard gestures keep passing their existing suites.
- **SC-009**: A muted group produces zero pushes for ordinary member messages (server unit: no notify call for muted-prid frames) while an @mention or reply-to-you in that group still pushes (mention pierce) — and unmuting restores pushes without re-subscribing.
- **SC-010**: With the global wall toggle off but one friend's "Notify me about new posts" on, only that friend's posts push (server unit + e2e prefs round-trip).
- **SC-011**: Hidden-chat conversations never appear in any subscription preference payload (client unit asserting the registration path filters them; ZK guard test in the spec-1019 style).

## Assumptions

- The silent hint is set per enqueued recipient frame (group fan-out already enqueues per member, letting one reaction be loud for the author and silent for others) — verified at plan time against the actual enqueue shape.
- "Co-reactor" = has ≥1 own reaction on the target message in the sender's local state at send time; best-effort under concurrency.
- The acceptance rich note is composed on-device from the accept card (the server never learns it's an acceptance beyond what the existing connection endpoints already reveal).
- Spec 1048's suppressed-outcome shapes and push-health invariant are untouched; this spec only removes wakes, never adds silent ones.
- `/speckit-checklist` is REQUIRED for this spec (Principle I surface: a wire-visible field).
