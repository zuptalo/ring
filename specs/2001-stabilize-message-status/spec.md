# Feature Specification: Stabilize message status reporting around downloaded-blob receipts

**Feature Branch**: `fix/2001-stabilize-message-status`

**Created**: 2026-06-15

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User description: "Fix the message status updates instability. We introduced a
new `downloaded` state for blobs so we can clean them up as soon as a blob is downloaded by
all recipients (or when the TTL is reached), but that seems to have messed up our status
reporting. Create a bug-fix spec to look into the implementation both backend and frontend,
make sure everything is wired correctly, and ensure we have test coverage for everything
around this feature so we can capture these kinds of misbehaviours."

## Bug Summary

Outgoing message status (the WhatsApp-style ticks: pending → sent → delivered → read) became
**unstable** — it can flicker or regress — after the `downloaded` blob-cleanup receipt was
introduced. `downloaded` is meant to be a pure media-cleanup signal (a recipient confirming it
holds the bytes so the sender can delete the server blob); it must **never** influence the
displayed delivery status. The regression is a wiring/concurrency problem, not a UI problem:
the new receipt path participates in non-atomic, whole-row updates to a message and can
overwrite a concurrent status transition with a stale snapshot.

## Root Cause (investigation findings)

- Inbound frames are serialized through `inboundChain` in `src/composables/useSync.ts`, but
  message-row writes from the **local send pipeline** (`compressing → pending → sent`, media
  jobs) and **local read-marking** happen *outside* that chain.
- `applyReceipt` and `applyDownloaded` in `src/services/sync.ts` both perform a **read →
  mutate-whole-object → write** (`getMessage` then `bulkPut`). The `downloaded` path reads a
  message, captures its `status`, and rewrites the **entire** row.
- When a `downloaded` receipt is applied concurrently with a local status transition for the
  same outgoing media message, the stale whole-row write can **regress `status`** (e.g.
  `sent → pending`) or **lose `sentBlobId` cleanup bookkeeping**, producing the observed
  instability.
- `MessageStatus` does not include `downloaded`, and `STATUS_ORDER` (the monotonic-clamp map)
  omits it. The separation is currently enforced only by an early `return`; the type system
  does not guarantee `downloaded` can never land in `status`.
- **Test gap:** there is **no** frontend unit coverage of receipt/status application
  (`applyReceipt` / `applyDownloaded`). The backend already routes `downloaded` (covered by
  `server/internal/ws/relay_test.go`), but forge-prevention and the status-independence of
  `downloaded` are not asserted as a guarded contract.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Status never regresses when media is cleaned up (Priority: P1)

A sender sends a photo. The recipient receives it (delivered), opens it (read), and — at some
point — their device confirms it holds the bytes (`downloaded`), letting the sender reclaim the
server blob. Throughout, the sender's ticks must only ever move **forward**.

**Why this priority**: This is the reported defect. Status correctness is the core promise of
the delivery-receipt feature; a regressing tick erodes trust in the whole app.

**Independent Test**: Drive `applyReceipt`/`applyDownloaded` (or their pure reducers) with an
interleaving of a status advance and a `downloaded` receipt for the same message and assert the
final status is the highest reached and never regressed.

**Acceptance Scenarios**:

1. **Given** an outgoing 1:1 media message at status `sent`, **When** a `downloaded` receipt is
   applied for the peer, **Then** the displayed `status` stays `sent` (unchanged) and the server
   blob is scheduled for deletion.
2. **Given** an outgoing media message whose local pipeline is concurrently advancing it
   `pending → sent`, **When** a `downloaded` receipt is applied, **Then** the final status is
   `sent` (or higher) and never `pending`.
3. **Given** an outgoing message already at `read`, **When** a late `delivered` or `downloaded`
   frame arrives, **Then** the status remains `read`.

### User Story 2 - Group ticks reflect the whole roster, unaffected by downloads (Priority: P1)

In a group, message-level delivered/read must reflect **every** member, and per-member media
downloads must not move them.

**Why this priority**: Group aggregation is the most error-prone path and the one most likely
to show a spurious "read".

**Acceptance Scenarios**:

1. **Given** a group message with three recipients, **When** one member's `delivered` arrives,
   **Then** the message-level status is **not** `delivered` until all three have delivered.
2. **Given** a group message, **When** members send `downloaded` receipts, **Then** the
   message-level status is unchanged and the server blob is deleted only once **all** members
   have confirmed `downloaded`.
3. **Given** out-of-order group receipts, **When** they are applied in any order, **Then** the
   final aggregate (delivered/read timestamps + status) is identical to in-order application.

### User Story 3 - The server keeps status receipts authoritative (Priority: P2)

The relay must let clients originate only `read` and `downloaded`; `sent`/`delivered` stay
server-authoritative so a peer cannot forge a delivery for a victim's message.

**Acceptance Scenarios**:

1. **Given** a client sends a `receipt` frame with status `read` or `downloaded` addressed to a
   peer, **When** the relay processes it, **Then** it is routed to the peer stamped with the
   authenticated sender id.
2. **Given** a client sends a `receipt` frame claiming `sent` or `delivered`, **When** the relay
   processes it, **Then** the frame is **dropped** (not routed).

### Edge Cases

- A `downloaded` receipt for a message that was deleted/pruned locally → no-op, no throw.
- A `downloaded` receipt for an **incoming** message, or one with no `sentBlobId` → ignored
  (only the owning sender cleans up).
- Duplicate/late `downloaded` receipts → idempotent (blob deleted at most once; `sentBlobId`
  cleared so it is never retried).
- The blob delete failing → cleanup is retried later; status is untouched either way.
- A `downloaded` value must never be assignable to `Message.status` (type-level guarantee).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Applying a `downloaded` receipt MUST NOT change a message's displayed `status`,
  `sentAt`, `deliveredAt`, or `readAt`, in either 1:1 or group conversations.
- **FR-002**: Message status MUST be monotonic — it MUST NOT regress to a lower state under any
  ordering or interleaving of inbound receipts and local status transitions.
- **FR-003**: Concurrent updates to the same message row (receipt application vs. the local send
  pipeline / read-marking) MUST NOT clobber each other; each writer MUST observe the latest row
  and only modify its own fields.
- **FR-004**: Group message-level `delivered`/`read` MUST be derived from the full receipt
  roster (all members), not from any single member's receipt.
- **FR-005**: The server blob MUST be deleted exactly once, only after **all** recipients
  confirm `downloaded` (1:1: the single peer; group: every member), with the age sweep as a
  backstop. Cleanup bookkeeping (`sentBlobId`, `downloadedBy`, per-member `downloadedAt`) MUST
  survive concurrent status updates.
- **FR-006**: The relay MUST route only client-originated `read` and `downloaded` receipts and
  MUST drop client-claimed `sent`/`delivered`.
- **FR-007**: `downloaded` MUST NOT be representable as a `MessageStatus`; the type system MUST
  prevent it from being assigned to `Message.status`.
- **FR-008**: The status-derivation logic MUST be extracted into pure, IndexedDB-free functions
  so it is unit-testable in the existing Node vitest environment.

### Key Entities

- **Message**: carries `status` (MessageStatus), `sentAt/deliveredAt/readAt`, group `receipts[]`,
  and sender-side cleanup fields `sentBlobId` / `downloadedBy`.
- **Receipt** (per group member): `deliveredAt`, `readAt`, `downloadedAt`.
- **Receipt frame** (wire): `{ messageId, status: 'sent'|'delivered'|'read'|'downloaded', at, from }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A `downloaded` receipt applied in any interleaving with status transitions leaves
  the displayed status at the highest reached value, with **zero** observed regressions across
  the test matrix.
- **SC-002**: New unit tests cover 1:1 progression, group aggregation, monotonic clamp,
  out-of-order application, the `downloaded`-is-status-independent contract, and the
  concurrent-write (race) regression — all green in `npm run test:unit`.
- **SC-003**: Backend tests assert `read`/`downloaded` routing **and** `sent`/`delivered`
  forge-rejection, green in `go test ./...`.
- **SC-004**: The pure status core is covered ≥ 90% by the new unit tests; overall client/server
  coverage floors do not regress.
- **SC-005**: `npm run build`, `npm run test:unit`, `go build/vet/test` all pass.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

No change to the client/server boundary. The relay continues to route opaque receipt frames
(message id + status enum + timestamp) and to store/delete opaque blobs by capability id; it
never sees plaintext. `downloaded` carries no content. The blob-delete authorization (owner-only)
is unchanged. This fix is confined to client-side state derivation/serialization and to
hardening (and asserting) existing server routing rules — nothing new crosses the wire.

## Assumptions

- Inbound frames remain serialized via `inboundChain`; the race is between that chain and
  out-of-chain local writers, so the fix serializes per-message read-modify-write rather than
  re-architecting frame dispatch.
- No new runtime dependencies; tests use the existing Node vitest environment by testing pure
  reducers (the IndexedDB glue stays thin and is exercised indirectly).
- Existing wire format and the `MessageStatus` set (minus `downloaded`, which was never a member)
  are unchanged — this is a stabilization, not a protocol change.

## Complexity & Exceptions

None. The fix reduces complexity (extracts pure, testable reducers and centralizes message-row
mutation). No constitutional principle is waived.
