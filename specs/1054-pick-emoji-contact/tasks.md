# Tasks: Emoji contact photos + reset to their photo

**Input**: Design documents from `specs/1054-pick-emoji-contact/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included — the constitution mandates TDD (red-first e2e for user-facing behavior).

**Organization**: Tasks are grouped by user story. US1 (emoji) is the MVP; US2 (reset) and US3 (photo paths) build on the same sheet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = pick an emoji, US2 = reset to their photo, US3 = take/choose photo via the sheet

## Phase 1: Setup

None — the feature reuses existing infrastructure (no scaffolding, no new stores, no dependencies).

## Phase 2: Foundational

None — all prerequisites (EmojiPickerModal, emojiAvatar, pickImageFile, setContactLocalProfile, test hooks `contactName`/`contactAvatarEmoji`/`setEmojiAvatar`) already exist.

---

## Phase 3: User Story 1 - Pick an emoji as a contact's picture (Priority: P1) 🎯 MVP

**Goal**: "Change photo" on the contact page opens an action sheet whose "Pick an emoji" entry sets an emoji disc as the contact's device-local picture, animated like emoji profile pictures.

**Independent Test**: e2e drives the real sheet → emoji applies; `contactAvatarEmoji` decodes it; visible across surfaces without reload.

- [X] T001 [US1] RED: new e2e `e2e/contact-emoji-avatar.spec.ts` — B sets an emoji profile picture (`setEmojiAvatar('😎')`) BEFORE pairing, then pair A/B, so A's FIRST-learned profile applies directly (`avatar` = `remoteAvatar` = 😎 disc; a post-pair publish would arrive STAGED and never reach `remoteAvatar`-as-displayed without an adopt); poll `contactAvatarEmoji(bId)` → `'😎'` as the baseline; on A, open Contacts → the contact's info page, tap "Change photo", assert the sheet lists "Take photo" / "Choose photo" / "Pick an emoji" (and NOT a reset entry yet), tap "Pick an emoji", dispatch `emoji-click` (CustomEvent, `detail: { unicode: '🐙' }`) on the `emoji-picker` element, then poll `__ringTest.contactAvatarEmoji(bId)` → `'🐙'`. Run it and confirm it FAILS (no sheet exists yet).
- [X] T002 [US1] Rework `src/views/detail/ContactDetailPage.vue`: replace the "Change photo" item's direct `photoInput?.click()` with an `editPhoto()` action sheet (`actionSheetController`, header "Edit photo") offering "Take photo" / "Choose photo" / "Pick an emoji" / "Cancel"; add `pickEmoji()` presenting `EmojiPickerModal` (cssClass `emoji-picker-sheet`, breakpoints `[0, 0.6, 0.95]`, initial `0.6`, exactly like ProfilePage) and on pick store `setContactLocalProfile(contactId, { avatar: emojiAvatar(data.emoji) })` — verbatim, NEVER through `downscaleAvatar`; dismissal without a pick changes nothing.
- [X] T003 [US1] GREEN: `npx playwright test e2e/contact-emoji-avatar.spec.ts` passes; `npm run build` typechecks.

**Checkpoint**: emoji contact pictures fully work; ship-able MVP.

---

## Phase 4: User Story 2 - Reset the picture to what the contact set (Priority: P2)

**Goal**: The sheet ends with "Reset to their photo" when (and only when) the photo is locally overridden and a published photo is known; it reverts the photo only, keeps a custom name, works offline optimistically, then re-pulls the current photo.

**Independent Test**: e2e overrides photo + name, resets via the real sheet → avatar decodes back to the contact's own emoji, `contactName` still returns the custom name, reset entry disappears afterwards.

- [X] T004 [US2] RED: extend `e2e/contact-emoji-avatar.spec.ts` — give the contact a custom name (`setContactLocalProfile(bId, 'Cap'\''n B')`) on top of the 🐙 override; reopen "Change photo", assert "Reset to their photo" is now listed, tap it; poll `contactAvatarEmoji(bId)` → `'😎'` (B's own) and `contactName(bId)` → still the custom name; reopen the sheet and assert the reset entry is gone. Confirm it FAILS.
- [X] T005 [P] [US2] Add `resetContactAvatarToRemote(id, freshAvatar?)` to `src/db/queries.ts` beside `resetContactToRemote`, per data-model.md: apply `freshAvatar` to `remoteAvatar` when passed; `avatar ← remoteAvatar`; clear `pendingAvatar` only if it equals the applied value; never touch `pendingName`; keep `localProfile` iff the name is still overridden (`remoteName && name !== remoteName`); bump `updatedAt`, `put`, `syncChatFromContact`. Carry a why-comment contrasting it with the both-fields reset.
- [X] T006 [P] [US2] Add `refetchContactAvatar(id)` to `src/services/directory.ts` beside `refetchContactProfile`: `fetchDirectoryUser` → `resetContactAvatarToRemote(id, u.avatar)` when an avatar came back; swallow network errors (optimistic revert already applied; must NOT clobber a kept name override).
- [X] T007 [US2] Wire the sheet in `src/views/detail/ContactDetailPage.vue`: computed `photoOverridden` (`contact.localProfile && contact.remoteAvatar && contact.avatar !== contact.remoteAvatar`); when true append "Reset to their photo" (icon `refreshOutline`, non-destructive) whose handler runs `resetContactAvatarToRemote(contactId)` then `refetchContactAvatar(contactId)`. The existing "Reset to their name & photo" row stays untouched.
- [X] T008 [US2] GREEN: the extended e2e passes; `npm run build` typechecks.

**Checkpoint**: US1 + US2 both verifiable through the real UI.

---

## Phase 5: User Story 3 - Take or choose a photo from the same menu (Priority: P3)

**Goal**: "Take photo" opens the camera directly, "Choose photo" the library/file picker; both keep the downscale treatment; the legacy hidden input is gone.

**Independent Test**: Choose a photo via the sheet on the dev stack (drive/ or by hand per quickstart.md) → the contact's picture updates; a broken image shows the existing error toast.

- [X] T009 [US3] In `src/views/detail/ContactDetailPage.vue`, add `pickPhoto(capture)` using `pickImageFile(capture)` + `fileToDataUrl` (from `@/utils/pick-image`) → `downscaleAvatar` → `setContactLocalProfile(contactId, { avatar })`, keeping the "Couldn't use that image." failure toast; wire it to "Take photo" (capture) and "Choose photo"; DELETE the hidden `<input ref="photoInput">`, `photoInput`, and `onPickPhoto`.
- [X] T010 [US3] Verify the photo path on the live dev stack (`make start` + `drive/`, or quickstart.md steps 1–3 by hand): choose an image file, confirm the avatar updates and the reset entry now appears. Screenshot for the PR. → `drive/scenarios/contact-emoji-1054.mjs` (committed); shots in `.tmp/drive/1054-*.png`. Surfaced + fixed a latent display bug: `UserAvatar` kept rendering the OLD emoji glyph when an emoji avatar changed in place (AnimatedEmoji needs `:key`).

**Checkpoint**: all three stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T011 Full gates: `npm run build`, `npm run test:unit` (vitest 1154/1154), and the contact/profile-related e2e specs (`contact-emoji-avatar`, `emoji-avatar`, `directory`, `contact-delete`, `curated-contacts` — 7/7) — all green.
- [X] T012 Walk quickstart.md end-to-end via the drive scenario (steps 1–6). The offline check (step 7) is left for the user's device pass: headless network-kill is flake-prone, and the offline guarantee is structural (the optimistic local revert commits before the network refetch is attempted; its failure is swallowed).
- [X] T013 Flip `specs/1054-pick-emoji-contact/spec.md` `**Status**:` to `in-progress` when implementation starts and `in-review` at PR time; run `make roadmap` and commit the regenerated `ROADMAP.md` with the same branch. → in-progress + roadmap regenerated; in-review flip owed at PR time.

---

## Dependencies & Execution Order

- **US1 (T001→T003)**: no dependencies; the MVP. T001 strictly before T002 (red first).
- **US2 (T004→T008)**: T004 first (red); T005/T006 in parallel (different files); T007 needs T005+T006 and the T002 sheet; T008 last.
- **US3 (T009→T010)**: T009 needs the T002 sheet; independent of US2.
- **Polish (T011→T013)**: after all stories.

### Parallel Opportunities

- T005 (`queries.ts`) ∥ T006 (`directory.ts`).
- US3's T009 can proceed in parallel with US2's T005/T006 once T002 lands (different concerns in the same file — coordinate the merge inside `ContactDetailPage.vue`).

## Implementation Strategy

MVP = Phase 3 alone (emoji picking, sheet in place). Each later phase is an
independently testable increment; stop-and-validate at every checkpoint. All
work stays client-side; a single feature branch and one PR into `develop` is
expected, with commits per task group.
