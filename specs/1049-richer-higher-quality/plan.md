# Implementation Plan: Richer Notification Alert Tones

**Branch**: `feat/1049-richer-higher-quality` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1049-richer-higher-quality/spec.md`

## Summary

Upgrade the 7 audible alert tones from bare oscillator beeps to layered struck-instrument
voices — multiple harmonic partials with independent decays, gentle detune, soft attack
transients, and a subtle procedurally-generated reverb tail — entirely within the existing
no-audio-files stance. One file carries the whole feature (`src/services/sound.ts` + its
test): a new **alert-voice engine** renders the 7 tones through a dedicated master bus
(compressor + generated-impulse convolver), while the existing `RECIPES` note engine and
`FX` foley keep serving every call/game cue byte-identically (FR-007). `playTone`'s
signature and the settings schema are untouched.

## Technical Context

**Language/Version**: TypeScript 5, Web Audio API (already the only audio dependency)

**Primary Dependencies**: none new — `src/services/sound.ts` is self-contained; consumers
(`notify.ts` `inAppSound`, settings previews via `previewTone`) unchanged

**Storage**: none (no settings change, no assets — FR-002)

**Testing**: vitest structural tests over exported tone definitions (extend
`src/services/sound.test.ts`); audio aesthetics = manual listening pass (spec SC-005)

**Target Platform**: PWA — iOS Safari/WebKit is the constrained target (webkitAudioContext,
autoplay policy already handled by the existing lazy-resume context)

**Project Type**: web app (client only)

**Performance Goals**: tone start latency indistinguishable from today (a few audio-node
allocations, all scheduled ahead of time); one-time lazy cost for the shared bus + a
~0.5 s generated impulse-response buffer (tens of KB of samples, generated once per context)

**Constraints**: ≤1.2 s total per tone incl. tail (SC-002); no clipping under overlap
(FR-005 — the compressor bus is the guarantee); cue/foley chains untouched (FR-007);
'none' stays a no-op before any AudioContext work (FR-008 unchanged)

**Scale/Scope**: 1 source file, 1 test file; 7 tone redesigns over ~3 shared helpers

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge | ✅ N/A | Purely local audio; nothing crosses the wire (spec carries the ZK Impact section). |
| II. Spec-Driven | ✅ PASS | Spec 1049 with clarifications recorded (both scope decisions asked interactively pre-spec, satisfying the clarify gate). |
| III. TDD | ✅ PASS (plan) | Structural tests (definitions exist, layered, bounded durations/gains, character shapes) land red before the engine; the aesthetic half is an explicit manual gate (SC-005) — audio cannot be asserted in CI. |
| IV. Crypto | ✅ N/A | — |
| V. Offline-First | ✅ N/A | No storage change. |
| VI. Stateless Server | ✅ N/A | Server untouched. |
| VII. Quality Gates | ✅ PASS (plan) | `npm run build` + vitest; no e2e surface (audio-only change, invisible to Playwright). Release-note subject in plain language. |
| VIII. Traceable | ✅ PASS | taskstoissues + `Closes #N` on the eventual PR. |
| IX. Privacy | ✅ N/A | — |
| X/XI. A11y & Ionic-First | ✅ N/A | No UI change; the existing settings preview flow is the listening surface. |

`/speckit-checklist` not required (no Principle I or IV surface).

**Post-design re-check (after Phase 1)**: clean — no new moving parts beyond two lazy
singletons (alert bus, impulse buffer) inside the already-singleton audio module.
Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/1049-richer-higher-quality/
├── spec.md, plan.md, research.md, quickstart.md
├── contracts/tone-structure.md   # the structural bounds the tests enforce
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks output (not created by /speckit-plan)
```

### Source Code (repository root)

```text
src/services/
├── sound.ts        # + alert-voice engine (timbre tables, strike renderer, master bus,
│                   #   generated impulse response); playTone routes the 7 alert names
│                   #   through it; RECIPES keeps every cue; FX untouched
└── sound.test.ts   # + spec 1049 structural suite (see contracts/tone-structure.md)
```

**Structure Decision**: single-file feature inside the existing audio module — no new source
files, matching the module's existing "everything about sound lives here" shape.

## Architecture decisions

1. **A separate engine, not deeper recipes.** The 7 alert tones move out of `RECIPES` into
   a new `ALERT_TONES` table rendered by a strike-voice engine (partial tables per timbre).
   `RECIPES` keeps serving the ~30 call/game cues, so FR-007 ("byte-identical") holds *by
   construction* — their code path is not edited. `playTone` checks `ALERT_TONES` first,
   then falls through to the existing FX/recipe lookups. The existing `RECIPE_NAMES` cue
   tests keep passing (no cue test references the 7 alert entries); a new
   `ALERT_TONE_NAMES` export covers the alert set for completeness checks.
2. **Timbre tables**: a timbre is an array of `{ratio, gain, durScale}` partials (a bell's
   inharmonic 1 / 2.7 / 5.4 stack, a marimba's 1 / 4 / 9.2, glass's brighter spread, wood's
   damped pair). A tone is a sequence of `{freq, start, dur, gain, timbre}` strikes — the
   same declarative style the codebase already uses, so tests can bound it structurally.
3. **Warmth and attack**: each partial renders as a detuned oscillator pair (±~4 cents)
   with a soft attack ramp; the fundamental gets a tiny downward pitch settle (~+8 cents →
   0 over ~30 ms) so strikes sound struck, not switched on.
4. **Space**: one lazily-built `ConvolverNode` with a procedurally generated stereo impulse
   response (exponentially decaying noise, ~0.45 s) hangs off the alert bus at a low wet
   mix (~18%). Zero assets — the IR is math, generated once and cached per context.
5. **Headroom**: the alert bus is `GainNode → DynamicsCompressorNode → destination`
   (gentle knee, fast attack), created lazily once. Overlapping tones sum into the
   compressor, so bursts cannot clip (FR-005/SC-003); cue/foley paths keep their existing
   direct-to-destination wiring.
6. **Character mapping** (name → redesign, each keeping its documented character):
   Note = single warm marimba strike (A5) with a soft octave shimmer · Chime = two glass
   bells E6→B5 · Ping = one bright glass tick (E6, short) · Pop = rounded low wood thump
   (~600 Hz fundamental, quick — stays subtle as spec 1048's reaction default) · Pulse =
   two equal muted wood taps (720 Hz) · Glow = soft bell pair A4→E5 with a swelled attack
   (keeps the "rising sweep" feel) · Beacon = three-bell arpeggio C5-E5-G5.
7. **Contracts for tests** (full table in contracts/tone-structure.md): every audible
   `TONES` value has an `ALERT_TONES` entry; every strike's timbre has ≥2 partials;
   per-tone last `start+dur` + the fixed reverb tail ≤ 1.2 s; strike gains within
   [0.08, 0.45]; melodic shapes preserved (chime/glow ascending pairs, beacon ascending
   triple, pulse equal pair); `'none'` absent from `ALERT_TONES`; all cue names remain in
   `RECIPE_NAMES`.

## Complexity Tracking

> No constitution violations — table intentionally empty.
