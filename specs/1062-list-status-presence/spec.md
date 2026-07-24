# Feature Specification: Message status and presence on the chat list

**Feature Branch**: `feat/1062-list-status-presence`

**Created**: 2026-07-24

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "In WhatsApp you can see the state of the last message right from the Chats list without going inside to see if it is sent, delivered or seen — please add that to Ring. For pinned chats there is no last-message preview, so if there is an outgoing message and nothing has arrived after it, show the pending/single/double/double-seen state at the bottom-left of the avatar, and show the online status at the bottom-right where the green dot already lives in the chats list. In group chats, if more than one other member is online, show an online count, and show the online count inside group chats too (where 1:1 shows the online status) — Online × N or whatever has a better UX/UI design."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See my last message's delivery status from the Chats list (Priority: P1)

A user sends a message and returns to the Chats list. Without opening the conversation, they can see whether their most recent message is still pending, has been sent, delivered, or seen — the same tick states shown inside the conversation, surfaced on the list row.

**Why this priority**: This is the core of the request and the highest-frequency payoff — every user checks "did it go through / did they read it?" many times a day. It reuses Ring's existing message-status model and tick glyphs, so it delivers the most value for the least new surface area, and it stands alone as a shippable slice.

**Independent Test**: Send a message in a 1:1 chat, go to the Chats list, and confirm the row shows a pending clock; after the recipient's device acknowledges, confirm it advances to a single check (sent), then a double check (delivered), then the "seen" state once read. Confirm the tick disappears/does not apply when the most recent activity in the chat is an incoming message.

**Acceptance Scenarios**:

1. **Given** my last message in a chat is outgoing and still sending, **When** I view the Chats list, **Then** that chat's row shows the pending (clock) indicator.
2. **Given** my last message was delivered but not yet read, **When** I view the Chats list, **Then** the row shows the delivered (grey double-check) indicator.
3. **Given** my last message has been seen and seen-receipts are mutually enabled, **When** I view the Chats list, **Then** the row shows the seen (blue double-check) indicator.
4. **Given** the most recent message in a chat is incoming (the other person replied after my last message), **When** I view the Chats list, **Then** no outgoing status indicator is shown for that chat (the incoming preview stands on its own).
5. **Given** I have disabled seen-receipts (so I do not share mine), **When** my delivered message is read by the recipient, **Then** the list row does not advance past the delivered state (the seen state stays suppressed, matching in-conversation behavior).

---

### User Story 2 - See status and presence on pinned chat tiles (Priority: P2)

A user pins their most important chats. Pinned chats render as avatar tiles with no message preview, so the tick and presence information has nowhere to appear today. This story places the last-outgoing-message status at the bottom-left corner of the tile avatar and the online presence dot at the bottom-right corner, so a pinned tile communicates both "state of my last message" and "are they online" at a glance.

**Why this priority**: Pinned chats are the user's highest-value conversations but currently the most information-poor surface (avatar + name only). This directly addresses the user's specific request and reuses the exact indicators built in Story 1 and the existing presence-dot pattern. It depends on Story 1's derived last-message status, so it comes second.

**Independent Test**: Pin a 1:1 chat, send a message, and confirm the tile shows the corresponding tick at the avatar's bottom-left. Have the peer come online (sharing presence) and confirm the green dot appears at the avatar's bottom-right; have them go offline and confirm it disappears. Confirm both corners can be shown at once without overlapping.

**Acceptance Scenarios**:

1. **Given** a pinned 1:1 chat whose most recent message is outgoing, **When** I view the pinned grid, **Then** the tile shows the last message's tick state at the avatar's bottom-left corner.
2. **Given** the pinned chat's peer is online and sharing their online status with me, **When** I view the pinned grid, **Then** the tile shows the green online dot at the avatar's bottom-right corner.
3. **Given** the pinned chat's most recent message is incoming, **When** I view the pinned grid, **Then** no outgoing tick is shown at the bottom-left corner (the corner stays empty).
4. **Given** a pinned chat's peer is offline or hides their presence, **When** I view the pinned grid, **Then** no online dot is shown.
5. **Given** a pinned tile already shows an unread badge, **When** the tick and/or presence indicators also apply, **Then** all indicators remain legible and do not visually collide.

---

### User Story 3 - See how many people are online in a group (Priority: P3)

A user wants to know, at a glance, how many people are around in a group conversation — both from the chat list/pinned surface and from inside the group. Because Ring is zero-knowledge and the server has no knowledge of group membership, the count reflects only the members the user can actually see presence for (their own contacts who share their online status). The wording makes this honest: a full-contact group reads "N online"; a mixed group reads "N online contacts" so a partial number is never mistaken for the whole roster.

**Why this priority**: This is the most valuable-but-constrained slice: it needs new presence subscriptions for group members and careful wording to stay honest under the zero-knowledge boundary. It is genuinely useful but not required for Stories 1–2 to ship, so it is sequenced last.

**Independent Test**: In a group where every member is the user's contact and two of them are online, confirm the group shows "2 online" in the header and a compact "2 online" on the list/pinned surface. In a group containing at least one member who is not the user's contact, confirm the wording becomes "N online contacts". With nobody visibly online, confirm no presence line/badge is shown.

**Acceptance Scenarios**:

1. **Given** a group where every member is my contact and 3 of them are currently online and sharing presence, **When** I open the group, **Then** the header shows "3 online".
2. **Given** a group that includes at least one member who is not my contact, and 2 members I can see are online, **When** I open the group, **Then** the header shows "2 online contacts".
3. **Given** a group where nobody I can see is currently online, **When** I view the group (header, list row, or pinned tile), **Then** no online count is shown at all.
4. **Given** a group with a visible online count, **When** I view its Chats-list row or pinned tile, **Then** a compact form of the count is shown (space-appropriate) consistent with the header count.
5. **Given** a member of the group who is not my contact comes online, **When** I view the group, **Then** the count does not increase for them (strangers never contribute to the count), preserving the zero-knowledge boundary.

---

### User Story 4 - See which specific members are online inside a group (Priority: P4)

Inside a group conversation, a member's avatar shows the same green online dot (sized in proportion to the in-conversation avatar) when that member is online and visible to the user. This makes the header count concrete — instead of only knowing "3 online", the user can see *which* three people the dots belong to. When a member is actively typing or recording, the existing activity indicator takes precedence over the plain online dot for that member.

**Why this priority**: This enriches the group online count (Story 3) from an aggregate into per-person visibility, so it depends on Story 3's member presence subscriptions being in place. It is a refinement rather than a prerequisite for the count, so it is sequenced last. It reuses the exact same contact-gated presence set as Story 3, so the dots and the count are always mutually consistent.

**Independent Test**: In a group with several members that are the user's contacts, bring two of them online (sharing presence) and confirm their avatars inside the conversation show the green dot at a proportionate size while offline members show none; have one of the online members start typing and confirm the activity indicator takes over from the plain dot for that member; confirm the number of dotted avatars equals the header count.

**Acceptance Scenarios**:

1. **Given** a group member who is my contact and is online sharing presence, **When** I view the group conversation, **Then** that member's avatar shows the green online dot, proportioned to the in-conversation avatar size.
2. **Given** a group member who is offline, hides presence, or is not my contact, **When** I view the group conversation, **Then** that member's avatar shows no online dot.
3. **Given** an online group member who begins typing or recording, **When** I view the group conversation, **Then** the existing activity indicator takes precedence over the plain online dot for that member.
4. **Given** a group with a visible online count of N in the header, **When** I look at the member avatars in the conversation, **Then** exactly the members counted in N show the online dot (dots and count agree).
5. **Given** a member's online state changes while I am viewing the group, **When** they come online or go offline, **Then** their avatar's dot appears or disappears live without reloading the conversation.

---

### Edge Cases

- **Last message is a reaction / system marker, not a chat message**: the status indicator reflects the most recent *outgoing chat message*, consistent with how the conversation view derives ticks; non-message markers do not produce a tick.
- **Failed outgoing message**: a failed send shows no success tick (matching in-conversation behavior, which suppresses ticks for `failed`); the row/tile should not imply delivery.
- **Group message partial delivery**: for a group, the last-outgoing-message status uses the same roster-based derivation as the conversation view (delivered/seen only when the whole roster reaches that tier). The list surfaces the resulting tier; the detailed "X/N" fraction remains an in-conversation detail, not required on the list.
- **Presence unknown vs. offline**: "unknown" (never received a presence frame / hidden) and "offline" both render as no dot and do not contribute to a group count — the surface stays quiet rather than showing "0 online".
- **Reciprocity**: a user who does not share their own online status cannot see others' online status (existing rule); in that case no dots and no group counts appear for them.
- **Large groups**: subscribing to presence for group members must scale to Ring's largest realistic groups without noticeable UI or battery cost; the count updates live as members come and go.
- **A member is in multiple of my chats**: presence for a person is consistent everywhere they appear (1:1 row, group count, pinned tile) — the same underlying online state drives all surfaces.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: nothing new. Message delivery/seen state already
  rides the existing sealed receipt frames; presence already rides the existing
  per-user, contact-gated `presence`/`presence-sub` frames. This feature only
  *renders* that existing data on more surfaces.
- **What is encrypted / client-only**: group membership stays entirely client-side
  (sender keys); the last-message tick is derived on-device from local messages;
  the group online count and per-member dots are composed on-device by intersecting
  the local group roster with the presence the client already receives for its
  contacts. None of it is sent to or stored by the server.
- **Unavoidably-visible metadata**: unchanged from today — the server already sees
  which sealed envelopes are relayed and gates presence by the 1:1 contact graph.
  This feature adds no new metadata: no group-aware request, no new endpoint, no
  new stored field, no new log or metric.
- **Why it stays zero-knowledge**: a co-member who is not the user's contact is
  invisible to the client by construction (the server withholds their presence),
  so the honest partial count cannot reveal more than the 1:1 contact graph already
  does. No server capability is added; a true "N of M" is deliberately *not*
  attempted because it would require the server to learn group membership.

## Requirements *(mandatory)*

### Functional Requirements

**Last-message status on the Chats list (Story 1)**

- **FR-001**: The system MUST display, on a chat's Chats-list row, the delivery status of that chat's most recent message when that message is outgoing (sent by the user) — using the same status stages already shown inside a conversation: pending, sent, delivered, and seen.
- **FR-002**: The system MUST NOT display an outgoing status indicator on a row when the chat's most recent message is incoming.
- **FR-003**: The system MUST NOT display a success indicator for a most-recent outgoing message that has failed to send.
- **FR-004**: The seen stage on the list MUST respect the existing seen-receipts reciprocity rule — if the user does not share seen-receipts, the list indicator MUST NOT advance to "seen" (it caps at delivered), identical to the in-conversation behavior.
- **FR-005**: The list status indicator MUST update live as the underlying message status advances (pending → sent → delivered → seen) without the user re-opening or manually refreshing the list.
- **FR-006**: For group chats, the most-recent-outgoing-message status on the list MUST be derived from the group's per-member receipt roster using the same rules as the conversation view (a tier is reached only when the whole roster reaches it).

**Pinned tile indicators (Story 2)**

- **FR-007**: On a pinned chat tile, the system MUST show the last-outgoing-message status indicator at the bottom-left corner of the tile's avatar, under the same conditions as FR-001–FR-006 (only when the most recent message is an outgoing, non-failed message).
- **FR-008**: On a pinned chat tile, the system MUST show the online presence dot at the bottom-right corner of the tile's avatar when the tile's peer is online and visible to the user, reusing the existing presence-dot visual.
- **FR-009**: The bottom-left status indicator and the bottom-right presence dot MUST be able to appear simultaneously on the same tile without overlapping each other, the unread badge, or the name.
- **FR-010**: Pinned-tile indicators MUST update live as message status and presence change.

**Group online count (Story 3)**

- **FR-011**: The system MUST compute a group's visible online count as the number of that group's members who are (a) the user's own contacts, (b) currently online, and (c) sharing their online status with the user. Members who are not the user's contacts MUST NEVER be counted.
- **FR-012**: When every member of a group is the user's contact, the system MUST label the count as "N online".
- **FR-013**: When a group includes at least one member who is not the user's contact (a mixed group), the system MUST label the count as "N online contacts" so a partial number cannot be mistaken for the full roster.
- **FR-014**: When a group's visible online count is zero or unknown, the system MUST show no online count on any surface (header, list row, pinned tile) — staying quiet rather than showing "0 online".
- **FR-015**: The system MUST show the group online count inside the group conversation header (where a 1:1 conversation header shows the peer's online/last-seen status, groups currently show nothing).
- **FR-016**: The system MUST show a space-appropriate form of the group online count on the group's Chats-list row and pinned tile, consistent with the header value.
- **FR-017**: To power the group count, the client MUST subscribe to presence for group members; the server MUST continue to gate each member's presence by the existing 1:1 contact graph, so a member who is not the user's contact always resolves to offline/unknown and never contributes to the count.

**Per-member online dots inside a group (Story 4)**

- **FR-022**: Inside a group conversation, the system MUST show the online presence dot on a member's avatar when that member is online and visible to the user, using the same contact-gated presence set that feeds the group online count (FR-011) — so the dotted avatars and the header count are always consistent.
- **FR-023**: The in-conversation member online dot MUST be sized in proportion to the in-conversation avatar (not the larger list/tile avatar), remaining legible without overwhelming the avatar.
- **FR-024**: When a group member is actively typing or recording, the existing activity indicator MUST take precedence over that member's plain online dot; when no member is composing, the plain online dots are what is shown.
- **FR-025**: A member who is offline, hides presence, or is not the user's contact MUST show no online dot, and the dot MUST update live as a member's online state changes.

**Cross-cutting / invariants**

- **FR-018**: The feature MUST NOT introduce any server knowledge of group membership and MUST NOT add a new server-side presence primitive; group presence is composed entirely on the client from existing per-user, contact-gated presence.
- **FR-019**: Presence used by this feature MUST remain ephemeral — never persisted to the device database and never synced.
- **FR-020**: All new indicators MUST respect the existing presence privacy settings (online-status sharing, last-seen sharing, and their reciprocity), showing nothing where the user or the peer has opted out.
- **FR-021**: The visual language for the status ticks and presence dot MUST reuse the existing in-app conventions (the conversation's tick glyphs and colors, including the blue "seen" tick, and the existing green presence dot) rather than introducing new iconography.

### Key Entities *(include if feature involves data)*

- **Chat last-message status**: a derived, read-only view of a chat summary that answers "is the most recent message outgoing, and if so what stage is it at (pending/sent/delivered/seen/failed)?". Derived from existing message and receipt data; not a new stored user record.
- **Peer presence**: an existing ephemeral, per-user online/last-seen state, contact-gated and server-authoritative; this feature consumes it for additional surfaces (pinned tiles, group members) but does not change its nature.
- **Group visible-online count**: a derived, read-only aggregate over a group's members — the count of members who are the user's contacts, online, and sharing presence — plus a flag for whether the group is "all contacts" or "mixed" (which selects the wording). Computed live on the client; never stored or sent to the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the Chats list alone, a user can correctly determine whether their most recent outgoing message in a chat is pending, sent, delivered, or seen, without opening the conversation, for 100% of chats whose latest message is outgoing.
- **SC-002**: The list/tile status indicator reflects a status change (e.g., delivered → seen) within the same time budget as the in-conversation indicator — no additional user action required — in at least 95% of observed transitions.
- **SC-003**: A pinned tile simultaneously communicates last-message status (bottom-left) and peer online state (bottom-right) with both indicators fully legible and non-overlapping across supported screen sizes and both light and dark themes.
- **SC-004**: For a group where every member is the user's contact, the displayed count exactly equals the number of those members who are online and sharing presence; for a mixed group, the count never includes any non-contact member and is labeled "online contacts".
- **SC-005**: In no scenario does any surface display a "0 online" (or equivalent empty) count; groups with no visible online members show nothing.
- **SC-006**: No plaintext, group-membership, or presence data crosses the client/server boundary beyond the existing per-user, contact-gated presence mechanism — verified by confirming the server receives no new group-aware requests and stores nothing new.
- **SC-007**: Inside a group conversation, the set of member avatars showing the online dot exactly matches the members counted in the header's online count, and each dot appears/disappears live within the same time budget as the header count when a member's online state changes.

## Assumptions

- The existing message-status model and the conversation's tick derivation are correct and are the single source of truth reused here; this feature surfaces that state on new UI, it does not redefine delivery/seen semantics.
- The existing presence mechanism (contact-gated, server-authoritative, ephemeral) is the only source of online state; "online" for the group count means exactly what it means for a 1:1 today.
- "The user's contact" means a member with whom the user has the mutual 1:1 relationship that already gates presence visibility; group co-members without that relationship are treated as strangers for counting/wording purposes.
- Subscribing to presence for group members is acceptable additional signalling and is expected to stay within reasonable cost for Ring's realistic group sizes; if a hard scaling limit is discovered during planning, it will be bounded there.
- The precise pixel placement, sizing, and exact micro-copy/format of the indicators and counts are delegated to the plan/implementation phase (the user explicitly invited design latitude); this spec fixes the behavior and the labeling rules, not the styling.
- Last-seen text for groups is out of scope; only a live online *count* is specified for groups (1:1 last-seen behavior is unchanged).

## Out of Scope

- Changing 1:1 presence or last-seen behavior, or the existing in-conversation tick rendering.
- Any server-side awareness of group membership, or a new server presence/aggregation primitive.
- A dedicated "who's online" roster screen or members list for a group. Per-member online *dots on existing avatars* inside the conversation are in scope (Story 4); a separate roster UI is not.
- Typing/recording activity indicators (an existing, separate feature) — unchanged here.
- Persisting or syncing presence or derived counts.
