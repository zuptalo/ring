# Contract: sealed `callEvent` system frame (spec 1040)

Scope: client↔client only. The server relays this as an opaque sealed
envelope on the existing messaging channel; it has no server-side schema.

## Envelope

- Carried as a new OPTIONAL field on `MessagePayload`
  (`src/services/crypto/message.ts`), sealed/opened by the unchanged Double
  Ratchet code path — same class as `reaction`, `gameMove`, `rekey`.
- MUST be sent on the pairwise 1:1 channel, including for group calls (the
  initiator fans out pairwise to each invitee).
- MUST NOT create a visible chat message on receive; it is a silent
  side-effect frame (`receiveIncomingInner` returns without storing a row).

## Shape

```ts
callEvent?: {
  phase: 'ring' | 'ended';
  callId: string;              // dedup key everywhere
  kind: 'audio' | 'video';
  outcome?: 'missed' | 'cancelled' | 'answered'; // required when phase='ended'
  roomId?: string;             // group calls only
  at: number;                  // sender ms clock; hint only
}
```

## Sender obligations (caller / group initiator)

| Moment | Frame |
|---|---|
| Dial (1:1) / group ring start | `{ phase:'ring', callId, kind, roomId? }` to the (each) callee |
| Caller no-answer timeout fires | `{ phase:'ended', outcome:'missed', … }` |
| Caller cancels before answer | `{ phase:'ended', outcome:'cancelled', … }` |
| Call answered (any callee device) | `{ phase:'ended', outcome:'answered', … }` |

Fire-and-forget; senders MUST NOT block or fail call setup on marker send.

## Receiver obligations

- Idempotent by `callId`; an existing `calls` row for `callId` wins — markers
  never overwrite or duplicate (FR-018).
- `ended/missed|cancelled` with no existing row → missed `calls` row +
  `logCallToChat` (1:1 chat; group chat via `roomId`; Calls tab only when no
  chat resolves).
- `ended/answered` → clear pending only.
- Stale `ring` (older than ring window, no outcome, no row) → reconcile to
  missed.
- SW preview path: read-only (never persists, never acks — spec 1032
  invariant); builds the named ring / missed-replacement notification, honors
  hidden-chat gating, and updates `sw.callBadge` units only.

## Compatibility

- Old receivers ignore unknown optional payload fields (existing behavior for
  every past field addition) — no version gate needed.
- Old senders simply never send markers: receivers see today's behavior
  (generic ring, live-only logging). No handshake.
