# Implementation Plan: Voice messages never arrive as an empty bubble

**Branch**: `fix/2058-voice-messages-arrive` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/2058-voice-messages-arrive/spec.md`

## Summary

An incoming voice message whose audio bytes are not yet on the device renders as a **completely
empty bubble**, because the voice/round-note render is gated on the bytes being local
(`ChatDetailPage.vue:306`) and the "not downloaded yet" fallbacks were only ever built for
photo/video (`:360`) and audio/file (`:380`). Voice matches neither.

The fix is three moves in the chat page plus one in the data layer:

1. **Draw something.** Add pending branches for `voice` (a voice-shaped placeholder matching
   `VoicePlayer`'s row height so the resolve is a swap, not a reflow) and for round video notes.
2. **Recover on its own.** Hang a debounced pending-recovery handler off the per-bubble
   `IntersectionObserver` that already exists for read receipts (`:3284`), so a message that arrived
   via push while the app was closed fetches itself when you scroll to it — bounded per message.
3. **Fail honestly.** The single shared tap handler `downloadPendingMedia` (`:1441`) currently
   swallows every failure. Mark the message failed and toast on a user-initiated tap. Because every
   kind funnels through that one function, this delivers User Story 4 across all attachment kinds
   for the same edit.
4. **Stop the stampede.** Route downloads through a `createLimiter(3)` lane. Downloads are
   completely unbounded today (`resumePendingMediaJobs` fires one `void` call per pending message),
   so adding on-view recovery without this would make an existing latent problem worse.

## Technical Context

**Language/Version**: TypeScript 5 (ES modules, `@/` → `src/`), Vue 3 `<script setup>`

**Primary Dependencies**: Ionic Vue, existing in-repo `createLimiter` (`src/utils/concurrency.ts`),
existing `appToast` (`src/services/toast.ts`). **No new dependency.**

**Storage**: IndexedDB via `src/db/idb.ts`. **One** optional field (`dlFailedAt`) added to existing
`messages` records; **no `DB_VERSION` bump** (see data-model.md). The auto-retry counter is
deliberately **in-memory and session-scoped**, not persisted — a persisted counter would strand a
message that burned its attempts while offline, contradicting FR-013.

**Testing**: Playwright e2e (`e2e/`) is the behavioral gate — the red regression test comes first
per Constitution III. Vitest covers the one genuinely pure piece this adds: the auto-retry
attempt-bound decision, extracted as a pure function so it is testable without IndexedDB (the
failure *marking* is an IDB write and is covered by e2e instead). `npm run build` is the typecheck.

**Test seam caveat (found in analysis)**: a seeded pending message must reference a blob that was
really uploaded, or every fetch fails and the *success* path — the whole of US1 — is unreachable
from the harness. The seeder therefore seals and uploads a real tiny audio blob, and takes an
explicit "broken" option for the failure cases.

**Target Platform**: the PWA on iOS Safari + Chrome/Android; the reported failure is an iOS PWA
receiving via Web Push while closed.

**Project Type**: client-only change. **No server, no Go, no migration, no wire change.**

**Performance Goals**: recovered and playable within 3s of opening the chat on a normal connection
(SC-002); ten consecutive pending messages recover without stalling scroll (SC-005).

**Constraints**: must not reflow the message list when a placeholder resolves (the spec 1011 scroll-
anchor lesson, `ChatDetailPage.vue:250-256`); must not disturb the read-receipt observer path; must
not auto-fetch attachments the user deliberately deferred (FR-015).

**Scale/Scope**: ~2 files of substance (`ChatDetailPage.vue`, `src/db/queries.ts`), plus
`src/db/types.ts` (1 field) and `src/services/testhook.ts` (test seam). One new e2e spec.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design. Both passes clean.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Zero-Knowledge (NON-NEGOTIABLE)** | ✅ PASS | No wire change. Reuses the existing fetch of a blob id already inside the sealed message. The one new field is device-local and never synced (`ownsync.ts:28` excludes `messages` entirely); the retry counter never persists at all. Spec carries the mandatory **Zero-Knowledge Impact** section. |
| **II. Spec-Driven** | ✅ PASS | specify → clarify → plan complete; tasks → analyze precede implement. Branch `fix/2058-…`, flat dir `specs/2058-…`, hotfix band. |
| **III. Test-Driven** | ✅ PASS *(binding)* | A 2001+ fix MUST open with a failing regression test. Phase ordering puts the test seam + red e2e before any fix, and the e2e asserts **rendered content**, not just the `pending` flag — a flag-only assertion would pass before and after and prove nothing. |
| **IV. Crypto Discipline** | ✅ N/A | Crypto core untouched; no key handling, no new primitive. |
| **Gate sequencing — `/speckit-checklist`** | ✅ PASS | Required for any spec touching Principle I or IV. IV is untouched. I is *documented* (the mandatory Zero-Knowledge Impact section) but not *modified* — no new wire field, endpoint, identifier, or stored server value. The only delta is that a fetch which previously never happened now happens, using the existing capability id over the existing path. Ran `/speckit-checklist` anyway rather than argue the boundary: `checklists/zero-knowledge.md`. |
| **Development Workflow — start-of-cycle version bump** | ⚠️ **Owed, tasked** | `package.json` is at 1.0.32 and tag `v1.0.32` exists, so `develop` and `main` are level and this is the first change of a new cycle. The constitution makes the bump to 1.0.33 mandatory on this branch or the release guard blocks the release PR. Carried as T039; recorded in spec.md → Complexity & Exceptions (E-3). |
| **V. Offline-First Data** | ✅ PASS | Writes go through the `idb` wrapper; the UI stays reactive via the existing change bus. No store added or altered → no `DB_VERSION` bump (justified in data-model.md). Old rows read `undefined` = correct default. |
| **VI. Stateless Server** | ✅ N/A | No server change, no migration. |
| **VII. Quality Gates** | ✅ PASS | `npm run build` + vitest + the new e2e. Commit subject will be plain-language release-note copy with no spec/issue refs. |
| **VIII. Traceable Delivery** | ✅ PASS | Tasks → issues → `Closes #N` on the PR; `ROADMAP.md` regenerated via `make roadmap`. |
| **IX. Privacy** | ✅ PASS | No telemetry. The retry bound also stops a permanently-broken message emitting an unbounded repeating fetch pattern. |
| **X. Accessibility & i18n** | ✅ PASS | Placeholder carries an accessible label and is a real focusable control; text is the existing "Voice message" string (already used by `clearedLabel`, `:2014-2029`), so bidi behavior is unchanged. |
| **XI. Ionic-First UI** | ⚠️ **Justified deviation** | See Complexity Tracking. |

### Supply-chain scan (Development Workflow, MUST)

The constitution requires reviewing the Docker Scout report for the current `zuptalo/ring` tag at
the start of new work and applying any vulnerability that has a fix. **Not performed — this
environment has no Docker Hub access.** This is an open obligation on this branch, flagged to the
maintainer rather than silently skipped. It does not block the code work (client-only change, no Go
module or base-image surface), but it must be discharged before the release PR.

Per Governance, an unmet MUST belongs in the **spec's** *Complexity & Exceptions* section, not only
here — recorded there as **E-1**, still awaiting maintainer sign-off.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **XI. Ionic-First** — the voice placeholder is hand-rolled markup rather than a stock Ionic component | There is no Ionic primitive for a voice-message bubble. The placeholder must match the row metrics of its sibling `VoicePlayer` (`.vp`, ~34-38px flex row) or the bubble visibly resizes when the fetch lands — the exact scroll-anchor reflow spec 1011 was written to prevent. | *Stock `ion-item`/`ion-chip`*: wrong height and wrong semantics, causes the reflow. *Reuse the existing `.pending-chip`*: same reflow problem, and reads as a file rather than a voice message. *Render `VoicePlayer` with an empty `src`*: it owns playback state and registers with the global single-source player (`useAudioPlayer`), so a src-less instance risks a half-live entry in the global registry. Mitigation: the placeholder is composed from the **existing** `.dl-ring`/`.dl-btn` download vocabulary, uses `ion-icon`, and adds no new colour or spacing tokens — exactly as its hand-rolled sibling `VoicePlayer` does. |

## Project Structure

### Documentation (this feature)

```text
specs/2058-voice-messages-arrive/
├── spec.md                 # /speckit-specify + /speckit-clarify output
├── plan.md                 # this file
├── research.md             # Phase 0 — R1..R7 decisions
├── data-model.md           # Phase 1 — Message delta + state machine
├── quickstart.md           # Phase 1 — how to reproduce and verify
├── checklists/
│   ├── requirements.md     # spec quality gate (all green)
│   └── zero-knowledge.md   # Principle I gate
└── tasks.md                # /speckit-tasks output (NOT created here)
```

**No `contracts/`**: this feature exposes no external interface. It adds no endpoint, no wire field,
and no change to the sealed message payload — it is receive-side rendering plus a local recovery
trigger. The plan template calls for contracts only where such a surface exists.

### Source Code (repository root)

```text
src/
├── views/detail/
│   └── ChatDetailPage.vue      # (1) pending voice + round-note branches in the v-if chain
│                               # (2) recovery handler beside markVisibleSeen()
│                               # (3) honest failure in downloadPendingMedia's catch
│                               # (4) a dedicated sibling branch for pending round notes
│                               # NOTE: do NOT flip mediaBubble()/.bubble-media on for pending
│                               # voice — a resolved voice message is not a media bubble, so
│                               # toggling the class adds then removes padding = the reflow
│                               # this design exists to avoid
├── db/
│   ├── types.ts                # Message.dlFailedAt?  (one field; counter is in-memory)
│   └── queries.ts              # downloadLane = createLimiter(3); mark/clear failure;
│                               # route downloadMessageMedia + resumePendingMediaJobs through it
├── services/
│   └── testhook.ts             # seedPendingIncoming(); expose pending + dlFailedAt on messages()
└── utils/
    └── concurrency.ts          # reused as-is (createLimiter) — no change

e2e/
└── voice-pending.spec.ts       # NEW — the red regression test (US1/US2), then US3/US4 coverage
```

**Structure Decision**: no new module or directory. The bug is a missing branch in an existing
template chain and a missing recovery trigger next to an existing observer, so the change stays
inside the files that already own those concerns. `src/utils/concurrency.ts` is reused unmodified.

## Phase ordering (drives `/speckit-tasks`)

Constitution III is binding here, so the order is not negotiable:

1. **Test seam** — `testhook.seedPendingIncoming()` + `pending`/`dlFailedAt` on `messages()`.
   Without this the bug's state is unreachable from a test (research R7).
2. **RED** — `e2e/voice-pending.spec.ts` asserting a pending incoming voice bubble renders visible
   content. Must fail against the current tree for the right reason (empty bubble), and that
   failure must be observed and recorded before any fix lands.
3. **US1 + US2 (both P1)** — placeholder branch, then the local failure marking + limiter, then the
   on-view recovery. Turns the red test green.
4. **US3 (P3)** — round-note placeholder (same branch, one condition).
5. **US4 (P2)** — honest failure across all kinds, at the shared `catch`.
6. **Gates** — `npm run build`, vitest, the new e2e, then a real two-device pass against the dev
   stack for the reporter's exact scenario (SC-006), since the failure only reproduces with a real
   push to a closed app.

## Risks

- **The read-receipt observer is delicate.** Its callback is deliberately a cheap trigger with an
  authoritative geometry re-scan and several gates (`seenSettled`, `seeking`, page visibility). The
  recovery handler must sit *beside* `markVisibleSeen()`, not inside it, and `e2e/seen-on-view.spec.ts`
  must stay green as the proof.
- **Headless can't reproduce the real trigger.** The genuine path is a Web Push into a closed iOS
  PWA. The e2e seeds the resulting *state* instead, which is the right unit to test, but SC-006
  still requires a real-device confirmation before this is called done.
- **`v-memo` on the bubble row** — most likely a non-issue, but verify rather than assume. The list
  opens with `m.updatedAt` (`:154`), and the failure write bumps `updatedAt` the same way the
  success path already does (`queries.ts:2963`), so the row should repaint on its own. Only if the
  failure write is implemented *without* bumping `updatedAt` does `m.dlFailedAt` need adding to the
  list at `:159`.
