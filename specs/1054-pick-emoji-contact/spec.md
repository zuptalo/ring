# Feature Specification: Emoji contact photos + reset to their photo

**Feature Branch**: `feat/1054-pick-emoji-contact`

**Created**: 2026-07-15

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Let's make it possible to set emoji for your contacts as well; right now it is only possible to take a photo or choose from library or pick a file. Prefer the profile-picture approach (Take photo / Choose photo / Pick an emoji), but instead of Remove the option should be Reset to what the contact has set for themselves."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick an emoji as a contact's picture (Priority: P1)

From a contact's info page, the user taps "Change photo" and — alongside taking
or choosing a photo — can now pick an emoji. The chosen emoji becomes that
contact's picture on this device: a colored disc with the emoji, exactly like an
emoji profile picture, animated on surfaces that support animation.

**Why this priority**: This is the feature being asked for — parity with the own-profile
picture flow so a contact can be personalized without hunting for a photo.

**Independent Test**: Open a contact's info page, choose "Change photo" → "Pick an
emoji", select an emoji, and confirm the contact now shows that emoji disc on the
contact page, the contacts list, the chat list, and the chat header.

**Acceptance Scenarios**:

1. **Given** a contact info page, **When** the user taps "Change photo", **Then** a menu appears with "Take photo", "Choose photo", "Pick an emoji", and "Cancel".
2. **Given** the picture menu, **When** the user picks an emoji, **Then** the contact's picture becomes that emoji on a colored disc everywhere the contact appears on this device.
3. **Given** an emoji was set for a contact, **When** the contact appears on a surface that animates emoji pictures, **Then** the emoji animates the same way emoji profile pictures do.
4. **Given** the emoji picker is open, **When** the user dismisses it without choosing, **Then** the contact's picture is unchanged.

---

### User Story 2 - Reset the picture to what the contact set (Priority: P2)

When the user has personalized a contact's picture (photo or emoji), the picture
menu offers "Reset to their photo" in place of the profile flow's "Remove photo".
Choosing it reverts only the picture back to whatever the contact has published
for themselves, while keeping any custom name the user gave the contact.

**Why this priority**: Personalization needs an undo. A contact picture, unlike an own
profile picture, always has a natural fallback — what the contact chose — so reset,
not remove, is the right verb.

**Independent Test**: Override a contact's photo with an emoji, also give them a
custom name, then use "Reset to their photo" and confirm the picture reverts to the
contact's own while the custom name stays.

**Acceptance Scenarios**:

1. **Given** a contact whose picture the user has changed, **When** the picture menu opens, **Then** it includes "Reset to their photo".
2. **Given** a contact whose picture the user has NOT changed, **When** the picture menu opens, **Then** no reset entry is shown.
3. **Given** a contact with both a custom name and a custom picture, **When** the user resets the photo from the picture menu, **Then** the picture reverts to the contact's own and the custom name is untouched.
4. **Given** the device is offline, **When** the user resets the photo, **Then** the picture immediately reverts to the last-known picture the contact published, and it refreshes to their current one when the device is next online.
5. **Given** the existing "Reset to their name & photo" row, **When** the user taps it, **Then** it still resets both, unchanged by this feature.

---

### User Story 3 - Take or choose a photo from the same menu (Priority: P3)

The existing photo paths move into the same menu: "Take photo" opens the camera
directly, "Choose photo" opens the library/file picker. Both behave as photo
overrides do today.

**Why this priority**: Pure parity/polish — the capability already exists via the OS
picker; the menu just makes camera capture explicit and the flow consistent with the
profile page.

**Independent Test**: Use "Choose photo" to select an image and confirm the contact's
picture updates; use "Take photo" on a device with a camera and confirm the captured
photo is applied.

**Acceptance Scenarios**:

1. **Given** the picture menu, **When** the user takes or chooses a photo, **Then** it becomes the contact's picture on this device, with the same size treatment photos get today.

---

### Edge Cases

- The contact has never published a picture: if nothing is known to reset to, the reset entry is not offered.
- The contact changed their own picture while the user had an override, creating a staged "They updated their profile" prompt: resetting the photo must not silently answer that prompt for their name; the name part of the prompt (if any) remains available.
- An emoji picture must never be degraded into a static, blurry image by the photo size treatment — it stays crisp and animatable.
- Setting a new picture (photo or emoji) replaces any previous override; there is at most one override at a time.
- A contact whose account no longer exists ("ghosted") shows no editing entries at all — unchanged by this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The contact info page MUST present a single picture menu with "Take photo", "Choose photo", "Pick an emoji", a reset entry when applicable, and "Cancel".
- **FR-002**: Users MUST be able to set any emoji as a contact's picture; it renders as the same colored-disc emoji picture used for profile pictures, animated on capable surfaces.
- **FR-003**: A contact picture set by the user (photo or emoji) MUST apply everywhere the contact's picture appears on this device (contact page, contacts list, chat list, chat header, calls).
- **FR-004**: The picture menu MUST offer "Reset to their photo" only when the user has overridden the picture and a picture published by the contact is known.
- **FR-005**: Resetting from the picture menu MUST revert only the picture; a custom contact name set by the user MUST be preserved.
- **FR-006**: Reset MUST work offline by reverting to the last-known picture the contact published, then refresh to the contact's current picture when the network allows.
- **FR-007**: Photos taken or chosen MUST keep today's size treatment; an emoji picture MUST be stored without that treatment so it stays crisp and animatable.
- **FR-008**: All contact-picture personalization MUST remain on this device only; nothing new is sent to the server or to the contact (zero-knowledge unchanged).
- **FR-009**: The existing "Reset to their name & photo" row MUST keep its current behavior (resets both name and picture).

### Key Entities

- **Contact picture override**: the user's device-local choice of picture for a contact (photo or emoji disc); at most one per contact; independent of the contact's own published picture.
- **Contact's published picture**: the picture the contact chose for themselves, as last learned from their profile; the target of "Reset to their photo".

## Zero-Knowledge Impact

- **What crosses the wire**: nothing new. Setting a photo or emoji for a contact is a device-local override that is never uploaded. Resetting re-uses the existing directory profile fetch (the same one contact profiles already use) to read the contact's current published picture.
- **What is encrypted**: unchanged. The override lives only in the device's local database.
- **What metadata is unavoidably visible**: at most one already-existing directory profile lookup for the contact when the user resets; the server cannot tell it apart from the routine profile refreshes the app already performs, and it learns nothing about the override (not even that one existed).
- **Why**: the reset target is "what the contact currently publishes", so the freshest copy comes from the same directory read the app already performs; no new server capability or data is involved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a contact's info page, a user can set an emoji as the contact's picture in 4 taps or fewer.
- **SC-002**: After picking an emoji, the contact's new picture is visible on every surface listing that contact without reloading the app.
- **SC-003**: After "Reset to their photo", the contact's picture matches what the contact published, and a custom contact name survives the reset in 100% of cases.
- **SC-004**: Resetting while offline still visibly reverts the picture immediately (to the last-known published one).

## Assumptions

- This personalization is device-local by design (it does not sync to the user's other devices), matching how custom contact names behave today.
- Group pictures and the own-profile picture flow are out of scope; the profile page keeps "Remove photo" since one's own picture has no third-party fallback.
- "Remove photo" (falling back to a generated initials picture) is intentionally not offered for contacts; reset-to-theirs replaces it, per the request.
- The emoji picker used for profile pictures is reused as-is (same emoji set, same presentation).
