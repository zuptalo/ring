# Contract: alert-tone structure (spec 1049)

The structural half of the feature's verification — enforced by vitest over the exported
definitions in `src/services/sound.ts`. The aesthetic half is the manual listening pass
(spec SC-005) and is deliberately NOT encoded here.

## Exports under contract

- `ALERT_TONES`: map of the audible alert-tone names → strike sequences
  (`{freq, start, dur, gain, timbre}[]`).
- `TIMBRES`: map of timbre name → partial table (`{ratio, gain, durScale}[]`).
- `ALERT_TONE_NAMES`: `Object.keys(ALERT_TONES)`.
- `RECIPE_NAMES` / `FX_NAMES`: unchanged semantics (cues + foley).
- Reverb-tail budget constant (exported) so the duration rule is a real sum, not a magic
  number in tests.

## Rules

| # | Rule | Serves |
|---|---|---|
| 1 | Every `TONES` value in the settings schema except `none` has an `ALERT_TONES` entry, and `none` does NOT | FR-003, FR-008, SC-001 |
| 2 | Every strike references a defined timbre with ≥ 2 partials | SC-001 (layered, not a bare beep) |
| 3 | For every tone: max(strike `start`+`dur`) + tail budget ≤ 1.2 s | FR-004, SC-002 |
| 4 | Every strike gain ∈ [0.08, 0.45]; every partial gain ∈ (0, 1] | FR-004 (loudness band), SC-002 |
| 5 | Character contours: `chime` = 2 strikes, descending high pair (E6→B5 as today); `glow` = 2 strikes ascending; `beacon` = 3 strikes strictly ascending; `pulse` = 2 strikes, equal freq; `note`, `ping`, `pop` = 1 strike; `pop` has the lowest fundamental of the set | FR-001 (character preserved) |
| 6 | All call/game cue names remain in `RECIPE_NAMES` (existing assertions untouched and still green) | FR-007 |
| 7 | `playTone(name)` for an alert name never throws when audio is unavailable (context factory returns null) | FR-008 |

## Non-rules (explicitly manual)

Perceived richness, warmth, distinguishability, and loudness matching are judged by ear via
Settings → Notifications → Sound previews. If a structural rule ever conflicts with what
sounds good, the rule is renegotiated in this contract first — tests must not freeze bad
sound design in place.
