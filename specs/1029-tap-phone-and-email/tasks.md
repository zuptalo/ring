# Tasks: Tap a Phone Number or Email in Messages & Posts

**Input**: Design documents from `/specs/1029-tap-phone-and-email/`

**Prerequisites**: plan.md, spec.md. Shares the `feat/1028-robust-audio-and` branch.

**Tests**: REQUIRED (constitution III). The pure detector is unit-first (the bulk of
correctness); the render/action integration gets a lean e2e. No crypto/ZK checklist
(this touches neither — no new wire data).

## Phase 1: The pure detector (core — unit-first)

- [x] T001 (#673) [P] Failing unit tests in `src/utils/linkify.test.ts`: `segmentContacts` over a large corpus — phone formats (plain, `+`, spaces, dashes, dots, parens), emails (plain, `a+b@x.com`, dotted local, multi-label domain), trailing-punctuation trimming, multiple entities in one string, an `@` inside an email not detected as a phone, and a NON-match corpus (order numbers, hashes, times like `12:30`, hex, long id strings) yielding ZERO false positives (SC-005); plus `telValue`/`telHref`/`smsHref`/`mailtoHref` normalization
- [x] T002 (#674) Implement `src/utils/linkify.ts` (EMAIL_RE, conservative PHONE_RE with a 7–15 digit bound, non-overlapping left-to-right segmentation, email-before-phone, href/normalizer helpers) until T001 is green

## Phase 2: Scheme open + action sheet

- [x] T003 (#675) [P] Add `openScheme(uri)` to `src/utils/external.ts` (transient anchor for `tel:`/`sms:`/`mailto:`, no `target=_blank`, graceful no-op if unhandled)
- [x] T004 (#676) Implement `src/services/entity-actions.ts` `presentEntityActions(seg)`: phone → Call/Message/Copy, email → Email/Copy, via `actionSheetController`; Copy = `navigator.clipboard.writeText(raw)` + `appToast('Copied')`

## Phase 3: User Story 1 & 2 — messages (P1)

- [x] T005 (#677) [US1] Failing Playwright e2e `e2e/tap-entities.spec.ts` (messages): a received message containing a phone number and an email renders TWO tappable entities; tapping the phone opens an action sheet with Call/Message/Copy; tapping the email opens Email/Copy; Copy places the exact value on the clipboard; assert the rendered `tel:`/`mailto:` targets are the normalized values
- [x] T006 (#678) [US1][US2] Extend `BodySeg` + `bodyParts` in `src/views/detail/ChatDetailPage.vue` to emit `email`/`phone` segments (URL → mention → contacts → emoji order) and render them as tappable spans → `presentEntityActions`

## Phase 4: User Story 1 & 2 — Wall posts (P1)

- [x] T007 (#679) [US1][US2] Add `segmentContacts` detection to `src/components/EmojiText.vue` (before emoji segmentation) so posts + comments render tappable phone/email → `presentEntityActions`; keep emoji-only rendering otherwise unchanged
- [ ] T008 (#680) [P] [US1][US2] Extend the e2e (or a drive scenario) to cover a Wall post body with a phone + email rendering tappable

## Phase 5: Polish & gates

- [x] T009 (#681) [P] Confirm coexistence (FR-005): a message with a URL, an `@mention`, a phone, and an email renders all four correctly (add to the unit corpus + the e2e)
- [x] T010 (#682) Full gates: `npm run build`, `npx vitest run`, `npm run test:e2e` (the tap-entities spec), and confirm existing message/emoji unit tests stay green
- [x] T011 (#683) Bump spec `**Status**:` to `in-review` + `make roadmap`

## Dependencies
Phase 1 (detector) → Phase 2 (actions) → Phases 3/4 (integration) → Phase 5. T005/T008 e2e are written before their integration lands. MVP is Phases 1–3 (messages); posts (Phase 4) layer on the same detector.
