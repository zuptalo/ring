# Contract: WebSocket call frames (spec 0004 delta)

Ring's client↔server interface is the JSON frame protocol over `/v1/ws` (typed in
`src/services/transport.ts`, handled in `server/internal/ws/hub.go`). This documents only
the **changes** spec 0004 makes. All SDP/ICE payloads remain end-to-end-encrypted ciphertext
the server relays without reading (Zero-Knowledge Principle I); the server reads only routing
fields (`to`, `roomId`, `kind`).

## Added frames

### `call-full` — server → joiner
Sent when a `call-join` is refused because the room is at its cap.
```jsonc
{ "t": "call-full", "roomId": "<room>", "kind": "audio" | "video" }
```
- Direction: server → the client that attempted to join.
- Client behavior: abandon the local join attempt, show "call is full", play the `callfull`
  cue. The existing call (if the user was elsewhere) is untouched; no roster broadcast occurs.
- No plaintext: carries only the room id + kind the joiner already supplied.

## Changed frames

### `call-busy` — now optionally group-scoped
Existing 1:1 shape (carries `callId`) is unchanged. New group form:
```jsonc
{ "t": "call-busy", "to": "<caller>", "roomId": "<room>" }   // group invite refused while busy
```
- Sent by a callee whose every device is busy when it receives a `call-group-invite`.
- Server: relays to `to`; when `roomId` + `to` are present, also stops that member's group-ring
  reminders (same machinery as `call-cancel`+`roomId`).
- Caller: marks that invitee "busy/unavailable" and stops ringing them; other invitees
  unaffected. A later `call-roster` join for the same member supersedes the busy tile.

## Removed frames (US6 cleanup — dead SFU path)
These are deleted from the client union, the server switch, and the SFU itself. The client
never sent them post-mesh-migration; removing them is safe after the migration is complete.

| Frame | Was |
|---|---|
| `sfu-offer` | SFU → client offer |
| `sfu-answer` | client → SFU answer |
| `sfu-ice` | SFU/client trickle |
| `sfu-renegotiate` | client → SFU re-offer trigger |
| `call-key` | sealed group media key (insertable-streams E2EE) |
| `call-key-request` | missing-key resend request |
| `call-streamid` | sealed stream-id ↔ member announcement |

## Unchanged but cap-affected: `call-join`
```jsonc
{ "t": "call-join", "roomId": "<room>", "kind": "audio"|"video", "members?": [...] }
```
- Server now admits via `JoinIfRoom(roomId, userID, max)` where `max = kind==="video" ? 4 : 8`.
- A user already in the room is always re-admitted (idempotent recovery/re-join — never
  refused by the cap).
- On refusal: emit `call-full` to the joiner and do **not** broadcast a new roster.
- On success: unchanged (`broadcastRoster`, `clearBufferedCalls(userID)`,
  `stopGroupMemberRing`, first-joiner ringing).

## Invariants
- The server still tracks only room membership + call kind; it gains no new knowledge.
- Cap enforcement is dual: client (pre-emptive UX) **and** server (`JoinIfRoom`, authoritative).
- Adaptive quality and audio cues produce **no frames** — they are entirely client-local.
