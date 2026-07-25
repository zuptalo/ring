# Data Model — Message status and presence on the chat list

Nothing new is persisted server-side and nothing new is synced. Two client-side
shapes are introduced: one tiny denormalized field on the existing Chat summary,
and one purely-derived view computed on demand.

## 1. `LastTick` — denormalized onto the Chat summary

A compact display tier for the chat's most recent message, used to render the
list-row / pinned-tile tick without a per-row message lookup.

```ts
// src/db/types.ts
export type LastTick =
  | 'none'        // last message is incoming, or there is no message → render nothing
  | 'pending'     // outgoing, still sending (clock)
  | 'sent'        // outgoing, single check
  | 'delivered'   // outgoing, grey double check
  | 'seen'        // outgoing, blue double check (only when seen-receipts reciprocal)
  | 'failed';     // outgoing send failed → render nothing (no success glyph)

export interface Chat {
  // ...existing fields (lastMessage, lastKind, lastMessageTime, ...)
  lastTick?: LastTick;   // optional: legacy records compute it lazily on read
}
```

**Derivation** (pure, in `message-status.ts`): from the chat's last message —
`none` if incoming/absent; otherwise map the message's `status` (1:1) or
`groupProgress` tier (group) to the tier above, capping at `delivered` when
`seenReceipts` is off. This is the same logic the conversation view already uses,
extracted so both share it.

**Maintenance** (`queries.ts`):
- Set alongside `lastMessage`/`lastKind`/`lastMessageTime` whenever the chat's
  last message changes (send, receive).
- When an inbound receipt advances the status of the chat's **current last
  outgoing** message, recompute and write `lastTick` on that Chat so the list
  advances live (pending→sent→delivered→seen) via the existing `chats` live query.
- Legacy Chat records without `lastTick`: computed on read from the last message,
  so **no `DB_VERSION` bump / migration** (additive, index-free field).

**Reactivity**: writing the Chat record fires the idb change bus → the Chats-list
`useLiveQuery` re-renders. No new subscription.

## 2. `GroupOnline` — derived, never stored

Computed on demand for a group from local roster + the in-memory presence map.

```ts
// returned by useGroupPresence(chat)
export interface GroupOnline {
  count: number;            // members who are my contacts AND online AND sharing
  onlineIds: string[];      // that member set (drives per-member dots, Story 4)
  allContacts: boolean;     // true → every member is my contact ("N online")
                            // false → mixed group ("N online contacts")
  label: string;            // '' when count === 0; else "N online" / "N online contacts"
}
```

**Derivation** (pure over inputs):
- `members = chat.participantIds`
- `contacts = ` your contact-id set
- `onlineIds = members.filter(id => contacts.has(id) && peerPresence(id)?.online)`
- `allContacts = members.every(id => contacts.has(id))`
- `count = onlineIds.length`; `label` per the rules above (empty at 0/unknown).

**Zero-knowledge**: a member not in `contacts` is never counted and never gets a
dot; the server already withholds their presence, so the client cannot and does
not infer it. Purely a set intersection over data already received.

**Inputs already available**: `participantIds` (local), the contact set
(`listContacts()` / a `Set`), and `peerPresence()` (already populated for all
contacts via the existing subscription). No new persistence, no new network for
the common case; an optional bounded `subscribePresence(members)` for the open
group only (see research D3).

## State & lifecycle

- `LastTick` lives as long as the Chat summary; it is display-only and derivable,
  so it is safe to drop/recompute at any time.
- `GroupOnline` is ephemeral per render (recomputed reactively from the presence
  map); it is never written to IndexedDB and never sent to the server, matching
  the existing ephemeral-presence rule.
