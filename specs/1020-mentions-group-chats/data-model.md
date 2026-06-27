# Data Model: @mentions in group chats

All additions are **optional** fields on existing IndexedDB stores (schemaless JSON) — no
`DB_VERSION` bump, no migration; absent = legacy/no-mention. Nothing new crosses the wire
in cleartext.

## 1. `MessagePayload` (sealed, E2EE) — `src/services/crypto/message.ts`

| Field | Type | Meaning |
|------|------|---------|
| `mentions?` | `string[]` | member user-ids explicitly mentioned in this message |
| `mentionsEveryone?` | `boolean` | broadcast mention; only honored if sender is the group owner |

- Set on send (built from the composer's resolved mention tokens). Read on receive.
- Sealed via the existing `JSON.stringify(payload)` in `sealMessage`; parsed in
  `openMessage`/`openMessagePreview`. **Server never sees these in cleartext.**

## 2. `Message` (local) — `src/db/types.ts`

| Field | Type | Meaning |
|------|------|---------|
| `mentions?` | `string[]` | mirror of the payload's mentioned ids (for rendering + seen tracking) |
| `mentionsEveryone?` | `boolean` | mirror of the payload flag (already validated against owner on receive) |

Rendering resolves each id → the member's CURRENT display name (FR-009); a mention of self is
emphasized (FR-008).

## 3. `Chat` (local) — `src/db/types.ts`

| Field | Type | Default | Meaning |
|------|------|---------|---------|
| `unreadMentions?` | `number` | `0`/unset | count of unseen messages mentioning self in this chat — SEPARATE from `unread` (FR-018) |
| `notifyMentions?` | `boolean` | `true` when unset | per-chat "Notify for mentions even when muted" (FR-013) |
| `createdBy?` | `string` | unset (legacy) | the group **owner** (creator) — v1 "admin" for `@everyone` gating (D1) |

- `unreadMentions`: ++ on receive when the message mentions self (or a validated `@everyone`) and
  the chat isn't active; cleared with `unread` in `markChatRead`, and on delete / leave (FR-020).
- `notifyMentions`: surfaced in chat/group notification settings; group chats only.
- `createdBy`: stamped in `createGroup`; carried in the group `create` card so members learn the
  owner (D1). Absent on pre-feature groups → `@everyone` simply unavailable there until re-derived.

## 4. `ChatNotifyPrefs` — `src/db/queries.ts` / `notify-prefs.ts`

Add `notifyMentions?: boolean` alongside `webPush`/`inApp`/`content`. `getChatNotifyPrefs` returns
it (default true); `setChatNotifyPrefs` writes it to the `Chat` record.

## 5. `NotifyInput.pref` — `src/services/notify-policy.ts` (the shared predicate)

Add `isMention: boolean`. Computed by each caller (foreground `notify.ts`, SW `sw-inbox.ts`) as:

```
isMention = chat.notifyMentions !== false
            && ( payload.mentions?.includes(selfId)
                 || (payload.mentionsEveryone && senderId === chat.createdBy) )
```

Escalation inside `notificationOwner` when `pref.isMention` is true:
- the `muted` gate does NOT suppress;
- `content:'none'/'generic'` is allowed to name the mentioner;
- the global "Show notifications" master + OS DND are still respected (checked before the policy);
- if `notifyMentions === false`, `isMention` is false → no escalation (normal muted behavior).

## 6. Derived / local-only (never synced to server)

- `unreadMentions`, the "@" row marker, and jump-to-mention target are derived on-device from
  received messages.
- `notifyMentions` rides the existing encrypted own-data sync (like other per-chat prefs); it is
  never sent to the server in cleartext.

## State transitions (unread-mentions)

```
receive msg mentioning self, chat not active   -> unreadMentions++
open chat / markChatRead                        -> unreadMentions = 0  (with unread)
that message deleted / user leaves group        -> recompute/clear (FR-020)
```
