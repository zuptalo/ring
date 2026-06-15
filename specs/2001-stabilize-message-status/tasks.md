# Tasks: Stabilize message status reporting

**Spec**: [`spec.md`](spec.md) · **Plan**: [`plan.md`](plan.md) · **Branch**: `fix/2001-stabilize-message-status`

TDD: within each group, the failing test task (Tn.a) is written and run (red) **before** its
implementation task (Tn.b). Groups roughly map to one GitHub issue each.

## T1 — Pure status core (FR-001, FR-002, FR-004, FR-007, FR-008)

- **T1.a** Write `src/services/message-status.test.ts` (red): 1:1 monotonic progression +
  no-regress; group per-member aggregation (no premature delivered/read); out-of-order
  equivalence; `downloaded` never alters `status`/`sentAt`/`deliveredAt`/`readAt`; `allDownloaded`
  only when every recipient confirms; idempotency.
- **T1.b** Add `src/services/message-status.ts` with `STATUS_ORDER`/`statusRank`,
  `applyScalarReceipt`, `applyGroupReceipt`, `applyDownloadedReceipt`. Make T1.a green.

## T2 — Keyed serialization primitive (FR-003)

- **T2.a** Write `src/services/keyed-mutex.test.ts` (red): serialized (no overlap), FIFO order,
  per-key independence, error in one section doesn't break the chain.
- **T2.b** Add `src/services/keyed-mutex.ts` (`KeyedMutex`). Make T2.a green.

## T3 — Wire the core into sync.ts (FR-001..FR-005)

- **T3.b** Refactor `src/services/sync.ts`: add `mutateMessage(id, fn)` (per-id lock + re-read +
  `bulkPut`); reimplement `applyReceipt`/`applyDownloaded` on top of the pure reducers via
  `mutateMessage`; route the contended local status setters (send/drain `pending→sent`/`failed`,
  local read-marking) through `mutateMessage`. Preserve outbox eviction + blob-delete behavior.
- **T3.c** `npm run build` (vue-tsc typecheck) green; `npm run test:unit` green.

## T4 — Backend contract tests (FR-006)

- **T4.a** Extend `server/internal/ws/relay_test.go` (red where missing): client `read` is routed
  with `from` stamped; client `sent`/`delivered` receipt is **dropped**; (existing `downloaded`
  routing retained).
- **T4.b** Only if a gap is found, adjust `hub.go` routing. `go build/vet/test ./...` green.

## T5 — Coverage + gates (SC-002..SC-005)

- **T5.a** Add `message-status.ts` + `keyed-mutex.ts` to the gated coverage set (≥ 90%); confirm
  no existing floor regresses.
- **T5.b** Run the full gate: `npm run build`, `npm run test:unit:coverage`,
  `cd server && go build ./... && go vet ./... && go test ./...`.

## T6 — Finalize

- **T6.a** Set spec `Status` to `in-review`; `make roadmap`; confirm `roadmap-gen.py --check`.
- **T6.b** PR body lists `Closes #N` for each issue (T1–T5 groups).
