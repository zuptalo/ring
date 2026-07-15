# Data Model: Emoji contact photos + reset to their photo (spec 1054)

No schema change: no new object store, no new fields, no `DB_VERSION` bump.
The feature is entirely a new set of transitions over the existing `Contact`
profile-override fields (`src/db/types.ts`).

## Existing fields involved (Contact, `contacts` store)

| Field | Meaning |
|---|---|
| `name` / `avatar` | DISPLAYED values (a local override or the last-adopted remote) |
| `remoteName` / `remoteAvatar` | latest profile the peer published (change detection + adopt/reset source) |
| `pendingName` / `pendingAvatar` | staged remote change awaiting the adopt/dismiss prompt |
| `localProfile` | true when the user set their own name and/or photo override |

An emoji picture is not a new kind of value: it is an ordinary `avatar` string
that happens to be `emojiAvatar(emoji)`'s SVG data URL (with the recoverable
`data-emoji` marker `UserAvatar` uses to animate). It must be stored verbatim
(never through `downscaleAvatar`).

## Transitions

### Set photo/emoji override (existing `setContactLocalProfile`)

```
avatar ← downscaleAvatar(picked photo)   |  emojiAvatar(picked emoji)
localProfile ← true
(chat row mirrored via syncChatFromContact)
```

At most one override exists: each set replaces `avatar` wholesale.

### NEW: photo-only reset (`resetContactAvatarToRemote(id, freshAvatar?)`)

Preconditions (also the sheet-entry visibility rule): `localProfile` set,
`remoteAvatar` known, `avatar !== remoteAvatar`.

```
remoteAvatar ← freshAvatar            (only when a fresher copy is passed in)
avatar       ← remoteAvatar
pendingAvatar: cleared IFF it equals the value just applied (moot half-prompt);
pendingName:   NEVER touched
localProfile ← (remoteName exists AND name !== remoteName)   // name still overridden?
updatedAt    ← now; chat row mirrored via syncChatFromContact
```

Invariants:

- A custom `name` survives unchanged (FR-005).
- A staged NAME change remains adoptable/dismissable afterwards.
- When `localProfile` clears, the "Reset to their name & photo" row (gated on
  it) disappears — consistent, since nothing is overridden anymore.

### NEW: photo-only refresh (`refetchContactAvatar(id)`, directory service)

```
u ← fetchDirectoryUser(id)        (network; failure → keep optimistic state)
u.avatar present → resetContactAvatarToRemote(id, u.avatar)
```

Offline: the caller already applied the optimistic revert from the last-known
`remoteAvatar`; the refresh silently no-ops (SC-004).

### Unchanged neighbours (for contrast)

- `resetContactToRemote(id)`: reverts BOTH name and avatar, drops
  `localProfile` and both `pending*` — stays behind "Reset to their name &
  photo" (FR-009).
- `updateContactProfile` / `adoptContactProfile` / `dismissContactProfile`:
  untouched; the staging state machine is not widened.
