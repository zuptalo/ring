# Phase 0 Research: Reliable Push & Redesigned In-App Notifications

This feature hardens an existing stack rather than building greenfield. The
research below records the key design decisions, grounded in the current code.

## Current-state map (verified)

- **Server push** is content-free: `push.go` sends `{"t":"msg"}` (28-day TTL,
  topic `ring-msg`, urgency high) and `{"t":"call"}` (60s TTL, no topic). The
  `Notifier` interface (`ws/hub.go`) is `{ Notify(ctx, userID); NotifyCall(ctx, userID) }`.
- **Message relay**: `EnqueueRelay` durably queues for the recipient; the server
  pushes only when the recipient is not "active-fresh" on a live socket
  (`isActiveFresh`, ~20s pong window). The SW drains via `GET /v1/relay/pending`
  which is **read-only** (records delivery, never deletes). A frame is deleted
  only when the client acks: WS `{"t":"ack","refId":...}` (`hub.go`) or
  `POST /v1/relay/ack` (`relay_handlers.go`) — both then emit the sender's
  "delivered" receipt.
- **Friend requests**: `connections_handlers.go` `requestConnection` /
  `acceptConnection` / `rejectConnection` call `notifyConn` → `Hub.Send` (live
  frame only). **No push Notifier call today** → offline users are not woken.
- **Client in-app**: `notify.ts` `notifyIncoming` routes to OS notification
  (hidden), custom banner / Ionic alert (visible, off-chat), or subtle sound
  (on-chat). `NotificationBanners.vue` is a **custom** translucent **slate** card
  pinned to the **top** (`top: safe-area-inset-top`, z-index 19000) with inline
  quick-reply + grab-handle dismiss.
- **Settings**: `schema.ts` has `notifications.inapp.style` (none/banners/alerts),
  `notifications.message.show`, `notifications.showPreview`, etc. No global in-app
  master switch; no per-chat notification controls (only `Chat.mutedUntil`).
- **DB**: `chats` object store, `DB_VERSION = 8`. `Chat` carries `mutedUntil?`
  (device-local, never synced) — the precedent for per-chat prefs.

---

## Decision 1 — Friend-request wake: a new content-free `conn` tickle

**Decision**: Add `Notifier.NotifyConn(ctx, userID)` sending a content-free
`{"t":"conn"}` tickle (high urgency, short-to-medium TTL, topic `ring-conn` so
bursts collapse). Call it from the three connection handlers *after* the existing
`notifyConn` live-frame send. The SW, on a `conn` tickle, syncs connection state
(`GET /v1/connections`, already authorized for that user) and shows a generic
notification, deep-linking to the requests/contact view.

**Rationale**: Mirrors the proven `msg` pattern (durable state on the server +
content-free wake + client renders specifics locally). The tickle leaks nothing
beyond "a connection event happened for this endpoint" — the same metadata class
the push provider already sees for `msg`/`call`. The recipient may not have the
requester as a contact, so the SW shows a generic, name-free string for inbound
requests; for accept/reject the requester can resolve the peer's name locally.

**Alternatives considered**:
- *Reuse the `msg` tickle* — rejected: it would route through the message-drain
  path and badge logic, conflating connection events with messages.
- *Put the event subtype (`req`/`accepted`/`rejected`) in the tickle* — rejected
  for v1: even though it is not user content, keeping the tickle fully generic and
  letting the SW diff connection state minimizes provider-visible metadata and
  matches the zero-knowledge ethos. (Could be revisited if SW state-sync proves
  costly.)

---

## Decision 2 — "Visualized first, then delivered" = ack-after-surface ordering

**Decision**: Treat FR-005 as an internal ordering guarantee on the **client**:
do not send the relay ack (which deletes the frame and triggers the sender's
"delivered" receipt) until the message is durably persisted to IndexedDB **and**
its notification path has run (or was intentionally suppressed because the user is
viewing the chat). Add a regression test pinning this order. No server change.

**Rationale**: The architecture already prevents loss — the SW drain is read-only
and persistence precedes ack, so a frame survives a crash. The user's requirement
("visualized first") is satisfied by making notify-dispatch a precondition of ack,
which is a small reordering + test, not a redesign. Avoids inventing a new
sender-visible receipt state (confirmed out of scope in clarification).

**Alternatives considered**:
- *New `POST /v1/relay/notify-display` endpoint the SW calls after the
  `notificationdisplay`/show resolves* — rejected as over-engineering: adds a
  round-trip and server surface for a guarantee the read-only drain already
  provides. Kept as a noted fallback only if a concrete loss case is found.

---

## Decision 3 — Per-chat preferences: device-local on the `Chat` record

**Decision**: Add three optional fields to `Chat` (IndexedDB), defaulting via
read-time fallback: `notifyWebPush?: boolean` (default true), `notifyInApp?:
boolean` (default true), `notifyContent?: 'full' | 'generic' | 'none'` (default
'full'). The global in-app master switch is a new setting
`notifications.inapp.enabled` (default true). Enforcement is client-side:
`notify.ts` for the page path, `sw-inbox.ts` for the SW path, applying
most-private-wins against global settings.

**Rationale**: `mutedUntil` already sets the precedent for device-local, never-
synced, per-chat alerting state. Optional fields on an existing store need **no**
`DB_VERSION` bump and lose no data (Principle V). Server stays blind (Principle I):
it pushes the content-free tickle regardless; the SW suppresses the user-facing
notification locally while still bumping the badge.

**Alternatives considered**:
- *Server-side per-chat push suppression* — rejected: would require the server to
  know per-chat preferences and which chat a message belongs to → violates
  zero-knowledge.
- *A separate `chatPrefs` object store* — rejected: heavier (DB_VERSION bump,
  migration) than three optional fields; no query/index benefit.

---

## Decision 4 — Calls obey per-chat web-push-off / mute (FR-022a)

**Decision**: Per-chat `notifyWebPush=false` or an active mute silences that
chat's **calls** as well as messages. Enforce robustly on the page path (the page
knows the caller/room and the chat). On the **SW** path (app closed), suppress
when the caller is cheaply resolvable from call state; otherwise ring (fail-open
for time-sensitive calls) and reconcile when the app opens.

**Rationale**: Matches the clarified decision (mute silences calls). The page
always has enough context; the SW's `call` tickle is content-free, so call-mute in
the fully-closed case is best-effort by design. Fail-open avoids silently dropping
a genuine call when the SW cannot resolve the caller.

**Alternatives considered**:
- *Separate per-chat "silence calls" control* — rejected in clarification (user
  chose unified mute).
- *Server-side call-mute* — rejected: server cannot know per-chat prefs.

---

## Decision 5 — In-app banner: restyle the existing custom component

**Decision**: Keep `NotificationBanners.vue` (justified custom component — hosts
inline quick-reply + drag gesture `ion-toast` can't). Change: (a) background from
slate `rgba(58,60,66,…)` to a translucent green derived from `--ion-color-primary`
/ existing `--ring-*` tokens, legible in light + dark; (b) anchor offset from
`safe-area-top` to `safe-area-top + toolbar height` so it sits **below the
header**; (c) keep swipe-up/grab dismiss and add an always-visible close
affordance; (d) preserve dedup, cap, pinned-reply, and bidi behavior.

**Rationale**: The component already solves the hard interaction problems
(synchronous iOS keyboard focus, drag thresholds, dedup/cap). Re-themeing + a
top-offset is far lower risk than re-implementing on `ion-toast` (which can't host
the quick-reply). Satisfies FR-013/014/015 and Principle XI's "compose from Ionic
primitives + existing tokens, minimal customization".

**Alternatives considered**:
- *Switch to `ion-toast`* — rejected: drops the inline quick-reply (a real UX
  regression) and the drag gesture.
- *Move banner to the bottom* — rejected in clarification (user chose top, below
  header); bottom would collide with the composer/tab bar more often.

---

## Open items for `/speckit-tasks`

- Confirm the exact chat-settings/info Vue page that should host the per-chat
  notification controls (where `mutedUntil` is currently toggled).
- Confirm name resolution for accept/reject notices in `useSync.ts`
  (`connect-update` currently uses a generic label).
- Decide the precise toolbar-height offset token for the banner (fixed `56px` vs a
  measured CSS variable) during implementation.
