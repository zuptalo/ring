# Data Model: Group call reliability, adaptive quality, caps, cues & busy

This feature adds **no persistent schema**: the server call registry is in-memory, and the
client `'calls'` IndexedDB store is schemaless within a record (new outcome values need no
`DB_VERSION` bump). The "model" here is the in-memory and on-the-wire state.

## Constants

| Name | Value | Where |
|---|---|---|
| `VIDEO_MAX` | 4 participants | shared client + server |
| `AUDIO_MAX` | 8 participants | shared client + server |
| Quality tiers | `off, low, medium, high, hd` | client (`useCall` / `mesh`) |
| Start tier | `low` | client |
| Sample cadence | ~2 s | client controller |
| Cue de-dup window | ~400 ms | `sound.ts` |
| `callBufferTTL` | 60 s (unchanged) | server `hub.go` |

## Server-side (in-memory)

### Room registry (`server/internal/call/registry.go`)
- Unchanged shape (`roomID → set of userIDs`), plus:
- **`JoinIfRoom(roomID, userID, max) (roster []string, ok bool)`** — admits `userID` only if
  the room has `< max` members **or** `userID` is already present (idempotent re-join). Returns
  `ok=false` without mutating when full. `Join` (uncapped) is kept for internal use/tests or
  replaced by `JoinIfRoom`.

### Call buffer (`server/internal/ws/hub.go`)
- `callBuf map[string][]bufferedCall` — unchanged, plus:
- **`clearBufferedCalls(userID)`** — deletes `callBuf[userID]`. Invoked on `call-join`
  (joiner present → any held invite is stale) and on room departure (`call-leave` / `cleanup`).

## Client-side (in-memory, `useCall.ts` / `mesh.ts`)

### CallMeta (existing) — extended
- `roster: string[]` / `invited: string[]` — unchanged.
- Per-invitee tile state gains a **`busy`** reason (alongside the existing "not joining"):
  set when a `call-busy` for this room arrives for that member; cleared if they later join.

### Recently-left guard (new)
- `leftRooms: Map<roomId, expiry>` — room ids we deliberately left, TTL ≈ `callBufferTTL`
  (60 s). `handleGroupInvite` drops an invite whose `roomId` is present. Pruned on read.

### Per-connection quality controller (new) — one per mesh leg, one for the 1:1 PC
- `currentTier: Tier` — starts `low`.
- `healthyStreak: number` — consecutive healthy samples (drives the additive climb).
- `clampTier: Tier` — upper bound from the manual `videoQuality` pin and
  `storage.lessDataCalls` (data-saver).
- Derived each tick from a **StatsSnapshot** (below) via the pure
  `nextTier(currentTier, snapshot, clampTier) → Tier`.

### StatsSnapshot (new, ephemeral) — the controller's input
| Field | Source (getStats) | Notes |
|---|---|---|
| `qualityLimited` | `outbound-rtp.qualityLimitationReason === 'bandwidth'` | Chromium; absent→false on Safari |
| `availableOutgoingBitrate` | candidate-pair | may be undefined (Safari) |
| `fractionLost` | `remote-inbound-rtp.fractionLost` | cross-browser; the remote downlink signal |
| `roundTripTime` | `remote-inbound-rtp.roundTripTime` | cross-browser |
| `framesEncoded` / `framesSent` | `outbound-rtp` | stagnation fallback |

### Tier → encoding (extends existing `QUALITY_ENCODING`)
- Each tier maps to `{ maxBitrate, scaleResolutionDownBy, maxFramerate }` applied via
  `sender.setParameters`. `off` ⇒ video track disabled/suspended; audio unaffected (audio is
  never tiered — "protect audio").

## On-the-wire (WS frames) — see `contracts/`
- **New**: `call-full` (server→joiner); `call-busy` extended with optional `roomId` (group).
- **Removed**: `sfu-offer`, `sfu-answer`, `sfu-ice`, `sfu-renegotiate`, `call-key`,
  `call-key-request`, `call-streamid`.
- **Unchanged**: `call-offer/answer/ice`, `call-ringing/accept/reject/cancel/end`,
  `call-ring`, `call-join`, `call-leave`, `call-roster`, `call-group-invite`,
  `call-upgrade-*`.

## Call-history entry (client `'calls'` store) — new outcome values
- Existing record shape reused; `outcome`/`status` gains: `busy`, `unavailable`, `missed`,
  `declined` (caller logs unavailable/declined; callee logs missed). No store/version change.

## State transitions (call lifecycle, client)
```
idle → calling → ringing → connecting → connected ⇄ reconnecting → ended → idle
                                   ↘ (peer/devices busy) → ended(busy/unavailable)
incoming → connecting → connected …            ↘ (declined / cap full) → ended
```
Each labelled transition fires its audio cue (US5); `connected→reconnecting` is the existing
grace path, now with a `reconnecting` cue, and `reconnecting→connected` re-fires `connected`.
