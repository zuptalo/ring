# Contract: `GET /v1/relay/status`

Side-effect-free metadata about the authenticated caller's queued relay frames. Powers the
spec-2043 client zombie self-heal. Distinct from `GET /v1/relay/pending`, which returns the
ciphertext frames AND emits delivery receipts — `/relay/status` does neither.

## Request

```
GET /v1/relay/status
Authorization: Bearer <session token>
```

- Auth: required (`authMW`). The authenticated user IS the recipient; no path/query params.
- No body.

## Response — 200 OK

```json
{ "oldestQueuedAtMs": 1752871200000, "count": 5 }
```

| Field | Type | Meaning |
|-------|------|---------|
| `oldestQueuedAtMs` | `number \| null` | Epoch ms of the oldest queued frame's `created_at`; **`null`** when the queue is empty (never `0`). |
| `count` | `number` | Total queued (unacked) frames for this recipient. |

## Guarantees

- **No side effects**: does not dequeue any frame and does not send any `delivered` receipt.
  A caller may poll it freely (the client throttles to once / 5 min regardless).
- **Zero-knowledge**: returns only a server timestamp and an integer count — no payload,
  ciphertext, sender, or message id. Derived from `relay_queue.created_at` / row count, which
  the server already holds to relay.

## Errors

- `401 Unauthorized` — missing/invalid bearer token (via `authMW`).
- `500 Internal Server Error` — query failure (`{"error":"could not load relay status"}`);
  the client treats any failure as a no-op (no rotation).

## Client usage

`fetchRelayStatus()` (`src/services/api.ts`, 8s AbortController timeout) →
`healZombieIfLikely()` (`src/services/push.ts`) evaluates `shouldRotateForQueueAge` and, on a
match, force-rotates the subscription.
