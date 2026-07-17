# Feature Specification: Friends-only messaging with privacy, settings and help refinements

**Feature Branch**: `feat/1026-friends-only-and-settings-refinements`

**Created**: 2026-07-02

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: a batch of privacy, settings, help, and rendering refinements found
during real-device use — headlined by making direct messaging friends-only, plus a simpler Privacy
screen, real in-app Help guides, a confirmation before resetting auto-download, a reliable emoji
fallback, and roomier settings captions.

## Overview

Ring previously ran an "open in-network inbox": because the network is invitation-only, any member
could message any other member, and a stranger's first message was accepted and auto-added. Feedback
from real use showed people expect direct messages to come only from those they've chosen to connect
with. This batch makes **direct messaging friends-only by default** and folds the old, redundant
"Block unknown account messages" toggle into that default. Alongside the messaging change, it clears
several rough edges surfaced in the same pass: a simpler Privacy screen, a genuinely useful Help
section, a guard on a destructive-feeling reset, an emoji that always renders, and captions that
don't crowd their card edge.

Each item is an independent slice: any one can be built, tested, and shipped on its own. All changes
stay within Ring's zero-knowledge boundary — the server keeps relaying only sealed ciphertext and
content-free tickles, and there are **no server changes**. The friends-only gate is enforced entirely
on the recipient's device.

## Clarifications

### Session 2026-07-02

Resolved from the shipped implementation (retroactive spec):

- Q: Does the friends-only gate apply to group messages too, or only 1:1 direct messages? → A: Only 1:1 direct messages. Group messaging is governed by group membership and is unaffected; the gate lives on the direct-message receive path only.
- Q: What happens to users who had "Block unknown account messages" turned on/off before this change? → A: The setting and its key are removed. Because friends-only is now the always-on default, users who had it ON keep identical behavior; users who had it OFF now get friends-only (the intended change). No migration step is required.
- Q: When an unknown sender's message is dropped, is it deferred or discarded? → A: Discarded — it is acknowledged to the relay so it is not redelivered (see FR-002); it does not reappear if the recipient later connects.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Direct messages come only from people you've connected with (Priority: P1)

A member of the network who is not in the user's contacts and has not been accepted as a connection
tries to send the user a direct message. The user never sees it — the message is dropped on their
device on arrival, not merely hidden. To reach the user, that person must first connect through the
existing request/invite flow; once the user has connected with them, their messages are delivered
normally. Crucially, this must **not** interfere with calls: the user can add someone who is not a
mutual contact to a (group) call and the call still connects for everyone.

**Why this priority**: This is the headline behavior change and a privacy expectation. It also
carries the sharpest risk of collateral damage (breaking call setup between non-mutual-contact
participants), so it must be both correct and provably scoped to messaging only.

**Independent Test**: With two accounts where the recipient has never connected with the sender, send
a direct message and confirm it never appears for the recipient; then connect and confirm a new
message arrives. Separately, start a group call including a non-contact participant and confirm the
call connects.

**Acceptance Scenarios**:

1. **Given** the sender is neither a contact nor an accepted connection of the recipient, **When** the sender sends a direct message, **Then** the recipient never sees or stores it.
2. **Given** a message was dropped because the sender was unknown, **When** time passes and the connection state is unchanged, **Then** the message stays gone (it was dropped, not deferred for later delivery).
3. **Given** the recipient then connects with the sender, **When** the sender sends a new message, **Then** the recipient receives it.
4. **Given** a sender who is an accepted connection, **When** they send a message, **Then** it is delivered even if their contact card has not arrived yet.
5. **Given** the user invites someone into a group call who is not their contact (and not a contact of the other participants), **When** the call is placed, **Then** all legs connect and media flows.
6. **Given** any user, **When** someone wants to reach them for the first time, **Then** a connection request still reaches them (requests travel outside the direct-message path).

---

### User Story 2 - A simpler Privacy screen (Priority: P2)

The user opens Privacy settings. There is no separate "Advanced" sub-page to dig into. The redundant
"Block unknown account messages" control is gone (its protection is now always on). The one control
that lived there and still has meaning — turning off link previews — sits directly on the Privacy
page where it's easy to find.

**Why this priority**: The Advanced page existed almost entirely to house a toggle that is now the
default; leaving it would present a confusing no-op. Surfacing the remaining, working control removes
a dead end.

**Independent Test**: Open Privacy and confirm there is no "Advanced" entry, no "Block unknown"
toggle, and a working "Disable link previews" control is directly present. Toggle it on and confirm
shared links no longer produce a rich preview.

**Acceptance Scenarios**:

1. **Given** the Privacy screen, **When** the user views it, **Then** no "Advanced" entry and no "Block unknown account messages" toggle are shown.
2. **Given** the Privacy screen, **When** the user looks for the link-preview control, **Then** "Disable link previews" is present directly on the page.
3. **Given** "Disable link previews" is on, **When** the user shares a URL, **Then** no rich link preview is generated for it.
4. **Given** the removed toggle, **When** settings sync across the user's devices, **Then** the obsolete key is not part of the synced set.

---

### User Story 3 - Help that actually helps (Priority: P2)

The user opens Help and finds short, plain-language guides that explain how Ring works: how chats
stay private, how to get started, how to add people, how chats and groups work, disappearing
messages, hidden chats and app lock, calls, and the recovery key. The app version is not repeated
here (it lives on About), and the developer self-test is still available.

**Why this priority**: The old Help screen showed only a (visually broken) duplicate of the version
plus a developer button — it did not help anyone. Real guidance is valuable as Ring approaches wider
use.

**Independent Test**: Open Help and confirm it lists the how-to topics, opening each shows readable
guidance, the version is not shown, and the self-test is still reachable.

**Acceptance Scenarios**:

1. **Given** the Help screen, **When** the user views it, **Then** it lists how-to guides covering privacy/encryption, getting started, adding people, chats and groups, disappearing messages, hidden chats and app lock, calls, and the recovery key.
2. **Given** a how-to topic, **When** the user opens it, **Then** readable, plain-language guidance is shown.
3. **Given** the Help screen, **When** the user looks for the app version, **Then** it is not shown on Help (it appears on About).
4. **Given** the Help screen, **When** a developer wants to validate the build, **Then** the on-device self-test is still reachable.

---

### User Story 4 - Confirm before resetting auto-download (Priority: P3)

In Storage and data settings, the user taps "Reset auto-download settings". Instead of instantly
wiping their choices, the app asks them to confirm; only on confirmation are the defaults restored.

**Why this priority**: It's a one-tap action that silently discards a set of preferences. A
confirmation prevents accidental loss with minimal friction.

**Independent Test**: Tap "Reset auto-download settings" and confirm a confirmation prompt appears;
cancel and verify nothing changed; confirm and verify defaults are restored.

**Acceptance Scenarios**:

1. **Given** custom auto-download choices, **When** the user taps "Reset auto-download settings", **Then** a confirmation prompt appears before anything changes.
2. **Given** the confirmation prompt, **When** the user cancels, **Then** their auto-download choices are unchanged.
3. **Given** the confirmation prompt, **When** the user confirms, **Then** the auto-download settings return to their defaults.

---

### User Story 5 - Emoji always render (Priority: P3)

An emoji that has no bundled image asset (for example a very new emoji) shows the device's own emoji
glyph instead of a broken-image placeholder. This is most visible on message reactions, where the
placeholder previously appeared as a "?" box.

**Why this priority**: A broken-image "?" in place of an emoji looks like a bug and undermines trust,
even though it's cosmetic.

**Independent Test**: React with (or send) an emoji that has no image asset and confirm the native
glyph is shown, never a persistent broken-image placeholder.

**Acceptance Scenarios**:

1. **Given** an emoji with no available image asset, **When** it is displayed, **Then** the device's native emoji glyph is shown.
2. **Given** such an emoji, **When** it is displayed, **Then** a broken-image placeholder is never left on screen.

---

### User Story 6 - Settings captions get room to breathe and stay readable (Priority: P3)

On settings screens, the explanatory caption beneath a group and the standalone note paragraphs have
a little space below the text so they no longer sit flush against the rounded bottom edge of their
card, and they use a text colour with enough contrast to read comfortably on both the light and dark
themes.

**Why this priority**: Purely visual polish, but text crowding the border reads as unfinished, and the
dim default description colour was genuinely hard to read.

**Independent Test**: View a settings screen whose group has a multi-line caption and confirm there is
visible spacing between the last line and the card's bottom edge, and that the caption is easy to read
in both light and dark mode.

**Acceptance Scenarios**:

1. **Given** a settings group with a multi-line caption, **When** it is displayed, **Then** there is visible spacing between the last line of the caption and the bottom edge of the card.
2. **Given** the light or the dark theme, **When** a caption or help paragraph is displayed, **Then** its text is comfortably readable (clearly higher contrast than the previous dim default).

---

### Edge Cases

- A person who shares a group with the user but is not a contact and not connected: their **direct**
  message is dropped (they must connect first); the group conversation is unaffected.
- A sender who is an accepted connection but whose contact row has not been created yet (e.g. invite
  auto-connect before the profile card lands): their message is delivered and the contact row is
  created on receipt.
- A message dropped as "unknown" is acknowledged so the relay stops holding it — it does not silently
  reappear after a later, unrelated connection.
- An emoji without a variation selector and no image asset: still resolves to the native glyph rather
  than looping on an identical failed image request.
- Turning off link previews mid-session: URLs shared afterward produce no preview.

## Requirements *(mandatory)*

### Functional Requirements

**Friends-only messaging (US1)**

- **FR-001**: The system MUST drop an inbound direct (1:1) message whose sender is neither an existing contact nor an accepted connection, so the recipient never sees or stores it.
- **FR-002**: A message dropped under FR-001 MUST be acknowledged to the relay so it is not redelivered later (dropped, not deferred).
- **FR-003**: After the recipient connects with a previously-unknown sender (adds them, accepts their request, or auto-connects via invite), subsequent messages from that sender MUST be delivered.
- **FR-004**: The friends-only gate MUST apply only to the direct-message path and MUST NOT affect call signalling; a user MUST be able to join or add a non-contact participant to a call and exchange call setup with them.
- **FR-005**: First-contact connection requests (friend requests and invites) MUST continue to reach recipients, as they travel over a channel separate from the gated direct-message path.

**Simplified Privacy settings (US2)**

- **FR-006**: The Privacy settings MUST NOT present an "Advanced" sub-page.
- **FR-007**: The "Block unknown account messages" toggle MUST be removed; its former behavior is now the always-on default (see FR-001).
- **FR-008**: "Disable link previews" MUST be presented as a control directly on the Privacy page.
- **FR-009**: When "Disable link previews" is enabled, the sender's device MUST NOT generate a link preview for shared URLs.
- **FR-010**: The obsolete "Block unknown" setting key MUST NOT be included in cross-device settings sync.

**Help guides (US3)**

- **FR-011**: The Help screen MUST present plain-language how-to guides covering, at minimum: how chats stay private (encryption), getting started, adding people, chats and groups, disappearing messages, hidden chats and app lock, calls, and the recovery key.
- **FR-012**: The Help screen MUST NOT display the app version (it is shown on the About screen).
- **FR-013**: The on-device developer self-test MUST remain reachable from Help.

**Confirm auto-download reset (US4)**

- **FR-014**: Resetting auto-download settings MUST require explicit user confirmation before the defaults are applied; cancelling MUST leave settings unchanged.

**Reliable emoji rendering (US5)**

- **FR-015**: An emoji with no available image asset MUST fall back to the device's native glyph and MUST NOT leave a persistent broken-image placeholder on screen.

**Settings caption spacing and readability (US6)**

- **FR-016**: Multi-line group captions and standalone note paragraphs on settings screens MUST have visible spacing below the text so they do not sit flush against the card's bottom edge.
- **FR-017**: Setting captions and help paragraphs MUST use a text colour with enough contrast to read comfortably on both the light and dark themes.
- **FR-018**: User-facing copy across these screens (Help guides, settings captions, confirmations) MUST read in Ring's plain, warm voice and MUST NOT use em-dashes or semicolons. The About screen header reads "Made with love for privacy" (the footer already credits the maker).

### Key Entities

- **Connection ledger**: the per-device record of which peers the user has accepted a connection with; it, together with the contacts list, determines whether an inbound direct message is delivered or dropped.
- **Settings tree**: the declarative hierarchy that renders the Privacy and Help screens; the changes here are edits to this tree (removed Advanced node, moved link-preview control, added Help how-to nodes).

## Success Criteria *(mandatory)*

- **SC-001**: 100% of direct messages from senders the recipient has not connected with are kept off the recipient's device.
- **SC-002**: A user can add a non-contact to a group call and the call connects for all participants, even though those participants cannot send each other direct messages.
- **SC-003**: The Privacy screen shows no "Advanced" entry, and the link-preview control is reachable in a single step from the Privacy screen.
- **SC-004**: Help offers at least 8 how-to topics, and the app version appears in exactly one place in Settings (About).
- **SC-005**: Resetting auto-download never changes any setting without an intervening confirmation step.
- **SC-006**: No emoji is ever left showing a broken-image placeholder.
- **SC-007**: Setting captions and help paragraphs are readable on both themes and contain no em-dashes or semicolons.

## Zero-Knowledge Impact

- **What plaintext, if any, is involved and where is it encrypted?** No new plaintext crosses the
  client/server boundary. Messages, link previews, and call setup remain end-to-end encrypted exactly
  as before. The friends-only decision is made on the recipient's already-decrypted inbound message,
  entirely on-device.
- **What new metadata (if any) does the server see?** None. The relay continues to forward opaque
  sealed frames and content-free tickles; it cannot tell an accepted message from a dropped one (the
  recipient still acks the frame either way, so queue behavior is unchanged from the server's view).
- **Does the server gain any new capability?** No. There are no server, protocol, or API changes; the
  gate cannot be and is not enforced server-side.
- **Settings sync**: the removed `privacy.blockUnknown` key simply leaves the client-encrypted
  own-data snapshot; that snapshot is sealed under the master key as before, so nothing new is exposed.

## Assumptions

- "Connected" means the peer is in the user's contacts or in the accepted-connection ledger; both invite auto-connect and accepting a friend request establish this.
- The change is client-side only; the zero-knowledge server cannot and does not enforce the gate, and no server or protocol change is introduced.
- "Native glyph" refers to the emoji rendering the user's own platform provides; devices without a glyph for a brand-new emoji will show their own platform placeholder, which is outside Ring's control.
- Existing conversations with people the user has already messaged are unaffected, because those peers are already recorded as connected.
