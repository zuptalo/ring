# Tasks: Friends-only messaging with privacy, settings and help refinements

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Branch**: `feat/1026-friends-only-and-settings-refinements`

Retroactive spec: the implementation already exists on this branch. Tasks marked `[X]` are the
already-landed change for that slice; tasks left `[ ]` are the test backfill / verification needed so
every user story is proven green before the spec is "done" (Constitution III). No server tasks.

Vitest runs in a **node** environment (no DOM / `@vue/test-utils`), so component-level tests are done
by extracting pure decision helpers and testing those.

## GitHub issues (spec-1026 label)

Task → issue mapping (repo `zuptalo/ring`). The feature→`develop` PR MUST list every one as
`Closes #N`.

| Task | Issue | Task | Issue |
|------|-------|------|-------|
| T001 | #592 | T009 | #588 |
| T002 | #583 | T010 | #589 |
| T003 | #584 | T011 | #579 |
| T004 | #577 | T012 | #590 |
| T005 | #585 | T013 | #591 |
| T006 | #586 | T014 | #581 |
| T007 | #578 | T015 | #582 |
| T008 | #587 | T016 | #580 |

PR closing line:
`Closes #577, #578, #579, #580, #581, #582, #583, #584, #585, #586, #587, #588, #589, #590, #591, #592`

## Phase 1: Setup

- [X] T001 Create spec 1026 and pipeline artifacts (spec.md, clarify, plan.md, research.md, data-model.md, quickstart.md, checklists/requirements.md) under `specs/1026-friends-only-and-settings-refinements/`

## Phase 2: Foundational

_None — no shared prerequisites; each user story is an independent slice._

## Phase 3: User Story 1 — Direct messages come only from people you've connected with (P1) 🎯 MVP

**Goal**: Drop inbound 1:1 messages from non-connected senders on-device; keep calls unaffected.
**Independent test**: `npm run test:e2e -- friends-only` (stranger DM dropped until connected).

- [X] T002 [US1] Make the friends-only gate unconditional in `handleIncoming` (`src/db/queries.ts`): drop when the sender is neither `getContact(from)` nor `isPeerConnected(from)`; remove the old "open in-network inbox" auto-add path and update the stale comment.
- [X] T003 [US1] Rework the e2e spec from `e2e/block-unknown.spec.ts` → `e2e/friends-only.spec.ts`: assert a stranger's DM is dropped by default, is delivered after the recipient connects (`requestFriend`), and the dropped one stays gone.
- [X] T004 [US1] Verify the gate cannot break calls: confirm `call-*` frames route via `src/services/sync.ts` → `useCall.handleCallFrame` and use `src/services/call/signalling.ts::meshSessionChatId` (ephemeral `callsess:` session for non-contacts). Confirm existing group-call e2e still passes with a non-contact participant; record the finding in `research.md` (done) and quickstart.

## Phase 4: User Story 2 — A simpler Privacy screen (P2)

**Goal**: Remove the Advanced sub-page + redundant toggle; surface "Disable link previews" on Privacy.
**Independent test**: Privacy shows no Advanced / no Block-unknown; link-preview control present and it suppresses previews.

- [X] T005 [US2] In `src/settings/schema.ts`: delete the `privacy-advanced` node and its link; move the `privacy.disableLinkPreviews` toggle (with its footer) directly onto the `privacy` page.
- [X] T006 [US2] Remove `privacy.blockUnknown` from the synced-key allowlist in `src/services/ownsync.ts`.
- [X] T007 [US2] Cover FR-009 (link previews suppressed when the setting is on): add a vitest unit test for `firstLink` URL detection in `src/services/link-preview.test.ts`, and assert the gating decision (`firstLink(body) && !disableLinkPreviews`) — extract a tiny pure predicate if needed so it is testable in the node env. Document any part left to the quickstart/manual check.

## Phase 5: User Story 3 — Help that actually helps (P2)

**Goal**: Replace the near-empty Help screen with plain-language how-to guides; drop the duplicated version; keep the self-test.
**Independent test**: Help lists ≥8 how-to topics, each opens to readable text, no version shown, self-test reachable.

- [X] T008 [US3] In `src/settings/schema.ts`: rewrite the `help` node (remove the version stat, add a "How Ring works" group linking `help-*` how-to nodes, keep the Developer → self-test route) and add the `help-privacy`, `help-getting-started`, `help-contacts`, `help-chats`, `help-disappearing`, `help-hidden`, `help-calls`, `help-recovery` content nodes as `note` paragraphs.

## Phase 6: User Story 4 — Confirm before resetting auto-download (P3)

**Goal**: Require confirmation before restoring auto-download defaults.
**Independent test**: Reset prompts; cancel = no change; confirm = defaults restored.

- [X] T009 [US4] Add a `confirm` string to the `reset-autodownload` action in `src/settings/schema.ts` (the existing `runAction` confirm flow presents Cancel/Confirm).

## Phase 7: User Story 5 — Emoji always render (P3)

**Goal**: No persistent broken-image placeholder; fall back to the native glyph.
**Independent test**: An emoji with no asset renders the native glyph.

- [X] T010 [US5] Fix `src/components/Emoji.vue`: only advance to the FE0F-less retry when a variation selector is present; otherwise jump straight to the native-glyph fallback.
- [X] T011 [US5] Extract the fallback decision into a pure helper in `src/utils/emoji.ts` (e.g. `nextEmojiAttempt(emoji, attempt)` / `emojiUsesImage(...)`), use it from `Emoji.vue`, and add a vitest unit test in `src/utils/emoji.test.ts` covering: no-FE0F asset failure → native glyph (never stuck), and FE0F present → retry then native.

## Phase 8: User Story 6 — Settings captions get room to breathe (P3)

**Goal**: Multi-line captions/notes don't sit flush against the card's bottom edge.
**Independent test**: Visible spacing under a multi-line caption.

- [X] T012 [US6] Add a scoped style in `src/views/detail/SettingDetailPage.vue` giving `.group-footer` and `.group-note` a `--inner-padding-bottom`; tag the footer/note `ion-item`s with those classes.

## Phase 9: Polish & Cross-Cutting

- [X] T016 Add `src/settings/schema.test.ts` (node/vitest — the schema is a pure data tree) asserting the settings-structure FRs: `settingNode('privacy-advanced')` is undefined and no `privacy.blockUnknown` key exists anywhere in the tree (FR-006/FR-007); the `privacy` node exposes `privacy.disableLinkPreviews` directly (FR-008); the `help` node links ≥8 `help-*` nodes that all resolve and shows no version stat, and the self-test route is still present (FR-011/FR-012/FR-013); the `reset-autodownload` action carries a `confirm` string (FR-014); and assert `SYNCED_PREF_KEYS` in `src/services/ownsync.ts` does not include `privacy.blockUnknown` (FR-010).
- [X] T013 Point the CLAUDE.md current-plan reference (SPECKIT markers) at `specs/1026-friends-only-and-settings-refinements/plan.md`.
- [X] T014 Regenerate `ROADMAP.md` via `make roadmap`; confirm the 1026 row and its `in-review` status; ensure the CI "Roadmap up to date" guard would pass.
- [X] T015 Run the full gate and confirm green: `npm run build` (typecheck), `npm run test:unit` (445 pass), and `npm run test:e2e -- friends-only` (1 pass).
- [X] T017 [US6] Readable description colour (FR-017): add `--app-text-secondary` to `src/theme/variables.css` (light + dark) and apply it to `.group-note p` / `.group-footer ion-note` in `src/views/detail/SettingDetailPage.vue`.
- [X] T018 Copy-voice pass (FR-018): rewrite Help guides in Ring's plain voice, strip em-dashes and semicolons from Help and settings captions, fix copy that referenced removed features, and simplify the About header (`src/settings/schema.ts`, `src/views/detail/AboutPage.vue`).

## Dependencies & ordering

- T001 precedes everything (pipeline scaffolding).
- Within each user story, the `[X]` implementation task precedes its `[ ]` test/verify task.
- User stories US1–US6 are independent and can be delivered/tested in any order (MVP = US1 alone).
- Polish (T013–T015) runs after the story tasks.

## Parallel execution opportunities

- The test-backfill tasks touch different files and can run in parallel: `T007` (link-preview),
  `T011` (emoji helper), `T004` (call-path verification).
- The `[X]` implementation tasks already landed together but were independent edits across
  `queries.ts`, `schema.ts`, `ownsync.ts`, `Emoji.vue`, and `SettingDetailPage.vue`.

## Implementation strategy

MVP is **User Story 1** (friends-only messaging) — the headline behavior and the only slice with real
risk (must not break calls). The remaining stories are independent polish and can ship alongside or
separately. Remaining open work before "done": T004, T007, T011, T016, T014, T015 (test backfill,
settings-schema test, roadmap regen, and the full green gate).
