# Research — Message status and presence on the chat list

Phase 0 decisions. Each resolves a design fork the plan depends on.

## D1. How the list learns the last message's tick

**Decision**: Denormalize a compact `lastTick` onto the Chat summary, maintained in `queries.ts` (a) wherever `lastMessage`/`lastKind`/`lastMessageTime` are already set, and (b) when an incoming receipt advances the status of the chat's *last outgoing* message.

**Rationale**: The Chats list is driven by a single `useLiveQuery` over the `chats` store. Denormalizing keeps every row's tick available synchronously (no per-row message lookup on render) and reactive (updating the Chat record re-fires the live query, so the tick advances pending→sent→delivered→seen without reopening the chat — SC-002/FR-005). It mirrors how `lastMessage` is already maintained.

**Alternatives considered**:
- *Per-row lookup of the last message at render time* — N async reads on every list paint; janky and harder to keep reactive. Rejected.
- *Store only `lastMessageId` + `lastOutgoing`, look up reactively* — still a per-row reactive read; more moving parts than a denormalized tier. Rejected.

**Cost acknowledged**: the receipt-handling path must, when it advances a message that is a chat's last outgoing message, also update that chat's `lastTick`. This is the one new write coupling and is called out as a task. Legacy Chat records with no `lastTick` compute it lazily from the last message on first read (no migration).

## D2. Reuse the conversation's tick logic

**Decision**: Extract the inline `tickInfo`/`statusIcon` logic from `ChatDetailPage.vue` into a pure `lastMessageTick(...)` in `src/services/message-status.ts` returning a **tier** enum (`'pending' | 'sent' | 'delivered' | 'seen' | 'failed' | 'none'`), and add a tiny `MessageTick.vue` that maps a tier to the `ion-icon` glyph + `.seen` blue. `ChatDetailPage`, `ChatListItem`, and `PinnedChatsGrid` all consume the same helper + component.

**Rationale**: One source of truth prevents the list and the conversation from drifting (the spec's whole premise is "same states as inside the chat"). `message-status.ts` is already the pure reducer home (`STATUS_ORDER`, `groupProgress`), so the tier logic belongs there; the glyph/`ion-icon` rendering stays in a component (Principle XI). The reciprocity gate (`seenReceipts`) is an input to the helper so "seen" caps at "delivered" identically everywhere (FR-004).

**Alternatives considered**: leaving the logic inline and copying it into the list — guarantees drift, rejected.

## D3. Group online count — no meaningful new subscription

**Decision**: Compute a group's online set as `participantIds ∩ { userId : peerPresence(userId)?.online }`, i.e. intersect the local roster with contacts the client already sees as online. Do **not** add broad group-member presence subscriptions. Optionally issue a **bounded** `subscribePresence(members)` for the *currently open* group only, to catch the rare inbound-only contact edge.

**Rationale (the key finding)**: The server gates presence strictly by the 1:1 contact graph (`store.PresenceAudience`), and the client already subscribes to *all* contacts (`useSync.sendPresenceSub` → `listContacts()`). Therefore presence for **every group member the client is permitted to see is already in the presence map** — a non-contact member would be gated to offline/unknown by the server even if subscribed, so subscribing to them yields nothing. This dissolves the spec's assumed scaling cost (the spec deliberately left the mechanism to the plan) while producing exactly the specified behavior: strangers never counted, honest partial count. The optional open-group subscription is a small, bounded safety net for the asymmetric case where someone added you (server would share) but you haven't added them (so they're not in `listContacts()`); scoped to one open conversation it is negligible.

**Alternatives considered**:
- *Subscribe to all members of all groups on connect* — potentially large sub set for no gain in the common case (contacts already covered). Rejected as the default; folded into the optional bounded open-group case only.
- *Server-side group presence aggregate* — breaks Principle I outright. Rejected.

**Zero-knowledge check**: unchanged wire; the count is a client-side set intersection over data already received. No new metadata leaves the device.

## D4. Labeling rule

**Decision**: Let `M` = group members, `online` = the D3 set, `contacts` = your contact set.
- If `M ⊆ contacts` → `"{online.size} online"`.
- Else (mixed) → `"{online.size} online contacts"`.
- If `online.size === 0` → render nothing (no header line, no tile/row badge).

Compact form on the pinned tile / list row (`N online`); fuller form in the group header where there's room.

**Rationale**: The word "contacts" makes a partial count honest without a disclaimer (the user's chosen wording). Staying silent at zero matches how a 1:1 shows nothing when offline/unknown (FR-014), keeping surfaces quiet.

## D5. Per-member dots inside a group (Story 4)

**Decision**: On the member avatars already rendered on group messages (the collapsed sender-group avatars in `ChatDetailPage.vue`), render the existing `.presence-dot` scaled to the smaller avatar, shown for members in the D3 online set. `activityFor(member)` (typing/recording) already takes precedence over presence in the header logic — reuse that so a composing member shows the activity affordance instead of the plain dot (FR-024).

**Rationale**: Reuses the exact presence source and dot styling; guarantees the dotted avatars equal the header count (SC-007) because both read the same D3 set. Sizing in proportion to the in-conversation avatar (FR-023) is a CSS-variable/`em`-based tweak on the shared dot, not a new element.

## D6. Placement & styling latitude

Exact corner offsets, dot diameter at tile vs. conversation avatar size, and whether the list-row group count sits in the preview row or the meta column are left to implementation, constrained to: reuse `.presence-dot` and `--ring-*`/success tokens, keep the unread badge legible alongside new indicators (FR-009), and work in light+dark + RTL (Principle X/XI). No new palette values.
