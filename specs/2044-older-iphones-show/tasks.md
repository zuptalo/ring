# Tasks: Legacy-iOS lite push path

**Feature**: `fix/2044-older-iphones-show` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

TDD-ordered (Principle III: failing tests precede implementation). Checked = done on
this branch; unchecked = the owed device/deploy verification.

## Phase 1: Setup

- [X] T001 Create hotfix spec + branch (`make spec CATEGORY=hotfix`), fill spec.md, `make roadmap`, bump `package.json` 1.0.5 → 1.0.6

## Phase 2: Foundational

- [X] T002 Failing tests in `src/services/sw-legacy.test.ts`: `iosMajorVersion`/`isLegacyIOS` UA truth table (legacy corpus true, modern corpus false, unparseable false) + `withTimeout` (resolve/hang/reject → fallback)
- [X] T003 Implement `iosMajorVersion`, `isLegacyIOS` (`LEGACY_IOS_MAX_MAJOR = 16`), `withTimeout` in `src/services/sw-inbox.ts`

## Phase 3: User Story 3 — last-resort generic can never hang (P1)

- [X] T004 [US3] Bound `showGeneric`'s `diagnostics.pushReasonText` read with `withTimeout(…, 300, false)` in `src/sw.ts` (all devices; fail toward plain body)

## Phase 4: User Story 1 — legacy devices always show + keep their subscription (P1)

- [X] T005 [US1] Add the `isLegacyIOS` branch in `dispatchPush` after the shared prologue in `src/sw.ts`
- [X] T006 [US1] Implement `dispatchLiteWake` in `src/sw.ts`: call → generic ring (no IDB dedup) + `ackCall`; conn/post/post-activity → nudges + quiet note; version → existing IDB-free show with quiet-note degrade; msg → unchanged page-claim arm, else `showGeneric` FIRST then bounded token read (3s) + bounded `fetchPendingFrames` (delivered receipts), no ack, no decrypt/ledger/settle/badge; `ctx` set at every terminal
- [ ] T007 [US1] Device pass: iPhone 8 backgrounded burst — every push shows the generic, senders get delivered ticks, subscription survives; prod watch shows `f88bf032` no longer accumulating stale frames or churning endpoints (SC-001/002/005)

## Phase 5: User Story 2 — modern isolation (P1)

- [X] T008 [US2] Modern-corpus isolation pin in `sw-legacy.test.ts` (iOS 17/26, Android, desktop, iPadOS-Macintosh, unparseable → all false)
- [ ] T009 [US2] iPhone 15 / 15 Pro regression pass after deploy: rich notifications unchanged

## Phase 6: Polish

- [X] T010 Gates: `npm run build` (typecheck+build), full vitest (1182 pass), `go build/vet` (server untouched)
- [X] T011 Spec artifacts: plan.md, tasks.md, checklists/zero-knowledge.md; roadmap regenerated

## GitHub issues (for the PR's `Closes #N`)

- **#1037** — implementation: lite path + detector + showGeneric hang fix (T002–T006, T008)
- **#1038** — verification: iPhone 8 burst + modern regression + prod watch (T007, T009)

## Dependencies

T002→T003→(T004 ∥ T005/T006); T007/T009 need the deploy; everything else is done.
