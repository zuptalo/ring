# Feature Specification: Richer Notification Alert Tones

**Feature Branch**: `feat/1049-richer-higher-quality`

**Created**: 2026-07-13

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Add higher quality sounds for the notifications — the current alert tones are bare single-oscillator beeps that sound thin next to the tones users know from other messengers."

## Clarifications

### Session 2026-07-13

- Q: Richer on-device synthesis, or ship real audio files? → A: Richer synthesis — keep the documented no-audio-files stance (nothing sampled or licensed, zero bundle growth); the Armada foley already proves the quality ceiling with the same technique.
- Q: Replace the existing 8 tones in place or add new ones alongside? → A: Upgrade in place — the tones keep their names and recognizable characters, saved user choices keep working, everyone gets the upgrade. Call/game cues are out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Alert tones that sound like a modern messenger (Priority: P1)

Sara gets a message and hears Ring's default tone. Today it is a thin electronic beep. After this change the same tone plays as a warm, rounded note with a natural decay — the kind of sound she knows from the messengers she used before Ring. Every tone in the picker gets the same treatment while keeping its recognizable character: Note stays a single soft note, Chime stays two ascending bells, Beacon stays a rising three-note figure, and so on.

**Why this priority**: The tones are the most-heard piece of the product — every message plays one. Thin beeps read as unpolished and undermine the quality impression of an otherwise polished app. This is the whole feature.

**Independent Test**: Open Settings → Notifications → Sound and tap each tone. Each preview plays a richer, layered sound with a natural tail; each remains clearly distinguishable from the others; none clips, crackles, or lingers noticeably beyond a second.

**Acceptance Scenarios**:

1. **Given** the tone picker in Settings, **When** Sara taps each of the 7 audible tones, **Then** each plays a richer sound (layered, warm, with a natural decay) rather than a bare beep, and each keeps its established character.
2. **Given** Sara had already chosen "Chime" before the update, **When** the app updates, **Then** her setting still reads "Chime" and simply sounds better — no re-selection, no migration, no changed default.
3. **Given** a burst of messages arriving in quick succession, **When** tones overlap, **Then** the audio stays clean (no clipping or distortion from stacked layers).
4. **Given** any notification tone plays, **Then** it is fully over (including its tail) within about a second, and the set has consistent perceived loudness — no tone dramatically louder than its neighbors.
5. **Given** the "None" choice, **Then** it stays completely silent, exactly as today.

---

### User Story 2 - Nothing else changes (Priority: P2)

Everything around the tones is untouched: the same 8 choices in the same pickers, the same setting keys and defaults (message, group, and reaction sounds), the same call-progress/in-call/game sounds, and the same zero-assets footprint — the app does not grow by a single byte of bundled audio.

**Why this priority**: The upgrade must be a pure quality lift with no behavioral or footprint regressions; this story pins the blast radius.

**Independent Test**: Diff-level and structural checks — the tone list, keys, and defaults are unchanged; call/game cues are byte-identical; no audio asset appears in the build output.

**Acceptance Scenarios**:

1. **Given** the settings screens, **Then** the tone lists, labels, keys, and defaults are exactly as before the change.
2. **Given** calls and games, **Then** their cues (ringback, connect, mute, game moves, Battleship/Armada effects) sound exactly as before.
3. **Given** the production build, **Then** it contains no bundled audio files — every sound is still generated on the device, royalty-free.

---

### Edge Cases

- **Rapid-fire tones** (message burst, or mashing the preview row): overlapping instances must mix cleanly without distortion and without unbounded resource growth.
- **First play after app open**: the very first tone (audio subsystem cold) must not glitch, stutter, or play partially, on phones or desktop browsers.
- **Silent/blocked audio environments** (browser autoplay policy, no audio hardware): tones fail silently as today — never an error surfaced to the user.
- **Low-end devices**: generating a richer tone must remain imperceptible in UI cost — no dropped frames or delayed banner because a sound was being built.
- **Distinguishability**: after the upgrade the 7 audible tones must remain mutually distinguishable at a glance-by-ear — richer must not mean samey.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The 7 audible notification alert tones (Note, Chime, Ping, Pop, Pulse, Glow, Beacon) MUST be upgraded to richer, layered sounds — struck-instrument-like warmth with natural decays and a subtle sense of space — while each keeps its existing name and recognizable melodic character.
- **FR-002**: All sounds MUST remain generated on-device with no bundled or downloaded audio assets and nothing sampled or licensed; the production build gains no audio files.
- **FR-003**: Existing user selections MUST keep working unchanged: the tone list, display labels, setting keys, and defaults (including the message, group, and reaction tone settings and the silent "None" choice) are not altered.
- **FR-004**: Each upgraded tone MUST complete, including its decay tail, within approximately one second, and the set MUST have consistent perceived loudness — no tone starkly louder or quieter than the rest at the same volume.
- **FR-005**: Overlapping tone playback (bursts, repeated previews) MUST NOT clip, distort, or accumulate resources without bound.
- **FR-006**: Producing and starting a tone MUST NOT introduce user-perceptible delay or interface jank, on phones included.
- **FR-007**: Call-progress cues, in-call cues, game cues, and the Battleship/Armada effect sets MUST be unaffected — byte-identical behavior.
- **FR-008**: Blocked or unavailable audio MUST remain a silent no-op, exactly as today.

### Key Entities

- **Alert tone**: a named, short, synthesized sound selectable in Settings and played for message/group/reaction notifications; this feature changes only how each named tone sounds, not what tones exist or when they play.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 7 audible tones play a layered (multi-component) sound rather than a single raw beep, verified structurally by automated tests over the tone definitions.
- **SC-002**: Every tone's total duration, including tail, is ≤ 1.2 s, and defined peak levels sit within a bounded range across the set (structural test).
- **SC-003**: Rapid repeated playback (10 plays in 2 s) produces no audible distortion and no unbounded growth in live audio objects (structural + manual).
- **SC-004**: The settings tone lists, keys, and defaults are byte-for-byte unchanged (automated test), and the build output contains zero audio files (build check).
- **SC-005**: A human listening pass via the Settings previews confirms each tone is richer than before, keeps its character, and remains distinguishable from the other six. *(Audio aesthetics cannot be asserted in CI; this is the explicit manual gate for this feature.)*

## Zero-Knowledge Impact

- **What crosses the wire**: nothing. Tones are generated and played entirely on the device; no asset downloads, no telemetry, no server involvement of any kind.
- **What is encrypted / visible metadata**: unchanged — this feature does not touch the wire, storage, or any payload.
- **Why**: purely local presentation-layer change.

## Assumptions

- "Richer" is realized through layered synthesis (multiple partials, gentle detune, soft attacks, a subtle generated space/tail) — the same technique family the in-app game foley already uses, so no new platform capability is assumed.
- Character preservation is judged per tone against its current one-line description (single soft note, two ascending bells, bright short ping, quick low pop, two equal beeps, gentle rising sweep, three-note arpeggio).
- Perceived-loudness consistency is tuned by ear within bounded structural limits; no loudness-measurement tooling is introduced.
- The 8-entry tone list is shared by the message, group, and reaction sound settings; upgrading the 7 audible entries automatically upgrades all three surfaces (including spec 1048's reaction default "Pop").
- No new settings, no migration, no server change, and no e2e surface (audio is not assertable in Playwright); automated coverage is structural unit tests plus the existing settings preview flow for the human listening pass.
