# Contracts: Reliable Push & Redesigned In-App Notifications

Interface contracts this feature exposes/changes. The wire stays content-free.

## 1. Server: Notifier interface (Go)

`server/internal/ws/hub.go` — extend the `Notifier` interface consumed by the
hub and connection handlers:

```go
type Notifier interface {
    Notify(ctx context.Context, userID string)      // existing — {"t":"msg"}
    NotifyCall(ctx context.Context, userID string)  // existing — {"t":"call"}
    NotifyConn(ctx context.Context, userID string)  // NEW     — {"t":"conn"}
}
```

`server/internal/push/push.go` — implement on `*Notifier`:

```go
// NotifyConn pushes a content-free CONNECTION tickle to every subscription of
// userID (high urgency, collapsible via topic "ring-conn"). Carries no identity.
func (n *Notifier) NotifyConn(ctx context.Context, userID string) {
    n.notify(ctx, userID, connParams())   // connParams: {"t":"conn"}, topic "ring-conn"
}
```

`server/internal/api/router.go` — the `Handlers.Notifier` field type gains
`NotifyConn` automatically (already satisfied by `*push.Notifier`).

## 2. Server: connection handlers fire the tickle

`server/internal/api/connections_handlers.go` — after the existing live-frame
`notifyConn(...)`, also wake an offline peer:

```go
// requestConnection (state == "pending"):
h.notifyConn(req.Target, map[string]any{"t": "connect-req", "from": uid})
h.Notifier.NotifyConn(r.Context(), req.Target)        // NEW

// acceptConnection:
h.notifyConn(req.Requester, map[string]any{"t": "connect-update", "from": uid, "state": "accepted"})
h.Notifier.NotifyConn(r.Context(), req.Requester)     // NEW

// rejectConnection:
h.notifyConn(req.Requester, map[string]any{"t": "connect-update", "from": uid, "state": "rejected"})
h.Notifier.NotifyConn(r.Context(), req.Requester)     // NEW
```

Behavior: fire-and-forget (like message push); `nil` Notifier is a no-op
(test/fakes). No new endpoint; no new payload fields on the wire frames.

## 3. Client: service worker push handling

`src/sw.ts` `pushKind()` decodes a third kind:

```
{"t":"msg"}  → 'msg'   (existing)
{"t":"call"} → 'call'  (existing)
{"t":"conn"} → 'conn'  (NEW)
```

On `conn`: sync connection state (`GET /v1/connections`), diff against local DB,
and `showNotification` a generic notice:
- inbound new request → "New friend request" → deep-link `/tabs/contacts`
- outbound accepted   → "Friend request accepted" → deep-link new contact/chat
- outbound rejected   → "Friend request declined"

No decryption required; no identity in the tickle. Always fires (FR-008/010).

On `msg` / `call`: before showing, read per-chat prefs (below) from IndexedDB and
apply suppression / content-visibility / call-mute (most-private-wins).

## 4. Client: per-chat preference accessors

New `src/services/notify-prefs.ts` (read-through cache, refreshed on the `chats`
+ `settings` change bus, mirroring `notify.ts` `NotifyPrefs`):

```ts
type ContentVisibility = 'full' | 'generic' | 'none';

interface ChatNotifyPrefs {
  webPush: boolean;        // default true   (Chat.notifyWebPush)
  inApp: boolean;          // default true   (Chat.notifyInApp)
  content: ContentVisibility; // default 'full' (Chat.notifyContent)
  mutedUntil?: number;     // existing
}

function getChatNotifyPrefs(chatId: string): Promise<ChatNotifyPrefs>;
function setChatNotifyPrefs(chatId: string, patch: Partial<ChatNotifyPrefs>): Promise<void>;
function inAppGloballyEnabled(): Promise<boolean>; // notifications.inapp.enabled, default true
```

`Chat` (`src/db/types.ts`) gains optional `notifyWebPush?`, `notifyInApp?`,
`notifyContent?` (see data-model.md). Persisted via the existing chat update path;
never synced.

## 5. Settings schema (declarative)

`src/settings/schema.ts` — add a global master toggle to the Notifications screen
(stock `ion-toggle` via the schema):

```ts
// in the `notifications` page groups:
{ type: 'toggle', title: 'In-app notifications', key: 'notifications.inapp.enabled', default: true }
```

When `false`, `notifyIncoming` shows no banner/alert for any chat (FR-018). The
existing `notifications-inapp` sub-page (style/sounds/vibrate) still applies when
the master is on.

## 6. Per-chat controls (chat settings/info UI)

A new "Notifications" section in the chat's settings/info page, built from stock
Ionic (`ion-list`, `ion-item`, `ion-toggle`, `ion-radio-group`/`ion-segment`):

| Control | Binds to | Values |
|---|---|---|
| Web push (this chat) | `Chat.notifyWebPush` | on / off |
| In-app banners (this chat) | `Chat.notifyInApp` | on / off |
| Show content | `Chat.notifyContent` | Full / Generic / Badge only |

Existing per-chat **Mute** remains; the section documents that mute / web-push-off
also silences this chat's calls (FR-022a).

## 7. Acceptance hooks (for e2e / drive)

- Friend-request push: with the recipient's app closed, a `conn` tickle yields a
  notification (US2 / SC-004).
- Banner: rendered below the header, greenish translucent, dismissible, never over
  header/composer/call controls (US3 / SC-005).
- Global in-app off ⇒ zero banners; per-chat in-app off ⇒ banners for other chats
  only (US4 / SC-006).
- `notifyContent='none'` ⇒ badge increments, no content anywhere (US5 / SC-007).
- No new plaintext on the wire; per-chat prefs never sent to server (SC-008).
