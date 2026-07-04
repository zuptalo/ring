# Contracts: SW authoritative receive (spec 1032)

## Wire contracts (existing, unchanged — listed for traceability)

### GET /v1/relay/pending  (bearer auth)

Returns `{ frames: [{ id, from, ciphertext, ... }] }`, newest 50. Side effect (existing):
emits delivered receipts for returned frames. This spec adds no parameters and changes no
semantics.

### POST /v1/relay/ack  (bearer auth)

Body `{ ids: string[] }`. Deletes the frames from the queue; idempotent (unknown/already
deleted ids are no-ops); emits durable delivered receipts. This spec only changes WHO calls
it (the SW, after atomic commit) and WHEN (while the app is closed). No server change.

## Cross-context lock contract (new, device-local)

| Lock name | Scope | Held by | Rules |
|-----------|-------|---------|-------|
| `ring:inbound` | global | page `receiveIncoming` chain step; SW per-frame apply loop | Outermost only. Never acquired while holding a session lock. SW: 3s AbortSignal → degrade frame/wake to preview-only. Page: no timeout. |
| `ring:session:<chatId>` | per chat | every ratchet load→advance→save in both contexts (seal, open, preview) | Acquired via `withSessionLock` only. Nothing inside acquires any other lock. Fallback when Web Locks absent: in-context KeyedMutex only (and the SW gate turns the feature off). |

## Module contracts (new/changed client modules)

### src/services/cross-lock.ts (new)

```ts
withInboundLock<T>(fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>
withSessionLock<T>(chatId: string, fn: () => Promise<T>, opts?): Promise<T>
locksAvailable(): boolean
```
- Composes in-context KeyedMutex FIFO with `navigator.locks.request` (exclusive).
- Timeout (SW callers) rejects with a typed `LockTimeoutError`; callers degrade.
- Import-clean: no DOM, no Ionic, no page-only modules (SW-safe).

### src/services/messaging.ts (changed)

```ts
// Existing (unchanged behavior, now internally under withSessionLock):
sealForChat(chatId, payload): Promise<Envelope | null>
openPacket(chatId, from, ciphertext): Promise<Payload>        // page path, persists
previewPacket(sessionKey, ciphertext): Promise<Payload>       // fallback path, same-chain-only persist

// New (SW authoritative path):
openPacketStaged(chatId, from, ciphertext): Promise<{
  payload: Payload
  sessionToPersist: SerializedSession   // advanced state incl. DH steps — NOT yet persisted
  metaWrites: SettingWrite[]            // e.g. send-preamble clear, session meta
}>
```
- `openPacketStaged` performs the full authoritative open (DH steps included) but persists
  NOTHING; the caller commits atomically. It must be called under
  `withSessionLock(chatId, …)`.
- First-contact X3DH / prekey re-init is NOT staged (classifier defers those frames).
- messaging.ts stays crypto-only: no imports of chats/messages/queries.

### src/db/idb.ts (changed)

```ts
transact(stores: StoreName[], fn: (tx: TxHandle) => void): Promise<void>
```
- One native IDB transaction across the named stores; `notify()` fires per touched store
  after commit; abort → no writes, no notifications.
- `notify()` additionally posts the store name on `BroadcastChannel('ring:idb')`;
  a received message fires local listeners only (never re-broadcast).

### src/services/sw-drain.ts (new)

```ts
drainAndPersist(): Promise<{
  applied: AppliedFrame[]     // committed + to-notify
  deferred: DeferredFrame[]   // preview-path frames (today's behavior)
  ackIds: string[]            // sent to /v1/relay/ack after notifications
  reason?: 'flag-off' | 'locked' | 'no-locks' | 'lock-timeout' | 'no-frames'
}>
classifyFrame(payload, ctx): 'eligible' | 'defer'   // pure, table-tested
```
- Import-clean (idb + messaging + cross-lock + notify-preview only).
- Called from the sw.ts push handler behind the gate; on ANY throw the caller falls back
  to `previewPending()`.

### src/services/testhook.ts (dev-only, e2e)

```ts
window.__ringTest.drainPending(): Promise<DrainResult>   // triggers the SW drain path
window.__ringTest.setSetting('sw.fullPersist', true)      // flag control (or existing setter)
```

## Behavioral invariants (testable)

1. Ack ⇒ committed: no frame id is ever POSTed to `/v1/relay/ack` unless its atomic
   transaction committed in this or a previous wake.
2. Exactly-once: for any interleaving of SW drain and page WS drain over the same frames,
   each message row exists once and each chat's `unread` counts it once.
3. Degrade-to-today: flag off / locked / no Web Locks / lock timeout / any throw ⇒ the
   observable behavior (notifications, storage, server queue) is identical to current
   production.
4. Privacy parity: notification content for every posture (default, generic, hidden,
   locked) is identical to current production.
5. Send-chain integrity: after the SW persists a DH-step advance, the page's next seal for
   that chat produces ciphertext the peer decrypts (no competing-writer clobber).
