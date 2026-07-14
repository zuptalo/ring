# Research: Richer Notification Alert Tones (spec 1049)

**Date**: 2026-07-13 · No NEEDS CLARIFICATION items remain (both scope decisions were
answered interactively and are recorded in spec.md's Clarifications).

## R1. Why the current tones sound thin

`src/services/sound.ts` renders each alert tone as 1–3 bare oscillator notes: a single
fixed-frequency `OscillatorNode` (sine/triangle) through a linear-attack/exponential-decay
gain, wired straight to `destination`. No harmonics beyond the waveform's own, no detune,
no attack transient, no space — the textbook "1980s pager" recipe. **Decision**: the gap to
modern messenger tones is closed by the three classic ingredients they all share: partial
stacks (struck-instrument spectra), micro-detune, and a short reverb tail.
**Alternatives**: shipping produced audio files — rejected by the user (clarification #1);
`PeriodicWave` custom waveforms — gives static spectra only (partials cannot decay at
different rates, which is exactly what makes a strike sound real), so rejected in favor of
per-partial oscillators.

## R2. The codebase already proves the technique

The Armada foley (spec 1038, same file) layers filtered noise + swept oscillators into
film-mix-quality effects — deterministic, zero assets. **Decision**: reuse the same
"scheduled tiny mix" philosophy but for melodic strikes: a `strike()` renderer over
declarative timbre tables, kept as data (like `RECIPES`) so tests can bound it.
**Alternatives**: an offline-rendered `AudioBuffer` cache per tone (render once, replay) —
more code and memory for no audible gain at these durations; oscillators are cheap.

## R3. Reverb without assets

A `ConvolverNode` needs an impulse response; generating one procedurally (stereo buffer of
exponentially decaying noise, ~0.45 s, slight L/R decorrelation) is standard practice and
literally noise-shaped math — still nothing sampled. **Decision**: one lazily-generated,
cached IR per AudioContext; alert tones mix ~18% wet. Tail length bounds the tone's total
duration (counted in the SC-002 budget). **Alternatives**: feedback-delay-network reverb —
more nodes, harder to bound; a plain short `DelayNode` echo — audibly cheaper than a tail.

## R4. Clip-proofing overlap (FR-005)

Today overlapping tones sum straight into `destination`; three simultaneous 0.3-gain notes
already flirt with clipping. **Decision**: route all alert voices through one lazy
`GainNode (0.9) → DynamicsCompressorNode (knee 24, ratio 4, attack 3 ms, release 250 ms)`
bus. Bursts get gently squashed instead of clipped, and the bus is a natural single wet/dry
join for the convolver. Cue/foley paths intentionally keep their old wiring so FR-007 stays
true by construction. **Alternatives**: manual gain-sharing per active voice — bookkeeping
that the compressor gives for free.

## R5. Keeping FR-007 provable

**Decision**: do not edit `RECIPES`, `FX`, `playNote`, or their wiring except to REMOVE the
7 alert entries from `RECIPES` — the cue entries and code path stay byte-identical, and
`sound.test.ts`'s existing cue-name assertions (which never reference the 7 alert names)
keep passing unchanged. `playTone` gains one lookup: `ALERT_TONES` first, then the existing
FX/recipe fallthrough. **Risk noted**: `RECIPE_NAMES` shrinks by 7 — grep confirmed nothing
outside tests consumes it, and no test references the alert names in `RECIPE_NAMES`.

## R6. What structural tests can honestly pin (SC-001/002/004)

Audio aesthetics are untestable in CI; structure is not. **Decision** (contract in
contracts/tone-structure.md): exported `ALERT_TONES`/`TIMBRES` let vitest assert coverage
of every audible `TONES` value, ≥2 partials per timbre, duration budget ≤1.2 s incl. the
fixed tail, gain bounds, preserved melodic contours, and `'none'` staying absent. The
listening pass (SC-005) is the explicit manual gate, done via the existing Settings
previews (`previewTone` — tapping a tone in Settings already plays it).

## R7. First-play robustness and cost

The lazy AudioContext + resume-on-demand pattern already handles autoplay policy; the new
lazy pieces (bus, IR) are built on first alert-tone play. IR generation: ~20k samples ×2
channels of `Math.random` decay — sub-millisecond on anything, no jank (FR-006).
Oscillator count per tone: partials (≤4) × detune pair (2) × strikes (≤3) ≤ 24 short-lived
nodes, each `stop()`ed — the same order as the existing Armada effects. **Decision**: no
pooling needed; nodes are one-shot and GC'd, satisfying FR-005's "no unbounded growth".
