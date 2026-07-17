# Implementation Plan: Emoji contact photos + reset to their photo

**Branch**: `feat/1054-pick-emoji-contact` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1054-pick-emoji-contact/spec.md`

## Summary

`ContactDetailPage.vue` replaces its bare hidden `<input type="file">` with the
same action sheet the own-profile picture uses (`ProfilePage.vue` `editPhoto`):
Take photo / Choose photo / Pick an emoji / (conditionally) Reset to their photo
/ Cancel. Photos go through the shared robust picker (`pickImageFile`, which
handles the Android camera `change` race) and keep the `downscaleAvatar`
treatment; an emoji is stored verbatim as `emojiAvatar(emoji)` (byte-stable SVG
disc, never rasterized) via the existing `setContactLocalProfile` override path,
so `UserAvatar` renders and animates it everywhere automatically. Reset gets a
new photo-only revert in `queries.ts` (`resetContactAvatarToRemote`) plus a
photo-only directory re-pull in `services/directory.ts`
(`refetchContactAvatar`), leaving a local NAME override intact — unlike the
existing `resetContactToRemote`, which stays as-is behind the "Reset to their
name & photo" row. Client-only; no server, crypto, or schema changes.

## Technical Context

**Language/Version**: TypeScript 5 / Vue 3 `<script setup>` + Ionic 8 (client only)

**Primary Dependencies**: Existing app stack — `actionSheetController` +
`modalController` (stock Ionic), `EmojiPickerModal` (the `emoji-picker-element`
sheet the profile/Wall already use), `emojiAvatar`/`emojiOfAvatar`
(`src/db/avatars.ts`), `pickImageFile`/`fileToDataUrl`
(`src/utils/pick-image.ts`), `setContactLocalProfile`/`downscaleAvatar`
(`src/db/queries.ts`), `fetchDirectoryUser` (`src/services/directory.ts`).
No new dependencies.

**Storage**: Existing `contacts` object store, existing fields only
(`avatar`, `remoteAvatar`, `localProfile`). No new store, no `DB_VERSION` bump.

**Testing**: Playwright e2e (`e2e/contact-emoji-avatar.spec.ts`, red first):
emoji override applied via the real action sheet → verified with the existing
`contactAvatarEmoji` hook; photo-only reset preserves a custom name. The
emoji pick inside the shadow-DOM `emoji-picker` is driven by dispatching its
`emoji-click` CustomEvent (the modal's own listener). `npm run build`
(vue-tsc) as the typecheck gate.

**Target Platform**: Installable PWA, touch + desktop.

**Project Type**: Web app (client half of the monorepo; zero server changes).

**Performance Goals**: None beyond today — the sheet is created on demand;
avatar rendering paths are unchanged.

**Constraints**: Zero-knowledge unchanged (override never leaves the device;
reset reuses the existing directory profile GET). Emoji avatars MUST bypass
`downscaleAvatar` (canvas re-encode would rasterize the SVG and strip the
recoverable `data-emoji` marker). Photo-only reset MUST NOT disturb
`pendingName` (a staged name prompt stays answerable).

**Scale/Scope**: One page reworked (`ContactDetailPage.vue`), one new function
in `queries.ts`, one in `directory.ts`, one new e2e spec. ~150 lines.

## Constitution Check

*GATE: passed before Phase 0; re-checked after design.*

- **I. Zero-Knowledge Boundary** — PASS. Nothing new crosses the wire; the
  override is device-local; reset reuses the existing directory read. Spec
  carries the Zero-Knowledge Impact section.
- **II. Spec-Driven Development** — PASS. Spec 1054 (ad-hoc), this plan, tasks
  to follow; analyze before implement; issues before PR.
- **III. TDD** — PASS. New user-facing behavior gets a red-first e2e spec;
  tasks order it before the implementation. No unit-testable pure module is
  added (the two new functions are thin IndexedDB/service-layer orchestration,
  exercised end-to-end like the sibling `resetContactToRemote`).
- **IV. Crypto Discipline** — N/A (no crypto changes).
- **V. Offline-First Data Integrity** — PASS. Writes ride `put('contacts', …)`
  through the existing idb wrapper + change bus; no schema change. Reset is
  optimistic-local first, network second.
- **VI. Stateless Server** — N/A (server untouched).
- **VII. Quality Gates** — PASS. Build + vitest + e2e planned; release-note
  commit subject ("set an emoji as a contact's photo, and reset back to
  theirs").
- **X. Accessibility & i18n** — PASS. Stock action sheet buttons (labelled,
  focus-managed by Ionic); emoji disc renders through `UserAvatar`, which
  already carries `role="img"` + `aria-label`.
- **XI. Ionic-First UI** — PASS. Everything is stock: `ion-action-sheet` via
  `actionSheetController`, `ion-modal` via `modalController` + the existing
  `EmojiPickerModal`. No new components.

## Project Structure

### Documentation (this feature)

```text
specs/1054-pick-emoji-contact/
├── spec.md              # done
├── plan.md              # this file
├── research.md          # decisions & alternatives
├── data-model.md        # contact override fields + reset transitions
├── quickstart.md        # run/verify locally
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── db/
│   └── queries.ts                    # EXTEND: + resetContactAvatarToRemote(id, freshAvatar?)
├── services/
│   ├── directory.ts                  # EXTEND: + refetchContactAvatar(id) (photo-only re-pull)
│   └── testhook.ts                   # EXTEND: + resetContactAvatar(id) hook for e2e
└── views/detail/
    └── ContactDetailPage.vue         # REWORK: photo action sheet (take/choose/emoji/reset),
                                      #         pickImageFile replaces the hidden <input>
e2e/
└── contact-emoji-avatar.spec.ts      # NEW: emoji override via UI + photo-only reset keeps name
```

**Structure Decision**: mirror the existing pairing — the optimistic local
revert lives beside its siblings in `queries.ts`; the network refresh lives
beside `refetchContactProfile` in `directory.ts`; the page only orchestrates.
No new component: the sheet is `actionSheetController` data, per Principle XI.

## Design Decisions (full trail in research.md)

1. **Sheet composition**: same order as the profile sheet — Take photo, Choose
   photo, Pick an emoji, then "Reset to their photo" (non-destructive role,
   `refreshOutline` icon — reset restores something, unlike the profile's
   destructive Remove), then Cancel. Header: "Edit photo".
2. **Reset visibility**: only when there is actually something to undo AND a
   known target — `contact.localProfile && contact.remoteAvatar &&
   contact.avatar !== contact.remoteAvatar`. A name-only override does not
   show it; a contact who never published a picture does not show it (FR-004).
3. **Photo-only reset**: new `resetContactAvatarToRemote(id, freshAvatar?)` —
   applies `remoteAvatar` (or the passed fresher copy) to `avatar`, keeps
   `localProfile` when the NAME is still overridden (`name !== remoteName`),
   clears it otherwise, never touches `pendingName`; clears `pendingAvatar`
   only when the reset lands on that exact value (the staged photo half is
   then moot). Syncs the linked 1:1 chat row via `syncChatFromContact`.
4. **Fresh re-pull**: `refetchContactAvatar(id)` fetches the directory user
   and re-applies via `resetContactAvatarToRemote(id, u.avatar)`; network
   errors are swallowed (the optimistic revert already applied) — the same
   shape as `refetchContactProfile`, but it cannot clobber a local name.
5. **Emoji storage**: `setContactLocalProfile(id, { avatar: emojiAvatar(emoji) })`
   — stored verbatim, NEVER through `downscaleAvatar` (FR-007); `UserAvatar`
   recovers the emoji via `emojiOfAvatar` and animates it, so every surface
   (contacts list, chat list, chat header, calls) works with zero changes.
6. **Photo paths**: replace the hidden `<input>` + FileReader with
   `pickImageFile(capture)` + `fileToDataUrl` (shared, Android-camera-safe),
   then `downscaleAvatar` as today; failures keep the existing
   "Couldn't use that image." toast.

## Complexity Tracking

No violations; no bespoke UI; no new moving parts beyond the two thin
functions the reset semantics require.
