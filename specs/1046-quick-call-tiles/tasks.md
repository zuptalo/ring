# Tasks: Quick Call tiles on the Calls tab, usage totals move to Network usage

**Input**: Design documents from `specs/1046-quick-call-tiles/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Included — constitution Principle III (TDD): the pure module's
failing tests land before its logic; e2e covers the changed user-facing
behavior.

**Organization**: US1 (one-tap calling) + US2 (management/caps) share the pure
core and the tile row, so the foundational phase carries the shared module;
US3 (totals move) is independent.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Confirm branch `feat/1046-quick-call-tiles` is current and
      `npm run build` is green before changes (baseline).

## Phase 2: Foundational (blocking US1 + US2)

- [ ] T002 RED: create `src/utils/quick-calls.test.ts` with failing tests for
      `src/utils/quick-calls.ts`: `callSize` (contact = 2, group = members+1),
      `allowedKinds` boundary cases (4/5 and 8/9), `upsertEntry` (dedupe on
      t+id, method update, soft cap 8, insertion order preserved),
      `entryVerdict` (ok / no-video / no-audio / missing / ghosted / blocked),
      and the parse/sanitise of an unknown-shaped synced value (garbage in →
      valid entries out).
- [ ] T003 GREEN: implement `src/utils/quick-calls.ts` as pure, dependency-free
      functions importing only `VIDEO_MAX`/`AUDIO_MAX` from
      `src/services/call/types.ts`.
- [ ] T004 [P] Add `'calls.quick'` to `SYNCED_PREF_KEYS` in
      `src/services/ownsync-keys.ts` with a why-comment (organisation pref,
      follows the user like chats.tabFilters).

## Phase 3: US1 — One tap to call the people I always call (P1) 🎯 MVP

- [ ] T005 [US1] Create `src/components/QuickCallsRow.vue`: tile row (avatar +
      dir="auto" name + method glyph corner badge + "+" add tile), entries
      resolved against live contacts/chats props, unknown ids hidden, invalid
      targets dimmed with a warning glyph; emits `call(entry)`, `add`,
      `manage(entry)`; long-press (500 ms timer + click swallow) and
      contextmenu → `manage`.
- [ ] T006 [US1] Host in `src/views/tabs/CallsPage.vue`: live-query the
      `calls.quick` setting + contacts + chats; render the row above Recent;
      tap → re-derive `entryVerdict`; ok → `startDirectCall(id, kind)` or
      (`ensureProfile` then) `startGroupCall(chat.id, kind, name, avatar,
      participantIds)`; not ok → the manage sheet with the reason (busy guard
      stays inside useCall).
- [ ] T007 [US1] Verify: `npm run build` green; drive check — tap rings a
      contact video call and a group audio call immediately.

## Phase 4: US2 — Add, re-method, and remove Quick Calls (P1)

- [ ] T008 [US2] Add-picker modal in `src/views/tabs/CallsPage.vue` (pattern:
      the existing New-call modal): sections Contacts + Groups (groups from
      listChats → isGroup); per-target kind step offers only `allowedKinds`
      (audio/video buttons, blocked one disabled with the capacity reason);
      >8 groups render disabled with the audio-cap reason; picking writes via
      `upsertEntry` + `setSetting('calls.quick', …)`.
- [ ] T009 [US2] Manage action sheet (from tile long-press/contextmenu or an
      invalid tap): "Switch to video/audio" (disabled + reason when the target's
      size disallows it), "Remove"; over-cap tap surfaces "Switch to audio"
      when audio is allowed, else Remove.
- [ ] T010 [US2] Verify: unit suite green; drive check of the cap flows
      (5-person group offers audio only; switch blocked with reason).

## Phase 5: US3 — Call statistics move to Network usage (P2)

- [ ] T011 [P] [US3] Extend `src/views/detail/NetworkUsagePage.vue`: "Audio
      calls" and "Video calls" rows (minutes + bytes) in Media & calls via
      `computeCallTotals` over the calls the page's `networkStats` window
      already covers (since `network.resetAt`, hidden calls excluded).
- [ ] T012 [P] [US3] Remove the Totals block from
      `src/views/tabs/CallsPage.vue` (template, `totalsCalls`/`totals`,
      `listCallsForTotals`/`computeCallTotals` imports, styles).
- [ ] T013 [US3] Verify: build green; Network usage shows per-kind rows that
      reset with "Reset statistics"; Calls tab has no Totals.

## Phase 6: Polish & cross-cutting

- [ ] T014 New e2e `e2e/quick-calls.spec.ts`: (a) add a contact video quick
      call via the picker and tap → outgoing video call rings (waitCallState);
      (b) group beyond VIDEO_MAX offers audio only and switch-to-video is
      blocked; (c) remove works; (d) NetworkUsagePage shows Audio/Video call
      rows; (e) CallsPage renders no Totals block.
- [ ] T015 Run the gates: `npm run test:unit`, `npm run build`,
      `npm run test:e2e -- quick-calls`; fix fallout.
- [ ] T016 Update spec Status → in-review after the user validates locally;
      `make roadmap`; commit regenerated ROADMAP.md.
- [ ] T017 (deferred, needs user go-ahead) `/speckit-taskstoissues` + push +
      PR with `Closes #N` lines.

## Dependencies

- T002→T003 (red→green) → T005/T006/T008/T009.
- T004 independent [P].
- US3 (T011–T013) independent of US1/US2; T011 ∥ T012.
- T014 after US1–US3.

## Implementation strategy

US1 with hand-seeded entries is demonstrable alone; US2 makes it real; US3 is
an independent slice that can land in the same PR. Unit tests red-first;
`npm run build` after each story.
