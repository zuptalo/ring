# Implementation Plan: Adaptive call quality — per-receiver, network- and screen-aware, with peer-reported health

**Branch**: `feat/0007-adaptive-call-quality` | **Date**: 2026-06-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/0007-adaptive-call-quality/spec.md`

## Summary

Two jobs in one feature: **(1) find and fix the post-automation video-quality regression**, and
**(2) improve the model** so each receiver gets the best quality its screen/tile size, device, and
network can sustain — driven partly by a small, sealed, periodic **connection-health report** each
peer sends its call peers (~2s + on significant change).

The pure adaptive controller (`quality.ts`) already exists (AIMD per mesh leg + the 1:1 PC). The
work keeps that shape but corrects it and feeds it three new inputs: the **receiver's reported
downlink/health**, the **receiver's manual cap** (hard, both directions), and the **rendered tile
size**. The health report rides the existing sealed per-pair signalling (the same channel hold/
resume used in 0005), so there is **no new server message, metadata, or state**.

### Regression hypotheses to confirm first (Phase 0)

The fix must be evidence-led. Leading suspects in the current controller:

1. **iOS encoder path** (`tierEncoding(tier, avoidEncoderScaling=true)`) drops `scaleResolutionDownBy`
   so a low/medium tier sends **full resolution at a starved bitrate** → blocky, rather than a clean
   downscaled image. Strongest suspect for "quality dropped."
2. **Start-low + slow climb**: `initialController()`='low', `CLIMB_AFTER`=3 healthy samples per
   single step, sampled every ~2s → many seconds to reach a good tier; may never feel "good."
3. **Safari cap-at-high**: with no `availableOutgoingBitrate` (common on WebKit), the climb ceiling
   is forced to `high` — never HD even on a 1:1 over a great link (violates the new HD-on-1:1 target).
4. **Participant-count ceiling** (`clampForPeers`) and/or back-off thresholds mis-tuned (e.g. a noisy
   single bad sample dropping a tier).

Phase 0 reproduces each in the harness/units before changing anything.

## Technical Context

**Language/Version**: TypeScript (Vue 3 + Ionic client); pure controller is framework-free. No server
change.

**Primary Dependencies**: Browser WebRTC (`RTCRtpSender.setParameters`, `getStats`), existing
`src/services/call/{quality,mesh,signalling,diag}.ts`, `src/composables/useCall.ts`, the sealed
`CallSignal` path (`src/services/crypto/message.ts`).

**Storage**: N/A — call/quality state is ephemeral (no IndexedDB store, no `DB_VERSION` bump). The
manual quality pin remains the existing setting.

**Testing**: Vitest for the pure controller (`quality.test.ts`); Playwright real-WebRTC e2e with **up
to 4 isolated participants** and **per-context CDP network throttling applied/changed on the fly**
(`Network.emulateNetworkConditions`) to assert timely, per-receiver, smooth adjustments. iOS image
quality confirmed on-device (headless WebKit can't do fake-media WebRTC).

**Target Platform**: Installable PWA on Chromium + WebKit/Safari (incl. older iOS that motivated the
bitrate-only encoder path). The quality model and the regression fix must hold on both.

**Performance Goals**: AUTO reaches HD on 1:1 / high on 3–4-person groups within ~5s on a healthy
link (SC-001); a throttled receiver's inbound steps down in ~3–5s and recovers in ~10s with no
freeze (SC-002); stable (no flapping) under steady conditions (SC-005).

**Constraints**: Zero-knowledge — the health report is sealed per-pair, coarse (downlink class +
pref tier), no precise network identifiers, no new server-visible metadata. Audio protected over
video under congestion. No regression to connect speed (2008), hold/swap (0005), caps/busy (0004).

**Scale/Scope**: Mesh up to the video cap (4) / audio cap (8); one controller per leg + the 1:1 PC;
a ~2s health report per leg.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS with required checklist. The new
  connection-health report is a sealed per-pair `CallSignal` carried over the existing relayed
  frame (like hold/resume), opaque to the server; coarse payload only (downlink class, pref tier),
  no precise IP/location, no new server frame/metadata/state. **`/speckit-checklist` (zero-knowledge)
  is REQUIRED** (touches Principle I) and will be run before implement.
- **II. Spec-Driven** — PASS (spec → clarify ✓ → plan → tasks → analyze → checklist → issues →
  implement).
- **III. Test-Driven Development** — PASS. Pure-controller unit tests lead (the regression is
  reproduced as failing unit assertions: HD-on-healthy-1:1, receiver-cap honored, iOS encoding
  shape, no-flap); user-facing behavior covered by the throttled multi-party e2e.
- **IV. Crypto Discipline** — PASS. No new crypto; reuses the existing sealed-signal seal/open.
- **V. Offline-First Data Integrity** — PASS. No object store change; no `DB_VERSION` bump.
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No server code or migration; the relay
  forwards the sealed health frame unchanged.
- **VII. Quality Gates** — PASS. build + unit + server + e2e green before done; user-facing subject
  reads as release-note copy.
- **VIII. Traceable Delivery** — PASS. `taskstoissues` → PR `Closes #N`.
- **IX. Privacy & Data Minimization** — PASS, reinforced: the report carries only coarse,
  call-relevant signals; precise bandwidth/IP/location never shared.
- **X. Accessibility & i18n** — PASS. ⓘ-panel additions are diagnostic text (LTR numerics);
  manual-pin UI already exists.
- **XI. Ionic-First UI** — PASS. ⓘ panel + quality picker reuse existing components/tokens.

**No violations → Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/0007-adaptive-call-quality/
├── plan.md           # this file
├── research.md       # Phase 0 — regression diagnosis + chosen designs + test approach
├── data-model.md     # Phase 1 — health report, extended controller inputs, tile target, diagnostics
├── contracts/
│   └── health-signal.md  # the sealed per-pair connection-health CallSignal (wire shape)
├── quickstart.md     # Phase 1 — 4-instance throttled Playwright + on-device iOS validation
└── tasks.md          # Phase 2 — /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
src/
├── services/call/
│   ├── quality.ts        # PURE controller: fix regression (iOS encoding, climb speed, Safari cap,
│   │                     #   count ceiling); add receiver downlink + hard receiver-cap + tile-size
│   │                     #   target as inputs; HD-on-1:1 / high-on-group default ceiling.
│   ├── mesh.ts           # per-leg: send/receive health reports (~2s + on change), apply receiver
│   │                     #   cap per leg, feed peer downlink into adaptLeg, per-tile target, diag.
│   ├── signalling.ts     # sendHealth(...) — new sealed CallSignal kind over the call-ice frame
│   │                     #   (mirrors sendHoldResume).
│   └── diag.ts           # ⓘ snapshot: per-leg tier, reported downlink, limitation reason, pin.
├── services/crypto/
│   └── message.ts        # CallSignal.type += 'qos' (health/pref) + its coarse payload fields.
├── composables/
│   └── useCall.ts        # 1:1 path mirror; manual pin → broadcast receiver cap; receive peer caps;
│                         #   thread rendered tile sizes from the UI into the target.
└── views/detail/
    └── CallActivePage.vue # report rendered tile sizes per remote; surface the richer ⓘ data.

src/services/call/quality.test.ts   # extend: regression assertions + new inputs (downlink, cap, tile)
e2e/
├── helpers.ts                       # CDP throttle helper + read per-leg tier / diag / inbound bitrate
└── call-quality.spec.ts             # NEW: 4-instance, on-the-fly-throttled adaptation + manual cap
```

**Structure Decision**: Single client codebase. The brain stays in the pure, unit-testable
`quality.ts`; `mesh.ts`/`useCall.ts` are the I/O (stats in, encodings out, health reports in/out);
`signalling.ts`/`message.ts` carry the sealed report; `diag.ts`/`CallActivePage.vue` surface it. The
Go server is untouched.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
