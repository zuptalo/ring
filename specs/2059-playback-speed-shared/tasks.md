---

description: "Task list for spec 2059 — playback speed belongs to the message you set it on"
---

# Tasks: Playback speed belongs to the message you set it on

**Input**: Design documents from `/specs/2059-playback-speed-shared/`

**Tests**: **REQUIRED.** Constitution III: a `2001+` fix MUST begin with a failing regression test.
Phase 3 is a hard gate — its tests must be observed failing, for the right reason, before Phase 4.

**Revision**: rewritten after `/speckit-analyze` returned 8 blockers. Mapping at the foot.

## Phase 1: Baseline

- [x] T001 Run `npm run build` and record it passing on the untouched branch
- [x] T002 Run `npx vitest run` and record it passing (the new registry tests join this suite)

## Phase 2: Test seam (Foundational — no behavior change)

- [x] T003 Add `sendVoice(chatId, name?, durationSec?)` to `src/services/testhook.ts`, mirroring the
      existing `sendAudio` (~:802). `dbSendMediaMessage` already accepts `kind: 'voice'`
      (`queries.ts:2297`); nothing exposes it, and **no e2e in the repo sends a voice message at
      all**. Without this the US1 regression test cannot be written, so the Constitution III gate
      cannot be satisfied
- [x] T004 Add `postVoice(text?, durationSec?)` to `src/services/testhook.ts` for a **Wall voice
      post**. `createPost` already accepts `kind: 'voice'` (`queries.ts:3246`) but every existing
      Wall seam is image/video only (`postAlbum`, `postMixedAlbum`, `seedWallVideoPosts`), so the
      US3 test is unwritable without it — the same gap T003 closes for chat
- [x] T005 Add `audioElementRate()` to `src/services/testhook.ts`, returning the shared audio
      element's live `playbackRate`. The element is `new Audio()` at module scope
      (`useAudioPlayer.ts:29`) and is **never attached to the DOM**, so Playwright cannot reach it
      by selector — without this accessor the "it really plays at that speed" assertions can only
      check the label, and a fix that never applied the rate to any element would pass
- [x] T006 Run `npm run build` — the hooks compile, no behavior changed, the bug still reproduces

## Phase 3: RED — the regression tests (Constitution III gate) 🚨

- [x] T007 Write `src/composables/usePlaybackRates.test.ts` against the not-yet-existing registry:
      an unset id reads 1; cycling one id does not change another; cycling wraps 1 → 1.5 → 2 → 1
      (matching `PLAYBACK_RATES`); the map holds at most 200 entries and drops the
      **least-recently-used**, where *use* means **playing a message or changing its speed** —
      NOT merely reading the rate to display it (FR-004 + FR-009 together)
- [x] T008 [US1] Create `e2e/playback-speed.spec.ts`: send two voice messages, change the speed of
      the first, assert the SECOND's pill still reads `1×`. The pill is `button.speed-pill` with an
      `aria-label` of `Playback speed …` (`SpeedPill.vue:4-12`)
- [x] T009 [US1] Add the "it actually plays at that speed" leg via the `audioElementRate()` hook
      from T005: after setting a message to 2× and playing it, assert the shared element's real
      `playbackRate` is 2 — not just the label. A label-only suite would pass even if the rate were
      never applied to any element. Then add the FR-006 leg: with one message playing, change a
      DIFFERENT message's speed and assert the playing element's rate is untouched
- [x] T010 [US2] Add the video case: set a non-default speed in the viewer, swipe to another item
      and back, assert both the pill **and** the `<video>` element's real `playbackRate` are
      retained; then close and reopen the viewer and assert it is still retained
- [x] T011 [US3] Add the Wall case: two voice posts in the feed, change one, assert the other still
      reads `1×`; and an album post with two voice items, where changing one slide's speed leaves the
      other slide alone (US3 AC-2 — the exact collision T022 warns about)
- [x] T012 [US1] Add the remaining US1 acceptance legs: a voice message set to 2× still reads 2×
      when you come back to it later (AC-3), and a shared-audio card and a voice message do not
      affect each other (AC-4)
- [x] T013 **Run the vitest and the e2e and observe them FAIL**, for the right reasons — the unit
      test because the module does not exist, the e2e because the second pill mirrors the first and
      the video resets to 1×. Record the output

## Phase 4: The registry (Foundational)

- [x] T014 Add `src/composables/usePlaybackRates.ts`: a module-level reactive
      `Map<string, PlaybackRate>` with `rateFor(id)` (default 1) and `cycleRateFor(id)` (via the
      existing `nextRate`). **LRU, capped at 200.** Recency is refreshed by `cycleRateFor` and by an
      explicit `touchRate(id)` the playback paths call when they start a track — **never by
      `rateFor`**, which is called from render-time computeds; mutating the reactive map from inside
      a computed that just tracked it means write-during-render warnings and a self-invalidating
      computed. T007 now passes
- [x] T015 [P] Add `src/composables/usePlaybackRates.ts` to `coverage.include` in `vitest.config.ts`
      — the repo gates pure, directly-tested modules there, and this is one

## Phase 5: User Story 1 — voice + audio speed is per message (Priority: P1)

- [x] T016 [US1] In `src/composables/useAudioPlayer.ts`: `playAudio` applies the track's OWN rate
      (`el.playbackRate = rateFor(meta.id)`, replacing the global read at ~:69, keeping it before
      `playWhenReady` so the opening moments are not at the wrong speed), and `cycleAudioRate` takes
      a message id — cycling that id and touching the shared element **only** when that id is the
      one currently playing (FR-006). **Delete the `audioRate` export**: it has exactly two readers
      (`VoicePlayer.vue:73`, `ChatDetailPage.vue:337`) and T017/T018 replace both, so keeping a
      derived stand-in would just be dead code inviting the same mistake again
- [x] T017 [US1] `src/components/VoicePlayer.vue`: `rate` reads `rateFor(props.mid)` (~:73) and
      `cycleRate()` cycles `props.mid` (~:117)
- [x] T018 [US1] `src/views/detail/ChatDetailPage.vue`: the AudioCard binding (~:337, ~:341) reads
      and cycles by `m.id`. Note `AudioCard`'s pill is `v-if="active"` (`AudioCard.vue:19`) so it
      only shows for the loaded track — correct as-is, just don't expect a non-active card to
      display a speed. Leave the draft-recording `recRate` (~:970, ref at ~:4590) alone: it is a
      preview of a recording that has no message id yet
- [x] T019 [US1] Run the e2e — the US1 pill and playback-rate cases pass

## Phase 6: User Story 2 — video keeps its speed (Priority: P1)

- [x] T020 [US2] `src/components/VideoPlayer.vue`: accept an item id prop; replace the local
      `rate = ref(1)` (~:68) with a read of `rateFor(id)`, and `cycleRate` (~:85-88) with
      `cycleRateFor(id)` plus applying it to the element. **Also apply it to a freshly-mounted
      element in `onMeta` (~:129)**, right beside the existing `startAt` position restore —
      currently `playbackRate` is written *only* inside `cycleRate`, so a remounted player would
      show the remembered pill while actually playing at 1×. Keep the `defineExpose` shape (~:178)
      so the viewer's hosted control row (`MediaViewer.vue:119`) needs no change
- [x] T021 [US2] `src/components/MediaViewer.vue`: pass the item id to `<video-player>` (~:71-81),
      alongside the `:start-at="positions[it.id]"` it already passes for scrub position
- [x] T022 [US2] Run the e2e — the swipe-away-and-back and close-and-reopen cases pass

## Phase 7: User Story 3 — Wall voice posts (Priority: P2)

- [x] T023 [US3] Verify only — the Wall's two `<voice-player>` usages already pass a stable
      per-player id (`WallPage.vue:225` passes `p.id`; `:158` passes the composite
      `` `${p.id}:${i}` `` so each **album slide** is its own player). **Do not "fix" the composite
      key to `p.id`** — that would collide `audioCurId` across slides and light every voice item in
      an album as the active track. Confirm both keys flow into the registry unchanged
- [x] T024 [US3] Run the e2e — the Wall case passes

## Phase 8: Polish & Gates

- [ ] T025 Verify FR-005 by hand: change speed mid-playback, confirm it keeps playing from the same
      position. Note this is **pre-existing behavior** (setting `playbackRate` never seeks) — this
      is a regression check that the signature change didn't break it, not new behavior
- [x] T026 [P] Run `npm run test:unit:coverage` (not bare `vitest run` — the thresholds only apply
      under `--coverage`, so T015's ratchet entry gates nothing otherwise) and `npm run build`
- [x] T027 [P] Run `npx playwright test e2e/media-viewer.spec.ts e2e/wall.spec.ts
      e2e/album-posts.spec.ts` — the viewer and the Wall players are unregressed
- [x] T028 Flip `**Status**:` to `in-progress` (then `in-review`) in the spec and run `make roadmap`
- [x] T029 **Bump `package.json` to 1.0.33** — `develop` is at 1.0.32 with tag `v1.0.32` cut, so
      this is the first change of a new release cycle (spec E-2)
- [ ] T030 Discharge the supply-chain obligation (spec E-1): Docker Scout report for the current
      `zuptalo/ring` tag. Blocked here (no Docker Hub access) — **needs maintainer sign-off, which
      Governance requires before `/speckit-implement` for an unmet MUST**

## Dependencies

```
Phase 1 (baseline)
   ↓
Phase 2 (sendVoice test seam)          ← no behavior change
   ↓
Phase 3 (RED — observed failing)       ← HARD GATE, Constitution III
   ↓
Phase 4 (registry)
   ↓
Phase 5 (US1) ── Phase 6 (US2) ── Phase 7 (US3)   ← three consumers of one module, independent
   ↓
Phase 8 (gates + version bump)
```

- **T003-T005 gate Phase 3**: nothing today can send a voice message, create a voice Wall post, or
  read the shared audio element's real rate — so all three regression tests are unwritable without
  those seams, and the Constitution III gate cannot be discharged.
- **T014 gates Phases 5-7**: all three are consumers of the registry.
- `[P]`: T015, T026, T027.

## Implementation Strategy

**MVP = Phases 1-5**: the reported bug fixed. Phase 6 is the other half the user asked for
explicitly and should ship alongside it. Phase 7 is a verification pass on a surface that inherits
the fix for free.

## Analysis remediation

Two adversarial passes ran over these artifacts. Task ids below are the current ones.

### First pass

| Finding | Severity | Resolution |
|---|---|---|
| F-01 US3 assumed the post detail page uses our player; it uses a native `<audio>` | CRITICAL | US3 rewritten to be Wall-**feed**-only; FR-008 narrowed to surfaces that actually render a `SpeedPill`; the two out-of-scope surfaces named in the spec |
| F-02 nothing applied the rate to a freshly-mounted `<video>` | CRITICAL | T020 applies it in `onMeta`; T010 asserts the real `playbackRate`, not just the pill |
| F-03 no `sendVoice` testhook, so the RED test was unwritable | CRITICAL | T003, ahead of the gate |
| F-04 the Wall task said "fix" the album composite key, which would have broken it | HIGH | T023 is verify-only and forbids the change, with the reason |
| F-05 plan justified keeping `audioRate` by a refactor the tasks already do | HIGH | T016 deletes the export outright |
| F-06 FR-009's "bounded" had no number | HIGH | 200, in FR-009, SC-005, T007, T014 |
| F-07 FIFO eviction contradicted FR-004 | HIGH | LRU, in FR-004, FR-009, T007, T014 |
| F-08 a gate task referenced an e2e file that is not on this branch | MEDIUM | T027 targets media-viewer, wall, album-posts |
| F-09 FR-006 had zero test coverage | MEDIUM | T009's second leg: change a non-playing message while another plays |
| F-10 close/reopen of the viewer untested | MEDIUM | folded into T010 |
| F-11 every assertion was pill-only | MEDIUM | T009 and T010 assert real `playbackRate` |
| F-12 unmet supply-chain MUST with no maintainer sign-off | MEDIUM | T030 states Governance requires sign-off before implement — surfaced, not self-waived |
| F-13 US3's test came after its change | MEDIUM | T011 is in the RED phase |
| F-14 plan cited a spec directory not on this branch | MEDIUM | dropped |
| F-15 "must outlive every component" overstated the rationale | LOW-MED | plan restated: four independent viewer instances + host-page unmount |
| F-16 AudioCard's pill only renders when active | LOW-MED | noted in T018 |
| F-17 FR-005 describes pre-existing behavior | LOW | T025 labelled a regression check |
| F-18 FR-008 listed surfaces with no speed control | LOW | narrowed |
| F-19 deleted-message edge case mapped to nothing | LOW | folded into FR-009's rationale |
| F-20 new module not in the coverage ratchet | LOW | T015 |
| F-21 a story task was missing its `[US1]` tag | TRIVIAL | tags corrected throughout |

### Second pass (verification of the above)

| Finding | Severity | Resolution |
|---|---|---|
| NEW-1 the "real playbackRate" assertion targeted a detached `new Audio()` Playwright cannot reach | BLOCKER | T005 adds an `audioElementRate()` hook; T009 uses it |
| NEW-2 no seam can create a **voice Wall post**, so the US3 test was unwritable — F-03 again, for the Wall | BLOCKER | T004 adds `postVoice` |
| NEW-3 "reading counts as use" would mutate a reactive map from inside render-time computeds → write-during-render and a self-invalidating computed | BLOCKER | use redefined as *playing or changing*, never reading: FR-004, FR-009, T007, T014, and a plan section explaining why |
| NEW-4 plan Summary still described `audioRate` as a surviving derived view | HIGH | Summary corrected to match T016 |
| NEW-5 plan's Constitution Check cited the pre-rewrite phase numbers | MEDIUM | corrected |
| NEW-6 the coverage ratchet was never actually run | MEDIUM | T026 runs `npm run test:unit:coverage` |
| NEW-7 plan's file inventory omitted `testhook.ts` and `vitest.config.ts` | MEDIUM | both added to Scale/Scope |
| NEW-8 four acceptance scenarios had no test | MEDIUM | T012 (US1 AC-3/AC-4) and T011's album leg (US3 AC-2) |
| NEW-9 plan never stated the cap or policy | LOW | 200 + LRU stated |
| NEW-10 FR-010 has no task | LOW | **accepted** — a negative wire-invariant discharged by the Zero-Knowledge Impact section; there is no code to test |
| NEW-11 line-citation drift on the Wall bindings | LOW | corrected to `:158` / `:225` |
| NEW-12 `e2e/media-viewer.spec.ts` covers no video | LOW | acknowledged — T010 builds its own video-in-viewer seeding; T027's guarantee is correspondingly weaker |
