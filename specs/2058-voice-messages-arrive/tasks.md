---

description: "Task list for spec 2058 — Voice messages never arrive as an empty bubble"
---

# Tasks: Voice messages never arrive as an empty bubble

**Input**: Design documents from `/specs/2058-voice-messages-arrive/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: **REQUIRED, not optional.** Constitution Principle III states a `2001+` bug fix *MUST*
begin with a failing regression test that reproduces the bug before the fix lands. Phase 3 is a hard
gate: it must be observed failing, for the right reason, before any task in Phase 4+ starts.

**Revision**: rewritten after `/speckit-analyze` returned 4 CRITICAL + 6 HIGH findings. See
"Analysis remediation" at the foot for the mapping from finding to task.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 / US4 from spec.md

---

## Phase 1: Setup (Baseline)

**Purpose**: know the tree is green before touching it, so a later failure is attributable.

- [x] T001 Run `npm run build` and record it passing on the untouched branch
- [x] T002 Run `npx playwright test e2e/seen-on-view.spec.ts` and record it passing — this is the
      canary for the read-receipt observer that Phase 4 extends (plan.md "Risks")

**Checkpoint**: baseline green and recorded.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the one persisted field and a test seam that can produce **both** a fetchable and a
broken pending message. **Nothing here changes user-visible behavior** — the bug must still
reproduce at the end of this phase, or the Phase 3 red test proves nothing.

**⚠️ CRITICAL**: no user-story work may begin until Phase 3's red test has been observed failing.

- [x] T003 Add optional `dlFailedAt?: number` to the `Message` interface in `src/db/types.ts` (near
      the existing `failReason?` / `jobAttempts?` send-side fields, ~:336-340), commented as
      device-local receive-side bookkeeping that is never synced. (No sync exclusion work is needed:
      own-data sync covers only `contacts`/`chats`/`chatlists` — `ownsync.ts:28` — so no `Message`
      field can ride it. Verified in `checklists/zero-knowledge.md`; noted here so the next reader
      doesn't re-derive it.)
- [x] T004 Add `seedPendingIncoming(chatId, kind, opts?)` to `src/services/testhook.ts` that writes
      an **incoming** message (`outgoing: false`, `status: 'delivered'`) with `pendingMedia` set,
      **no** `mediaId`, and a `durationSec`. It MUST seal and **really upload** a tiny audio blob
      via `prepareOutgoingMedia` (`src/services/media-transfer.ts:203`) and store the resulting
      genuine `MediaRef`, so a fetch can actually succeed. Note `seedMedia` (~:1143-1166) is **not**
      the seam to copy — it writes a local `Media` blob and uploads nothing. `opts.broken: true`
      instead stores a ref pointing at a blob id that was never uploaded, for the failure cases;
      `opts.videoNote: true` seeds a round note. **A fabricated ref for every case would make the
      entire success path — US1 — untestable**
- [x] T005 [P] Extend the `messages(chatId)` projection in `src/services/testhook.ts` (~:551-581) to
      expose `pending: !!m.pendingMedia` and `dlFailedAt: m.dlFailedAt ?? null`. (Convenience only —
      `mediaInfo()` at ~:585-604 already reports `hasMedia`/`pending`; this just spares the tests a
      second call per row)
- [x] T006 **RED (unit)**: write the vitest for the auto-retry bound *before* the function exists —
      0/1/2 attempts → retry, 3+ → stop. Constitution III requires tests to be ordered before the
      implementation that satisfies them, and this is the only genuinely pure piece the fix adds.
      Run it and watch it fail to resolve the import
- [x] T007 Extract the auto-retry bound as a **pure** function in `src/utils/` (or beside the
      existing helpers) — `shouldAutoRetry(attempts: number): boolean`, capped at 3 per FR-006 —
      testable without IndexedDB. T006 now passes
- [x] T008 Run `npm run build` — types compile, behavior unchanged, bug still reproduces by hand

**Checkpoint**: both flavors of the bug's state are reachable from a test, and nothing is fixed yet.

---

## Phase 3: RED — the regression test (Constitution III gate) 🚨

**Purpose**: reproduce the reported defect automatically, and watch it fail, before any fix.

**Goal**: a test that fails today **because the bubble body is empty**, and passes only once the
placeholder exists and the fetch resolves into a real player.

- [x] T009 Create `e2e/voice-pending.spec.ts` with the US1 case: seed a **fetchable** pending
      incoming voice message, open the chat, assert the bubble `[data-mid]` contains a visible,
      non-empty body, **and then** assert the placeholder is replaced by the real player
      (`.vp-pending` gone, `VoicePlayer`'s `.vp` present) without navigating away — FR-007, within a
      timeout encoding SC-002's 3 seconds
- [x] T010 [US2] Add the US2 case: with a `broken: true` seed, the bubble shows a placeholder
      carrying the duration, a tap starts a retry, and the failure is surfaced
- [x] T011 [US2] Add the FR-008 persistence case: after a failed fetch, **leave the chat and
      re-enter**, and assert the bubble still reads as failed. Without this step a component-local
      implementation would pass every other assertion
- [x] T012 Add the FR-013 / SC-004 case: seed a pending incoming voice message with an old
      `updatedAt` (a message stranded before this fix), open the chat, assert it recovers with no
      tap and no re-send
- [x] T013 **Run the new spec and observe it FAIL.** Record the failure output in the PR/commit
      message. Confirm it fails because the bubble renders empty — not because the seam is wrong,
      the selector is wrong, or the test errored before asserting. **Rule out self-resolution**:
      `resumePendingMediaJobs` already auto-downloads voice on app start *and on reconnect*
      (`queries.ts:2982-2986`), so a fetchable seed can quietly resolve itself mid-test and turn the
      red gate green for the wrong reason. Assert the pending state still holds at the moment of the
      bubble assertion, or seed after the reconnect settles

**Checkpoint**: red, for the right reason, and recorded. Only now may Phase 4 begin.

---

## Phase 4: User Story 1 — self-healing voice message (Priority: P1) 🎯 MVP

**Goal**: a voice message that arrived while the app was closed renders, and fetches itself on view.

**Independent test**: T009 + T012 pass.

- [x] T014 [US1] Add the pending-voice branch to the `v-if` chain in
      `src/views/detail/ChatDetailPage.vue` (after the audio/file chip at ~:379-394): condition
      `m.kind === 'voice' && !m.mediaId && m.pendingMedia`, rendering a `.vp-pending` row — a
      download disc reusing the existing `.dl-ring` progress SVG where `VoicePlayer`'s play button
      sits, a flat inert waveform, and `m.durationSec` (falling back to the plain "Voice message"
      label when the duration is unknown, per FR-002). Render the tap target as a `<button>` with an
      explicit accessible label, as the sibling `.pending-chip` at ~:379 already does — Constitution
      X makes labels and focus part of every UI change. Tap calls `downloadPendingMedia(m.id)`
- [x] T015 [US1] Add `.vp-pending` CSS to the same file's `<style>` block beside the existing
      `.dl-ring` / `.chip-ico` rules (~:5727-5773), matching `VoicePlayer`'s `.vp` row metrics
      (`display:flex; align-items:center; gap:10px`, 34px disc, 24px wave strip) so the bubble does
      **not** change height when the fetch resolves. Keep the placeholder inside the ordinary
      text-padding bubble — do **not** flip `mediaBubble()`/`.bubble-media` on for pending voice: a
      *resolved* voice message is not a media bubble, so toggling the class would add then remove
      the media padding and produce exactly the reflow this design exists to avoid
- [x] T016 [US1] Add `downloadLane = createLimiter(3)` in `src/db/queries.ts` beside the existing
      spec-2053 lanes (~:2498-2515), import from `@/utils/concurrency`, and route the fetch **inside**
      `downloadMessageMedia` (~:2940) through it. This single choke point covers every caller —
      including the `resumePendingMediaJobs` backfill loop (~:2982-2986), whose body is just
      `void downloadMessageMedia(m.id)`. Do **not** also wrap the call sites: double-wrapping halves
      effective concurrency and risks a re-entrant stall
- [x] T017 [US1] Add a debounced `recoverVisiblePending()` in `src/views/detail/ChatDetailPage.vue`
      **beside** `markVisibleSeen()` (~:3298), driven by the existing bubble observer (~:3284). It
      walks visible `.bubble[data-mid]` rows and, for rows that are `!m.outgoing && m.pendingMedia
      && !m.mediaId && !m.deleted` and not past `expiresAt` (so a message deleted or expired
      mid-flight starts no orphan fetch), calls `downloadPendingMedia(m.id, { silent: true })`
      (signature per T022). It defers the should-I-fetch decision to the **existing**
      `shouldAutoDownloadMedia` (`queries.ts:2862` — add `export`; it is currently module-private
      with only two in-file callers, so exporting breaks nothing) rather than restating a kind
      allowlist: that function already encodes "voice and round notes always, everything else per
      preference and size cap", which is exactly FR-015. Do **not** modify
      `markVisibleSeen`/`runMarkVisibleSeen` themselves
- [x] T018 [US1] Bound the automatic path with the pure `shouldAutoRetry` from T007, backed by a
      module-scoped in-memory `Map<messageId, number>` — **not** a persisted field. A persisted
      counter would strand a message that burned its attempts offline, contradicting FR-013. A
      manual tap ignores the cap and never increments it (data-model INV-3, INV-4)
- [x] T019 [US1] Run `npx playwright test e2e/voice-pending.spec.ts` — the US1 and FR-013 cases pass

**Checkpoint**: the reported bug is fixed and the red test is green.

---

## Phase 5: User Story 2 — honest failure + retry for voice (Priority: P1)

**Goal**: a voice message whose audio can't be fetched says so and can be retried.

- [x] T020 [US2] In `src/db/queries.ts` `downloadMessageMedia`, stamp `dlFailedAt = now()` on failure
      and clear it on success, writing through the `idb` wrapper (and bumping `updatedAt`, as the
      success path already does at ~:2963) so the change bus repaints the bubble. Keep
      `pendingMedia` intact on failure (data-model INV-2)
- [x] T021 [US2] Give the failed state a face in `src/views/detail/ChatDetailPage.vue`: when
      `m.dlFailedAt` is set the placeholder reads as failed and offers a retry, rather than looking
      like it is still loading
- [x] T022 [US2] Change `downloadPendingMedia` (~:1441) to
      `downloadPendingMedia(id: string, opts: { silent?: boolean } = {})` — note the **default `{}`**,
      or the existing template call sites (~:362, ~:383) that pass only the id would throw. The
      automatic path and the tap path then share the existing `if (id in downloadProgress) return`
      guard (~:1442), so a tap and an on-view attempt cannot race (FR-004), differing only in
      whether they speak up
- [x] T023 [US2] Confirm the bubble repaints on the failed flip: T020 bumps `updatedAt`, which is
      already the first entry of the row's `v-memo` list (~:154), so no `v-memo` change should be
      needed. **Verify this rather than assume it** — if T020 is implemented without bumping
      `updatedAt`, add `m.dlFailedAt` to the `v-memo` list at ~:159 instead
- [x] T024 [US2] Add the SC-003 recovery case to `e2e/voice-pending.spec.ts`: seed a **fetchable**
      voice message, force the first fetch to fail, confirm the failed state, then tap **once** and
      assert it plays. T010's `broken` seed can never succeed, so without this the "single tap
      recovers it, 100% of the time the audio is still available" promise is never actually
      exercised
- [x] T025 [US2] Run `npx playwright test e2e/voice-pending.spec.ts` — the US2, FR-008 persistence
      and SC-003 cases pass

**Checkpoint**: MVP complete. US1+US2 together deliver the reported fix end to end.

---

## Phase 6: User Story 3 — round video notes (Priority: P3)

**Goal**: round notes behave like voice messages.

- [x] T026 [US3] Add a **dedicated sibling branch** for pending round notes in
      `src/views/detail/ChatDetailPage.vue` — condition `m.kind === 'video' && m.videoNote &&
      !m.mediaId && m.pendingMedia` — rendering a circular placeholder with the same `.dl-ring`
      affordance, **including the failed state** from T021 so FR-010 holds for round notes and the
      SC-001 round-note × failed cell is covered. Do **not** simply drop the `!m.videoNote`
      exclusion from the square photo/video block at ~:360: that frame is a square
      poster-or-skeleton box and would render a round note as a square, and the round-note bubble is
      already chromeless via `'bubble-plain': m.videoNote && !m.deleted` (~:212), so a square
      pending frame inside it would render bare
- [x] T027 [P] [US3] Add the round-note cases to `e2e/voice-pending.spec.ts` via
      `seedPendingIncoming(chatId, 'video', { videoNote: true })` — both the recovery case and the
      failed-state case

---

## Phase 7: User Story 4 — no attachment fails silently (Priority: P2)

**Goal**: every pending kind fails honestly, not just voice.

- [x] T028 [US4] Replace the swallowing `catch` in `downloadPendingMedia`
      (`src/views/detail/ChatDetailPage.vue` ~:1446-1448) with one that raises an `appToast` **when
      `silent` is false** and lets T020's failure marking stand. `appToast` is already imported at
      ~:1230. This is the single shared tap handler for every kind, so it covers photo, video, audio
      and document at once (research R6)
- [x] T029 [US4] Show the failed state on the existing pending photo/video block and audio/file chip
      so those kinds read as failed too (FR-010)
- [x] T030 [P] [US4] Add the US4 case to `e2e/voice-pending.spec.ts`: a pending **photo** whose tap
      fails produces a visible message and a failed-looking bubble
- [x] T031 [P] [US4] Add the FR-015 guard case: with photo auto-download set to never, a pending
      photo scrolled into view does **not** self-fetch. (Meaningful only because T017 defers to
      `shouldAutoDownloadMedia` rather than a hardcoded allowlist)

---

## Phase 8: Polish & Gates

- [x] T032 Add the SC-005 stampede case to `e2e/voice-pending.spec.ts`: seed 10 consecutive pending
      voice messages, scroll through them, assert all 10 recover, **at most 3 fetches in flight**,
      and the scroll position stays stable
- [x] T033 Add the SC-001 matrix case: walk the six kinds × four states and assert **no** bubble
      renders empty. Scope explicitly to the states reachable from the harness and log any cell left
      to manual check rather than silently omitting it
- [x] T034 Run `npx playwright test e2e/seen-on-view.spec.ts` — the read-receipt observer is
      unharmed by T017 (the canary from T002)
- [x] T035 [P] Run `npx playwright test e2e/media-blob-delete.spec.ts e2e/chat-media-scroll.spec.ts
      e2e/media-cleanup.spec.ts` — pending/download and scroll-anchor behavior unregressed
- [x] T036 [P] Run `npx vitest run` and `npm run build` — unit (now including T006) + typecheck green
- [ ] T037 Confirm FR-012 by hand: free space on a downloaded voice message and check it still reads
      "removed to free space" rather than appearing re-fetchable
- [x] T038 Flip `**Status**:` to `in-progress` (then `in-review`) in
      `specs/2058-voice-messages-arrive/spec.md` and run `make roadmap`
- [x] T039 **Bump `package.json` to 1.0.33.** `develop` and `main` are level at 1.0.32 (tag
      `v1.0.32` exists), so this is the first change of a new release cycle and the constitution
      makes the bump mandatory — without it the release guard blocks the eventual `develop → main`
      PR (spec.md → Complexity & Exceptions, E-3)
- [ ] T040 **SC-006 real-device pass**: send a voice message, and a reply carrying a voice message,
      to a genuinely closed phone and confirm both play. Headless cannot produce a Web Push into a
      closed iOS PWA, so this is owed before the spec is called shipped
- [ ] T041 Discharge the supply-chain obligation (spec.md E-1): review the Docker Scout report for
      the current `zuptalo/ring` tag and apply any vulnerability with a fix version, riding this
      branch. Blocked in this environment (no Docker Hub access) — needs the maintainer

---

## Dependencies

```
Phase 1 (baseline)
      ↓
Phase 2 (field + REAL test seam + pure retry bound)   ← no behavior change
      ↓
Phase 3 (RED — observed failing)                      ← HARD GATE, Constitution III
      ↓
Phase 4 (US1) ──► Phase 5 (US2)                       ← US2's failed state renders on US1's placeholder
      ↓                 ↓
Phase 6 (US3)     Phase 7 (US4)                       ← both need T020's marking; independent of each other
      ↓                 ↓
            Phase 8 (gates + version bump)
```

- **T004 gates everything**: a seam that cannot produce a *successful* fetch makes US1 untestable.
- **US1 → US2**: the failed state renders *on* the placeholder US1 introduces.
- **US2 → US4**: US4 reuses T020's marking and T022's `silent` flag.
- **US3** depends on T021's failed state (T026 renders it for round notes too); T026/T027 can
  otherwise run alongside Phase 7.
- `[P]`: T005, T027, T030, T031, T035, T036 — separate files or read-only runs.

## Implementation Strategy

**MVP = Phase 1-5** (US1 + US2). That is the reported bug fixed: no blank bubble, self-healing, a
visible retry when the fetch fails, and stranded pre-fix messages recovering.

**Stop-and-check points**:
1. End of Phase 3 — do not proceed until the red test has actually been seen failing for the right
   reason. The one gate the constitution makes non-negotiable for a `2001+` fix.
2. End of Phase 5 — the reporter's scenario should now work; worth the real-device look (T040)
   before investing in Phases 6-7.

## Analysis remediation

Mapping from the `/speckit-analyze` findings to their resolution.

| Finding | Severity | Resolution |
|---|---|---|
| A1 seeded ref never fetchable → US1 untestable | CRITICAL | T004 rewritten to really upload a blob, with an explicit `broken` option |
| A2 missed start-of-cycle version bump | CRITICAL | T039; plan Constitution Check row; spec E-3 |
| A3 FR-013 / SC-004 zero coverage | CRITICAL | T012 |
| A4 FR-007 / SC-002 zero coverage | CRITICAL | T009 extended to assert the placeholder→player swap within SC-002's budget |
| A5 `mediaBubble`/`mediaVars` wrong for voice | HIGH | old T012 deleted; T015 now explicitly says keep the ordinary bubble box |
| A6 session-vs-persistent retry contradiction | HIGH | counter made in-memory: spec FR-006 + Assumptions, data-model, T018 |
| A7 `/speckit-checklist` for Principle I | HIGH | `checklists/zero-knowledge.md` added; plan row records the reasoning |
| A8/A21 waiver in the wrong artifact | HIGH | spec.md gains a *Complexity & Exceptions* section (E-1..E-3) |
| A9 vitest promised, none written | HIGH | T006 writes the failing unit test, T007 makes it pass |
| A10 T013/T014 double-wrapped the lane | HIGH | merged into T016, single choke point |
| A11 `silent` flag signature unspecified | MEDIUM | T022 states the signature; T017 and T028 reference it |
| A12 hardcoded kind allowlist | MEDIUM | T017 defers to `shouldAutoDownloadMedia`, making T031 meaningful |
| A13 a11y claim with no task | MEDIUM | T014 requires a `<button>` with an accessible label |
| A14 T023 offered the implementer a fork | MEDIUM | T026 decides it: a dedicated sibling branch |
| A15 retry cap number undefined | MEDIUM | fixed at 3 in FR-006, data-model, T006/T007 |
| A16 FR-008 persistence untested | MEDIUM | T011 leaves and re-enters the chat |
| A17 unmeasurable SC-001/002/005 | MEDIUM | criteria tightened in spec; T032 and T033 verify them |
| A18 FR-002 unknown-duration fallback | LOW | FR-002 amended; T014 renders the fallback |
| A19 FR-010/FR-011 are scope qualifiers | LOW | **accepted as-is** — merging would renumber every FR for no behavioral gain |
| A20 T020 `v-memo` likely a no-op | LOW | T023 turned into a verify-don't-assume step |
| A22 stale claim in research R7 | LOW | research.md R7 corrected in place; T005 downgraded to a convenience |

### Second-pass remediation (re-run of `/speckit-analyze`)

The re-run confirmed the design was sound but caught the rewrite leaving three artifacts stale.

| Finding | Severity | Resolution |
|---|---|---|
| N1 plan.md still carried `dlAttempts`, the `mediaBubble()` extension, and the `v-memo` mandate | HIGH | plan.md Technical Context, source tree, and Risks all corrected |
| N2 research.md R3 still recorded the persisted counter; R7 the false seam claim | MEDIUM | both revised in place, with a note explaining the reversal |
| N3 `checklists/requirements.md` contradicted the A7 and A15 fixes | MEDIUM | notes rewritten; FR-012→FR-014 mis-citation fixed |
| N4 T006 (impl) preceded T007 (its test) — literal Principle III inversion | MEDIUM | swapped: T006 is now the failing unit test, T007 the implementation |
| N5 round-note failed state untasked (FR-010, SC-001 cell) | MEDIUM | folded into T026 |
| N6 SC-003 (failed → single tap → success) had no automated case | MEDIUM | new T024 using a *fetchable* seed, since T010's `broken` seed can never succeed |
| N8 `{ silent = false }` was invalid TS and would break existing call sites | LOW | T022 now specifies `opts: { silent?: boolean } = {}` |
| N9 T017 omitted the guards and never named the function it calls | LOW | T017 now states the full predicate and the `{ silent: true }` call |
| N10 T004 mis-cited `seedMedia` as an upload seam (it uploads nothing) | LOW | corrected to `prepareOutgoingMedia` (`media-transfer.ts:203`) |
| N11 a fetchable seed can self-resolve via reconnect and green the red gate | LOW | T013 now requires ruling that out explicitly |
| N12 the ZK checklist's open item rested on a false premise | LOW | closed by citation — `ownsync.ts:28` excludes `messages` from sync entirely |
| N7, N13 | LOW | **accepted** — FR-004 is covered by implementation (T022) and exercised indirectly; the "don't interrupt playback in progress" edge case is left to the manual pass |
