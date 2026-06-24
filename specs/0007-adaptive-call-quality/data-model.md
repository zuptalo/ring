# Data Model: Adaptive call quality (spec 0007)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-06-24

No persisted data — all state is **ephemeral** per call (no IndexedDB store, no `DB_VERSION` bump,
no server state). The manual quality pin stays the existing client setting. The entities below are
in-memory per-call structures + one sealed wire message.

## Entity: ConnectionHealthReport (sealed wire message — the `qos` CallSignal)

A tiny, coarse, sealed per-pair message a receiver sends each sender (~2s + on change). Contract:
`contracts/health-signal.md`.

| Field | Type | Meaning |
|-------|------|---------|
| `requestedTier` | tier enum (`off`/`low`/`medium`/`high`/`hd`) | the MAX tier this receiver wants from the sender = `min(downlinkClass, manualPin, tileTarget)`. A hard ceiling for the sender. |
| `downlinkClass` | tier enum | the receiver's coarse self-assessed downlink capacity (for the sender's info / diag). |
| `seq` | integer | monotonic per sender→peer; newest wins, guards reorder. |

Coarse enums only — **never** raw Mbps, IP, or location (privacy / Principle IX).

## Entity: PerLegQualityState (in-memory, per mesh leg + the 1:1 PC)

Extends the existing `ControllerState` with the receiver-driven inputs.

| Field | Meaning |
|-------|---------|
| `tier` | current outgoing tier for this leg (existing). |
| `healthyStreak` | consecutive healthy samples (existing; climb gate). |
| `peerRequestedTier` | latest `requestedTier` from this peer's report (hard ceiling); null if none/stale. |
| `peerDownlinkClass` | latest reported `downlinkClass` (diag/info). |
| `reportSeq` / `reportAt` | last accepted report's seq + timestamp (staleness = ignore after ~3× cadence). |
| `limitationReason` | why the current tier (bandwidth/cpu/loss/peer-cap/none) — for diag. |

Effective tier each step = `min(` send-side `nextTier(...)`, `peerRequestedTier` (if fresh),
`clampForPeers(peers)`, manual local pin `)`.

## Entity: ReceiverQualityRequest (in-memory, per remote we render)

What THIS device wants from each peer, recomputed when inputs change → drives our outgoing
`qos.requestedTier` to that peer.

| Input | Source |
|-------|--------|
| `downlinkClass` | our inbound stats (throughput, loss, framesDropped) bucketed w/ hysteresis. |
| `manualPin` | our quality setting (auto/medium/low) — a hard cap when not auto. |
| `tileTarget` | tier appropriate for the size we render this peer at (small grid tile → lower; fullscreen → up to hd), rate-limited on layout change. |

`requestedTier = min(downlinkClass, manualPin, tileTarget)`.

## Entity: QualityDiagnostics (ⓘ panel, per leg)

Read-only surfacing of the decision: `tier`, `limitationReason`, measured send bitrate, peer's
`requestedTier` + `downlinkClass`, manual pin, in/out frames (existing). Dev/diagnostic text only.

## State transitions

No new call-state-machine states. Per leg, the tier moves off↔low↔medium↔high↔hd via the controller,
now additionally **clamped down** by a fresh `peerRequestedTier` and **released up** (toward the
ceiling) when the peer raises its request or its downlink recovers — always bounded by the local
manual pin, the participant-count ceiling, and sender-side congestion. Audio is never tiered (video
drops first under congestion).

## Validation / rules

- A report older than the staleness window is ignored; the sender falls back to send-side adaptation.
- `requestedTier` is a ceiling only — it never forces a sender ABOVE its sustainable tier.
- Tile-target recomputation is rate-limited so layout churn can't thrash the encoder.
- Self-preview always renders the full local capture, independent of any leg's encoding (FR-008).
