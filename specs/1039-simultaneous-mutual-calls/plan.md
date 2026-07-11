# Implementation Plan: Simultaneous mutual calls connect instead of ringing each other

**Branch**: `feat/1039-simultaneous-mutual-calls` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1039-simultaneous-mutual-calls/spec.md`

## Summary

When two contacts place 1:1 calls at each other at (nearly) the same time, resolve the
glare deterministically on both devices and connect them into ONE call — automatically
when the kinds match, via a normal incoming ring when they differ (camera consent).
Two client-side defects are fixed on the way: (1) the glare branch in `handleOffer`
keys on `callState !== 'idle'`, but `startDirectCall` only leaves `'idle'` *after*
getUserMedia + PC build + offer send, so a crossing offer inside that setup window
skips glare handling, clobbers `callMeta`, and strands BOTH sides on "Calling…"; and
(2) even detected glare today re-rings the yielding side instead of connecting it.
Everything is client-only policy over the existing sealed signalling — no server or
protocol change.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>` + Ionic 8), client-only change

**Primary Dependencies**: WebRTC (`RTCPeerConnection`), existing sealed call signalling
(`sendSealedSignal`/`openSealedSignal` over the pair's Double Ratchet), existing call
state machine in `src/composables/useCall.ts`

**Storage**: IndexedDB call log via existing `createCall`/`deleteCalls` in `src/db/queries.ts`
(no new object store, no `DB_VERSION` bump)

**Testing**: vitest for a new pure decision module; Playwright e2e (two real browsers
calling each other simultaneously, per-repo harness)

**Target Platform**: installable PWA — Chrome/Android, Safari/iOS (WebKit constraints
apply, see research R4), desktop browsers

**Project Type**: web app (client of the existing monorepo; `server/` untouched)

**Performance Goals**: mutual attempts connect within the normal single-call
answer-to-connected time (+≤1s); no added latency to ordinary calls

**Constraints**: zero-knowledge boundary (no new plaintext or metadata to the server);
no second `getUserMedia` on the yielding WebKit device (mute hazard, bug 179363);
call-waiting (specs 0005/2009) behavior for genuinely different callers unchanged

**Scale/Scope**: one composable (`useCall.ts`) + one new pure module + tests; ~4 touch
points (`startDirectCall`, `handleOffer`, accept path, teardown/cancel)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary** — PASS. No new frame types or fields; the resolution
  re-uses the sealed offer/answer/cancel frames exactly as a human-driven
  place/accept/hang-up would. Spec carries the required Zero-Knowledge Impact section.
- **II. Spec-Driven Development** — PASS. Spec 1039 (ad-hoc band), pipeline followed
  (specify → clarify → plan → tasks → analyze → taskstoissues → implement).
- **III. Test-Driven Development** — PASS (planned). New pure decision module gets
  vitest coverage written first; user-facing behavior gets a new e2e spec
  (`e2e/mutual-call.spec.ts`) with the mutual-timing scenarios. tasks.md orders tests
  before implementation.
- **IV. Crypto Discipline** — PASS. No crypto change: sealing/opening of call frames is
  untouched; `messaging.ts` untouched. `/speckit-checklist` is therefore not mandated by
  the gate-sequencing rule (no Principle I/IV surface is modified), and is skipped.
- **V. Offline-First Data Integrity** — PASS. Call-log writes stay behind
  `src/db/queries.ts`; the abandoned attempt's record is removed via the existing
  `deleteCalls`. No schema change.
- **VI. Stateless Server** — PASS (server untouched).
- **VII. Quality Gates** — PASS (planned): `npm run build`, vitest, e2e for the changed
  behavior; server gates unaffected but run anyway in CI.
- **VIII. Traceability** — PASS: branch `feat/1039-…`, issues via taskstoissues, PR
  lists `Closes #N`.
- **IX–XI** — PASS. No new data collected; no new UI surface (the change *removes* a
  ring in one path; any toast/cue reuses existing primitives).

## Project Structure

### Documentation (this feature)

```text
specs/1039-simultaneous-mutual-calls/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── signalling.md    # Phase 1 output — existing-frame sequences (no wire change)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── composables/
│   └── useCall.ts                 # startDirectCall (attempt token), handleOffer
│                                  # (meta-keyed glare gate + routing), auto-accept path,
│                                  # yield/cancel of the abandoned attempt
├── services/call/
│   ├── glare.ts                   # NEW pure decision module (unit-testable)
│   └── glare.test.ts              # NEW vitest decision-table tests
└── db/queries.ts                  # (existing deleteCalls; no change expected)

e2e/
└── mutual-call.spec.ts            # NEW two-browser simultaneous-call e2e
```

**Structure Decision**: single-project client change inside the existing monorepo
layout; all new logic that can be pure lives in `src/services/call/glare.ts` following
the repo's established pattern (`capacity.ts`, `invite-plan.ts`, `merge-kind.ts` — pure
modules with sibling tests), keeping `useCall.ts` wiring thin.

## Complexity Tracking

No constitution violations to justify.
