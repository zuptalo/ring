# Research: Adaptive call quality (spec 0007)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-06-24

## Current implementation (as read)

- `quality.ts` — pure AIMD controller. `initialController()`='low'; `nextTier(state, snap, clamp)`:
  back off one tier on `qualityLimited || fractionLost>0.05 || (knownBw && avail < target*0.7)`;
  come down to clamp if above it; else climb one tier after `CLIMB_AFTER`=3 healthy samples, with
  the climb ceiling forced to `high` when there's **no** `availableOutgoingBitrate`. `clampForPeers`:
  1 peer→hd, 2–3→high, >3→medium. `tierEncoding(tier, avoidEncoderScaling)` drops
  `scaleResolutionDownBy`/`maxFramerate` on WebKit/iOS.
- `mesh.ts` — one `PeerLeg.qc` per peer; `adaptLeg` runs **every 2s** from the diag timer, calling
  `nextTier(leg.qc, snapshotFromReport(report), effectiveCeiling())` where
  `effectiveCeiling = min(clampTier, clampForPeers(legs.size))`; `setLegTier`/`applyLegEncoding`
  pushes `tierEncoding(...)` to the sender. Inputs are the **sender's** getStats + the receiver's
  `fractionLost`/`rtt` only.
- `useCall.ts` — the 1:1 PC mirrors this in `pollStats`/`adaptOneToOne`; `videoQuality`
  (auto/medium/low) → `clampForPin` → outgoing clamp only.
- `diag.ts` — ⓘ snapshot prints per-leg connection state, codec, in/out bytes + frame counters; it
  does **not** show the current tier, the limitation reason, the manual pin, or any reported downlink.
- Sealed per-pair signalling already carries non-ICE payloads over the `call-ice` frame
  (`sendHoldResume` in 0005) — the pattern the health report will reuse.

## Regression diagnosis (Phase-0 confirmations)

| # | Suspect | Why it lowers quality | Confirmation | Fix direction |
|---|---------|-----------------------|--------------|---------------|
| 1 | **iOS `avoidEncoderScaling`** drops `scaleResolutionDownBy` for ALL WebKit | low/medium then send **full-resolution at 150–500 kbps** → heavy blockiness instead of a clean downscaled frame | unit: `tierEncoding('low', true)` has `scaleResolutionDownBy:1`; on-device: iOS low tier looks blocky | downscale at the **encoder** (`scaleResolutionDownBy`) — it's per-sender, never touches the shared capture track or self-preview; narrow the bitrate-only fallback to genuinely-broken old WebKit only (feature/version gate), not all iOS |
| 2 | **start-low + 1-step climb, 3 healthy samples, 2s cadence** | ~low→medium→high→hd = up to ~18s; feels low for a long time | unit: from 'low', N `nextTier` healthy steps to reach hd | start at a sensible tier (e.g. medium) and/or climb faster when health is strongly positive (multi-step or shorter streak); converge to target in ~5s (SC-001) |
| 3 | **Safari cap-at-high without `availableOutgoingBitrate`** | 1:1 over a great link never reaches HD on WebKit | unit: healthy 1:1, `avail` undefined → ceiling forced to 'high' | allow HD on a 1:1/2-person leg when sustained-healthy even without a candidate-pair estimate (use the new receiver-reported headroom + loss/RTT instead of hard-capping) |
| 4 | **`clampForPeers` / back-off thresholds** | a noisy single bad sample can drop a tier; count ceiling maybe too low | unit: single high `fractionLost` sample drops a tier | require sustained (not single-sample) congestion to back off; re-confirm the count ceiling against the caps (4 video) |

These are **reproduced as failing unit tests first** (TDD), then fixed.

## Decision 1 — Unify the receiver's wishes into a single "requested max tier"

**Decision**: Each receiver computes ONE `requestedMaxTier` = `min(` downlink-derived capacity class,
manual pin/cap, tile-size target `)` and reports it to each sender. A sender's per-leg tier becomes
`min(` own send-side adaptive tier, peer's `requestedMaxTier` `)`. Sender-side congestion may still
push **below** that; the receiver's request is a hard **ceiling**, never a floor.

**Rationale**: This folds US2 (downlink), US3 (manual hard cap), and US4 (screen/tile size) into one
receiver-driven ceiling — minimal, privacy-preserving (a single tier enum, no raw Mbps/IP), and easy
to reason about/test. The receiver is the authority on what *it* can use and wants; the sender stays
the authority on what *its* uplink can push.

**Alternatives considered**: reporting raw downlink Mbps (rejected — leaks more than needed, noisier,
privacy); sender-estimates-remote-from-RTCP-only (rejected — the current approach, which misjudges
the remote downlink). Keeping three separate signals (rejected — more wire + more state for the same
decision).

## Decision 2 — Connection-health report transport & cadence

**Decision**: A new sealed `CallSignal` kind (`qos`) carrying a tiny payload `{ requestedTier,
downlinkClass }` (coarse enums) + a monotonic `seq`. Sent **per-pair**, ~every **2s** and
**immediately on a significant change** (requestedTier change, or a manual-pin change). 1:1 sends it
over the `call-ice` frame (like `sendHoldResume`); mesh sends per leg over its sealed signalling.
Receivers keep the latest report per peer (newest `seq` wins) with a **staleness timeout** (e.g.
3× cadence) after which a sender ignores it and falls back to send-side adaptation.

**Rationale**: Reuses the proven sealed channel (no new server frame/metadata/state — Principle I);
2s matches the existing adapt cadence; on-change keeps throttle reactions snappy (SC-002); seq +
staleness make it robust to reorder/loss.

**Alternatives considered**: WebRTC data channel per pair (rejected — extra negotiation/teardown vs.
the existing sealed relay; would also add SCTP setup latency); server-mediated QoS (rejected — breaks
zero-knowledge). Faster 1s cadence (rejected per clarify — more chatter for little gain).

## Decision 3 — Downlink capacity class (how a receiver self-assesses)

**Decision**: The receiver derives a coarse `downlinkClass` from its **inbound** stats — sustained
`bytesReceived` throughput, `packetsLost`/`fractionLost`, and decode health (`framesDropped`) — mapped
to a tier-equivalent bucket with hysteresis. It reports the class, not the raw numbers.

**Rationale**: Inbound stats are the receiver's truthful view of its own downlink; bucketing +
hysteresis avoids flapping and avoids sharing precise figures (privacy/Principle IX).

**Alternatives**: `navigator.connection.downlink` (rejected — unreliable/absent on Safari, and a
coarse OS hint, not the call's actual throughput).

## Decision 4 — iOS clean-downscale without breaking old devices

**Decision**: Downscale via the **sender encoding** (`scaleResolutionDownBy`), which is per-sender and
leaves the shared capture track (and self-preview) at full resolution. Replace the blanket
`avoidEncoderScaling = isWebKit` with a **narrow** gate: only the specific old-WebKit builds that
demonstrably stall keep the bitrate-only path; modern iOS/Safari uses `scaleResolutionDownBy` like
everyone else, so a low tier is a clean small image, not full-res blockiness.

**Rationale**: Restores clean low/medium tiers on the iOS devices that regressed, while preserving the
older-iPhone stability the bitrate-only path was added for (spec 0005). Per-sender encoding keeps
FR-008 (self-preview always full) intact for free.

**Alternatives**: reduce capture resolution via `track.applyConstraints` (rejected — the track is
shared across all mesh senders AND the self-preview, so it would degrade the preview and every peer
at once, violating FR-008 and per-receiver adaptation).

## Decision 5 — Diagnostics (ⓘ panel)

**Decision**: Extend the per-leg diag snapshot to include: current **tier**, the **limitation
reason** (bandwidth/cpu/loss/none), the peer's **reported requestedTier + downlinkClass**, and the
**manual pin** — alongside the existing codec/bitrate/frames. Surface the same for the 1:1 PC.

**Rationale**: Directly serves US5 and makes the throttled-e2e assertions + on-device diagnosis
possible; it's the observability the investigation itself needs.

## Decision 6 — Test strategy (throttled, multi-party, mostly deterministic)

**Decision**:
- **Pure unit tests** (`quality.test.ts`) are the gate: the four regression assertions (reproduced
  failing, then green) + the new inputs — `min(ownTier, requestedTier)` ceiling, hard receiver cap,
  HD-on-healthy-1:1, sustained-not-single-sample back-off, no-flap, tile/downlink → requestedTier
  mapping. Deterministic, no WebRTC.
- **Playwright e2e** (`e2e/call-quality.spec.ts`): up to **4 isolated participants**; throttle a
  participant's network **on the fly** via CDP `Network.emulateNetworkConditions` (through the page's
  CDP session) and assert, via the per-leg diag/tier hooks and inbound bitrate, that only the streams
  **to** the throttled peer step down within ~3–5s and recover within ~10s; that a manual "low" pin
  lowers inbound to that peer while self-preview stays full; and that the call never freezes. Use
  generous timing margins; the unit assertions are the precise gate.
- **iOS** image cleanliness is verified **on-device** (headless WebKit can't do fake-media WebRTC),
  per quickstart.

**Rationale**: Keeps the brain in a deterministic pure module (constitution-friendly TDD), and uses
real-WebRTC throttling for the behavioral/system claims the user explicitly asked to see verified.

**Alternatives**: CDP throttling is Chromium-only — accepted; WebKit timing is covered on-device. No
reliable cross-browser headless throttling exists for fake-media WebRTC.

## Zero-knowledge confirmation

The `qos` report is sealed per-pair (Double Ratchet / call-scoped key) and relayed as opaque
ciphertext over the existing frame — no new server message type, metadata, or stored state. Payload
is coarse enums only (`requestedTier`, `downlinkClass`, `seq`) — never raw bandwidth, IP, or location.
The required zero-knowledge checklist will record each facet.
