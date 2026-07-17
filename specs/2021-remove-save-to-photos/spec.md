# Feature Specification: Remove the "Save to Photos" chat setting

**Feature Branch**: `fix/2021-remove-save-to-photos`

**Created**: 2026-07-04

**Status**: shipped

**Input**: Bug report (iOS installed PWA): with "Save to Photos" on, every incoming photo/video
popped a Safari/QuickLook preview ("Open in…", Done, Refresh, Back, Share, compass) that broke
the app out of standalone mode, instead of silently saving to the camera roll.

## Why remove it

Ring is a pure installable PWA — no Capacitor, no native shell (no `ios/`/`android/`, zero
`@capacitor/*` deps). There is NO web API that silently writes to the iOS Photos library:
- File System Access (`showSaveFilePicker`) is unsupported on iOS Safari.
- The Web Share API can reach Photos only via the share sheet AND only under a user gesture —
  it can never fire automatically on message arrival.
- The old implementation used an `<a download>` blob-click (`media-autosave.ts`), which on a
  standalone iOS PWA is handed to QuickLook — the reported breakout — and can't reach Photos.

The feature's premise is unachievable on this platform; the module's own header already
noted it is "effectively a no-op" on iOS. Saving media stays available as a MANUAL,
gesture-triggered share from the media viewer (`services/media-save.ts`), so nothing is lost.

## Requirements

- **FR-001**: The "Save to Photos" toggle is removed from Chats settings.
- **FR-002**: Incoming media is never auto-handed to the OS (no download/share on arrival);
  an incoming photo/video causes no app breakout.
- **FR-003**: Manual save from the media viewer is unchanged.
- **FR-004**: The removed preference key is dropped from the cross-device settings sync set;
  a stale stored value is simply ignored (harmless).

## Success Criteria

- **SC-001**: No "Save to Photos" row in Settings → Chats.
- **SC-002**: Receiving a photo/video on the iOS PWA shows it in the chat with no Safari/
  QuickLook popup — device-verified.
- **SC-003**: Build + existing suites stay green (no test referenced the removed feature).

## Zero-Knowledge Impact *(constitution Principle I)*

None — removes a client-only, device-local behavior; nothing crosses the wire.

## Assumptions

- Full removal (not a hidden no-op toggle): a control that can never work is worse UX than
  its absence. The manual viewer save covers the real need.
- No migration needed for the dropped `chats.saveToPhotos` value; own-data sync ignores
  keys not in its allow-list.
