# Contract: Activity WebSocket Frame

The feature's only external interface is a new WebSocket frame on the existing
`/v1/ws` connection. It is a **live, relay-only control frame** — the same class
as read receipts and call-control frames. This contract is the source of truth
for the client `Frame` union (`src/services/transport.ts`) and the server
`frame` struct + `handleFrame` switch (`server/internal/ws/hub.go`); both are
hand-mirrored and MUST stay in sync.

## Frame shape (single flat JSON object, discriminated by `t`)

```jsonc
{
  "t": "activity",          // new discriminator value
  "to": "<peerUserId>",     // client sets the recipient (a peer, or one group member)
  "from": "<senderUserId>", // CLIENT OMITS; the server STAMPS this with the authenticated user id
  "ciphertext": "<sealed>"  // opaque to the server: sealed { kind, state } (see below)
}
```

- **Visible to the server**: only `t`, `to`, and (server-stamped) `from`. This is
  the **same tuple** the existing `msg` / `receipt` relay already exposes — no
  new metadata (Constitution I, IX).
- **Sealed payload** (decryptable only by the two endpoints):
  ```jsonc
  { "kind": "typing" | "recording-audio" | "recording-video",
    "state": "active" | "stopped" }
  ```
  Sealed with the existing AEAD (`envelope.seal` / XChaCha20-Poly1305) under a
  per-peer "activity key" derived once from the session secret via the existing
  `hkdf` — **no new primitive and no Double-Ratchet advance** (see research.md D3;
  pending security sign-off). The server never sees `kind`/`state`.

## Direction & roles

| Direction | `from` | `to` | Notes |
|---|---|---|---|
| Client → Server | omitted (ignored if sent) | the peer / a group member | sent via the transient `sendLive()` path (no durable outbox) |
| Server → Client | stamped = authenticated sender | the recipient | relayed via `Hub.Send`; dropped if `to` has no live socket |

## Server relay rules (handleFrame `case "activity"`, modeled on call-control relay)

The handler MUST:

1. **Validate** `to` is non-empty.
2. **Reject forgery**: ignore/overwrite any client-supplied `from`; stamp
   `from = c.userID` (the authenticated connection).
3. **Block check**: if the sender↔recipient relationship is blocked (existing
   `IsBlocked`), drop silently.
4. **Relay live only**: `c.hub.Send(to, payload)` — fan out to the recipient's
   currently-connected sockets. If none are connected, **drop** (return without
   error).

The handler MUST NOT:

- `EnqueueRelay` (no durable queue / no offline catch-up),
- `notifyAsync` / Web Push (no notification),
- `bufferCall` or otherwise retain the frame,
- write any database row, or touch any store. **No migration is added.**

## Group fan-out (client-side)

For a group chat the **client** emits one `activity` frame per recipient member
(excluding self and blocked members), bounded by a recipient cap (default ≤50)
and rate-limited (≤1 frame per ~3s per recipient), mirroring the existing
group-call invite fan-out (`ringGroup` / `call-roster`). The server treats each
as an independent 1:1 relay (it has no group object), so it learns no membership.

## Emission semantics (client)

- `state:"active"` on first composer input and as a keepalive ~every 3s while
  composing or recording.
- `state:"stopped"` on send, draft-clear, blur, leaving the chat, or app
  background.
- `kind` reflects the current activity; switching (e.g. typing→recording)
  replaces, never stacks.
- **Suppressed entirely** when `privacy.activityIndicators` is off.
- **Suppressed (fail closed)** when no encryption session exists with the peer —
  never sent unsealed.

## Receipt semantics (client)

- An `active` frame creates/refreshes the recipient entry and arms a ~6s expiry.
- A `stopped` frame, expiry, socket-offline, or logout clears it.
- Incoming frames are **ignored** (not rendered) when the recipient has
  `privacy.activityIndicators` off (reciprocity).

## Test contract (what the relay test asserts)

`server/internal/ws/activity_test.go` MUST assert:

- An `activity` frame from A addressed to B is delivered to B's live socket with
  `from == A` (stamped), `to`/`ciphertext` intact.
- A client-supplied bogus `from` is overwritten with the authenticated id.
- When B has no live socket, the frame is dropped and **nothing is enqueued /
  persisted** (no relay-queue row, no store write).
- A blocked pair does not deliver.
