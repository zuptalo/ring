# Phase 1 Data Model: Reliable Push & Redesigned In-App Notifications

All new persistent state is **device-local** (IndexedDB) — nothing here is added
to the server schema. No `DB_VERSION` bump (optional fields on the existing
`chats` store; read-time defaults).

## Entity: Chat (extended) — IndexedDB `chats` store

New **optional** fields on `src/db/types.ts` `interface Chat`, alongside the
existing device-local `mutedUntil?`:

| Field | Type | Default (read-time) | Synced? | Meaning |
|---|---|---|---|---|
| `notifyWebPush?` | `boolean` | `true` | No | When `false`, suppress system/web-push notifications **and call rings** for this chat while the app is closed/backgrounded (badge still updates). |
| `notifyInApp?` | `boolean` | `true` | No | When `false`, suppress in-app banners for this chat while the app is open. |
| `notifyContent?` | `'full' \| 'generic' \| 'none'` | `'full'` | No | How much a notification reveals for this chat: `full` = decrypted sender + text; `generic` = placeholder ("New message"); `none` = badge only (no banner/system text anywhere). |

**Validation / rules**:
- Absent field ⇒ default (back-compat; existing chats unchanged → FR-025).
- `notifyContent='none'` forces badge-only regardless of `notifyWebPush`/
  `notifyInApp` surfaces (nothing is revealed) → FR-024.
- **Most-private-wins** with global settings (FR-023): effective behavior =
  min(global, per-chat). A global "off" cannot be overridden louder by a chat.
- Never written to own-data sync (like `mutedUntil`) → FR-026, Principle I.

**State composition (effective decision for one incoming message)**:

```
muted(chat) OR notifyWebPush=false (closed) ........→ no system notify; badge only; calls silenced (FR-022a)
global inapp.enabled=false (open) ..................→ no banner
notifyInApp=false (open) ...........................→ no banner for this chat
notifyContent: full → decrypted preview
               generic → "New message" placeholder
               none → badge only, no banner/system text
```

## Entity: Global notification settings — IndexedDB `settings` store

| Key | Type | Default | Meaning |
|---|---|---|---|
| `notifications.inapp.enabled` | `boolean` | `true` | **New** global master switch. When `false`, no in-app banners appear for any chat (system push + badge unaffected) → FR-018. |

Existing keys are unchanged and still apply: `notifications.inapp.style`
(none/banners/alerts), `notifications.message.show`, `notifications.showPreview`,
`notifications.push`, `notifications.badge`, sound/vibrate keys. Friend-request
notifications are **not** gated by any setting (always fire) → FR-008/010.

## Entity: Notification event (client, in-memory) — extends `IncomingNotice`

`src/services/notify.ts` `IncomingKind` gains connection-outcome handling. The
`'request'` kind already exists; add explicit accept/reject system notices.

| Field | Notes |
|---|---|
| `kind` | `'message' \| 'request' \| 'system'` (accept/reject surface as `request`/`system` with resolved peer name where known). |
| `chatId?` | message deep-link + per-chat preference lookup key. |
| `name` / `body` | resolved client-side; for inbound friend requests the requester may be unknown → generic label. |

## Entity: Push tickle (wire, content-free) — server → client

| Tickle | Payload | TTL / topic | Trigger |
|---|---|---|---|
| message (existing) | `{"t":"msg"}` | 28d / `ring-msg` | relayed message, recipient not active-fresh |
| call (existing) | `{"t":"call"}` | 60s / none | call offer / ring loop |
| **connection (new)** | `{"t":"conn"}` | short-medium / `ring-conn` | request created / accepted / rejected |

The `conn` tickle carries **no** identity or state — the SW resolves specifics
from `GET /v1/connections`.

## Server schema

**No changes.** Reuses `push_subscriptions` (delivery), the connections tables
(state), and `relay_queue` (messages). No new migration; `SECRETS_KEY` untouched.
