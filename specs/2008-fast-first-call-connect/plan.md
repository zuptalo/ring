# Implementation Plan: Make the first call connect as fast as a call-waiting second call

**Branch**: `fix/2008-fast-first-call-connect` | **Date**: 2026-06-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/2008-fast-first-call-connect/spec.md`

## Summary

The first 1:1 call connects slowly because the critical path is **serial**: the caller does
`getUserMedia` → build peer connection (which awaits a **cold** TURN-credential fetch) →
`createOffer` → send; the callee, on accept, does `getUserMedia` → build PC (TURN fetch) →
`setRemoteDescription` → `createAnswer`. The call-waiting **second** call is fast because, by then,
the TURN cache is warm, the camera/mic stream already exists (reused — no `getUserMedia`), and the
PC connects immediately; early ICE is buffered either way (`pendingIce` already covers the first
call, so dropped candidates are **not** the cause).

The fix removes avoidable serialization from the first-call critical path, with **no change to the
zero-knowledge boundary** (client-side timing/ordering only):

1. **Warm the TURN credential cache off the critical path** — start `getTurnConfig()` at call
   intent (outgoing) and on incoming ring, so `newPeerConnection` never blocks on a network fetch.
2. **Run media capture and connection setup concurrently** instead of strictly serially — overlap
   `getUserMedia` with TURN warming (caller) and with PC creation + `setRemoteDescription` (callee),
   so the answer/offer is produced as soon as the (independently captured) stream is ready.
3. **Keep the existing early-ICE buffering** (`pendingIce`) and all call semantics unchanged.

This is a TDD bug fix (constitution III): it begins with a **failing, deterministic regression
test** that asserts the *ordering/overlap* invariant (setup work no longer waits serially on gUM /
a cold TURN fetch) — not a flaky wall-clock threshold — plus a coarse time-to-first-media parity
measurement as success validation.

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>` + Ionic; client-only change.

**Primary Dependencies**: Browser WebRTC (`RTCPeerConnection`, `getUserMedia`), existing
`src/services/call/turn.ts` (`getTurnConfig` cache), `src/composables/useCall.ts` (1:1 connect
paths), `src/services/call/mesh.ts` (group first-leg, P3 only). No new dependencies.

**Storage**: N/A — no IndexedDB store change, no `DB_VERSION` bump (call state is ephemeral).

**Testing**: Playwright real-WebRTC e2e (`e2e/`, drives via `window.__ringTest`) for the
behavioral/timing assertions; existing Vitest units for any pure helper. No DB needed.

**Target Platform**: Installable PWA on Chromium + WebKit/Safari (iOS). The speed-up MUST hold on
iOS/Safari; e2e timing assertions run on chromium (WebKit headless can't do fake-media WebRTC), so
iOS is validated on-device per quickstart.

**Project Type**: Web (Vue PWA client + Go server) — but this change is **client-only**.

**Performance Goals**: First-call median time-to-first-media within ~1s of the second-call path
(SC-001); both parties receive decoded media within ~2s of accept on a LAN-equivalent link
(SC-002); ≥99% first-attempt connect with no dropped early ICE (SC-003).

**Constraints**: Zero-knowledge boundary unchanged (no new server frame/metadata/state); no media
captured before the callee accepts (privacy, Principle IX); no regression to ring/answer/decline/
cancel/no-answer, busy, or call-waiting behavior; works on iOS/Safari.

**Scale/Scope**: Two functions on the hot path (`startDirectCall`, `acceptCall`) plus TURN-warm
call sites and an optional instrumentation hook; group first-leg (`mesh.ts`) only if the same
asymmetry is confirmed (P3).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS. Change is purely client-side
  timing/ordering. SDP/ICE stay sealed exactly as today; no new server message type, no new
  server-visible metadata, no stored plaintext. Warming TURN earlier changes only *when* the
  existing authenticated `/v1/turn-credentials` request is made, not *what* it reveals. ZK Impact
  section present in spec (FR-009). **`/speckit-checklist` (zero-knowledge) will be run** as a
  required confirmation since the change touches the call-signalling path (Principle I).
- **II. Spec-Driven Development** — PASS. Spec → plan → tasks → analyze → checklist → taskstoissues
  → implement; traceable to `fix/2008`.
- **III. Test-Driven Development** — PASS. As a `2001+` bug fix it begins with a **failing
  regression test** that reproduces the slow/serial behavior deterministically (ordering/overlap
  assertion via instrumentation milestones), satisfied by the fix; user-facing behavior change is
  covered by an e2e under `e2e/`.
- **IV. Crypto Discipline** — PASS. No crypto changes; the sealed signalling transport is untouched.
- **V. Offline-First Data Integrity** — PASS. No object store added/changed; no `DB_VERSION` bump.
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No server code, no migration; the TURN
  endpoint is unchanged.
- **VII. Quality Gates** — PASS. `npm run build`, server gate (unaffected), `npm run test:unit`,
  `npm run test:e2e` all green before done; user-facing `fix(...)` subject reads as release-note copy.
- **VIII. Traceable, Auto-Closing Delivery** — PASS. `taskstoissues` opens issues; the feature→
  develop PR will `Closes #N` each.
- **IX. Privacy & Data Minimization** — PASS, and reinforced: the plan explicitly **does not**
  capture camera/mic before the callee accepts (no pre-ring gUM); only network/SDP prep is warmed.
- **X. Accessibility & Internationalization** — PASS. No new user-facing text/UI surface.
- **XI. Ionic-First UI** — PASS. No UI change.

**No violations → Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/2008-fast-first-call-connect/
├── plan.md              # This file
├── research.md          # Phase 0 — root-cause + chosen levers + test strategy
├── data-model.md        # Phase 1 — connection-setup milestones (instrumentation), no persisted data
├── quickstart.md        # Phase 1 — how to validate (e2e + on-device iOS)
└── tasks.md             # Phase 2 — /speckit-tasks (not created here)
```

(No `contracts/` — this is a purely internal client-timing change with no new external/API or
wire contract. The only new surface is a dev-only test-instrumentation hook, documented in
data-model.md/quickstart.md.)

### Source Code (repository root)

```text
src/
├── composables/
│   └── useCall.ts            # PRIMARY: startDirectCall (caller) + acceptCall (callee) — parallelize
│                             #   gUM with TURN warm / PC setup; add connect-milestone instrumentation
├── services/
│   └── call/
│       ├── turn.ts           # getTurnConfig cache — add an explicit fire-and-forget warm entrypoint
│       └── mesh.ts           # P3 only: first group-leg connect, if the same asymmetry is confirmed
└── services/
    └── testhook.ts           # expose connect-milestone timestamps for the e2e (dev-only, stripped in prod)

e2e/
├── helpers.ts                # add helpers to read connect milestones / time-to-first-media
└── call-connect-speed.spec.ts # NEW: failing-first regression (ordering/overlap) + TTFM parity
```

**Structure Decision**: Single client codebase (Option: web client). The change is concentrated in
`useCall.ts` (the two 1:1 connect paths) plus a small TURN-warm helper in `turn.ts` and a dev-only
instrumentation hook surfaced through `testhook.ts`/`helpers.ts`. The Go server is untouched.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
