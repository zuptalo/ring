# Feature Specification: Voice messages never arrive as an empty bubble

**Feature Branch**: `fix/2058-voice-messages-arrive`

**Created**: 2026-07-29

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report (with screenshots from both sides of the conversation): "When replying with audio message, the other party doesn't see the audio message to play."

## Context: why this hotfix exists

The reporter's recipient saw two voice messages arrive as **completely blank bubbles** — bubble
outline, timestamp, and reaction button, and nothing else. No player, no duration, no download
button, no error. The sender's own screen showed both messages sent and delivered normally.

The report framed this as reply-specific because the blank bubble that prompted it happened to
carry a reply quote (the quote *did* render, since a quote is plain message metadata that needs no
attachment). **It is not reply-specific** — the plain voice note directly above it was equally
blank. Any incoming voice message can land in this state.

A voice bubble only draws once the audio bytes are on the device. There is a separate
"not downloaded yet" presentation for attachments whose bytes are still pending, but it was only
ever built for photos, non-note videos, shared audio files, and documents. **Voice messages — and
round video notes — have no pending presentation at all**, so when their bytes aren't local yet
there is simply nothing to draw.

Voice is never *deliberately* deferred (it is exempt from the auto-download preferences and the
size cap, on the reasoning that voice notes are small and expected to play instantly). So every
occurrence of this bug is one of two transient-or-failed states that were never given a face:

1. **It arrived while the app was closed or backgrounded.** The background-notification path
   deliberately stores only the reference and never fetches bytes (fetching needs a media pipeline
   and far more time than a notification wake-up is given). The bytes are fetched on the next app
   start. Between arrival and that fetch, the bubble is blank — and this is the common case, since
   the whole point of a voice note is that it arrives while you are not looking at the app.
2. **The fetch failed.** Both the live receive path and the app-start backfill swallow a fetch
   failure and leave the attachment pending, with an explicit "allow a manual retry" / "failure
   keeps the manual tap path" intent. For voice there *is* no manual tap path, so a single failed
   fetch strands the message permanently — it stays blank for the life of the message.

The unifying principle of this fix, matching spec 2050's: **an attachment must either render
something the user can act on, or say plainly what happened — never a silent blank.**

## Clarifications

### Session 2026-07-29

- Q: When a pending voice message's audio can't be fetched, how should the recipient be told? → A:
  Both an inline failed state on the bubble and a message when a manual retry fails — and extend
  the same honest-failure treatment to every pending attachment kind, not just voice. Today a
  failed fetch on a pending photo or video is swallowed silently too, so the same "never a silent
  blank" principle is applied across the board rather than fixing voice alone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A voice message received while the app was closed plays on its own (Priority: P1)

Someone sends a voice message while the recipient's app is closed or in the background. The
recipient opens the chat and the message is there, ready to play, without them having to do
anything or knowing anything went wrong.

**Why this priority**: This is the reported defect and by far the most common path — a voice note
almost always arrives while the recipient isn't looking at the app. Today it produces a blank
bubble with no explanation and no recourse, which reads as the message simply being broken.

**Independent Test**: Send a voice message to a recipient whose app is closed. Open the app,
go to the chat, and confirm the message shows as a playable voice note without any tap.

**Acceptance Scenarios**:

1. **Given** the recipient's app is closed, **When** a voice message arrives and the recipient
   later opens the chat, **Then** the message appears as a playable voice note.
2. **Given** the bytes have not been fetched yet at the moment the chat opens, **When** the bubble
   is on screen, **Then** the fetch starts on its own and the bubble becomes playable when it
   completes — with a visible indication that it is loading in the meantime.
3. **Given** a voice message that has been sitting blank on the device from before this fix,
   **When** the recipient opens that chat, **Then** it recovers the same way — no reinstall,
   no re-send from the sender.

---

### User Story 2 - A voice message whose audio can't be fetched says so and can be retried (Priority: P1)

The recipient's device can't fetch the audio — they're offline, the network drops mid-fetch, or the
attempt fails. Instead of a blank bubble, they see a voice message placeholder that shows how long
the message is and can be tapped to try again.

**Why this priority**: This is the permanent-damage half of the bug. Without a visible retry, one
failed fetch strands the message forever, and the recipient has no way to tell a broken message
from an empty one. Shipping only User Story 1 would leave failures silent.

**Independent Test**: Put the device offline, receive a voice message, and confirm the bubble shows
a voice placeholder with its duration; go back online, tap it, and confirm it fetches and plays.

**Acceptance Scenarios**:

1. **Given** the audio has not been fetched, **When** the recipient looks at the bubble, **Then**
   they see it is a voice message, how long it is, and that it can be tapped to load.
2. **Given** a fetch attempt fails, **When** the recipient taps the placeholder, **Then** a fresh
   attempt starts and shows its progress.
3. **Given** a fetch is in progress, **When** the recipient looks at the bubble, **Then** progress
   is visible, and repeated taps do not start overlapping attempts.
4. **Given** a fetch attempt has failed, **When** the recipient looks at the bubble, **Then** the
   placeholder shows a failed state that says so and offers a retry, and it keeps saying so when
   they scroll back to it later.
5. **Given** the audio can never be fetched because it is no longer available to fetch, **When**
   the recipient taps to retry, **Then** they are told plainly rather than left tapping a
   placeholder that silently does nothing.

---

### User Story 3 - Round video notes get the same treatment (Priority: P3)

A round video note that arrives while the app is closed behaves like a voice message: it recovers
on its own, and shows a tappable placeholder if it can't.

**Why this priority**: Round notes have exactly the same gap for exactly the same reason, and are
fixed by the same change — but they are used far less than voice, so no one has reported it. Worth
closing while the code is open; not worth blocking the voice fix on.

**Independent Test**: Send a round video note to a recipient whose app is closed, open the app,
and confirm it plays without a tap.

**Acceptance Scenarios**:

1. **Given** the recipient's app is closed, **When** a round video note arrives and the recipient
   later opens the chat, **Then** it is playable without any tap.
2. **Given** its bytes cannot be fetched, **When** the recipient looks at the bubble, **Then** they
   see a round-note placeholder they can tap to retry, not a blank bubble.

---

### User Story 4 - No attachment fails silently (Priority: P2)

A recipient taps to load any pending attachment — a photo, a video, a shared audio file, a
document — and the load fails. They are told it failed, and the bubble goes on saying so, instead
of the tap appearing to do nothing.

**Why this priority**: Today a failed tap on a pending photo or video is swallowed with no
feedback at all, so the recipient cannot tell a slow load from a broken one and re-taps blindly.
It is the same "never a silent blank" principle as the voice fix and shares its mechanism, but it
is a pre-existing wart rather than the reported defect, so it should not block the voice fix.

**Independent Test**: Go offline, tap a pending photo, and confirm both an immediate message that
it failed and a bubble that still reads as failed afterwards.

**Acceptance Scenarios**:

1. **Given** a pending photo, video, audio file, or document, **When** the recipient taps it and
   the fetch fails, **Then** they are told at that moment and the bubble shows a failed state.
2. **Given** a bubble in the failed state, **When** the recipient taps it again and the network has
   recovered, **Then** it fetches and renders normally.
3. **Given** a photo or video the recipient deliberately left deferred, **When** its bubble comes
   into view, **Then** it does NOT start fetching on its own.

---

### Edge Cases

- **Message deleted or expired before the fetch lands**: a disappearing message that expires, or a
  message the sender unsends, while its audio is still pending — the bubble follows the normal
  deleted/expired presentation and no orphan fetch keeps running.
- **Audio deliberately removed from this device to free space**: this is a different state from
  "not fetched yet" and keeps its existing "removed to free space" presentation — the fix must not
  make cleared media look re-fetchable when it isn't.
- **Attachment no longer available on the relay**: an old message whose stored ciphertext has aged
  out. The retry must fail honestly rather than retry forever.
- **Offline with several pending voice messages in one chat**: the recipient scrolls a chat with a
  run of them. Recovery must not stampede the network or the device with simultaneous fetches.
- **Repeated on-view retries for a message that keeps failing**: scrolling a permanently-broken
  message in and out of view must not retry endlessly in a loop.
- **Group chats**: the same behavior applies to voice messages from any group member.
- **A voice message the recipient is already playing**: recovery of *other* pending messages must
  not interrupt playback in progress.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An incoming voice message whose audio is not yet on the device MUST render a visible
  placeholder in place of the player — never an empty bubble.
- **FR-002**: The placeholder MUST identify the message as a voice message and show its duration
  when the duration is known. When the duration is not known it MUST still read as a voice message
  rather than leaving an empty slot where the duration would be.
- **FR-003**: The placeholder MUST be tappable to fetch the audio, and MUST show fetch progress
  while a fetch is running.
- **FR-004**: Tapping a placeholder whose fetch is already in progress MUST NOT start a second
  overlapping fetch.
- **FR-005**: A pending voice message MUST attempt its fetch automatically when its bubble comes
  into view, so the common "arrived while the app was closed" case resolves without any tap.
- **FR-006**: Automatic on-view retries MUST be bounded at **3 attempts per message per app
  session**, so a message that cannot be fetched stops retrying and falls back to the manual tap
  rather than looping. The count MUST reset when the app restarts — a message that exhausted its
  attempts while the device was offline must still recover on a later launch (FR-013).
- **FR-007**: When a fetch completes, the bubble MUST become the normal playable voice player
  without the user leaving or reopening the chat.
- **FR-008**: When a fetch fails, the placeholder MUST enter a visible failed state that names the
  failure and offers a retry, and that state MUST persist so it still reads as failed when the
  recipient returns to the message later.
- **FR-009**: When a fetch the recipient started by tapping fails, the app MUST additionally tell
  them at the moment of the failure, rather than only changing the bubble they may not be looking
  at. Automatic on-view retries MUST fail quietly into the failed state without interrupting the
  recipient.
- **FR-010**: The failed state and the on-tap message of FR-008 and FR-009 MUST apply to every
  pending attachment kind — voice, round video note, photo, video, audio file, and document — so
  no kind fails silently.
- **FR-011**: Round video notes MUST follow FR-001 through FR-007, with a round-note placeholder
  in place of the voice placeholder.
- **FR-012**: Audio deliberately removed from the device to free space MUST keep its existing
  distinct presentation and MUST NOT be shown as a pending fetch.
- **FR-013**: The fix MUST apply to voice messages already stranded on devices before it ships,
  with no reinstall and no re-send by the sender.
- **FR-014**: The fix MUST NOT change what is sent over the wire, how it is encrypted, or what the
  server can observe — it is a receive-side rendering and recovery change only.
- **FR-015**: Attachments the recipient deliberately deferred (a photo or video left for a manual
  tap by their auto-download preference or the size cap) MUST keep that behavior — they MUST NOT
  start fetching automatically on view just because voice does.

### Key Entities

- **Voice message**: an incoming chat message carrying recorded audio, with a known duration and
  a reference to its stored ciphertext, in one of three states on the device — audio present,
  audio pending, or audio removed to free space.
- **Pending attachment reference**: the sender's reference to the stored ciphertext, kept on the
  message so the audio can be fetched later. Its presence alongside absent audio is what
  identifies the pending state.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

**What crosses the wire**: nothing new. This fix changes only how the receiving device draws a
message it already has, and when it fetches attachment bytes it was already entitled to fetch.

- **Sending**: unchanged. No change to what is sealed, how it is sealed, or what accompanies it.
- **Fetching**: the fix reuses the existing attachment fetch unchanged — the same capability-style
  blob id the sender already put in the sealed message, fetched over the existing endpoint, and
  decrypted on the device. No new endpoint, no new parameter, no new identifier.
- **New state**: the failure marker lives **only in the device's local database** — never synced,
  never sent, never derived from anything the server provides. The retry count is weaker still: it
  is held in memory for the session and never written down at all.
- **Metadata visible to the server**: unchanged in kind. The server already observes that some
  device fetched some blob id at some time — that is inherent to relaying the bytes at all. This
  fix does not add a new observable; it can only change *timing*, since a fetch that previously
  never happened (the stranded case) now happens. It reveals nothing the ordinary success path
  would not have revealed moments earlier.
- **Retry bound**: the per-message attempt cap (FR-006) additionally keeps a permanently-failing
  message from generating an unbounded, repeating fetch pattern against the relay.

**Not affected**: no change to the crypto core, key handling, session state, or the at-rest
wrapping of secrets. No new plaintext reaches the server, no log line or error payload gains user
content, and no migration touches server-side storage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero blank bubbles across the full matrix of message kind × attachment state:
  the six attachment kinds (voice, round video note, photo, video, audio file, document) in each of
  the four states (audio present, pending, failed, removed to free space) — 24 cells, none of which
  renders a bubble with no content.
- **SC-002**: A voice message that arrives while the app is closed is playable within 3 seconds of
  the recipient opening the chat, with no taps, measured on an unthrottled local connection. The
  measured moment is the placeholder being replaced by a working player, not merely the fetch
  returning.
- **SC-003**: A voice message whose fetch failed can be recovered by the recipient in a single tap,
  100% of the time the audio is still available to fetch.
- **SC-004**: A voice message stranded blank before this fix becomes playable on the next open of
  its chat, with no reinstall and no re-send.
- **SC-005**: Scrolling a chat containing 10 consecutive pending voice messages recovers all 10,
  with **at most 3 fetches in flight at any moment**, and the scroll position stays stable
  throughout (no jump, no blank frame) by the same measure the existing chat-media scroll coverage
  applies.
- **SC-006**: The reporter's exact scenario — a voice message, and a reply carrying a voice
  message, sent to a recipient whose app is closed — plays on both sides.
- **SC-007**: Zero silent failures: for every pending attachment kind, a failed manual load
  produces both an immediate message to the recipient and a bubble that still reads as failed
  afterwards — no kind swallows the failure.

## Complexity & Exceptions

*Governance requires a waived or unmet **MUST** to be recorded here and accepted by a maintainer.*

| # | Principle / rule | Status | Detail |
|---|---|---|---|
| E-1 | **Development Workflow — supply-chain scan at the start of new work** (MUST) | ⏳ **Unmet, awaiting maintainer** | The Docker Scout report for the current `zuptalo/ring` tag has not been reviewed; this environment has no Docker Hub access. No Go module or base-image surface is touched by this client-only change, so it does not block the code, but it MUST be discharged before the release PR. **Maintainer sign-off: not yet recorded.** |
| E-2 | **Principle XI — Ionic-First UI** | ✅ Justified deviation | The voice placeholder is hand-rolled rather than a stock Ionic component, because no Ionic primitive exists for a voice bubble and the placeholder must match `VoicePlayer`'s row metrics or the bubble reflows when the fetch lands. Composed from the existing download vocabulary and existing theme tokens, exactly as its hand-rolled sibling does. Full reasoning in plan.md → Complexity Tracking. |
| E-3 | **Development Workflow — version bump at the start of a release cycle** (MUST) | ✅ Addressed | `develop` and `main` are level at 1.0.32 (tag `v1.0.32` exists), so this is the first change of a new cycle and `package.json` must move to 1.0.33 on this branch or the release guard blocks the eventual release PR. Carried as a task. |

## Assumptions

- The recipients in the report were not deliberately deferring media: voice is exempt from the
  auto-download preferences and the size cap, so their messages were pending because of the
  background-arrival path or a failed fetch, not a setting. No change to the auto-download
  preferences is in scope.
- The placeholder reuses the visual language already established for pending photos, videos,
  audio files, and documents (a duration/size label plus a download affordance with a progress
  ring), rather than introducing a new one.
- The honest-failure extension to all attachment kinds (User Story 4) is deliberately in scope per
  the 2026-07-29 clarification, on the grounds that it is the same principle and the same
  mechanism. It stays a strictly additive change to how a failure is presented — it does not
  change when any kind is fetched.
- The automatic-retry bound is **in-memory and per session** (FR-006). It deliberately does not
  persist: a persistent counter would let a message that burned its attempts during one offline
  session become permanently manual-only, which would contradict FR-013's promise that stranded
  messages recover on a later open.
- Fixing the send side is out of scope — the sender's own copy renders correctly today, and the
  report's screenshots confirm the messages were sent, delivered, and readable on the sender's
  device.
- Existing background-notification behavior stays as-is: it is deliberate that the notification
  path does not fetch attachment bytes, and this fix repairs the recipient experience downstream
  of that rather than changing it.
