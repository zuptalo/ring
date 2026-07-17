---
description: "Task list for spec 2013 — mirror the resume countdown for the swapper"
---

# Tasks: Mirror the resume countdown for the swapper

**Input**: [spec.md](./spec.md)

**Tests**: e2e (call-waiting resume path) — the mirror countdown is a small client-only UI addition.

## Phase 3: User Story 1 — the swapper sees the peer's video resuming (P1)

- [x] T001 [US1] Add `peerResumeCountdown` ref + `beginPeerResumeCountdown(kind)` /
  `cancelPeerResumeCountdown()` in `src/composables/useCall.ts` (5s, video-only); start it at the two
  resume-send sites (resume-from-hold + swap), clear on teardown / re-held (FR-001..FR-004).
- [x] T002 [US1] Show the mirror countdown in `src/views/detail/CallActivePage.vue`
  ("{name}’s video resuming…") as a sibling of the existing resume-countdown; expose
  `peerResumeCountdown` via the test hook.
- [x] T003 [US1] e2e (`e2e/call-waiting.spec.ts`): the swapper (A) sees the mirror countdown on a
  VIDEO resume and none on an AUDIO resume; the resumed party (B) keeps its own countdown (SC-001/002).

## Phase 6: Polish

- [x] T004 Build + unit + targeted e2e green; client-only, no server change, ZK unchanged (FR-005).
- [x] T005 Flip spec `Status:` to `in-review` at PR and run `make roadmap`.
