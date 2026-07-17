# Implementation Plan: Stabilize message status reporting

**Spec**: [`spec.md`](spec.md) · **Branch**: `fix/2001-stabilize-message-status` · **Status**: in-progress

## Approach

Two root problems: (1) status correctness logic is entangled with IndexedDB so it is untested,
and (2) message-row updates are non-atomic whole-row read-modify-writes, so the new `downloaded`
receipt can clobber a concurrent status transition. Fix both by **extracting pure reducers** and
**serializing per-message mutation**.

### 1. Pure status core — `src/services/message-status.ts` (new, no IndexedDB)

Pure functions over a plain `Message` (the constitution's crypto-core pattern: testable in the
Node vitest env, no DOM/IDB):

- `STATUS_ORDER` and `statusRank(s)` — single source of truth for monotonic ordering.
- `applyScalarReceipt(msg, status, at): Message` — the 1:1 timeline (monotonic clamp; sets
  `sentAt/deliveredAt/readAt`). Never accepts `downloaded` (type-excluded).
- `applyGroupReceipt(msg, status, at, recipient): Message` — per-member stamp + whole-roster
  aggregate (delivered/read only when **all** members reach it) + monotonic clamp.
- `applyDownloadedReceipt(msg, recipient, at): { msg, allDownloaded }` — stamps the cleanup
  bookkeeping (`receipts[].downloadedAt` for groups, `downloadedBy` for 1:1) and reports whether
  every recipient now holds the bytes. **Touches no status/`*At` display field.**

`MessageStatus` already excludes `downloaded`; keep it that way and have the reducers take the
narrow type so the compiler guarantees FR-007.

### 2. Serialized mutation — `src/services/keyed-mutex.ts` (new, pure) + `mutateMessage` in `sync.ts`

- `KeyedMutex`: serialize async critical sections by key (promise-chain per key). Pure, trivially
  unit-testable (assert no overlap / FIFO ordering).
- `mutateMessage(id, fn)` in `sync.ts`: under the per-`id` lock, **re-read** the message, apply
  `fn` to the latest row, and `bulkPut`. This closes the clobber window — every writer observes
  the latest row instead of a stale snapshot (FR-003).
- Route the message-row writers that share `status`/cleanup fields through `mutateMessage`:
  `applyReceipt`, `applyDownloaded`, and the local status setters in the send/drain path
  (`pending → sent`, `failed`) and local read-marking. Identify exact call sites during
  implementation; convert only those that mutate the contended fields.

### 3. Backend — assert the contract (mostly tests)

Routing already exists and is correct (`hub.go` `case "receipt"`: only `read`/`downloaded`
routed, `From` stamped; `relay_test.go` covers `downloaded` routing). Add tests that pin the
**forge-rejection** (a client `sent`/`delivered` receipt is dropped) and `read` routing as a
guarded contract. Touch server code only if a gap is found.

## Research / decisions (clarify)

- **No new dependencies** (no `fake-indexeddb`). Correctness lives in pure reducers tested in
  Node; `mutateMessage`'s glue is thin and exercised via the reducers + a `KeyedMutex` test.
- **Serialize both sides.** FR-003 requires the local writer *and* the receipt writer to share
  the lock; serializing only the receipt path would leave the local writer able to clobber. Scope
  to writers touching `status`/`sentBlobId`/`downloadedBy`/`receipts`.
- **Behavior preserved.** Same wire format, same `MessageStatus` set, same WhatsApp-style
  aggregation semantics — this is a stabilization + test backfill, not a protocol change.

## Data model / contracts

No schema, migration, or wire-format change. No `DB_VERSION` bump. Receipt frame shape unchanged.

## Zero-knowledge

Unchanged (see spec's Zero-Knowledge Impact). No new data crosses the boundary.

## Test strategy (TDD — tests precede implementation)

- `src/services/message-status.test.ts`: 1:1 progression + monotonic clamp + no-regress;
  group aggregation (no premature delivered/read) + out-of-order equivalence; `downloaded`
  leaves status/`*At` untouched (1:1 + group); `allDownloaded` only when every recipient
  confirms; idempotency.
- `src/services/keyed-mutex.test.ts`: serialization (no overlap), FIFO, per-key independence,
  error isolation.
- `server/internal/ws/relay_test.go`: add forge-rejection (`sent`/`delivered` dropped) +
  `read` routing assertions alongside the existing `downloaded` test.
- Coverage: add `message-status.ts` (and `keyed-mutex.ts`) to the gated client coverage set at
  ≥ 90%; do not regress existing floors.
