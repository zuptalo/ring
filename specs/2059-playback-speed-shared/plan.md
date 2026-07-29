# Implementation Plan: Playback speed belongs to the message you set it on

**Branch**: `fix/2059-playback-speed-shared` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2059-playback-speed-shared/spec.md`

## Summary

One control, two opposite bugs. The audio rate is a single module-level ref
(`useAudioPlayer.ts:36`) that every voice bubble reads directly (`VoicePlayer.vue:73`), so a change
on one message repaints the pill on all of them. The video rate is the mirror image — a
component-local `ref(1)` (`VideoPlayer.vue:68`) in a player the viewer mounts per item and tears
down on swipe, so the speed is forgotten.

Both collapse into one idea: **a per-message rate registry** that outlives any component and is
keyed by the message id every player already has. Audio reads its entry instead of a global; video
reads its entry instead of a fresh local ref.

1. **One registry.** A module-level reactive `Map<messageId, rate>` with a bounded size, plus
   `rateFor(id)` and `cycleRateFor(id)`. Absent entry = normal speed, so nothing needs seeding.
2. **Audio reads per id.** `playAudio` applies the track's own rate to the shared element;
   `cycleAudioRate(id)` cycles that id and only touches the element when that id is the one
   playing (FR-006). the now-misleading `audioRate` export is deleted outright — both of its readers become per-id reads.
3. **Video reads per id.** `VideoPlayer` takes the item id and reads the same registry, so its rate
   survives being torn down and rebuilt. `MediaViewer` already passes per-item state this way for
   scrub position (`positions[it.id]`, `:start-at`) — the rate follows that established shape.

## Technical Context

**Language/Version**: TypeScript 5, Vue 3 `<script setup>`

**Primary Dependencies**: none new. Reuses `nextRate`/`rateLabel` in `src/utils/playback.ts`.

**Storage**: none. Session-only per the clarification — no IndexedDB write, no `DB_VERSION` bump,
no settings key.

**Testing**: Playwright e2e is the behavioral gate; vitest for the pure registry (bounding, cycle,
default) since it is plain state with no DOM dependency.

**Target Platform**: the PWA on iOS Safari + Chrome/Android.

**Project Type**: client-only. No server, no Go, no migration, no wire change.

**Constraints**: must not disturb single-source audio (spec 1007 — one shared `HTMLAudioElement`,
playback continues across navigation); changing a rate mid-playback must not reload the element or
lose position (FR-005).

**Scale/Scope**: one new small module; edits to `useAudioPlayer.ts`, `VoicePlayer.vue`,
`VideoPlayer.vue`, `MediaViewer.vue`, and the AudioCard wiring in `ChatDetailPage.vue`; plus
`testhook.ts` (three new dev-only seams) and one line in `vitest.config.ts`.

## Constitution Check

| Principle | Verdict | Basis |
|---|---|---|
| **I. Zero-Knowledge (NON-NEGOTIABLE)** | ✅ PASS | Nothing crosses the wire. A playback rate is a local rendering preference; the server cannot observe playback at all. Spec carries the mandatory Zero-Knowledge Impact section. |
| **II. Spec-Driven** | ✅ PASS | specify → clarify → plan → tasks → analyze → issues → implement, on `fix/2059-…` with flat `specs/2059-…`. |
| **III. Test-Driven** | ✅ PASS *(binding)* | A `2001+` fix MUST open with a failing regression test. Phase 2 adds the test seams (all in the dev-only test hook, stripped from production), Phase 3 writes the red vitest and red e2e, and both are observed failing before any behavior changes in Phase 4+. |
| **IV. Crypto Discipline** | ✅ N/A | Untouched. |
| **V. Offline-First Data** | ✅ N/A | No store, no field, no migration — session state only. |
| **VI. Stateless Server** | ✅ N/A | No server change. |
| **VII. Quality Gates** | ✅ PASS | `npm run build`, vitest, e2e. Commit subject is plain-language release-note copy. |
| **VIII. Traceable Delivery** | ✅ PASS | Issues per phase, `Closes #N` on the PR, `make roadmap` on status flips. |
| **IX. Privacy** | ✅ PASS | No telemetry; strictly less state than the alternative of persisting rates. |
| **X. Accessibility & i18n** | ✅ PASS | The pill and its `aria-label` are unchanged; only the value it reflects changes. |
| **XI. Ionic-First UI** | ✅ PASS | No new UI. `SpeedPill` is reused untouched. |

### Supply-chain scan (Development Workflow, MUST)

Not performed — no Docker Hub access in this environment. Client-only change with no Go module or
base-image surface, so it does not block the code, but it is owed before the release PR. Recorded
in the spec's *Complexity & Exceptions* as an unmet MUST awaiting maintainer sign-off.

### Version bump

`package.json` is at 1.0.32 on `develop` with tag `v1.0.32` cut, so this is the first change of a
new cycle and the bump to 1.0.33 is mandatory on this branch.

## Project Structure

```text
src/
├── composables/
│   ├── usePlaybackRates.ts   # NEW — the bounded per-message rate registry
│   └── useAudioPlayer.ts     # read/apply the current track's own rate
├── components/
│   ├── VoicePlayer.vue       # rate for THIS mid, not the global
│   ├── VideoPlayer.vue       # takes an id; rate survives remount
│   └── MediaViewer.vue       # pass the item id through
└── views/detail/
    └── ChatDetailPage.vue    # AudioCard rate/cycle keyed by message id

src/composables/usePlaybackRates.test.ts   # NEW — pure registry unit tests
e2e/playback-speed.spec.ts                 # NEW — the red regression test
```

**Structure Decision**: one new module rather than threading a rate through props.

The obvious alternative — a per-item map local to `MediaViewer`, mirroring its existing
`positions` — turns out to survive more than expected: the viewer is rendered unconditionally in
all four of its hosts with only `:open` toggling the modal, so a component-local map would in fact
survive closing and reopening the viewer. It still fails for the reasons that matter here: there
are **four independent viewer instances** (chat, all-media, Wall, post detail), a host page can
unmount, and audio and video would end up with two separate notions of the same thing. A module
registry gives one answer per id for every surface — which is what the existing global already
provides, minus the part where it is keyed wrongly.

### Recency without a render loop

FR-004's "use" is deliberately defined as **playing or changing** a speed, not as reading one. The
tempting definition — a read counts as use — would have the registry mutated from inside the
render-time computeds that display the pill (`VoicePlayer.vue:73` today, and `VideoPlayer`'s rate
after this change). Writing to a reactive structure that the computed just tracked is how you get
write-during-render warnings and a self-invalidating computed. Keeping recency on the two genuine
user actions avoids that entirely, and is the better definition anyway: a pill that merely scrolled
past is not evidence anyone cares about that message.

## Risks

- **Single-source audio is delicate** (spec 1007): one shared element, playback surviving
  navigation. Setting `playbackRate` on a playing element is safe and does not reload it, but the
  order matters — apply the rate on `src` assignment *before* play, as the current code already
  does, or the first moments play at the wrong speed.
- **Video applies its rate in only one place today.** `VideoPlayer` writes `playbackRate` inside
  `cycleRate` and nowhere else; `onMeta` restores the scrub position but not the speed. Reading a
  remembered rate without also pushing it onto a freshly-mounted element would show the right pill
  over playback at the wrong speed — a bug that a pill-only test would not catch.
- **`audioRate` is being deleted, not redefined.** It has exactly two readers — `VoicePlayer.vue:73`
  and `ChatDetailPage.vue:337` — and both are replaced by per-id reads, so retaining a same-named
  derived export would leave dead code whose name invites exactly the mistake being fixed.
- **The draft-recording preview** (`recRate`, `ChatDetailPage.vue:970`) is a separate local rate
  for a recording that has no message id. It must be left alone.
