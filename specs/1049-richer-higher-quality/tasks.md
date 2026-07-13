# Tasks: Richer Notification Alert Tones

**Input**: Design documents from `/specs/1049-richer-higher-quality/`

**Prerequisites**: plan.md, spec.md (clarified pre-spec), research.md, contracts/tone-structure.md, quickstart.md

**Tests**: INCLUDED, first (Principle III). The testable half is structural (contract rules 1–7); the aesthetic half is the explicit manual listening gate (SC-005) and cannot precede implementation.

**Organization**: US1 is the feature; US2 is the no-regression fence around it. One source file total, so tasks are sequential apart from the test-first pair.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: User Story 1 - Alert tones that sound like a modern messenger (Priority: P1) 🎯 MVP

**Goal**: the 7 audible tones become layered struck-instrument voices with warmth and a subtle tail, each keeping its name and character

**Independent Test**: Settings → Notifications → Sound; tap each row (quickstart.md manual pass) + structural suite green

### Tests first (MUST fail before the engine lands) ⚠️

- [ ] T001 [P] [US1] Add the spec-1049 structural suite to src/services/sound.test.ts against the exported `ALERT_TONES` / `TIMBRES` / `ALERT_TONE_NAMES` / tail-budget constant, enforcing contract rules 1–5 and 7 of specs/1049-richer-higher-quality/contracts/tone-structure.md (coverage of every audible `TONES` value + `none` absent, ≥2 partials per timbre, ≤1.2 s incl. tail, gain bounds, character contours: chime descending pair / glow ascending pair / beacon ascending triple / pulse equal pair / note-ping-pop single strikes with pop lowest, playTone never throws with audio unavailable)

### Implementation

- [ ] T002 [US1] Build the alert-voice engine in src/services/sound.ts: `TIMBRES` partial tables (marimba, bell, glass, wood), a `strike()` renderer (detuned oscillator pair per partial ±4 cents, soft attack, ~30 ms pitch settle on the fundamental, independent partial decays), and the lazy alert bus (`GainNode → DynamicsCompressorNode → destination`) with the procedurally generated ~0.45 s stereo impulse-response `ConvolverNode` at ~18% wet
- [ ] T003 [US1] Define `ALERT_TONES` (7 redesigns per plan.md decision 6: Note marimba A5 + octave shimmer, Chime glass E6→B5, Ping glass tick, Pop low wood thump, Pulse two wood taps, Glow bell pair A4→E5 swelled, Beacon bell arpeggio C5-E5-G5), remove those 7 entries from `RECIPES`, and route `playTone` through `ALERT_TONES` first with the existing FX/recipe fallthrough; keep module doc comments telling the why (match file style)
- [ ] T004 [US1] Loudness pass: tune strike gains within the contract band so the 7 tones sit at consistent perceived loudness (by ear via `previewTone` in the running dev app; adjust data only)

**Checkpoint**: structural suite green; `npx vitest run` + `npm run build` green

---

## Phase 2: User Story 2 - Nothing else changes (Priority: P2)

**Goal**: prove the fence — cues/foley byte-identical, settings untouched, zero audio assets

### Tests

- [ ] T005 [P] [US2] Extend src/services/sound.test.ts with the fence assertions (contract rule 6 + FR-003): every call/game cue name still in `RECIPE_NAMES`, none of the 7 alert names in `RECIPE_NAMES` anymore, and the settings `TONES` list still offers exactly the same 8 values with unchanged defaults (cross-check against src/settings/schema.ts exports or the schema test if the list is not exported)
- [ ] T006 [US2] Verify: `git diff` shows zero edits to `RECIPES` cue entries / `FX` / `playNote` wiring beyond the 7 alert-entry removals; `npm run build` then `find dist -name '*.mp3' -o -name '*.wav' -o -name '*.ogg' -o -name '*.m4a'` returns nothing (SC-004)

**Checkpoint**: full `npx vitest run` green; both stories demonstrable

---

## Phase 3: Polish & manual gate

- [ ] T007 Run the quickstart.md manual listening pass in the dev app (Settings previews: richer, in character, distinguishable, no clipping on rapid taps; None silent; spot-check group + reaction Sound pages) — SC-005; the end user confirms on their device as final sign-off
- [ ] T008 Full gates (`npm run build`, `npx vitest run`) + spec Status flips (`in-progress` → `in-review`) + `make roadmap`

---

## Dependencies & Execution Order

T001 (red) → T002 → T003 → T004; T005 may land with T001 [P] (same file, one commit is fine); T006 after T003; T007–T008 last. No parallelism worth orchestrating — one file.

## Implementation Strategy

Single increment: US1 is the MVP and US2 is its fence; both ship together in one small PR-able slice. The only genuinely irreplaceable step is T007's human ears.
