# Phase 1 Data Model: Friends-only messaging & settings refinements

No new or altered IndexedDB object stores. No `DB_VERSION` bump. No server tables or migrations.

The friends-only gate reads two **pre-existing** data structures; it introduces no fields:

## Connection ledger (existing)

- **Store/shape**: `settings` entry keyed `connectedPeers` → `Record<peerUserId, boolean>`.
- **Meaning**: a peer present (and `true`) is an accepted connection whose direct messages are
  delivered.
- **Writers (existing)**: `markContactConnected` (on invite auto-connect, accepting a request,
  `requestFriend`, and after a message from an already-passing sender).
- **Reader (this feature)**: `isPeerConnected(from)` in `handleIncoming` — one half of the gate.

## Contacts (existing)

- **Store**: `contacts` object store (`Contact` records).
- **Reader (this feature)**: `getContact(from)` in `handleIncoming` — the other half of the gate.
- The gate is `deliver ⟺ getContact(from) !== undefined || isPeerConnected(from)`.

## Settings keys (existing; changed membership only)

- **Removed**: `privacy.blockUnknown` — deleted from the schema tree and from the `ownsync.ts`
  synced-key allowlist. Any previously-stored value becomes inert.
- **Relocated (unchanged value/semantics)**: `privacy.disableLinkPreviews` — moved from the removed
  Advanced node onto the Privacy page; still synced; still gates sender-side link-preview generation.
- **Added (content only, no persisted state)**: `help-*` schema nodes are static content; they store
  nothing.

## State transitions

Inbound 1:1 message → `handleIncoming`:

```
unknown sender (not contact, not connected)  ──drop (ack; discarded)──▶  never stored
known/connected sender                       ──deliver──▶  stored; sender marked connected
```

No other lifecycle changes.
