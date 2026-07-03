# Implementation Plan: Messages store on push so the app opens warm

**Branch**: `feat/1032-store-messages-push` | **Date**: 2026-07-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/1032-store-messages-push/spec.md`

## Summary

When a push wakes the service worker and no app window claims it, the SW — which today
decrypts the queued E2EE frames read-only for a notification — will run an authoritative
receive for eligible frames: decrypt under cross-context Web Locks, commit the message row,
chat summary (unread/lastMessage/lastMessageTime), advanced ratchet session, and dedup-ledger
mark in ONE atomic multi-store IndexedDB transaction, then ack via the existing idempotent
`POST /v1/relay/ack`. Notifications keep the existing privacy rules; every failure path
degrades to today's preview-only behavior; the page's WS drain still delivers everything the
SW deferred. Behind an internal `sw.fullPersist` flag, default off. No server changes.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 + Ionic PWA, Vite); service-worker context
(`src/sw.ts` + import-clean service modules)

**Primary Dependencies**: libsodium-wrappers-sumo (existing crypto core), Web Locks API
(`navigator.locks`, feature-detected), BroadcastChannel, IndexedDB via `src/db/idb.ts`

**Storage**: IndexedDB (single DB, existing stores: `sessions`, `messages`, `chats`,
`settings`); no new object store, no `DB_VERSION` bump; server Postgres untouched

**Testing**: vitest unit tests (crypto core is pure; SW modules tested with a fake
`navigator.locks` + fake idb), Playwright e2e (`e2e/`, extending `sw-decrypt.spec.ts`)

**Target Platform**: installable PWA — Chrome/Edge/Firefox desktop + Android, iOS Safari
16.4+ home-screen PWA (web push floor)

**Project Type**: web app (client-only change; Go server: zero changes)

**Performance Goals**: notification wake handles a full pending batch (≤50 frames) within
the SW `waitUntil` budget; lock acquisition time-boxed at ~3s; app-open first paint shows
correct chats list with zero network round-trips for already-applied messages

**Constraints**: zero-knowledge boundary untouched (same tickle/fetch/ack wire surface);
exactly-once application across SW and page paths; every failure degrades to today's
behavior; PIN/passkey-locked posture never decrypts or stores in the SW

**Scale/Scope**: ~6 client files touched + 1 new module + tests; single-device-per-user
product invariant (verified: `server/internal/store/push.go:17`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary**: PASS — nothing new crosses the wire; same content-free
  tickle, same `/v1/relay/pending` fetch, same idempotent `/v1/relay/ack`; only ack timing
  changes. The server already learns "device received these frames" at fetch time
  (delivered receipts). Spec carries the required Zero-Knowledge Impact section.
- **II. Spec-Driven Development**: PASS — spec 1032 (ad-hoc band), pipeline followed in
  order; this plan is stage 3.
- **III. Test-Driven Development**: PASS — tasks.md will order failing unit tests (locks,
  eligibility, atomicity, ratchet send-chain integrity, replay/out-of-order/skipped-key)
  and e2e (warm-open, deferral, race, locked posture) before implementation.
- **IV. Crypto Discipline**: PASS with review — no new primitives; the existing Double
  Ratchet core is reused. `messaging.ts` gains a *staged* open variant (returns the
  advanced session for the caller to persist) so the crypto core stays pure and
  `messaging.ts` stays crypto-only (no chats/messages imports; dependency remains
  one-directional: sw-drain.ts → messaging.ts, mirroring queries.ts → messaging.ts).
  The change to the SW-persistence rule (supersedes `messaging.ts:294-300`) is a crypto
  behavior change → security review + `/speckit-checklist` REQUIRED (zero-knowledge +
  crypto checklist, like spec 1031's).
- **V. Offline-First Data Integrity**: PASS — all writes via `idb.ts`; no store/schema
  change; the change bus gains a cross-context bridge (additive); atomic multi-store
  transaction helper added to `idb.ts` (uses native IDB transaction semantics).
- **VI. Stateless Server & Migrations**: PASS — zero server changes.
- **VII. Quality Gates**: PASS — build/vet/test/e2e gates unchanged and required; commit
  subjects will be release-note copy.
- **VIII. Traceable Delivery**: PASS — taskstoissues + `Closes #N` on the PR.
- **IX–XI (Privacy, A11y/i18n, Ionic-first)**: PASS — no data collection change; no UI
  change at all (internal flag, no settings screen).

**Post-Phase-1 re-check**: no new violations introduced by the design artifacts. The one
deliberate rule change (SW may persist DH steps *under lock, behind flag*) is documented in
research.md D3 and called out for security review.

## Project Structure

### Documentation (this feature)

```text
specs/1032-store-messages-push/
├── spec.md              # Feature specification (with Zero-Knowledge Impact)
├── plan.md              # This file
├── research.md          # Phase 0: decisions D1–D9
├── data-model.md        # Phase 1: entities & state transitions
├── quickstart.md        # Phase 1: how to run/verify locally
├── contracts/
│   └── sw-receive.md    # Phase 1: module + wire contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 (/speckit-tasks — not created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── sw.ts                          # push handler: route to sw-drain when gated on;
│                                  #   badge math (pending → deferred-only when applied)
├── services/
│   ├── sw-drain.ts                # NEW: gate, eligibility classifier, per-frame
│   │                              #   critical section, atomic commit, ack, notifications
│   ├── sw-inbox.ts                # preview path retained (fallback + deferred frames);
│   │                              #   shared helpers exported for sw-drain
│   ├── messaging.ts               # withSessionLock (KeyedMutex + Web Locks);
│   │                              #   staged open API; rewrite 240-266/294-300 comments
│   ├── cross-lock.ts              # NEW: named-lock helpers (ring:inbound,
│   │                              #   ring:session:<chatId>), timeout + fallback
│   └── testhook.ts                # expose drainPending() for e2e (dev-only)
├── db/
│   ├── idb.ts                     # transact([...stores], fn) helper;
│   │                              #   BroadcastChannel('ring:idb') bridge on notify()
│   └── queries.ts                 # receiveIncoming under ring:inbound; ledger check
│                                  #   already idempotent (wasInboundSeen)
└── composables/
    └── useSync.ts                 # touch() on visibility resume (belt-and-braces)

e2e/
└── sw-persist.spec.ts             # NEW (or extend sw-decrypt.spec.ts): warm-open,
                                   #   deferral, race, locked-posture scenarios
```

**Structure Decision**: single-project PWA layout (existing). One new service module
(`sw-drain.ts`) mirroring the import-clean discipline of `sw-inbox.ts`, one small shared
lock helper, surgical edits elsewhere. Server untouched.

## Design details (how the pieces fit)

### Gate (in src/sw.ts push handler, before today's preview call)

1. `sw.fullPersist` setting on; 2. `navigator.locks` present; 3. `attemptDeviceUnlock()`
succeeds (passwordless posture — PIN/passkey devices can't decrypt in the SW by design);
4. no live client claimed the alert via the existing `pageWillNotify` handshake.
Any gate failing → `previewPending()` exactly as today.

### Per-frame critical section (sw-drain.ts)

```
fetch /v1/relay/pending                     (unchanged; earns 'delivered')
for each msg frame, under 'ring:inbound' (3s AbortSignal):
  1. wasInboundSeen(id)? → collect for re-ack, skip
  2. classify (pure): existing connected contact AND resolvable chat
     (1:1 or payload.groupId → existing group) AND plain message
     (text | media-by-reference) → eligible; else DEFER (preview path, no ack)
  3. staged authoritative decrypt under 'ring:session:<chatId>'
     (full open incl. DH steps; returns advanced session, does NOT persist)
  4. ONE idb transaction: sessions.put + messages.put(remoteId) +
     chats RMW (unread+1, lastMessage, lastMessageTime, unreadMentions)
     + settings markInboundSeen
  5. collect id for ack
show notifications from committed data (existing privacy rules via noteForPayload)
POST /v1/relay/ack {ids}                    (LAST step of the wake)
badge = unreadCount() (+ deferred-only pending count)
```

Media: persist the message row with the existing `pendingMedia` ref; never download bytes
in the SW. The page backfills via `resumePendingMediaJobs()` on reconnect (already called
at `useSync.ts:246`).

### Lock discipline (cross-lock.ts + messaging.ts)

- Only the outermost inbound layer takes `ring:inbound` (SW: sw-drain loop; page: the
  `receiveIncoming` chain step at `queries.ts:4515`). Nothing inside a session lock
  acquires another lock. Page acquisitions have no timeout; SW acquisitions abort at ~3s
  and degrade that frame (or the wake) to preview-only.
- `sessionMutex.run(chatId, fn)` in messaging.ts (seal at :117, open at :197, preview at
  :277) becomes `withSessionLock(chatId, fn)` = in-context KeyedMutex FIFO + Web Locks
  `ring:session:<chatId>` (fallback to bare KeyedMutex when Web Locks are absent). This
  also serializes live call/`qos` seals against SW opens — strictly safer than today.

### Exactly-once & page interplay

- The `inboundSeenIds` ledger (`queries.ts:4499`) is the arbiter for both paths; the
  ledger mark rides inside the SW's atomic transaction, and the page's `receiveIncoming`
  already skips seen frames. The page's WS re-ack of an SW-acked frame is an idempotent
  no-op server-side.
- Notification dedup keeps its current shape: the gate defers to live pages
  (`pageWillNotify`/`ring:handled`); SW-applied frames are acked so they can never
  re-notify; `swNotifiedIds` keeps serving only deferred frames.

### Reactivity

`idb.ts notify()` additionally posts the store name on `BroadcastChannel('ring:idb')`;
received names fire local listeners only (no echo). `useSync`'s visibility-resume handler
adds `touch('chats'); touch('messages')` so an iOS-frozen page repaints on resume even if
the channel message was dropped.

## Verification approach (drives tasks.md test-first ordering)

- **Unit (vitest)**: cross-lock ordering/timeout/fallback; eligibility classifier table
  over every payload type; atomic apply (row + unread + ledger + session in one
  transaction; abort → nothing); replay of an applied frame is a no-op; ratchet
  send-chain integrity after an SW-persisted DH step (page seal still decrypts at peer);
  out-of-order >50-backlog apply via skipped-key cache; forgery/replay/skipped-key suites
  extended per Principle IV; idb bridge no-echo.
- **E2E (Playwright)**: warm-open (rows + unread + empty server queue before reconnect;
  no duplicates after reconnect); deferral (stranger first-contact drains on open);
  SW-drain vs page-reconnect race (exactly one row); PIN-locked posture unchanged;
  existing call + sw-decrypt suites green with flag off AND on.
- **Manual**: real-device soak on the dev deployment (installed iOS PWA; client changes
  need `npm run build` to show there); message during a live call while a push lands.

## Complexity Tracking

No constitution violations to justify. The one rule *change* (SW may persist DH-ratchet
steps) is not a violation of a principle but a revision of an internal invariant, made
safe by cross-context locking; it is flagged for security review in research.md D3 and
via the required `/speckit-checklist`.
