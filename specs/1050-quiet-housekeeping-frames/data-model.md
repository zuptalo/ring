# Data Model: Push Classes, Conversation Mutes & Notification Routing (spec 1050)

## Server

| Change | Shape | Notes |
|---|---|---|
| Migration `0028_push_prefs.sql` | `ALTER TABLE push_subscriptions ADD COLUMN prefs JSONB NOT NULL DEFAULT '{}'` | Full-state replace; dies with the row (FR-011); `{}` = push everything (interop). |
| WS frame | `+ class string, prid string` (optional) | Read in `case "msg"` only; never persisted; absent class = `message`. |
| `Notifier.Notify` | `(ctx, userID, class, prid)` | Existing debouncers keyed as today; the per-subscription gate applies contract rows 3–8. |
| `NotifyPost` | `(ctx, recipient, author)` | author feeds postSenders overrides. |
| `wakeConn` | presence-gated via the hub | fixes push-while-in-app for connection events. |

## Client (no new object stores; no DB_VERSION bump)

| Entity/field | Shape | Notes |
|---|---|---|
| `Chat.prid?` | string (b64url, 16 random bytes) | minted by first up-to-date sender; adopt-on-receive; conflict → lexicographically smaller wins; persisted via existing `put('chats')`. |
| `MessagePayload.prid?` | string, INSIDE the sealed payload | share/adopt channel; opaque passthrough for `messaging.ts`. |
| Outbox row | `+ class, prid` | computed per recipient at seal time; sent as frame fields by `useSync`. |
| Contact wall flag | `alwaysPostAlert?: boolean` (stored like the existing per-person wall mute) | the new per-friend "Notify me about new posts". |
| `push-prefs.ts` (new, pure) | `(settingsSnap, chatsSnap, hiddenSet, wallPrefs) → {classesOff, mutedPrids, postSenders}` | SC-011 hidden-exclusion guard tests this function directly. |

## Class assignment inputs (all already on-device at send time)

reaction target author + `message.reactions` set (co-reactors) · `payload.mentions` /
`mentionsEveryone` / `reply.senderId` per recipient · card type (create vs invite) ·
removal flag · everything else defaults per contracts/push-routing.md.

## Invariants (unit-enforced)

1. Hidden chats never contribute a prid to prefs (structural filter before derivation).
2. Prefs POST is full-state replace; no incremental mutation anywhere.
3. Relay storage writes are byte-identical for every class (server test diffing enqueue
   behavior across classes).
4. `mention` class assigned ONLY when the specific recipient is mentioned/replied-to
   (never broadcast), and always pushes server-side.
5. Absent class/prid/prefs at every layer ⇒ exactly pre-1050 behavior.
