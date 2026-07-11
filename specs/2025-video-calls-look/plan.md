# Implementation Plan: Video calls look sharp again and recover from quality dips

**Branch**: `feat/1039-simultaneous-mutual-calls` (shared with spec 1039 by owner request — one branch build, one develop build) | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2025-video-calls-look/spec.md`

## Summary

Fix the video-quality regression introduced with the adaptive tier controller
(specs 0004/0007) while keeping its adaptivity: make the congestion signal truthful
(an encoder "bandwidth limited" reading caused by our own cap is not congestion),
make the floor recoverable (tier `off` genuinely pauses the video sender instead of
strangling it to 1 bps, so stats can read healthy and the ladder climbs back), raise
the ceiling (top tier ≥4 Mbps; 1:1 starts at `high`), request HD capture where safe
(non-iOS), sample 1:1 adaptation on the designed ~2 s cadence, and de-noise the
receiver's downlink classification. Client-only; the sealed `qos` frame and all wire
shapes are unchanged.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 + Ionic PWA), client-only

**Primary Dependencies**: WebRTC RTCRtpSender.setParameters / getStats; the existing
pure controller `src/services/call/quality.ts` and its two consumers
(`src/composables/useCall.ts` 1:1 path, `src/services/call/mesh.ts` per-leg path)

**Storage**: none (no persisted data touched)

**Testing**: vitest on the pure controller (regression tests FIRST — hotfix band);
existing Playwright e2e (`call-adaptive`, `call-quality`, `call-connect-speed`,
`mutual-call`) as the behavioral gate; a drive probe for capture resolution + steady-tier

**Target Platform**: PWA — Chrome/Android, Safari/iOS (WebKit constraints per R4)

**Project Type**: web app (client of the monorepo; `server/` untouched)

**Performance Goals**: top tier ≤6 s after connect on a clean link; zero tier
down-steps over 60 s steady-state; floor recovery ≤10 s after conditions clear

**Constraints**: zero-knowledge boundary (no wire change); iPhone-8-class WebKit must
keep unconstrained capture + bitrate-only tiering; adaptation must not fight
hold/resume (spec 0005) or the user's camera toggle

**Scale/Scope**: `quality.ts` (+ its test), `useCall.ts` (1:1 adapt/suspend/capture),
`mesh.ts` (per-leg suspend), no schema/server changes

## Constitution Check

- **I. Zero-Knowledge Boundary** — PASS: no new wire data; `qos` shape untouched; spec
  carries the Zero-Knowledge Impact section.
- **II. Spec-Driven Development** — PASS: spec 2025 (hotfix band), full pipeline on the
  shared branch; every commit references the spec.
- **III. Test-Driven Development** — PASS (planned): this is a `2001+` fix, so FAILING
  regression tests reproducing the floor trap and the self-inflicted back-off land
  before the fix; downlink-classifier noise tests likewise.
- **IV. Crypto Discipline** — PASS: no crypto surface; `/speckit-checklist` not
  mandated (no Principle I/IV change).
- **V. Offline-First Data Integrity** — PASS: no data layer changes.
- **VI. Stateless Server** — PASS: server untouched.
- **VII. Quality Gates** — PASS (planned): `npm run build`, vitest, adaptive/call e2e.
- **VIII. Traceability** — PASS: spec id in commits; GitHub issues deferred together
  with spec 1039's (issue creation pending owner-approved tooling permission).
- **IX–XI** — PASS: no new data collection; no UI change (numbers/semantics only).

## Design decisions (research folded in — client-only tuning fix)

### R1 — Congestion truthfulness (FR-004)

`snapshotFromReport` reports `limitedBy: 'bandwidth' | 'cpu' | null` instead of the
boolean `qualityLimited`. In `nextTier`:

- `bandwidth`-limited counts as congestion **only when corroborated**: receiver loss
  `fractionLost > 0.02`, or a known send estimate below the current tier's target
  (the existing `BW_BACKOFF_MARGIN` path already covers the collapse case).
- `cpu`-limited keeps today's semantics (sustained 2-sample back-off) — it is never
  caused by our bitrate cap, and in a mesh it is the real N-encoders protection. The
  brief cpu blip after an encoder reconfigure is filtered by the existing
  sustained-congestion requirement at the 2 s cadence.

*Rejected*: dropping limitation reasons entirely (loses the only early CPU signal);
corroborating cpu too (starves the mesh protection the moment loss is clean).

### R2 — Recoverable floor (FR-005)

Tier `off` pauses the video sender for real: the adapter (1:1 `applySenderTier` /
mesh `setLegTier`) detaches the video track (`replaceTrack(null)`) and remembers *it*
did so (a per-connection/per-leg suspended flag). With nothing encoded, `outbound-rtp`
stops reporting `bandwidth` limitation, samples read healthy, and the existing ladder
climbs `off → low` after `CLIMB_AFTER` healthy samples; leaving `off` re-attaches the
current local video track and applies the tier's encoding. Guards:

- Resume only re-attaches when adaptation itself suspended — never fights the user's
  camera toggle or hold/resume, which manage tracks through their own paths.
- Teardown / hold / camera-off clear the flag (hold and camera-off already detach
  tracks; adaptation is suspended while held, unchanged).

*Rejected*: flooring the ladder at `low` (perpetuates ~150 kbps of junk video on a
link that can't afford it — audio suffers, the original spec-0004 intent); keeping
`maxBitrate: 1` (the trap being fixed).

### R3 — Ceiling + entry point (FR-001/FR-002)

`hd` tier: `maxBitrate` 2.5 → **4 Mbps** (shared table; mesh reaches `hd` only for
2-person calls via `clampForPeers`, where 4 Mbps is equally appropriate).
`initialController(start)` gains a start-tier argument: **1:1 starts `high`**, mesh
legs keep `medium` (N parallel encoders). With `CLIMB_AFTER = 2` at the 2 s cadence,
`high → hd` lands ≤6 s after connect (SC-001).

*Rejected*: uncapped `hd` (destroys pin/data-saver semantics and mesh budgeting);
starting 1:1 at `hd` directly (one blind step above the estimate on a genuinely bad
link before the first sample lands — `high` is the safe sharp start).

### R4 — HD capture where safe (FR-003)

`gumConstraints` (and the camera-flip/re-acquire call sites, via one shared
`videoConstraints(facing?)` helper) request `width/height ideal 1280×720` **on
non-iOS only**. iOS stays unconstrained: the iPhone-8/iOS-16.7 WebKit orientation
flip permanently mutes the camera when ANY size is named (existing comment), and
unconstrained WebKit opens the sensor in its native format anyway. Chrome (Android/
desktop) defaults to 640×480 without the request — this is where the sharpness is won.
`ideal` (not `exact`) so devices without 720p still open.

### R5 — De-noised downlink classification (FR-006)

`downlinkClassFrom` gains a minimum-evidence rule: a window with fewer than
**50 packets** (received+lost) keeps the previous class unchanged (no hysteresis
step on noise). The dropped-frame trim requires a ratio **> 0.25** (was 0.1) — real
decode/render starvation, not UI-animation jitter. Loss thresholds keep their intent
with mild relaxation: `>0.25 → low`, `>0.12 → medium`, `>0.05 → high`, else `hd`.

### R6 — Cadence (FR-007)

`pollStats` stays at 1 s (byte counters / warning / ⓘ need it) but calls
`adaptOneToOne` every **second** tick (~2 s), matching the mesh and the constants'
design. The severe-loss immediate back-off is unaffected (it acts within one decision).

### R7 — What deliberately does NOT change

Manual pin + data-saver clamps, per-peer mesh ceilings, tile-size ceilings, the
receiver-request (`qos`) wire shape and staleness fallback, severe-loss immediate
back-off, iOS bitrate-only tiering, and the hold/resume machinery.

## Project Structure

### Documentation (this feature)

```text
specs/2025-video-calls-look/
├── spec.md
├── plan.md              # This file (research folded in — client-only tuning fix)
├── quickstart.md
└── tasks.md
```

No `data-model.md` (no persisted entities) and no `contracts/` (no interface change;
the `qos` frame is untouched — asserted by FR-008).

### Source Code (repository root)

```text
src/
├── services/call/
│   ├── quality.ts           # limitedBy signal, corroborated congestion, start-tier
│   │                        # param, hd bitrate, downlink min-evidence + thresholds
│   ├── quality.test.ts      # FAILING-first regression + decision tests
│   └── mesh.ts              # per-leg suspend/resume at tier 'off'
├── composables/useCall.ts   # 1:1 suspend/resume, start 'high', 2s adapt cadence,
│                            # videoConstraints helper (HD capture on non-iOS)
drive/scenarios/
└── probe-call-quality.mjs   # capture size + steady-tier + floor-recovery probe
```

**Structure Decision**: all policy changes land in the pure `quality.ts` first (unit-
testable), with the two consumers wired to the new signal; matches the repo's
pure-core/thin-wiring convention.

## Complexity Tracking

No constitution violations to justify.
