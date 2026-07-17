# Research: Emoji contact photos + reset to their photo (spec 1054)

No NEEDS CLARIFICATION items remained after `/speckit-clarify`. This file
records the design decisions and the alternatives considered.

## D1 — Reuse the profile picture sheet pattern, not a new component

- **Decision**: Build the contact photo menu with `actionSheetController`
  inline in `ContactDetailPage.vue`, mirroring `ProfilePage.vue`'s `editPhoto`
  (same buttons, same icons, same `EmojiPickerModal` presentation:
  `emoji-picker-sheet` class, breakpoints `[0, 0.6, 0.95]`, initial `0.6`).
- **Rationale**: Principle XI (stock Ionic); the user explicitly asked for
  the profile-picture approach; two surfaces behaving identically is the
  feature.
- **Alternatives**: extracting a shared `useAvatarSheet` composable for both
  pages — rejected for now: the two flows diverge exactly where it matters
  (publish-own-profile + Remove vs. local-override + Reset), so the shared
  part is ~15 declarative lines; a premature abstraction would obscure the
  divergence.

## D2 — Emoji avatars must bypass `downscaleAvatar`

- **Decision**: store `emojiAvatar(emoji)` verbatim via
  `setContactLocalProfile`; only camera/library photos go through
  `downscaleAvatar`.
- **Rationale**: `downscaleAvatar` is a canvas JPEG re-encode; it would
  rasterize the SVG disc, strip the recoverable `data-emoji` attribute, and
  kill the animated upgrade (`emojiOfAvatar` returns null on a JPEG). The
  profile flow already stores the SVG verbatim, and `emojiAvatar` is
  deterministic and byte-stable by design.
- **Alternatives**: none viable.

## D3 — Photo-only reset is a new function, not a flag on `resetContactToRemote`

- **Decision**: add `resetContactAvatarToRemote(id, freshAvatar?)` next to
  `resetContactToRemote` in `queries.ts`.
- **Rationale**: the existing function reverts name AND avatar and drops the
  whole override; the sheet's reset must keep a custom name (FR-005). A
  boolean parameter (`resetContactToRemote(id, { avatarOnly: true })`) would
  make one function carry two distinct state machines (when to drop
  `localProfile`, what to do with `pendingName`); two small functions with
  clear comments match the file's existing style (`adoptContactProfile` /
  `dismissContactProfile` are similarly split).
- **`localProfile` bookkeeping**: after a photo-only reset the flag stays set
  iff the name is still overridden (`c.remoteName && c.name !== c.remoteName`);
  otherwise it's cleared so the "Reset to their name & photo" row (gated on
  `localProfile`) disappears when nothing is overridden anymore.
- **`pending*` bookkeeping**: `pendingName` is never touched (a staged name
  change stays answerable, per the spec's edge case). `pendingAvatar` is
  cleared only when the reset applied that exact value — the photo half of
  the prompt would otherwise offer a no-op adopt.

## D4 — Fresh copy comes from a photo-only directory re-pull

- **Decision**: `refetchContactAvatar(id)` in `services/directory.ts`:
  `fetchDirectoryUser(id)` → `resetContactAvatarToRemote(id, u.avatar)` when
  an avatar is present; errors swallowed.
- **Rationale**: mirrors the existing optimistic-revert-then-refetch pair
  (`resetContactToRemote` + `refetchContactProfile`), but the existing
  refetch force-applies the peer's NAME too (`updateContactProfile(…, true)`),
  which would clobber a kept name override — hence the photo-only variant.
  Offline behavior falls out naturally: the optimistic revert already
  happened from `remoteAvatar` (SC-004).
- **Alternatives**: parameterizing `updateContactProfile(force)` with a field
  mask — rejected; that function is the staging brain and is called from
  sync/ingest paths, so widening its contract for one caller risks the
  adopt/dismiss machinery.

## D5 — Reset entry visibility

- **Decision**: show "Reset to their photo" iff `contact.localProfile &&
  contact.remoteAvatar && contact.avatar !== contact.remoteAvatar`.
- **Rationale**: FR-004 — only when the user overrode the picture and a
  published target exists. Requiring `localProfile` keeps the entry away
  from the not-overridden case where `avatar` lags `remoteAvatar` merely
  because a remote change is STAGED (pending prompt) — reset must not become
  a hidden "adopt half the prompt" path.
- **Alternatives**: `avatar !== remoteAvatar` alone — rejected for the
  staged-change case above.

## D6 — Photo picking moves to the shared `pickImageFile`

- **Decision**: drop the page's hidden `<input type="file">` + FileReader in
  favour of `pickImageFile(capture)` + `fileToDataUrl`, exactly like the
  profile page.
- **Rationale**: gives contacts a true "Take photo" entry (capture attribute)
  and inherits the documented Android camera `change`-race handling; deletes
  code instead of adding it.
- **Alternatives**: keeping the hidden input for "Choose photo" — rejected;
  one picker path is easier to reason about and already proven on the
  profile page.

## D7 — e2e drives the real sheet; the emoji pick is event-injected

- **Decision**: the new e2e opens the contact page, taps "Change photo" →
  "Pick an emoji", then dispatches `emoji-click` (CustomEvent with
  `detail.unicode`) on the `emoji-picker` element; assertions use the
  existing `contactAvatarEmoji` / `setContactLocalProfile` test hooks; a new
  tiny `resetContactAvatar` hook mirrors the UI reset for the offline half.
- **Rationale**: `emoji-picker-element` renders in shadow DOM with a virtual
  grid — clicking a specific glyph is flaky; its public event contract
  (`emoji-click`) is exactly what `EmojiPickerModal` consumes, so injecting
  it exercises everything from the modal down. The profile-side e2e
  (`emoji-avatar.spec.ts`) set the precedent of hook-level emoji selection.
- **Alternatives**: shadow-DOM piercing selectors — rejected (visual-order
  and locale dependent, flake-prone in CI).
