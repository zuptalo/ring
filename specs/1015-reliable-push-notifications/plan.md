# Implementation Plan: Reliable Push & Redesigned In-App Notifications

**Branch**: `feat/1015-reliable-push-notifications` | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1015-reliable-push-notifications/spec.md`

## Summary

Harden the existing notification stack and add user control, without breaking the
zero-knowledge boundary. Five slices:

1. **Reliable delivery + complete decryption (P1)** — audit and harden the
   relay-drain/ack ordering so a frame is acked (and the "delivered" receipt
   emitted) only *after* the message is durably persisted and its notification
   path has run; make the service-worker read-only decrypt preview show full,
   correct content and fall back to a content-free placeholder cleanly when the
   device is locked.
2. **Friend-request push (P1)** — the server currently delivers connection
   request/accept/reject only as a *live* WebSocket frame (`notifyConn` →
   `Hub.Send`); add a content-free `conn` push tickle so an offline user is woken,
   and have the service worker render a generic, zero-knowledge-safe notification.
3. **Redesigned in-app banner (P2)** — restyle the existing custom
   `NotificationBanners.vue` to a translucent greenish theme card, anchored **at
   the top but offset below the header**, with an explicit dismiss affordance.
4. **Global + per-chat in-app toggles (P2)** — add a global "In-app
   notifications" master switch to the settings schema; add per-chat controls to
   the chat's settings/info surface.
5. **Per-chat notification privacy controls (P3)** — three orthogonal per-chat
   switches (web push / in-app / content visibility), stored device-local on the
   `Chat` record like `mutedUntil`, enforced **client-side** (page + service
   worker). Per-chat web-push-off / mute also silences that chat's calls (FR-022a).

The hard part is intentionally small: the relay/ack path already favors
reliability (the SW's `GET /v1/relay/pending` is read-only; only the page's WS
`ack` / `POST /v1/relay/ack` deletes a frame), so P1 is mostly ordering + tests.
Friend-request push is one new content-free tickle kind plus a notifier call.
Per-chat enforcement is client-side, so the server needs **no** new schema and
the wire stays content-free.

## Technical Context

**Language/Version**: TypeScript (ES modules, Vue 3 `<script setup>` + Ionic) on
the client; Go 1.26 (stdlib `net/http`) on the server.

**Primary Dependencies**: Client — Ionic Vue, libsodium-wrappers-sumo (existing
crypto core), Workbox/custom service worker (`src/sw.ts`), Web Push API. Server —
`webpush-go` (VAPID), `pgx` v5, stdlib WebSocket hub.

**Storage**: Client — IndexedDB via `src/db/idb.ts` (`chats` store holds per-chat
prefs; `settings` store holds the global toggle). Server — PostgreSQL
(`relay_queue`, `push_subscriptions`, connections tables) — **no new tables**.

**Testing**: `vue-tsc` typecheck (`npm run build`); Go unit tests against the
in-memory fake store (`go test ./...`); Playwright e2e (`npm run test:e2e`) for
user-facing behavior; `drive/` harness for manual multi-user verification.

**Target Platform**: Installable PWA on iOS 16.4+ (home-screen install required
for Web Push), Android/Chromium, and desktop browsers; single Go container.

**Project Type**: Web application (Vue PWA client + Go server in one repo, one
image).

**Performance Goals**: Notification surfaces within a few seconds of push wake
(platform-bound); per-chat preference reads add no perceptible latency
(in-memory cached, like `notify.ts` `NotifyPrefs`).

**Constraints**: Zero-knowledge — push payload stays content-free; per-chat
notification preferences are device-local and never synced to the server. Offline
-first — IndexedDB is source of truth; adding optional `Chat` fields needs no
`DB_VERSION` bump (no new store/index). Ionic-first UI.

**Scale/Scope**: ~5 client files touched (`sw.ts`, `sw-inbox.ts`, `notify.ts`,
`push.ts`, `NotificationBanners.vue`), settings schema + chat-settings UI, a new
client per-chat-prefs helper; server: `push.go`, `ws/hub.go` interface,
`connections_handlers.go`, `router.go` interface. No DB migration.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.1.0. Re-checked post-design.*

| Principle | Gate | Status |
|---|---|---|
| I. Zero-Knowledge (NON-NEGOTIABLE) | Wire stays content-free; no plaintext to server | **PASS** — new `conn` tickle is content-free (same class as existing `msg`/`call`); per-chat prefs device-local, never synced; all preview decryption + preference enforcement client-side. Spec carries a **Zero-Knowledge Impact** section. |
| II. Spec-Driven | specify→clarify→plan… followed | **PASS** |
| III. Test-Driven | Tests before impl; crypto/handler unit tests; e2e for UX | **PASS (planned)** — `tasks.md` will order failing tests first: Go unit tests for `NotifyConn` + connection-push trigger against the fake store; e2e for friend-request push, banner reposition/dismiss, global+per-chat toggles, badge-only. |
| IV. Crypto Discipline | Reuse libsodium core; no new primitives | **PASS** — uses only the existing read-only `previewPacket` decrypt path; no ratchet/keyex changes. **`/speckit-checklist` REQUIRED** (Principle I & IV touched). |
| V. Offline-First | `DB_VERSION` bump if store/shape changes | **PASS** — new fields are **optional** on the existing `chats` store with read-time defaults; no new store/index → no `DB_VERSION` bump, no data loss. |
| VI. Stateless Server & Forward-Only Migrations | New schema = next numbered migration; `SECRETS_KEY` impact stated | **PASS** — no new tables/columns; reuses `push_subscriptions` + connections + `relay_queue`. `SECRETS_KEY` untouched. |
| VII. Quality Gates | build + vet + test + e2e green | **PASS (planned)** |
| VIII. Traceable Delivery | issues + `Closes #N` | **PASS (planned)** via `/speckit-taskstoissues`. |
| IX. Privacy & Data Minimization | Minimize metadata | **PASS** — friend-request tickle carries no requester identity; SW resolves specifics from already-authorized connection state. |
| X. a11y / i18n | Ionic + settings schema; bidi text | **PASS** — global toggle is a settings-schema edit; banner text already `unicode-bidi: plaintext`; per-chat UI uses Ionic components + `--ring-*` tokens. |
| XI. Ionic-First UI | Stock Ionic; bespoke only when justified | **PASS w/ documented deviation** — global toggle + per-chat controls use stock `ion-toggle`/`ion-list`/`ion-radio`/`ion-segment`. The in-app **banner stays a custom component** (see Complexity Tracking) because `ion-toast` cannot host the inline quick-reply textarea; it is restyled using existing theme tokens only. |

**Result**: PASS. One justified deviation (custom banner) recorded below. No
unjustified violations; `/speckit-checklist` is required before implement.

## Zero-Knowledge Impact (design)

- **What crosses the wire (new)**: a content-free `{"t":"conn"}` push tickle to a
  recipient/requester's existing push subscription. It contains no names, no
  message content, no request body — identical privacy class to the existing
  `{"t":"msg"}` / `{"t":"call"}` tickles. The push provider (Apple/Google/Mozilla)
  learns only that "a connection-related event occurred for this endpoint", which
  is the same metadata shape already accepted for messages and calls.
- **What is encrypted / unchanged**: message bodies remain sealed; the SW preview
  decrypts **locally** with the device key and never persists ratchet state.
- **What stays on device**: all per-chat notification preferences (web push,
  in-app, content visibility) and the global in-app toggle live in IndexedDB and
  are **never** sent to the server. Enforcement of "web push off for this chat"
  happens in the SW after local decryption (the server still sends the
  content-free tickle because it cannot know per-chat prefs — the SW suppresses
  the user-facing notification while still updating the badge).
- **Metadata unavoidably visible**: the server already knows *that* user A
  requested/accepted/rejected a connection with user B (connection routing
  requires it); this feature adds no new identity metadata.

## Project Structure

### Documentation (this feature)

```text
specs/1015-reliable-push-notifications/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (tickle kind, ack ordering, call-mute, banner)
├── data-model.md        # Phase 1 — Chat pref fields, settings keys, tickle/event shapes
├── quickstart.md        # Phase 1 — how to verify each user story locally (drive/ + e2e)
├── contracts/
│   └── notification-contracts.md   # tickle formats, endpoints, settings keys, Chat fields
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
# ---- Client (Vue PWA) ----
src/
├── sw.ts                         # push handler: add 'conn' kind; per-chat suppression on msg/call
├── services/
│   ├── sw-inbox.ts               # SW notification builder: conn notices; per-chat content-visibility
│   ├── notify.ts                 # notifyIncoming: honor global in-app toggle + per-chat prefs; content level
│   ├── push.ts                   # notifyLocal: respect per-chat content visibility
│   ├── connections.ts            # (client) request/accept/reject — name resolution for accept/reject notices
│   └── notify-prefs.ts           # NEW: read-through cache for per-chat prefs + global in-app toggle
├── components/
│   └── NotificationBanners.vue   # redesign: greenish translucent, offset below header, explicit dismiss
├── composables/
│   └── useSync.ts                # connect-req/connect-update → notifyIncoming with resolved names
├── db/
│   ├── types.ts                  # Chat: + notifyWebPush?, notifyInApp?, notifyContent?
│   └── queries.ts                # getters/setters for per-chat notification prefs (+ default fallbacks)
├── settings/
│   └── schema.ts                 # + global 'notifications.inapp.enabled' toggle
└── views/detail/
    └── <ChatInfo/ChatSettings>.vue  # per-chat notification controls section (Ionic)

# ---- Server (Go) ----
server/internal/
├── push/push.go                  # + NotifyConn(ctx, userID) → content-free {"t":"conn"} tickle (+ connParams)
├── ws/hub.go                     # Notifier interface: + NotifyConn
└── api/
    ├── connections_handlers.go   # request/accept/reject: also fire Notifier.NotifyConn (offline wake)
    └── router.go                 # Handlers.Notifier interface gains NotifyConn (already wired to *push.Notifier)
```

**Structure Decision**: Web-application layout (existing). This feature edits
existing files plus one new client helper (`notify-prefs.ts`) and one per-chat
settings UI section. No new server package, no new DB table/migration.

## Design notes per user story

- **US1 (reliable + decrypt)**: The server never deletes a relay frame until the
  client acks (`POST /v1/relay/ack` or WS `{"t":"ack"}`); the SW drain
  (`GET /v1/relay/pending`) is read-only. So "visualized first, then acked" =
  ensure the page acks a frame only after durable persist + notify dispatch
  (or intentional in-chat suppression). Harden the ordering and add a regression
  test; ensure the SW preview renders full text + correct sender and degrades to
  a content-free notice when locked (no device key).
- **US2 (friend-request push)**: Add `Notifier.NotifyConn`; call it from
  `requestConnection`/`acceptConnection`/`rejectConnection` *after* the existing
  `notifyConn` live-frame send. SW handles a `conn` tickle by syncing connection
  state (`GET /v1/connections`, already authorized) and showing a generic
  notification ("New friend request" / "Friend request accepted/declined"),
  deep-linking to the requests/contact view. Friend-request notices always fire
  (no per-category setting).
- **US3 (banner redesign)**: Keep the custom component; swap the slate background
  for a translucent green built from `--ion-color-primary` / `--ring-*` tokens
  (legible light + dark); change `.nb-stack` top offset from `safe-area-top` to
  `safe-area-top + header height` so it clears the toolbar/back control; keep the
  existing swipe-up/grab dismiss and add an always-visible close affordance.
- **US4/US5 (toggles + privacy)**: New `notify-prefs.ts` caches the global
  `notifications.inapp.enabled` flag and per-chat `{notifyWebPush, notifyInApp,
  notifyContent}` (defaults: on/on/'full'). `notifyIncoming` consults them for the
  page path; `sw-inbox.ts` consults them (read from IndexedDB) for the SW path,
  applying most-private-wins. `notifyContent='none'` → badge only; `'generic'` →
  placeholder; `'full'` → decrypted preview. `notifyWebPush=false` or active mute
  → suppress that chat's message notifications **and** call rings (FR-022a).

## Testing Strategy (logical + visual, via the project's established Playwright harnesses)

Per Constitution III, user-facing behavior gets e2e coverage and crypto/handler
logic gets unit tests. This feature is also **visually** significant (banner
redesign), so it is verified through **both** of the repo's existing Playwright
paths — no new harness is introduced.

### A. Logical / behavioral — `e2e/` suite (`npm run test:e2e`)

Hermetic stack (`e2e/global-setup.ts`: ringd :8081 + fresh `ring_e2e` DB + test
Vite :5174), driven through the dev-only `window.__ringTest` hook. Add/extend one
`*.spec.ts` per area, matching the existing one-file-per-area convention:

- **`e2e/friendship.spec.ts` / `connect.spec.ts` (extend)** — friend-request push
  path: with the recipient "closed" (no live socket), a `conn` tickle results in a
  notification intent; accept/reject notify the requester (US2 / FR-008–010).
- **`e2e/sw-decrypt.spec.ts` (extend)** — service-worker read-only preview shows
  full decrypted sender+text when unlocked; content-free fallback when locked;
  malformed/undecryptable → generic, never garbled (US1 / FR-002, FR-004, FR-004a).
- **`e2e/notifications-inapp.spec.ts` (new)** — global in-app off ⇒ zero banners;
  per-chat in-app off ⇒ banners suppressed for that chat only; per-chat
  content=none ⇒ badge increments with no banner/text; content=generic ⇒
  placeholder; content=full ⇒ preview (US4/US5 / FR-018–024).
- **`e2e/notifications-delivery.spec.ts` (new)** — relay-ack ordering: a frame is
  acked only after persist + notify dispatch; never silently dropped under
  injected display failure (US1 / FR-005, SC-003); no duplicate page+SW
  notification (FR-006 / SC-009).
- **Banner geometry assertion (in the in-app spec)** — instead of flaky pixel
  snapshots, assert non-overlap *logically*: compare the banner's
  `getBoundingClientRect()` against the header/back, composer, and call-control
  rects and require zero intersection, on phone and desktop viewports (SC-005,
  FR-014). This is the robust, deterministic guard for "never covers a critical
  control".

### B. Visual — `showcase/` capture harness (`npm run showcase`)

`showcase/capture.spec.ts` seeds a curated dataset and screenshots the UI across
**iphone / ipad / android / desktop × light/dark** into `showcase/output/<device>/
<theme>/`. Extend it to capture the redesigned banner so the green translucency,
contrast, and below-header placement are reviewable on every device + theme:

- Add a capture state that triggers an in-app banner (via the test hook /
  `notifyBanners`) and screenshots it: (a) on the Chats list, (b) inside an open
  chat with the composer visible, (c) on the active-call screen — each in light
  and dark. These are the human-review artifacts for FR-013/014 and SC-005.
- Because banners auto-dismiss (~4.5s), the capture must hold/trigger the banner
  synchronously before the screenshot (mirroring how `capture.spec.ts` stages
  transient UI). Note this for the tasks phase.

### C. Manual / exploratory — `drive/` (optional, not CI)

`drive/` against the live `make start` stack for quick multi-user spot-checks of
the banner gesture (swipe/close) and per-chat toggles during development; not part
of the gate.

### Gate

`npm run build` (typecheck) + `go build/vet/test ./...` + `npm run test:e2e` must
be green; `npm run showcase` artifacts reviewed for the banner across devices/
themes before US3 is considered done. Real-device iOS/Android push reliability
(SC-001/SC-004 at 100% across 20 trials) is a manual cross-device pass on
installed PWAs, since Web Push wake cannot be exercised in the headless harness —
called out explicitly so it is not silently skipped.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Custom `NotificationBanners.vue` (not `ion-toast`) — Principle XI deviation | The banner hosts an **inline quick-reply** textarea with synchronous focus inside the pointer gesture (the only way iOS raises the keyboard) and a pull-down/swipe-up grab gesture. | `ion-toast` cannot embed an interactive `ion-textarea` or custom drag gesture; it only supports text + buttons. The component is still composed from Ionic primitives (`ion-icon`, `ion-textarea`) and restyled with existing theme tokens, so the deviation is minimized. |
