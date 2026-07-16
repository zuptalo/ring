# Tasks: Push Wakes Always End Visibly Where Silence Is Unsafe

**Input**: Design documents from `/specs/2023-push-wakes-always/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/wake-outcomes.md, quickstart.md

**Tests**: REQUIRED and ordered red-first — this is a `2001+` hotfix, so the
constitution (Principle III) mandates failing regression tests that reproduce
the bug before the fix lands. The `src/sw.ts` wiring is not importable under
vitest (workbox + SW globals); per research.md D5 it is covered by the
[wake-outcomes contract](./contracts/wake-outcomes.md) inventory instead, and
every pure decision gets red-first unit tests.

**Organization**: Grouped by user story. US1 (always-visible on unsafe
platforms) is the MVP; US2 (Chromium unchanged) and US3 (failure hardening)
are independently verifiable increments.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Mark spec 2023 `**Status**: in-progress` in
      specs/2023-push-wakes-always/spec.md and run `make roadmap` (CI guard
      requires ROADMAP.md to match)

---

## Phase 2: Foundational

*(none — no scaffolding needed; the feature edits existing files only)*

---

## Phase 3: User Story 1 — iPhone notifications survive foreground pushes (P1) 🎯 MVP

**Goal**: On WebKit/unknown platforms every push wake ends with a
showNotification call; the visible-client skip and the page-claim silence are
licensed only through the new platform gate.

**Independent Test**: `npx vitest run src/services/sw-quiet.test.ts` — the
T002 regression cases pass; wake-outcomes contract rows 2/4/8/9/11/13/15/17
(unsafe column) verified by code inventory.

- [X] T002 [US1] RED: add failing regression tests to
      src/services/sw-quiet.test.ts importing `platformTrustsSilence` and
      `mayEndWakeSilently` from `@/services/sw-inbox` (they do not exist yet —
      the suite must fail): full gate truth table from data-model.md (iOS
      Safari PWA UA, CriOS, EdgiOS, FxiOS, macOS Safari, Firefox, empty and
      garbage strings → false; desktop/Android/macOS Chrome, Edge, Samsung
      Internet → true) and the core regression `mayEndWakeSilently(iOS UA,
      [{visibilityState:'visible', focused:true}]) === false` plus
      `mayEndWakeSilently(Chrome UA, same) === true`
- [X] T003 [US1] GREEN: implement `platformTrustsSilence(ua)` and
      `mayEndWakeSilently(ua, clients)` as pure exports in
      src/services/sw-inbox.ts with why-comments (webpushd cumulative 3-strike
      counter, no reset, no visible-page exemption; engine-keyed per spec
      Clarifications), and rewrite the stale spec-1034 block comment
      ("unless a Ring window is actually ON SCREEN") to state the new
      platform-gated license; T002 tests now pass
- [X] T004 [US1] Rewire src/sw.ts quiet terminal: split bare
      `showQuietNote(kind)` out of `showQuietUnlessVisible(kind)`; license the
      skip via `mayEndWakeSilently(self.navigator.userAgent, clients)`; remove
      the swallowing try/catch so a failed quiet show propagates to
      guardedPush (FR-005); update the function doc comment and the
      "user is looking at Ring — silence is honest here" inline comment to the
      platform-gated semantics
- [X] T005 [US1] Add the post-claim visible ending in src/sw.ts dispatchPush:
      after `pageWillNotify` returns true, on
      `!platformTrustsSilence(self.navigator.userAgent)` show the quiet note
      unconditionally (platform-gated ONLY, not visibility-gated, per FR-003 —
      Chromium claim outcome stays byte-identical); comment why this also
      closes the zero-render hidden-chat claim arm (notify.ts:386, the spec
      1027 FR-012 zero-trace trade documented in spec 2023 edge cases)

**Checkpoint**: US1 alone fixes the live incident class on iPhones.

---

## Phase 4: User Story 2 — Desktop Chromium stays calm (P2)

**Goal**: Chromium-engine behavior unchanged except the already-applied
focused+visible tightening, which gets its rationale, house style, and
missing test pinned (FR-004).

**Independent Test**: gate truth-table Chromium rows from T002 pass;
`anyClientVisible` truth table fully pinned; wake-outcomes rows 2–17
(trusted column) verified by inventory — non-failure behavior unchanged; the
zero-accepted variants are the US3 hardening and apply on every platform.

- [X] T006 [P] [US2] Pin the missing predicate case in
      src/services/sw-quiet.test.ts: `anyClientVisible([{visibilityState:
      'visible'}])` (focused ABSENT) → false — kills the `?? true` mutant that
      passes today's suite — and `anyClientVisible([{visibilityState:'hidden',
      focused:true}])` → false; retitle the misnamed test ("a hidden/frozen
      background client…") so the visible-but-unfocused case is named by a
      test of its own
- [X] T007 [P] [US2] Restore the deleted why-comment on `anyClientVisible` in
      src/services/sw-inbox.ts covering BOTH halves (frozen-snapshot distrust
      of matchAll attributes AND Chromium's documented "open and focused"
      exemption wording) and switch `(c.focused ?? false)` to house-style
      `c.focused === true` (behavior-identical; verified by the truth-table
      tests)

**Checkpoint**: externally-contributed predicate is fully adopted: rationale,
style, tests.

---

## Phase 5: User Story 3 — A failed notification can never masquerade as a shown one (P3)

**Goal**: A rejected/hung showNotification is never recorded as a show, and a
wake whose every show failed still ends visibly or reaches the guarded
fallback (FR-006, FR-007).

**Independent Test**: wake-outcomes contract rows 18–19 and the
zero-accepted variants of rows 3/5/10/12/14 verified by inventory; full
vitest suite + `npm run build` green.

- [X] T008 [US3] RED: add failing unit tests to
      src/services/sw-quiet.test.ts for two pure helpers imported from
      `@/services/sw-inbox` that do not exist yet (the suite must fail):
      `stampedShow(raw, stamp)` — returns a show function where `stamp` runs
      ONLY when `raw`'s promise fulfills (rejecting raw → stamp NOT called
      and the rejection still reaches the caller; resolving raw → stamped),
      and `countAccepted(shows)` — runs an array of async show thunks,
      tolerates individual rejections, returns the number that fulfilled
      (all-reject → 0, mixed → exact count, empty → 0)
- [X] T009 [US3] GREEN: implement `stampedShow` and `countAccepted` as pure
      exports in src/services/sw-inbox.ts with why-comments (FR-006: a show
      is only "shown" once the platform accepts it — a rejected show must not
      suppress the last-resort fallback; FR-007: a batch's visible outcome is
      its ACCEPTED count); T008 tests pass
- [X] T010 [US3] Wire src/sw.ts: replace the call-time `lastNotificationAt`
      assignment with `stampedShow(rawShow, stamp)` preserving the
      reassignment-blocked fallback comment (FR-006); rebuild `showNotes` and
      `showConnNotes` on `countAccepted` so both return the accepted count
      (per-tag sig saves stay best-effort after each accepted show); update
      callers per the wake-outcomes failure semantics: the initial arm of
      `showMessageNotification` sets `shownAny` from count > 0; the settle
      UPGRADE arm closes the already-accepted generic only AFTER the upgrade
      shows report accepted > 0 (never destroy the wake's accepted visible
      ending for a failed upgrade — do NOT touch `shownAny` there, it is only
      read before the settle block); `tryAuthoritativeDrain` ends via the
      quiet terminal when `!r.notes.length || accepted === 0` (still acks
      committed frames per research D4); post-activity sets `shownActivity`
      from count > 0; `showConnNotification`/`showPostNotification` fall
      through to their generic placeholder when notes existed but zero were
      accepted (FR-007)

**Checkpoint**: all three latent error-class silent paths from the review are
closed, each pinned by a unit test on its pure half.

---

## Phase 6: Polish & Gates

- [X] T011 [P] Append the FR-008 amendment pointers, both linking to
      specs/2023-push-wakes-always/spec.md: (a) in
      specs/1034-every-push-wake/spec.md "Policy (FR-001)" section, one short
      paragraph noting spec 2023 supersedes the visible-client license
      (platform-gated silence; focused AND visible; page-claim followed by
      the quiet note on silence-unsafe platforms); (b) in
      specs/1027-harden-hidden-chats/spec.md at FR-012 (the foreground
      zero-trace claim — the arm at notify.ts:386 whose comment cites 1027
      FR-012), a note that on silence-unsafe platforms the claim now ends
      with the content-free quiet note per spec 2023
- [X] T012 Walk every terminal in src/sw.ts dispatchPush/guardedPush against
      contracts/wake-outcomes.md and record the row-by-row inventory (SC-001)
      in specs/2023-push-wakes-always/inventory.md for the PR description
- [X] T013 Run the full gates: `npx vitest run` (all suites) and
      `npm run build` (vue-tsc + vite) — both green (SC-003). No NEW e2e spec
      per the plan's documented Principle-III deviation (Playwright cannot
      deliver Web Push to the SW); the existing notification e2e suites run
      in CI on push and must stay green
- [X] T014 Real-device validation per quickstart.md on the dev iPhone
      (SC-004): foreground + severed socket, 5+ pushes, every wake visible,
      subscription alive afterward — MANUAL, requires the physical device;
      may complete after the PR opens

## Dependencies

- T001 → everything (roadmap guard)
- T002 (RED) → T003 (GREEN) → T004 → T005 (same files, strict order)
- T006/T007 [P] after T003 (same test/source files as US1 but distinct
  regions; parallel with each other, sequential with T004/T005 edits to
  sw-inbox.ts only via T007)
- T008 (RED) → T009 (GREEN) → T010; T010 after T004/T005 (edits src/sw.ts —
  sequential with US1 wiring)
- T011 [P] anytime; T012 after T010; T013 after all code tasks; T014 last

## Issue Mapping

T001 #908 · T002 #909 · T003 #910 · T004 #911 · T005 #912 · T006 #913 ·
T007 #914 · T008 #915 · T009 #916 · T010 #917 · T011 #918 · T012 #919 ·
T013 #920 · T014 #921 — the feature → `develop` PR must list `Closes #N`
for each (constitution VIII).

## Implementation Strategy

US1 is the MVP and the incident fix; it is deliverable alone. US2 is mostly
adoption polish of the already-applied predicate. US3 is defense-in-depth in
the same wiring. Single PR: the phases land as ordered commits on
`fix/2023-push-wakes-always`, red tests first within each story.
