# Implementation Plan: Expanding "Jump to Latest" Pill + Visibility-Driven Seen Receipts

**Branch**: `feat/1013-jump-pill-seen-receipts` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1013-jump-pill-seen-receipts/spec.md`

## Summary

Evolve the spec-1012 scroll-to-latest control into an **expanding pill** (circle at rest →
stadium with the count inline when behind, shrinking back to a circle when caught up) and change
**when** "Seen" receipts are sent: a message reports Seen only when it is **≥50% on screen while
the chat is foregrounded** (not on chat-open), with a uniform **catch-up** (viewing a message
reports Seen for it and all older not-yet-Seen incoming). The per-message reported state is
**persisted locally** (`Message.seenReportedAt`), the chat **opens at the first not-yet-Seen
message**, and the pill counts **incoming messages not yet reported Seen**. The technical
approach reuses spec-1010's receipt path/envelope/privacy toggle and spec-1011/1012's bounded
scroll + pure `unreadSince` logic; the new mechanism is a second `IntersectionObserver`
(`threshold: 0.5`) over the bounded message list. **Client-only**; the wire and server are
unchanged (a net privacy improvement).

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>` + Ionic 8; Node 22 toolchain.
**Primary Dependencies**: Ionic Vue (`ion-fab`/`ion-fab-button`/`ion-icon`), the project's
IndexedDB wrapper (`src/db/idb.ts`), `useChatHistory` (spec 1011), `chat-unread.ts` (spec 1012),
`useSync.ts` + `transport.ts` receipt path (spec 1010). No new runtime dependency.
**Storage**: IndexedDB only — one new optional field `Message.seenReportedAt`; `DB_VERSION` 6 → 7
with a forward, data-preserving migration. No server/SQL/Postgres change.
**Testing**: vitest (pure helpers in `chat-unread.ts`; `migrateMessageToV7` in
`idb.migration.test.ts`); Playwright e2e (`e2e/seen-on-view.spec.ts`) for the cross-account
visibility behavior + the pill; manual `quickstart.md` for fade/feel and a real-device check.
**Target Platform**: Installable PWA (mobile-first, iOS Safari + Android Chromium; desktop PWA).
**Project Type**: Single client app in repo root (`src/`); Go server untouched.
**Performance Goals**: 60fps pill animation; visibility observation adds no per-scroll-event cost
beyond the existing handler; observer targets bounded by `useChatHistory` `MAX_ROWS`.
**Constraints**: Preserve spec-1011 scroll momentum (no scrollTop writes except the momentum-safe
open seek); zero-knowledge boundary unchanged; offline-first (local persistence, retry on
reconnect); LTR/RTL + light/dark; Ionic-first.
**Scale/Scope**: One view (`ChatDetailPage.vue`), one composable (`useSync.ts`), one pure util
(`chat-unread.ts`), one type (`db/types.ts`), one migration (`db/idb.ts`). No new screen.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1 design.*

| Principle | Verdict | How this plan satisfies it |
|---|---|---|
| **I. Zero-Knowledge (NON-NEGOTIABLE)** | ✅ Pass | Only receipt *timing* changes; same sealed `receipt` envelope, no new wire fields/metadata. `seenReportedAt` is client-local, never sent. Spec now has a **Zero-Knowledge Impact** section. `/speckit-checklist` (ZK) REQUIRED before implement. |
| **II. Spec-Driven** | ✅ Pass | specify → clarify → **plan** (here) → tasks → analyze → checklist → taskstoissues → implement; spec id 1013 on every artifact/branch. |
| **III. TDD** | ✅ Pass | Pure `seenFrontier` + not-yet-Seen count → vitest (ratchet `chat-unread.ts` coverage); `migrateMessageToV7` → `idb.migration.test.ts`; new user-facing behavior → `e2e/seen-on-view.spec.ts`. Tests authored before implementation in tasks. |
| **IV. Crypto Discipline** | ✅ N/A | No crypto change; receipts already encrypted/relayed by spec 1010. `messaging.ts` untouched. |
| **V. Offline-First Data Integrity** | ✅ Pass | New field ⇒ `DB_VERSION` 6→7 + forward `onupgradeneeded` migration preserving data (`migrateMessageToV7`, pure, never throws). Reads stay reactive via the idb change bus. |
| **VI. Stateless Server / Migrations** | ✅ N/A | No server or SQL change. |
| **VII. Quality Gates** | ✅ Pass | DoD = build + vitest(+floors) + go build/vet/test (unchanged) + e2e green; Conventional Commits; PWA stays `registerType:'prompt'`. |
| **VIII. Traceable Delivery** | ✅ Pass | ROADMAP row added; tasks → issues; PR lists `Closes #N`. |
| **IX. Privacy & Data Minimization** | ✅ Pass (net improvement) | Sends strictly *less* (only viewed messages); no telemetry; local-only flag. |
| **X. Accessibility & i18n** | ✅ Pass | Pill labeled with the count; logical CSS for RTL; light/dark via existing tokens; touch target preserved. |
| **XI. Ionic-First UI** | ✅ Pass | Pill is the existing `ion-fab-button` with inline content + a CSS transition; no bespoke widget; existing theme tokens reused. |

**Initial gate (pre-Phase 0)**: PASS, with one action — add the Zero-Knowledge Impact section to
the spec (**done** during this plan).
**Post-design gate (after Phase 1)**: PASS — no new violations; the only persisted change is the
field + forward migration (Principle V), and the wire is untouched (Principle I).

No entries in *Complexity & Exceptions* — nothing requires a waiver.

## Project Structure

### Documentation (this feature)

```text
specs/1013-jump-pill-seen-receipts/
├── spec.md           # /speckit-specify + /speckit-clarify (done)
├── plan.md           # this file
├── research.md       # Phase 0 (done) — decisions D1–D7
├── data-model.md     # Phase 1 (done) — Message.seenReportedAt + migration + derived state
├── contracts/
│   └── seen-and-pill.md   # Phase 1 (done) — wire (unchanged) + pure API + behavior contract
├── quickstart.md     # Phase 1 (done) — manual smoke
├── checklists/
│   ├── requirements.md    # spec quality (done)
│   └── zero-knowledge.md  # to be added by /speckit-checklist (REQUIRED, Principle I)
└── tasks.md          # /speckit-tasks (next)
```

### Source code (repository root) — files this feature touches

```text
src/
├── db/
│   ├── types.ts             # + Message.seenReportedAt?: number
│   ├── idb.ts               # DB_VERSION 6→7; migrateMessageToV7 (pure) + onupgradeneeded wiring
│   └── idb.migration.test.ts# + migrateMessageToV7 unit test
├── utils/
│   ├── chat-unread.ts       # + seenFrontier(messages, selfId) (pure); reuse unreadSince
│   └── chat-unread.test.ts  # + seenFrontier tests (+ not-yet-Seen count composition)
├── composables/
│   └── useSync.ts           # per-message Seen send + catch-up; persist via seenReportedAt;
│                            #   remove on-open bulk trigger; keep envelope/gate/addressing
└── views/detail/
    └── ChatDetailPage.vue   # expanding pill (remove corner badge); bubbleVisObs (≥50%);
                             #   reportSeenAndOlder; open-at-first-unseen; unseenCount/firstUnseenId

e2e/
└── seen-on-view.spec.ts     # NEW — visibility-driven Seen + catch-up + pill (cross-account)
```

Server (`server/`) untouched.

## Phase plan (for /speckit-tasks)

1. **Setup/baseline** — capture green gates; `chat-unread.ts` already gated in vitest coverage.
2. **Data layer (foundational, blocks the rest)** — `Message.seenReportedAt`; `DB_VERSION` 6→7 +
   `migrateMessageToV7` (failing `idb.migration.test.ts` first).
3. **Pure logic** — `seenFrontier` (failing vitest first); not-yet-Seen count composition.
4. **US1 — expanding pill** — replace the corner badge with the inline-count pill + animation,
   driven by `unseenCount`; keep spec-1012 fade/theme/RTL/a11y. (e2e: pill grows/shrinks.)
5. **US2 — visibility-driven Seen** — `bubbleVisObs` (≥50%, foreground-gated); `reportSeenAndOlder`
   persists `seenReportedAt` + sends via the unchanged path; remove on-open bulk calls.
   (e2e: off-screen not Seen; view → Seen; toggle off → none.)
6. **US3 — catch-up + open-at-first-unseen** — uniform older catch-up; `seekTo` first not-yet-Seen
   on open. (e2e: view partway → it + older Seen; reopen → no dup; persistence survives reload.)
7. **Polish** — spec-1011 no-regression (momentum/no-yank), fling send-batching, a11y/i18n,
   real-device feel, DoD gate.

## Complexity & Exceptions

None. Every change is the simplest zero-knowledge-preserving option: reuse the existing receipt
path and pure scroll logic, add exactly one persisted field with a forward migration, and add one
bounded `IntersectionObserver`. No new dependency, server capability, or wire surface.

## Phase 1 agent-context update

`CLAUDE.md` SPECKIT plan pointer updated to `specs/1013-jump-pill-seen-receipts/plan.md`.
