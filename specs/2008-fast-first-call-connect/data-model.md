# Data Model: Make the first call connect as fast as a call-waiting second call

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-06-24

This fix persists **no data** — no IndexedDB store, no `DB_VERSION` bump, no server state. The only
"model" is an **ephemeral, dev-only instrumentation record** of connection-setup milestones, used
by the e2e to assert ordering/overlap and measure time-to-first-media. It is stripped from
production builds (like the rest of `testhook`) and never leaves the device.

## Entity: ConnectMilestones (ephemeral, dev/test only)

Per-call timestamps (ms, monotonic) for the current 1:1 call's setup, reset at the start of each
call. Recorded by `useCall.ts` on the caller and callee; read by the Playwright harness.

| Field | Meaning | Recorded on |
|-------|---------|-------------|
| `callStart` | Outgoing intent (`startDirectCall`) / accept tapped (`acceptCall`) | both |
| `turnWarmStart` | TURN warm kicked off | both |
| `turnReady` | `getTurnConfig()` resolved (cache hit ⇒ ~immediate) | both |
| `gumStart` | `getUserMedia` called | both |
| `gumResolved` | Local media stream available | both |
| `pcCreated` | `RTCPeerConnection` constructed | both |
| `remoteDescriptionSet` | `setRemoteDescription(offer)` done | callee |
| `offerSent` / `answerSent` | Local SDP sent to peer | caller / callee |
| `firstRemoteMedia` | First decoded remote track/stream observed | both |

### Derived assertions (the regression gate — deterministic, not wall-clock)

- **Caller overlap**: `turnWarmStart <= gumStart` (TURN warm is not gated behind gUM). Today TURN
  warming happens *inside* `newPeerConnection`, strictly **after** `gumResolved` → this assertion
  **fails before the fix, passes after**.
- **Callee overlap**: `pcCreated`/`remoteDescriptionSet` is reached without first awaiting
  `gumResolved` (SDP/PC setup overlaps capture). Today it's strictly serial after gUM → **fails
  before, passes after**.

### Derived metric (success validation — coarse, generous margin)

- **Time-to-first-media (TTFM)** = `firstRemoteMedia − callStart` (and the accept→media variant),
  per direction and per kind. SC-001/SC-002 compare the first call's TTFM against the second-call
  (call-waiting) path with a generous margin so CI hardware variance doesn't flake the suite.

## Validation rules

- Milestones are write-once per call and reset on each new call; absent milestones (e.g. an
  audio-only call has no video frame) are simply unset, never inferred.
- The record exists only when the dev test hook is active; production builds neither record nor
  expose it.

## State transitions

No new call-state machine states. Call states (`idle → dialing/incoming → connecting → connected →
ended`) are unchanged; the fix only reorders the work performed *within* the `dialing` (caller) and
the accept→`connecting` (callee) transitions so independent steps run concurrently.
