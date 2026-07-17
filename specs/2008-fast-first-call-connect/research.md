# Research: Make the first call connect as fast as a call-waiting second call

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-06-24

## Root cause (measured from the code)

The slow first call is **not** caused by dropped ICE — `pendingIce` already buffers early
candidates that arrive before `setRemoteDescription` on the first-call path, and they are drained
in `acceptCall`/`drainPendingIce`. The latency comes from **serial work on the critical path**:

- **Caller — `startDirectCall` (`useCall.ts`)**: `await getUserMedia` → `await newPeerConnection()`
  (which does `await getTurnConfig()` — a **cold** network fetch of `/v1/turn-credentials`) →
  `createOffer` → `setLocalDescription` → send. gUM (camera warm-up / permission) and the TURN
  fetch happen back-to-back, both before the offer can be sent.
- **Callee — `acceptCall` (`useCall.ts`)**: on accept, `await getUserMedia` → `await
  newPeerConnection()` (TURN fetch again, but cache may be cold if this device hasn't called) →
  `setRemoteDescription` → `createAnswer` → `setLocalDescription` → send. The entire gUM + TURN +
  SDP chain runs **after** the user taps accept, before any media can flow.

Why the **second** (call-waiting) call is snappy, for contrast:
- TURN cache is already **warm** (`getTurnConfig` cached with TTL) from the first call, so
  `newPeerConnection` returns immediately.
- The camera/mic **stream already exists** and is reused (`connectSecondDirect` takes the shared
  stream) — **no `getUserMedia`** on the critical path.
- The PC is created and early candidates (`secondIce`) drained immediately.

So the first call pays two costs the second call doesn't: a **cold TURN fetch** and a
**fresh `getUserMedia`**, and it pays them **serially**.

## Decision 1 — Warm the TURN credential cache off the critical path

**Decision**: Add an explicit fire-and-forget warm entrypoint (e.g. `warmTurnConfig()` wrapping
`getTurnConfig().catch(()=>{})`) and call it:
- on **outgoing call intent** — at the very start of `startDirectCall` (before/parallel to gUM);
- on **incoming ring** — when an offer is presented and the call starts ringing (callee side),
  well before the user accepts.

So by the time `newPeerConnection` runs, `getTurnConfig` returns from cache with no network wait.

**Rationale**: The TURN fetch is a full RTT to our server on a cold cache, squarely on the critical
path. Warming at call intent / ring overlaps it with user reaction time and media capture.
`getTurnConfig` already caches with a TTL and refreshes 30s early, so warming is idempotent and
cheap.

**Alternatives considered**:
- *Warm at app start / login*: rejected — credentials are TTL-bound and most app opens don't lead
  to a call; wasteful and could expire before use. Call-intent/ring warming is precisely timed.
- *Bundle TURN creds into the call offer*: rejected — adds server/wire involvement and complexity
  for no benefit over client-side caching; risks touching the ZK boundary.

## Decision 2 — Run media capture concurrently with connection setup

**Decision**:
- **Caller**: start `getUserMedia` and TURN warming **concurrently** (e.g. `Promise.all([gUM,
  warmTurn])`), then build the PC (TURN already resolved), add tracks, create+send the offer. The
  critical path becomes `max(gUM, turn)` + SDP instead of `gUM + turn + SDP`.
- **Callee**: on accept, start `getUserMedia` **concurrently** with the work that doesn't need the
  stream — creating the PC (TURN warm) and `setRemoteDescription(offer)` + applying buffered ICE —
  then, once the stream resolves, add tracks, `createAnswer`, `setLocalDescription`, send. This
  overlaps the gUM latency with SDP/PC setup that previously waited behind it.

**Rationale**: gUM and the PC/SDP/TURN setup are independent until tracks must be added; overlapping
them removes the largest serial gaps. `createAnswer` still needs the local tracks, so the answer is
produced as soon as gUM resolves — but no later, and with the remote description + ICE already in
place.

**Alternatives considered**:
- *Pre-create the PC and `setRemoteDescription` on the callee during ring (before accept)*:
  promising (saves even more), and **safe** for SDP/ICE (no media flows until tracks+answer at
  accept). Deferred as an **optional** extra step in tasks — the concurrent-on-accept approach
  already closes most of the gap with less state to unwind on decline. Revisit if measurements
  show accept→media still lags the second-call path.
- *Pre-capture camera/mic during ring (callee)*: **rejected** — turning the camera on before the
  user accepts is a privacy violation (Principle IX) and lights the camera while merely ringing.
- *Create the answer with placeholder transceivers and `replaceTrack` after gUM*: rejected for now
  — more renegotiation complexity than warranted; the concurrent approach is simpler and enough.

## Decision 3 — Group first-leg (P3)

**Decision**: Investigate `mesh.ts` `start()`/`buildLeg()` for the same serial gUM→TURN→leg
pattern; `mesh.start()` already warms TURN before building legs (line ~166), so the main remaining
lever is overlapping the initial `getUserMedia` in `start()` with TURN warm. Apply the same
concurrency only if a measured asymmetry exists; otherwise this story is a verification no-op.

**Rationale**: Group calls reuse the same primitives; the headline pain is 1:1, so keep group
changes minimal and evidence-driven.

**Finding (T014)**: Confirmed the asymmetry — `mesh.start()` `await`s `getUserMedia` and only then
`await getTurnConfig()` (serial), the same cold-TURN-after-gUM pattern as the 1:1 caller. **Fix
applied (T015)**: warm the TURN cache before awaiting capture in `start()` (one call to
`warmTurnConfig()`, mirroring the proven US1 change), so the fetch overlaps gUM; the later
`getTurnConfig()` is then a warm hit. **Verification scoping**: this is the identical pattern
already gated deterministically by the US1 caller-overlap test, applied to a P3 path; group
connectivity is covered by the existing real-WebRTC group e2e (`e2e/calls.spec.ts` group cases),
which must stay green. A bespoke group-leg milestone gate would require coupling `mesh.ts` to the
1:1 connect-milestone instrumentation for marginal P3 value, so it is intentionally not added —
the reorder is low-risk and the no-regression group suite is the check.

## Decision 4 — Test strategy (TDD for a perf fix, non-flaky)

**Decision**: Use a **deterministic ordering/overlap assertion** as the failing-first regression
test, backed by a small dev-only instrumentation hook that records connect-milestone timestamps
(`callStart`, `gumStart`/`gumResolved`, `turnReady`, `pcCreated`, `remoteDescriptionSet`,
`answerSent`/`offerSent`, `firstRemoteMedia`). Assertions:
- **Regression (fails today, passes after)**: setup work does **not** run strictly after gUM — e.g.
  on the caller, `turnReady` is reached without having waited for `gumResolved` first (TURN warm
  started before/parallel to gUM); on the callee, `remoteDescriptionSet` is reached without waiting
  for `gumResolved` (PC/SDP setup overlaps capture). These are boolean orderings, not wall-clock
  thresholds → no flake.
- **Success validation (coarse, generous margin)**: measure first-call time-to-first-media via the
  existing remote-stream/track hooks and assert it is within a generous margin of the second-call
  path (SC-001/SC-002). Kept generous to avoid CI flake; the ordering assertions are the real gate.
- **No regression**: existing `e2e/calls.spec.ts` and `e2e/call-waiting.spec.ts` stay green.

**Rationale**: Constitution III requires a failing regression test for a bug fix; raw timing
thresholds are flaky in CI, so the deterministic ordering invariant is the gate and timing is a
diagnostic. The instrumentation hook is dev-only (stripped from production like the rest of
`testhook`), so it adds no production weight and no server-visible anything.

**Alternatives considered**:
- *Pure wall-clock threshold test*: rejected as the gate — flaky across CI hardware.
- *Mock timers / unit-test the ordering*: the connect path is deeply tied to real
  `RTCPeerConnection`/`getUserMedia`; a real-WebRTC e2e with milestone timestamps is more faithful
  and is the established pattern (`call-adaptive.spec.ts` already reasons about connect behavior).

## Zero-knowledge confirmation

No new server frame, metadata, or stored state. The only server interaction affected is the timing
of the existing authenticated `/v1/turn-credentials` request (warmed earlier) — same request, same
response, just sooner. SDP/ICE remain sealed. The instrumentation hook is client-local and dev-only.
The required zero-knowledge checklist will record this explicitly.
