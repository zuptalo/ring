# Implementation Plan: Call waiting — hold, swap & drop between two concurrent calls

**Branch**: `feat/0005-call-waiting-hold` | **Date**: 2026-06-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/0005-call-waiting-hold/spec.md`

## Summary

Let a user take a second call without losing the first: accepting a second incoming call puts
the current call on hold (media paused both ways, "on hold" shown to the other side), connects
the new one, and lets the user swap back and forth or drop either — across any mix of 1:1 and
mesh group calls, capped at two (one active, one held; a third caller gets busy).

Technical approach (see [research.md](./research.md)): keep the PeerConnections alive and
pause/resume media with **`replaceTrack(null|live)`** (renegotiation-free, iOS/Safari-safe) —
the active call owns the single `getUserMedia` track set; the held call's senders carry
`null`. Add a **two-slot** model (`active` + `held`) to the singleton `useCall`, parking the
other call in a held holder. Signal hold/resume as **sealed `CallSignal` kinds** over the
existing per-pair path so the server stays blind. Extend spec 0004's busy handling to offer
**Accept & hold** when a held slot is free, and reuse its cue mechanism for the call-waiting
cues. No new server endpoints, stores, or migrations.

## Technical Context

**Language/Version**: TypeScript (ES modules, Vue 3 `<script setup>` + Ionic); Go 1.26 server
(unchanged here — relay only).

**Primary Dependencies**: WebRTC (`RTCPeerConnection`, `RTCRtpSender.replaceTrack`),
libsodium Double Ratchet (existing sealed-signal path), Ionic components + `--ring-*` tokens.

**Storage**: None new. Call state is in-memory in `useCall.ts`; call-history rows
(IndexedDB) are unchanged. No Postgres table, no `DB_VERSION` bump, no migration.

**Testing**: vitest for the pure slot state machine + cue-trigger decisions; Playwright e2e
(`e2e/call-waiting.spec.ts`, chromium) for hold/swap/drop/cap/cues; on-device iOS/Safari for
the hard cross-browser constraint.

**Target Platform**: Installable PWA (Chromium + iOS/Safari/WebKit); single-container `ringd`.

**Project Type**: Web app (Vue 3 PWA client + Go relay) — client-only feature here.

**Performance Goals**: Resume/swap restores media within a few seconds (SC-003); swaps are
renegotiation-free so effectively instant. No added server load (sealed signals only).

**Constraints**: iOS/Safari MUST work (FR-013); zero-knowledge non-negotiable (FR-012); at
most two concurrent calls (FR-008); a resumed call restarts adaptive quality low.

**Scale/Scope**: Two concurrent calls per user; touches `useCall.ts`, `mesh.ts`,
`signalling.ts`/`crypto/message.ts` (signal kind), `sound.ts`, `CallActivePage.vue`,
`IncomingCallOverlay.vue`. No server code beyond confirming the relay forwards the sealed
signal unchanged.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — ✅ Hold/resume are sealed `CallSignal`s
  over each pair's ratchet; the server relays ciphertext and can't distinguish a hold from any
  other sealed signal (FR-012). No new metadata, no plaintext, no media to the server. The
  spec's Zero-Knowledge Impact is captured in [data-model.md](./data-model.md). **Requires the
  `/speckit-checklist` zero-knowledge pass** (touches Principle I).
- **II. Spec-Driven** — ✅ specify → clarify done; this is `plan`; tasks/analyze/checklist to
  follow before implement.
- **III. TDD** — ✅ Plan orders pure unit tests (slot state machine, cue triggers) and an e2e
  spec before/with implementation; new user-facing behaviour adds `e2e/call-waiting.spec.ts`.
- **IV. Crypto Discipline** — ✅ Reuses the existing Double Ratchet sealed-signal path; adds
  only a new signal *kind*, no new primitive or scheme. No key handling changes.
- **V. Offline-First** — ✅ No IndexedDB store/`DB_VERSION` change (call state is ephemeral).
- **VI. Stateless Server & Forward-Only Migrations** — ✅ No server state, no migration; relay
  unchanged.
- **VII. Quality Gates** — ✅ Will satisfy build + vet + test + e2e; user-facing commit
  subjects written as release-note copy.
- **X / XI. A11y & Ionic-First** — ✅ The held-call bar, swap control, and Accept & hold are
  composed from stock Ionic + `--ring-*` tokens; the "on hold" affordance reuses existing tile
  styling. No bespoke widgets.

No violations → **Complexity Tracking is empty**. The two-slot model (vs a general N-call
refactor) is the *simpler* option for a two-call cap, not added complexity.

## Project Structure

### Documentation (this feature)

```text
specs/0005-call-waiting-hold/
├── plan.md              # This file
├── research.md          # Phase 0 — technical decisions
├── data-model.md        # Phase 1 — slots, hold state, transitions, ZK impact
├── quickstart.md        # Phase 1 — how to verify
├── contracts/
│   └── hold-signals.md  # Phase 1 — sealed hold/resume signal + hook/UI/cue surface
├── checklists/          # requirements.md (from specify) + zero-knowledge.md (required, /speckit-checklist)
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created here)
```

### Source Code (repository root) — files this feature touches

```text
src/
├── composables/
│   └── useCall.ts                # two-slot model: heldCall holder, acceptAndHold/swapCalls/
│                                 # endActive/endHeld; second-incoming → offer hold vs busy
├── services/
│   ├── call/
│   │   ├── mesh.ts               # MeshSession.pause()/resume(): replaceTrack(null|live) per
│   │   │                         # leg + send sealed hold/resume per leg
│   │   └── signalling.ts         # send/handle the sealed hold/resume CallSignal
│   ├── crypto/message.ts         # CallSignal gains 'hold' | 'resume' kinds
│   └── sound.ts                  # callwaiting/hold/resume/swap cue recipes
├── views/detail/
│   └── CallActivePage.vue        # held-call swap bar, swap control, "on hold" affordance
└── components/
    └── IncomingCallOverlay.vue   # "Accept & hold" action when a held slot is free

e2e/
└── call-waiting.spec.ts          # hold/swap/drop/cap/cues (chromium)

# Server: NO changes expected (the relay already forwards sealed call signals between room
# members). Confirm-only; if a routing gap appears, it's a relay tweak, not new state.
```

**Structure Decision**: Client-only feature on the existing Vue PWA + mesh calling stack;
the Go server is relay-only and unchanged. The two-slot call model lives in the existing
`useCall.ts` singleton (active path untouched; a parked `held` holder added), and media
pause/resume reuses the established renegotiation-free `replaceTrack` pattern.

## Complexity Tracking

> No constitution violations — section intentionally empty. The two-slot design is the
> minimum needed for the two-call cap; no new server capability, dependency, or persistence
> is introduced.
