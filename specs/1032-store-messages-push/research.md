# Research: Messages store on push so the app opens warm (spec 1032)

All decisions below were made during an explicit design review (two independent design
passes plus an adversarial risk analysis) before this spec was cut; the approved design
lives in the session plan and is consolidated here. No NEEDS CLARIFICATION items remain.

## D1. Cross-context serialization primitive

- **Decision**: Web Locks API (`navigator.locks`), feature-detected, with two named
  exclusive locks: global `ring:inbound` (per-frame apply-and-ack critical section) and
  per-chat `ring:session:<chatId>` (every ratchet load→advance→save in both contexts).
- **Rationale**: Web Locks are origin-scoped, shared between window and service-worker
  contexts, and — decisively — auto-released when the holding context dies, so a killed SW
  can never deadlock the page. Available everywhere Ring's push works (Safari 15.4+ vs
  push's 16.4+ floor; Chrome 69+; Firefox 96+). The SW time-boxes acquisition (~3s via
  AbortSignal) and degrades to preview-only when it can't get the lock (frozen page,
  contention); the page waits without a timeout.
- **Alternatives considered**: leader election via a held-while-alive lock (rejected: a
  frozen-but-alive iOS page would hold leadership while unable to run); an IndexedDB-based
  mutex with lease expiry (rejected: hand-rolled, polling, worse than the platform
  primitive); `clients.matchAll()` "page always wins" checks alone (kept as *policy* — the
  existing `pageWillNotify` handshake still runs first — but rejected as a *safety*
  mechanism because it is racy).

## D2. Crash safety: one atomic multi-store IndexedDB transaction

- **Decision**: commit the advanced ratchet session, the message row, the chat summary
  read-modify-write (unread+1, lastMessage, lastMessageTime), and the `inboundSeenIds`
  dedup-ledger mark in ONE IndexedDB transaction spanning `sessions`, `messages`, `chats`,
  and `settings`. The server ack (`POST /v1/relay/ack`) is sent strictly after commit.
- **Rationale**: all Ring stores live in one IndexedDB database (`src/db/idb.ts` STORES),
  so a single transaction is possible and collapses every interruption ordering into
  all-or-nothing: killed pre-commit → the frame redelivers cleanly (nothing advanced);
  killed post-commit pre-ack → redelivery hits the ledger and re-acks without reapplying.
  The non-idempotent `unread+1` rides inside the same transaction as the ledger mark, so it
  can never double-apply.
- **Consequence for the crypto layer**: the SW cannot let `openPacket` persist the session
  internally (that would be a separate transaction). `messaging.ts` gains a *staged* open
  variant that returns `{ payload, sessionToPersist, metaWrites }` without persisting;
  the caller commits everything atomically. This keeps the crypto core pure (Principle IV)
  and messaging.ts crypto-only; sw-drain owns the transaction the way queries.ts owns the
  page-side writes today.
- **Alternatives considered**: separate transactions with careful ordering (rejected: the
  "session advanced but message row lost" ordering forces the heavyweight rekey recovery —
  routine SW termination would make it common); write-ahead journal replayed on open
  (rejected: more machinery than a single transaction, same guarantee).

## D3. Superseding the "SW never persists DH steps" rule

- **Decision**: with the flag on and under `ring:session:<chatId>`, the SW performs the
  full authoritative open — including DH-ratchet steps — and persists the result (in the
  atomic transaction of D2). The existing preview path (`previewPacket`, same-chain-only
  persistence) remains as the fallback for flag-off, locked posture, deferred frames, and
  lock-timeout degrade. The long rationale comments at `src/services/messaging.ts:240-266`
  and `294-300` are rewritten to describe the new two-mode contract.
- **Rationale**: the old rule existed because page and SW had no cross-context mutual
  exclusion — "competing writer of send-state" was unsolvable then. The Web Locks
  discipline removes the race the rule guarded against; keeping the rule would forbid the
  feature. Live call/`qos` signalling (which rides the same pairwise ratchet) becomes
  *safer*: the same lock now serializes page seals against SW opens, closing the race the
  old comment merely tolerated.

## D4. Eligibility scope v1

- **Decision**: the SW applies plain messages (text, and media-by-reference stored as the
  existing `pendingMedia` ref on the message row) in *existing* chats from *existing*
  connected contacts, including group messages (groups ride pairwise ratchets with
  `payload.groupId`). Everything else — first-contact X3DH establishment, contact/group
  cards, reactions, edits, erases, poll votes, rekey/control frames — defers: preview-only
  notification exactly as today, no ack, applied by the page drain on open.
- **Rationale**: the page's full receive path (`receiveIncomingInner`) is welded to
  page-only modules (Ionic notify, canvas media pipeline, contact/group side effects) and
  cannot be imported by the SW; the eligible subset covers essentially all real traffic
  (active conversations) while deferring exactly the frames whose side effects are complex
  or risky. Deferred frames don't render message bubbles, so the app still *looks* fully
  warm. Media bytes are never downloaded in the SW — the page backfills via the existing
  `resumePendingMediaJobs()` on reconnect (`src/composables/useSync.ts:246`).
- **Alternatives considered**: refactoring queries.ts into an SW-importable core (rejected
  for v1: large, ongoing drift risk); full parity in the SW (rejected: side effects like
  provisional-contact rollback and rekey-triggered resends must not run headless).

## D5. Server ack channel

- **Decision**: reuse the existing idempotent `POST /v1/relay/ack`
  (`server/internal/api/relay_handlers.go`, routed at `router.go:276`). No server changes.
- **Rationale**: the endpoint already exists for the page, is bearer-authenticated, deletes
  queued frames, and emits the same delivered receipts as the WS ack. Zero-knowledge
  surface unchanged — only ack timing moves.

## D6. Cross-context reactivity

- **Decision**: bridge the in-context idb change bus over `BroadcastChannel('ring:idb')`:
  `notify()` additionally posts the store name; a received name fires *local* listeners
  only (no re-broadcast, no echo loop). Belt-and-braces: `touch('chats')`/`touch('messages')`
  on visibility resume in useSync, for iOS pages frozen while the channel message fired.
- **Rationale**: `useLiveQuery` subscribes to a module-level listener map that never
  crosses JS contexts, so a backgrounded-but-alive page would otherwise show a stale chat
  list that contradicts the notification the user just tapped. The bridge also fixes
  multi-tab staleness for free.
- **Alternatives considered**: SW→client `postMessage` fan-out (rejected: duplicates the
  bus semantics; BroadcastChannel is symmetrical and covers tab↔tab too); polling on
  focus only (rejected: covers resume but not the live-in-background case).

## D7. Rollout flag

- **Decision**: internal device-local flag `sw.fullPersist` in the settings store, default
  off, read per wake in the SW gate; NOT exposed in the Settings UI (clarified with the
  product owner). Enabled via dev tooling on the dev deployment during the soak, then
  flipped default-on in a later release and eventually removed.
- **Rationale**: it's a delivery mechanism, not a user preference; a visible toggle would
  add copy and support burden. The gate composes with the existing gates (device-unlock
  posture, Web Locks presence, no live client claiming the drain), and every failure path
  degrades to today's shipped behavior — which is the design's spine.

## D8. Single-device invariant (safety precondition)

- **Finding**: `SaveSubscription` (`server/internal/store/push.go:17-26`) stores the user's
  ONE push subscription, overwriting any previous — a second-device login revokes the
  first's push. Therefore no stale device can be push-woken to ack (and thereby consume)
  frames meant for the active device. Recorded as a spec assumption: if multi-device ever
  ships, this feature's ack rule must be revisited first.
- **Durability framing**: the page already acks immediately after persisting, so app-open
  messages are already device-IDB-only; the SW doing persist→ack is symmetric, not a new
  durability class. Un-acked (deferred/failed) frames keep the server's 35-day retention
  (`server/cmd/ringd/main.go:454`) and drain on open.

## D9. Known bounded behaviors (accepted)

- `/relay/pending` returns the newest 50 frames (`relay_handlers.go`): a larger backlog is
  partially applied newest-first; the ratchet's skipped-key cache handles the out-of-order
  apply and the page drains the remainder on open. Ordering in the UI is by timestamp — no
  visible anomaly. Covered by an explicit test.
- Applied-but-killed-before-notification: the message is safely stored and acked but the OS
  notification for that wake may be lost. Mitigation: build and show notifications from the
  committed data *before* sending the ack, so the ack is the last step of the wake.
- SW/page version skew (`registerType: 'prompt'` keeps an old SW alive against a new page):
  the serialized session format must not change in the same release as this feature; if it
  ever changes, add a version field and make old readers defer.
