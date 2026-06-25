# Tasks: Stop background notifications showing a generic placeholder when there's nothing new

**Feature**: 2016-sw-no-spurious-generic

**Input**: [spec.md](./spec.md)

**Tests**: REQUIRED (TDD). Reproduce the spurious generic as a FAILING unit test first (all-seen and
no-frames wakes show no new placeholder), then implement to green. Adversarial safety review focused on
the iOS per-push notification contract.

## Phase 3: User Story 1 + 2 — only show the generic for a genuinely-new, unrenderable message (P1)

- [x] T001 Write FAILING unit tests (`src/services/sw-inbox.test.ts` and/or `src/sw` test): (a) a
  preview whose fetched frames are ALL already in the shown-ledger returns a result the caller treats
  as "nothing new" (no placeholder); (b) a `no-frames` preview is "nothing new"; (c) a fetched-but-
  undecryptable NEW frame is still "placeholder-worthy". Assert against the new discriminator.
- [x] T002 `src/services/sw-inbox.ts`: add a `newUnshown` (genuinely-new-unrendered) signal to the
  `previewPending` result — true when an UNSEEN msg frame was processed but produced no note
  (decrypt-failed) or the device was locked with pending>0; false for `no-frames` and all-seen.
  (FR-001/FR-002.)
- [x] T003 `src/sw.ts` `showMessageNotification`: show the generic ONLY when
  `timedOut || (notes.length === 0 && newUnshown)` and not suppressed/silenced. For a "nothing new"
  wake (no notes, not suppressed/silenced, not newUnshown, not timedOut), call a new
  `reassertForContract()` that re-shows an already-showing notification silently (renotify:false,
  silent:true) if `getNotifications()` is non-empty, else shows nothing. Badge still updates. Run T001
  → green. (FR-001/FR-002/FR-003/FR-004.)
- [x] T004 Verify the straggler loop and generic→content upgrade still behave: a late real note still
  shows once and still closes any earlier generic (no change needed beyond T003; add/keep a test).

## Phase 6: Polish

- [x] T005 Adversarial review: focus on the iOS userVisibleOnly per-push contract (does suppressing the
  generic on a "nothing new" wake risk an OS fallback / subscription revocation beyond what the existing
  `silenced` path already incurs?), plus badge accuracy and any path that now shows NO notification.
- [x] T006 Zero-knowledge confirmation: no plaintext leaves the device; SW still only fetches sealed
  ciphertext; no server change (FR-006).
- [ ] T007 Full gate: `npm run build`; `npx vitest run`; `cd server && go build/vet/test`;
  `RING_E2E_PORT=8085 npm run test:e2e` (notifications-inapp / sw-decrypt / calls — no regression).
- [ ] T008 Flip spec `Status:` to `in-review` at PR and run `make roadmap`.
