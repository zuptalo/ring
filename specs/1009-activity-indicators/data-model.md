# Phase 1 Data Model: Ephemeral Activity Indicators

This feature introduces **no persisted data** — no IndexedDB object store (no
`DB_VERSION` bump) and no Postgres table/column/migration. The only "model" is a
volatile in-memory shape on the client and the wire frame (see
`contracts/activity-frame.md`). Nothing here is written to disk on the client or
server.

## Entity: ActivitySignal (ephemeral, in transit + in volatile UI state only)

Represents "this participant is doing X in this conversation right now."

| Field | Type | Notes |
|---|---|---|
| `conversationId` | string | The 1:1 peer id or the group/chat id this activity belongs to. |
| `senderId` | string | The composing user (server-stamped `from`). Used as the coalescing key (so multiple devices of one sender collapse to one indicator). |
| `kind` | `'typing' \| 'recording-audio' \| 'recording-video'` | Carried **sealed** on the wire; plaintext only inside the two endpoints. |
| `state` | `'active' \| 'stopped'` | `active` = start/keepalive; `stopped` = explicit stop. Also sealed. |
| `expiresAt` | timestamp (client clock) | Recipient-side only. Set to "now + ~6s" on each `active` signal; entry is removed when passed (FR-007). |

- **Lifetime**: exists only while in transit and for at most ~6s in recipient
  memory after the last `active` signal. No identity, no history, no storage.
- **Uniqueness / coalescing**: keyed by `(conversationId, senderId)`. A second
  device of the same sender updates the same entry (FR-011).
- **State transitions** (recipient view):
  - *absent* → *active*: an `active` signal for a new `(conversation, sender)`.
  - *active* → *active*: a keepalive or kind-change refreshes `expiresAt` /
    swaps `kind` (e.g. typing → recording-audio replaces, never stacks).
  - *active* → *absent*: a `stopped` signal, OR `expiresAt` elapses, OR the
    socket goes offline / the user logs out (`clearTyping()`).

## Client in-memory store shape

`src/composables/useTyping.ts` (modeled on `src/composables/usePresence.ts`):

- A module-level `reactive(new Map<conversationId, Map<senderId, Entry>>())`
  where `Entry = { kind, expiresAt, timer }`. Explicitly **never** persisted to
  IndexedDB and **never** synced (same guarantee as `usePresence`).
- Derived getters the UI consumes:
  - `activityFor(conversationId)` → the coalesced label inputs for that chat
    (the set of `{senderId, kind}` currently active).
  - For 1:1: at most one entry → drives the header/list label.
  - For groups: the set of active senders → coalesced to up to two names then
    "several people…".
- `applyActivity(frame)` merges/refreshes an entry and (re)arms its ~6s timer.
- `clearTyping()` wipes the whole map; wired into the same offline/logout paths
  as `clearPresence()`.
- **Reciprocity gate**: when `privacy.activityIndicators` is off, `applyActivity`
  is a no-op (incoming activity is not rendered), and emission is suppressed at
  the source (nothing is sent).

## Relationship to existing models

- **No coupling to the messages store.** An ActivitySignal is not a message and
  MUST NOT pass through `queries.ts` / the messages object store or
  `messaging.ts` (which stays crypto-only). It is transport + ephemeral UI state.
- **Mirrors presence.** Same volatility, same clear-on-offline/logout discipline,
  same "live fast-path" dispatch — but delivered peer-to-peer (relay), not
  computed/broadcast by the server.
