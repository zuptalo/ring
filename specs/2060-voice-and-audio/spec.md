# Feature Specification: Voice and audio messages must not render blank when you open a chat from the list

**Feature Branch**: `fix/2060-voice-and-audio`

**Created**: 2026-07-30

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: Found while verifying spec 2059: a voice message whose audio is already on the device
renders as a blank bubble when the chat is opened by tapping it in the chat list, even though the
audio is present and resolves. It is a pre-existing issue (predates 2058 and 2059).

## Context: why this hotfix exists

A voice message (and a shared-audio card) draws its player only once the on-device media has been
resolved into a playable URL. The chat resolves that media as the message enters the rendered
window, then relies on the bubble re-rendering to swap in the player.

The bubble is memoised. Its memo watches the message's poster image as the signal that its media
became available — which is correct for photos and videos (they gain a poster when they resolve),
but **voice and audio have no poster**. Their playable URL resolves, but the memo's watched value
never changes, so a bubble that first rendered *before* the media resolved is frozen in that empty
state and never swaps in the player.

Whether you hit it comes down to timing:

- **Opening the chat by tapping it in the list** (the normal way) renders the bubbles first and
  resolves the media a beat later — so the memo has already frozen the empty bubble. **Blank.**
- **Deep-linking or reloading straight into the chat** happens to resolve the media before the
  first paint, so the memo freezes the *resolved* bubble. **Fine.**

That timing difference is why it slipped through: automated coverage and quick manual checks tend to
land straight in a chat, where it looks correct.

This is distinct from spec 2058 (voice messages whose bytes are *not on the device yet*). Here the
bytes are present and resolve successfully; the failure is purely that the bubble does not re-render
to show them. 2058's own recovery works only because completing a fetch stamps the message, which
the memo also watches — so 2058 masked this for freshly-fetched messages while leaving
already-present ones exposed.

The principle is the same as 2058's: **a message that has its media must show it.**

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Opening a chat from the list shows its voice messages (Priority: P1)

Someone opens a conversation the usual way — tapping it in the chat list — and its voice messages
are there, ready to play, exactly as when the chat is opened any other way.

**Why this priority**: This is the reported defect and the single most common way anyone opens a
chat. A voice message rendering blank on the normal entry path reads as the message being lost.

**Independent Test**: Send a voice message, open the chat by tapping its row in the list, and
confirm the voice player is shown.

**Acceptance Scenarios**:

1. **Given** a chat containing a voice message whose audio is on the device, **When** the chat is
   opened by tapping it in the list, **Then** the voice player is shown, not a blank bubble.
2. **Given** that chat is left and re-opened, **When** it is entered again, **Then** the voice
   message still shows its player.
3. **Given** a shared audio file in the chat, **When** the chat is opened from the list, **Then**
   its track card is shown.

---

### User Story 2 - No message kind renders blank on the normal entry path (Priority: P2)

Photos, videos, documents and round notes also show correctly when a chat is opened from the list —
confirming the fix is general and did not simply special-case voice.

**Why this priority**: The underlying cause (a bubble not re-rendering when its media resolves)
could in principle touch any media kind. Photos and videos happen to escape it today via their
poster, but the fix should be verified not to have disturbed them, and to hold for every kind.

**Independent Test**: Open a chat from the list containing each media kind and confirm each renders
its normal presentation.

**Acceptance Scenarios**:

1. **Given** a chat with a photo, a video, a document and a voice message, **When** it is opened
   from the list, **Then** every one of them renders its content, none blank.

---

### Edge Cases

- **A message that arrives while the chat is already open**: it must render its player when its
  media resolves, without needing the chat to be reopened.
- **Media removed from the device to free space**: keeps its existing "removed to free space"
  placeholder — this fix is about present media rendering, not about that state.
- **A very long chat scrolled quickly**: bubbles that resolve their media while scrolling must
  still swap in their players; the fix must not depend on scroll having stopped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A message whose media is present on the device MUST render that media's presentation
  regardless of how the chat was opened (tapped from the list, deep-linked, or reloaded into).
- **FR-002**: When a message's media resolves after its bubble has already been rendered, the
  bubble MUST update to show the media, without the chat being reopened.
- **FR-003**: FR-001 and FR-002 MUST hold for every media kind that lacks a poster image — in
  particular voice messages and shared-audio cards — not only for kinds that have one.
- **FR-004**: The fix MUST NOT regress the rendering of kinds that render correctly today (photos,
  videos, documents, round notes).
- **FR-005**: The fix MUST NOT reintroduce the per-render cost the bubble's memoisation exists to
  avoid — a status tick or reaction on one message must still not force unrelated re-computation.
- **FR-006**: The change is client-side rendering only. It MUST NOT change anything sent, stored on
  the server, or observable to it.

### Key Entities

- **Chat bubble**: the rendered row for one message. Memoised so routine updates elsewhere in the
  list do not re-render it; the memo must nonetheless recognise this message's own media becoming
  available.
- **Resolved media**: the playable object URL derived on-device from stored bytes. For voice and
  audio it is the only resolved artifact (there is no poster); for photos and videos a poster
  resolves alongside it.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

Nothing crosses the wire. This changes only whether an already-present, already-decrypted local
media blob is shown in its bubble. No new field, request, endpoint, or stored value; no change to
what the server can observe; no crypto surface touched.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A voice message opened via the chat list shows its player 100% of the time its audio
  is on the device — matching the deep-link entry path exactly.
- **SC-002**: Zero blank bubbles for present media across the media kinds, on the list-tap entry
  path, on re-entry, and for media that resolves while the chat is open.
- **SC-003**: The bubble memoisation still suppresses re-render for an unrelated status tick or
  reaction (no regression in the scroll/update cost it was added for).

## Assumptions

- The fix is expected to be a correction to what the bubble's memo treats as "this message's media
  changed" so that it recognises voice/audio resolution (which produces a playable URL but no
  poster), not a redesign of the rendering path.
- Round video notes are gated the same way voice is; the fix covers them by the same mechanism.
- No change to media resolution, storage, or the auto-download behaviour — only to the bubble
  updating once resolution has happened.

## Complexity & Exceptions

| # | Principle / rule | Status | Detail |
|---|---|---|---|
| E-1 | **Development Workflow — supply-chain scan** (MUST) | ✅ Done on this branch | Docker Scout was run against `zuptalo/ring:1.0.32`. Two fixable advisories found and applied on this branch: `golang.org/x/net` 0.55.0 → 0.56.0 (CVE-2026-46600) and `golang.org/x/text` 0.37.0 → 0.39.0 (CVE-2026-56852). No other fixable advisories. The maintainer had deferred the 1.0.33 scan to this follow-up release. |
| E-2 | **Development Workflow — start-of-cycle version bump** (MUST) | ✅ Addressed | 1.0.33 shipped, so `develop` and `main` are level; this branch bumps to 1.0.34. Carried as a task. |
