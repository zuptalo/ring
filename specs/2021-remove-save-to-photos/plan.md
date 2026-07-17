# Implementation Plan: spec 2021 (hotfix)

**Branch**: `fix/2021-remove-save-to-photos` | **Date**: 2026-07-04 | **Spec**: [spec.md](spec.md)

## Changes (removal only)

- Delete `src/services/media-autosave.ts` (the whole module; `<a download>` blob-click).
- `src/db/queries.ts`: drop the `autoSaveIncomingMedia` import and its fire-and-forget call
  in `receiveIncomingInner` (replaced by a comment explaining the platform limit).
- `src/settings/schema.ts`: remove the "Save to Photos" toggle group from the Chats screen.
- `src/services/ownsync-keys.ts`: drop `'chats.saveToPhotos'` from the synced-key list.

## Constitution check

- I: no wire change. III: no test referenced the feature (nothing to update); the change is
  a removal verified by build + device. XI/X: settings edit is a data change to schema.ts.

## Verification

- `npm run build` (typecheck), `npx vitest run`, settings + chat-media e2e green.
- Device: with a fresh build, receiving a photo shows no Safari/QuickLook breakout, and the
  Chats settings screen no longer lists "Save to Photos".
