# Tasks: Coalesce burst notifications into one clean per-chat notification

**Feature**: 2017-sw-burst-coalesce

**Input**: [spec.md](./spec.md)

**Tests**: REQUIRED (TDD). Reproduce the duplicate / jumpy-count / stranded-generic logic as FAILING
unit tests against extracted pure helpers, then implement to green. Adversarial review on the new
cross-wake serialization + summary lifecycle (stale re-assert, ratchet/2015 untouched, iOS inference).

## Phase 3: User Story 1 + 2 — serialize, coalesce, re-assert, close-stranded (P1)

- [x] T001 Write FAILING unit tests for the new pure helpers (`src/services/sw-inbox.test.ts`):
  (a) per-chat count = true queued total from the backlog, not the per-pass unseen slice;
  (b) a coalesce/merge of a prior per-chat summary + the current pass → one note with monotonic count +
  latest body; (c) `isNothingNew` still classifies correctly (regression).
- [x] T002 `src/services/sw-inbox.ts`: derive a per-chat TOTAL-queued count from the fetched msg frames
  and carry it on `SwNote` (add `count?: number`); `aggregate` titles from `count ?? ids.length`
  (FR-002). Add bounded+TTL `swShownSummary` load/save helpers (mirror `SHOWN_KEY`/`SHOWN_TTL_MS`)
  (FR-003/FR-006).
- [x] T003 `src/sw.ts`: add a module-level serialize chain (`serializeNotify`) and wrap the
  fetch→decide→show→markShown body of `showMessageNotification` AND each straggler-loop iteration in it
  so overlapping wakes can't interleave (FR-001). Update the per-chat summary on every show.
- [x] T004 `src/sw.ts`: replace `reassertForContract` with `reassertFromSummary` — on a "nothing new"
  wake, re-show the recorded per-chat notification silently (renotify:false) when the summary has one,
  else show nothing (FR-004); and close a stranded generic when the summary/shown-ledger already covers
  the pending frames (FR-005). Keep `NON_MESSAGE_TAGS` exclusion + 2016 `newUnshown` gating intact.
- [x] T005 Summary lifecycle: do NOT re-assert a chat the page has drained/read — key the summary off
  the shown-ledger ids and prune on read; add a test that a drained chat isn't re-asserted (FR-006).

## Phase 6: Polish

- [x] T006 Adversarial review: cross-wake serialization correctness (deadlock/starvation/latency under
  a long burst), summary staleness (resurrecting a read chat), 2015 ratchet lock untouched, 2016
  `newUnshown` intact, and which iOS claims are inferred vs certain (flag for on-device validation).
- [x] T007 Zero-knowledge confirmation: no plaintext leaves the device; SW still only fetches sealed
  ciphertext; no server change; `swShownSummary` holds only already-decrypted-on-device previews
  (FR-008).
- [ ] T008 Full gate: `npm run build`; `npx vitest run`; `cd server && go build/vet/test`;
  `RING_E2E_PORT=8085 npm run test:e2e` (notifications-inapp / sw-decrypt / calls — no regression).
- [ ] T009 Flip spec `Status:` to `in-review` at PR and run `make roadmap`. On-device validation
  (burst test on the real iPhone PWA) is the acceptance gate for the iOS UX; iterate from there.
