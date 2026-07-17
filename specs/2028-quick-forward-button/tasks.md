# Tasks: Quick-Forward Button Bottom Alignment (spec 2028)

**Input**: spec.md, plan.md. **Tests**: REQUIRED (bug band — failing regression test first, constitution III).

## Phase 1: User Story 1 - Button hugs the bottom of the message (P1)

- [X] T001 [US1] Write failing e2e regression `e2e/forward-button-position.spec.ts`: A sends B a portrait image; on B, assert the `.fwd-float` button's `getBoundingClientRect().bottom` is within 8 px of its `.bubble-col` sibling's bottom. Run `npm run test:e2e -- forward-button-position` and confirm FAIL (offset ≈ half the media height under `align-self: center`).
- [X] T002 [US1] Fix `src/views/detail/ChatDetailPage.vue` `.fwd-float` (~line 5155): `align-self: flex-end` + `margin-block-end: 2px`; update the rule's comment (why bottom-anchored). T001 goes green.
- [X] T003 [US1] Gates + evidence: `npm run build`, `npx vitest run`, the new e2e spec green; drive-harness screenshots (tall portrait + short file/link bubble) attached for the PR.

## Dependencies

T001 → T002 → T003 (strictly sequential; same feature, same files).
