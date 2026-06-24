# Contract: Sealed connection-health signal (`qos` CallSignal)

**Spec**: [spec.md](../spec.md) · **Date**: 2026-06-24

A new sealed, per-pair call-signalling message that lets a receiver tell each sender the maximum
quality it wants/can use. It is **not** a new server endpoint or frame — it is a new `CallSignal`
*kind* carried inside the existing sealed `call-ice` relay frame (the exact mechanism hold/resume
used in spec 0005), so the server only ever relays opaque ciphertext.

## Inner payload (sealed; never seen by the server)

Added to `CallSignal` (`src/services/crypto/message.ts`):

```
type: 'qos'
qos: {
  requestedTier: 'off' | 'low' | 'medium' | 'high' | 'hd'   // hard ceiling the sender must honor
  downlinkClass: 'off' | 'low' | 'medium' | 'high' | 'hd'   // receiver's coarse self-assessed downlink
  seq: number                                               // monotonic per sender→peer; newest wins
}
```

- Coarse enums + a counter ONLY. MUST NOT carry raw bitrate (Mbps), IP, geolocation, or any precise
  network identifier (privacy / Principle IX, FR-011).

## Transport

- **1:1**: `sendHealth(chatId, peerUserId, callId, qos)` → `sendSealedSignal('call-ice', …, { type:
  'qos', qos })` — mirrors `sendHoldResume`. Received in the `call-ice` handler, dispatched on the
  inner `CallSignal.type === 'qos'`.
- **Group (mesh)**: sent per leg over the leg's existing sealed signalling, tagged with `roomId`;
  applied to that `PeerLeg`.
- Sealed with the pair's Double Ratchet (contacts) or the call-scoped key agreement (non-contact
  co-members) — identical to all other call signalling.

## Cadence & lifecycle

- Sent ~every **2 seconds** while in a call, AND **immediately** when `requestedTier` changes (manual
  pin change, downlink-class change, or a tile-size change that moves the target).
- Receiver keeps the latest report per peer; a higher `seq` supersedes. A report older than the
  **staleness window** (~3× cadence, ~6s) is ignored and the sender falls back to send-side
  adaptation (FR-004).
- `requestedTier` is a **ceiling**: the sender sends `min(own-sustainable-tier, requestedTier, …)`.
  It never raises a sender above what its own uplink/CPU sustains.

## Server view (zero-knowledge)

- No new server message type, route, field, metadata, or stored state. The `qos` frame is an
  ordinary sealed `call-ice` relay — indistinguishable to the server from other call signalling.
- The server cannot read `requestedTier`/`downlinkClass`/`seq` (they are inside the sealed payload)
  and learns nothing about any device's network beyond the relaying it already does.

## Backwards compatibility

- A peer that doesn't send `qos` (older build) → the sender simply has no fresh report → falls back
  to send-side adaptation (same as today). No negotiation/handshake required; the kind is additive.
