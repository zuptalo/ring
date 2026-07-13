# Feature Specification: Reaction Notifications & Group Reply Escalation

**Feature Branch**: `feat/1048-notify-reactions-messages`

**Created**: 2026-07-13

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Notify users when someone reacts to their message (the existing reaction-notification toggles are dead controls today), and escalate direct replies to you in groups past mute the same way @mentions escalate. Hard constraint: every push delivered to a device must end in a visible outcome — after 3 hidden notifications the platform revokes the push subscription — so suppressed reaction pushes must follow the established visible-outcome pattern rather than being silently swallowed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know when someone reacts to your message (Priority: P1)

Sara sends Alex a photo of her finished painting. Alex reacts with ❤️. Today Sara learns this only if she happens to reopen the chat. With this feature, Sara gets a gentle notification — "Alex reacted ❤️ to: my painting is done!" — the same way she would in WhatsApp, Telegram, or Messenger. The same works in groups: when a group member reacts to Sara's message, Sara (and only Sara) hears about it.

**Why this priority**: This is the core gap. It is market-standard behavior in every major messenger, and Ring's settings screen already shows "reaction" toggles that currently do nothing — the app is promising a behavior it doesn't deliver. Reactions are also the lightest form of connection between people; losing them silently makes the app feel less alive.

**Independent Test**: With two accounts in a 1:1 chat, account B reacts to a message account A sent. Account A receives a visible notification naming B and the emoji, both while the app is open (in-app banner) and while it is closed (system notification). Repeat in a group with a third member reacting to A's message: only A is notified.

**Acceptance Scenarios**:

1. **Given** Alex and Sara have a 1:1 chat and Sara's app is closed, **When** Alex reacts 👍 to a message Sara sent, **Then** Sara's device shows a notification identifying Alex, the emoji, and a preview of the reacted-to message, and tapping it opens that chat.
2. **Given** Sara's app is open on the Chats tab, **When** Alex reacts to her message, **Then** Sara sees an in-app banner (not a duplicate system notification), consistent with how message notifications behave today.
3. **Given** a group where Sara, Alex, and Maya are members and Alex reacts to Sara's message, **When** the reaction is delivered, **Then** Sara is notified and Maya is not.
4. **Given** Alex removes his reaction, or reacts to a message Maya (not Sara) sent, **When** the event is delivered to Sara's device, **Then** Sara sees no reaction notification.
5. **Given** several people react to Sara's message in quick succession, **When** the reactions arrive, **Then** they collapse into the chat's single updating notification rather than stacking one notification per reaction.
6. **Given** Sara reacts to her own message, or her reaction echoes back from her second device, **Then** no notification is shown.

---

### User Story 2 - A reply to you cuts through a muted group (Priority: P2)

Sara muted the busy "Family" group. Alex replies directly to a message Sara wrote there, asking her a question. Today that reply is suppressed with the rest of the group noise and Sara never sees it. With this feature, a direct reply to one of Sara's own messages is treated as personally directed — like an @mention — and reaches her even though the group is muted.

**Why this priority**: Mentions already escalate past mute (spec 1020); replies-to-you are the same "this is addressed to you" signal and the market treats them identically (Telegram notifies for replies in muted groups by default). Without this, muting a group means missing direct questions. Priority below P1 because the mention machinery already gives users a partial workaround (the replier can @mention).

**Independent Test**: Account A mutes a group, account B replies directly to a message A authored. A receives a notification despite the mute; the group's unread-mentions indicator lights up. A reply to a message authored by someone else stays suppressed.

**Acceptance Scenarios**:

1. **Given** Sara has muted a group, **When** Alex sends a message that directly replies to a message Sara authored, **Then** Sara receives a notification as if she had been @mentioned.
2. **Given** Sara has muted a group and set its content preference to hide message contents, **When** Alex replies to her message, **Then** the notification still names the replier in a content-safe way (e.g., "Alex replied to you") without revealing the message body.
3. **Given** Sara turned off the group's per-chat "notify on mentions" preference, **When** Alex replies to her message, **Then** the reply is treated like any ordinary group message (no escalation).
4. **Given** Alex replies to Sara's message in an *unmuted* group, **Then** Sara gets one normal notification (no double-notify, no changed behavior beyond the mention-style indicator).
5. **Given** Alex's reply to Sara's message *also* @mentions Sara, **Then** Sara receives exactly one notification.
6. **Given** a 1:1 chat, **When** Alex replies to Sara's message, **Then** behavior is unchanged from today (1:1 messages already notify; no escalation concept applies).
7. **Given** Sara replies to her own message in a group, **Then** no escalation occurs.
8. **Given** Alex replied to Sara's message in a muted group, **When** Sara looks at her chat list, **Then** the group shows the unread-mentions indicator, and it clears when she reads the chat.

---

### User Story 3 - Turning it off really turns it off, without breaking push (Priority: P3)

Maya finds reaction notifications noisy and switches the existing "Reactions" toggles off (separately for direct messages and groups). She stops seeing reaction notifications entirely — but her device keeps receiving the underlying deliveries, and her push registration must stay healthy: the platform revokes push after repeated deliveries that produce nothing visible.

**Why this priority**: Controls that silently break push are worse than no controls. This story exists to make the suppression path an explicit, testable requirement rather than an afterthought — it protects the P1 feature from becoming a reliability regression.

**Independent Test**: With reaction notifications toggled off, deliver a series of reactions to a closed app. No reaction notification appears, yet every delivery ends in the same visible-outcome pattern used today for muted/suppressed messages, and the push subscription remains active afterward.

**Acceptance Scenarios**:

1. **Given** Maya turned the 1:1 reactions toggle off, **When** someone reacts to her message in a 1:1 chat, **Then** no reaction notification or banner appears, while group reactions still notify (and vice versa — the two toggles are independent).
2. **Given** Maya muted a chat, **When** someone reacts to her message there, **Then** no reaction notification appears (reactions never escalate past mute, unlike mentions).
3. **Given** Maya's app is closed and a reaction delivery is suppressed by a toggle, mute, or hidden-chat rules, **When** the delivery wakes the device, **Then** the wake ends in the same user-visible outcome the app already uses for suppressed message deliveries — never an invisible no-op.
4. **Given** a chat is hidden and locked, **When** a reaction or reply-to-you arrives in it, **Then** the existing traceless hidden-chat behavior applies unchanged (no content, no escalation, no trace).

---

### Edge Cases

- **Reaction changed (👍 → ❤️)**: treated as a new reaction; may notify again, but coalescing under the chat's single notification keeps this from stacking.
- **Reaction to a message that was deleted locally, or arriving before the original message** (out-of-order delivery): no notification if the reacted-to message can't be resolved as one of the user's own; never a crash or an orphan notification.
- **Burst of reactions** (e.g., 10 members react to one message): must collapse into the chat's one updating notification with a sensible summary, not 10 entries.
- **Reply chain**: Alex replies to Maya's reply, which quoted Sara — only the author of the *directly replied-to* message (Maya) gets escalation; Sara does not.
- **Reply-to-you while the target chat is open on screen**: follows today's rule for messages (no notification for the chat you're actively viewing).
- **Global "show notifications" off**: reactions and replies respect the master message-notification switch exactly as ordinary messages do; escalation for replies punches through the same suppressions mentions punch through today, and no more.
- **Preview privacy**: with the global "show preview" off or a per-chat generic-content preference, reaction and reply notifications must not leak message text; replies may still name the replier (mention-parity), reactions fall back to fully generic text.
- **Older senders / mixed versions**: messages from clients that predate this feature carry no new information; devices must handle their reactions/replies with the same rules (a reaction is a reaction regardless of sender version).

## Requirements *(mandatory)*

### Functional Requirements

**Reaction notifications**

- **FR-001**: The system MUST notify a user when another participant adds a reaction to a message that user authored, in both 1:1 and group chats.
- **FR-002**: The reaction notification MUST identify the reactor and the emoji and include a short preview of the reacted-to message, subject to the user's content-privacy settings: with previews disabled globally or the chat set to generic content, no message text or reactor identity leaks beyond what suppressed message notifications reveal today.
- **FR-003**: Reaction notifications MUST coalesce with the chat's existing notification (one updating entry per chat), never a separate per-reaction stack.
- **FR-004**: The two existing settings toggles for reactions (one for direct messages, one for groups, both defaulting to on) MUST gate this behavior and MUST be independently effective. No new settings are introduced.
- **FR-005**: Reaction notifications MUST respect every existing suppression layer — per-chat mute, per-chat notification preferences (delivery channels and content level), hidden-chat rules, and the global message-notification switch — and MUST NOT escalate past any of them.
- **FR-006**: The system MUST NOT notify for: reaction removals, reactions to messages the user did not author, the user's own reactions (including echoes from their other devices), or reactions in hidden chats beyond the existing traceless pattern.
- **FR-007**: Reaction notifications MUST work both while the app is open (in-app banner path) and while it is closed (system notification path), with exactly one surface notifying per event, consistent with the existing one-owner notification policy.

**Reply escalation in groups**

- **FR-008**: A group message that directly replies to a message the user authored MUST be treated as personally directed: it escalates past mute and the other suppression layers exactly as an @mention does today — no more, no less.
- **FR-009**: Reply escalation MUST be gated by the same per-chat "notify on mentions" preference that governs mention escalation; with it off, a reply-to-you notifies as an ordinary group message.
- **FR-010**: Under masked/generic content, an escalated reply MUST still name the replier in a content-safe form (parity with how escalated mentions name the mentioner) without revealing the message body.
- **FR-011**: Replies-to-you MUST count toward the chat's unread-mentions indicator and clear when the chat is read.
- **FR-012**: Reply escalation applies only in groups, only when the replied-to message was authored by the recipient, and never for self-replies. A message that both replies to the user and @mentions them MUST produce exactly one notification. 1:1 reply behavior is unchanged.

**Push-health invariant (applies to all of the above)**

- **FR-013**: Every push delivery that reaches a device MUST end in a user-visible outcome, even when the reaction or reply notification itself is suppressed by settings, mute, or hidden-chat rules. Suppressed deliveries MUST follow the same established visible-outcome pattern the app already uses for suppressed message deliveries (specs 2022/1034), because the platform revokes the push subscription after repeated deliveries that produce nothing visible. This feature MUST NOT introduce any new class of silent wakes.
- **FR-014**: Because the server cannot inspect sealed payloads (zero-knowledge boundary), all reaction/reply notification decisions MUST be made on the receiving device; no server-side filtering of these events may be introduced.

### Key Entities

- **Reaction event**: an existing sealed payload conveying reactor, emoji, target message, and add/remove; gains a notification decision on the receiving device but no new wire format.
- **Reply-to-you**: an existing group message whose reply reference targets a message authored by the recipient; classified on-device as an implicit mention for notification and unread-indicator purposes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When someone reacts to a user's message, the author sees a notification within 5 seconds of delivery while online, in both open-app and closed-app states.
- **SC-002**: A direct reply to the user's message in a muted group produces a notification in 100% of attempts (mentions preference on); a reply to someone else's message in the same muted group produces none.
- **SC-003**: With a reactions toggle off, zero reaction notifications are shown across at least 10 consecutive suppressed reaction deliveries to a closed app, and the device's push subscription remains active afterwards (no platform revocation).
- **SC-004**: A burst of 5+ reactions to the same chat results in at most one visible notification entry for that chat.
- **SC-005**: Both reaction toggles observably change behavior from the settings screen — the app no longer ships dead controls (verified by toggling each and confirming the corresponding behavior change).
- **SC-006**: No content leak: with previews off or generic content set, reaction and reply notifications reveal no message text in any tested scenario.

## Assumptions

- **Changing a reaction** (swapping one emoji for another) counts as a new reaction add and may notify again; coalescing bounds the noise. Removals never notify.
- **Unread counts are unchanged**: reactions are not messages and do not increment the chat's unread message count; only the notification (and existing badge rules) surface them. Replies-to-you additionally light the unread-mentions indicator, as mentions do today.
- **No new sounds or settings**: reaction notifications reuse the chat's existing sound/preference machinery; the only user-facing controls are the two existing (currently dead) toggles and the existing per-chat preferences.
- **"Reply" means an explicit reply reference** to a specific message; quoting or thematically responding without the reply affordance does not escalate.
- **Escalation parity is intentional**: replies punch through exactly the suppressions mentions punch through today (per spec 1020), including the hidden-chat exception — hidden chats never escalate anything.
- **Existing wire formats suffice**: reactions and reply references already travel in sealed payloads today; this feature changes only receiving-device behavior, so no compatibility window or server change is expected.
- **Both delivery paths are in scope**: open-app (in-app banner) and closed-app (system notification) must behave consistently under the one-owner policy (spec 2010).
