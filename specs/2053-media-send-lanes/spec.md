# Feature Specification: Stuck media sends no longer block every later send

**Feature Branch**: `fix/2053-media-send-lanes`

**Created**: 2026-07-26

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User report: "Some animated webp files still don't get sent and are stuck in sending process and retry doesn't help either! Do we really need to convert them at all?" … and, on a follow-up screenshot: "seems like when a video is stuck in conversion and fails it also blocks everything else sent afterwards! The one above is a gif, the one in the middle is a still frame image and the last one is a webp animated."

## Context: why this hotfix exists

Two independent defects compounded into "media sends freeze forever".

**1. An unbounded decode.** The send pipeline's thumbnail step awaited `createImageBitmap()` with **no timeout** (`generateImageThumbUnlimited`). On WebKit, that call can *never settle* for certain animated WebPs — it neither resolves nor rejects. Every sibling decode in the same module is already time-bounded (`readImageMeta`, `generateVideoPoster`); this one was missed. The SVG rasteriser's `<img>` load was likewise unbounded.

**2. One over-serialized queue.** All outgoing media ran through a single strictly-sequential promise chain (`jobChain`). That serialization exists for a real reason — ffmpeg.wasm is a **single shared instance** with fixed virtual-FS filenames and one progress handler, so two video transcodes at once corrupt each other — but it was applied to *everything*, including images that have no such constraint.

Together: because the decode **hangs rather than throws**, the job never reaches its `catch`, so the 3-attempt retry/`failed` path never fires and the message sits on the "sending" clock forever. The hung job also never releases the shared chain, so **every later media send queues behind it and never runs** — and **Retry is inert**, because it re-enqueues onto the same wedged chain. The user's screenshot shows exactly this: a still image that squeezed through between two frozen clips, with a GIF above and an animated WebP below both stuck on the clock.

**Not a conversion problem.** The user's question — "do we need to convert these at all?" — is fair, and the answer is that WebP and GIF are *already* never converted (`PRESERVED_IMAGE_MIME`), precisely so animation and alpha survive. Only WebM genuinely needs conversion, because Safari/iOS cannot decode VP8/VP9 in a native `<video>` (spec 2050/2052). So the fix is entirely in scheduling and time-bounding, not in format handling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A stuck item never blocks the sends after it (Priority: P1)

A user sends a video that takes a long time to convert (or an item that can't be processed at all), then keeps sending photos. The photos go through while the video is still working; a genuinely un-processable item eventually reports a retryable failure instead of sitting on the clock forever.

**Why this priority**: This is the reported defect and the most damaging one — a single bad item silently disables *all* media sending until the app is restarted.

**Independent Test**: Send a transcoding video immediately followed by several images; confirm the images deliver without waiting for the video, and that nothing remains in "sending" indefinitely.

**Acceptance Scenarios**:

1. **Given** a video that is transcoding, **When** I send photos right after it, **Then** the photos deliver without waiting for the transcode to finish.
2. **Given** media whose processing hangs, **When** the hang exceeds a time bound, **Then** the send reports an honest, retryable failure rather than remaining on the "sending" clock.
3. **Given** a previously stuck send, **When** I tap Retry, **Then** the retry actually runs (it is not queued behind the wedged item).
4. **Given** several photos sent at once, **When** no video is converting, **Then** they process a few at a time rather than strictly one-by-one.

---

### User Story 2 - Animated WebP and GIF send reliably (Priority: P1)

A user pastes or picks an animated WebP or GIF and sends it; it delivers, still animated.

**Why this priority**: The originally reported symptom. Same root cause as Story 1 (the unbounded decode), and these formats are what triggered it.

**Independent Test**: Send an animated WebP and a GIF; confirm both deliver and animate for the recipient.

**Acceptance Scenarios**:

1. **Given** an animated WebP, **When** I send it, **Then** it delivers with animation intact.
2. **Given** an image whose thumbnail can't be generated, **When** I send it, **Then** it still sends (the missing preview is not fatal).

---

### User Story 3 - Memory stays bounded when several items send at once (Priority: P2)

Sending several large items together does not crash the app on a phone.

**Why this priority**: Allowing concurrency reintroduces the out-of-memory risk that the previous strict serialization masked (spec 2041); this keeps the peak bounded.

**Independent Test**: Send a burst including large media and confirm the app stays alive and all items complete.

**Acceptance Scenarios**:

1. **Given** several large items sent together, **When** they are processed, **Then** total in-flight upload memory stays under a bound (larger items wait; small ones proceed).
2. **Given** a single item larger than that bound, **When** it is sent, **Then** it still sends (it runs on its own rather than deadlocking).

---

### User Story 4 - The "couldn't be sent" notice takes you to the problem (Priority: P3)

Tapping the failed-send banner opens the chat at the failing media. For a hidden chat it stays purely informative and navigates nowhere.

**Why this priority**: Recovery polish — valuable once failures are surfaced honestly (Story 1), but not the break itself.

**Independent Test**: Force a failure in a normal chat and confirm tapping the banner jumps to that message; repeat in a hidden chat and confirm tapping does nothing.

**Acceptance Scenarios**:

1. **Given** a failed media send in a normal chat, **When** I tap the banner, **Then** the chat opens scrolled to the failing message.
2. **Given** failures only in hidden chats, **When** I tap the banner, **Then** nothing happens and no hidden conversation is revealed or opened.
3. **Given** failures in both a hidden and a normal chat, **When** I tap the banner, **Then** it opens the most recent **non-hidden** one.

---

### Edge Cases

- **A legitimately long transcode** (a big clip on a slow phone) must NOT be cut off by the watchdog: the bound scales with source size.
- **A slow upload on a poor connection** must not be false-failed: the upload keeps its own separate size-scaled timeout.
- **Thumbnail/metadata failure** is never fatal — the recipient still downloads and renders the full media.
- **Two video transcodes** must never run at once (the shared ffmpeg instance would corrupt both).
- **Animated formats** keep passing through unconverted (spec 2050 FR-012 remains intact).

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire**: unchanged. Same sealed, client-encrypted media blobs and capability-style ids; the server still stores opaque ciphertext.
- **Where processing happens**: entirely client-side, before encryption. This change only alters *when* and *how concurrently* that local work runs.
- **Unavoidably-visible metadata**: unchanged — no new endpoint, field, log, or timing signal. Blob sizes and relay timing were already visible.
- **Why it stays zero-knowledge**: scheduling, timeouts and a memory budget are purely local concerns; the server gains no new capability or visibility.

## Requirements *(mandatory)*

### Functional Requirements

**Scheduling (Story 1)**

- **FR-001**: Media jobs MUST NOT all share one strictly-sequential queue. Work whose only constraint is the single shared video transcoder MUST be serialized; other media MUST be able to proceed concurrently.
- **FR-002**: At most ONE video transcode MUST run at a time (the shared transcoder cannot be used re-entrantly).
- **FR-003**: Media that does not require a transcode (images, pass-through animated formats, already-portable videos) MUST process with limited concurrency rather than one-at-a-time.
- **FR-004**: A slow or stuck job MUST NOT prevent unrelated media sends from starting.

**Never hang (Stories 1, 2)**

- **FR-005**: Every image decode used by the send path MUST be time-bounded; a decode that does not settle MUST yield "no thumbnail" rather than block.
- **FR-006**: The encode/transcode phase of a send MUST be time-bounded, with the bound scaled to the source size so a legitimate long transcode is not cut off.
- **FR-007**: A job that exceeds its bound MUST become a retryable failure surfaced to the user, and MUST release its lane.
- **FR-008**: The metadata/thumbnail step MUST be strictly non-fatal — failure there MUST NOT abort or retry the send.
- **FR-009**: Retry MUST actually re-run a failed send (never queue behind a wedged job).

**Memory (Story 3)**

- **FR-010**: Total in-flight seal+upload bytes MUST stay within a bounded budget shared across all concurrent media work.
- **FR-011**: A single item exceeding that budget MUST still send (no deadlock).

**Failure surface (Story 4)**

- **FR-012**: The failed-send banner MUST be tappable and open the most recent failing message in a NON-hidden chat, anchored to that message.
- **FR-013**: When every failure is in a hidden chat, the banner MUST NOT navigate anywhere and MUST remain purely informative.

**Cross-cutting**

- **FR-014**: Format handling MUST be unchanged — animated WebP/GIF keep passing through unconverted; WebM keeps its best-effort MP4 conversion (specs 2050/2052).
- **FR-015**: No media is sent to the server for processing; all work stays client-side (zero-knowledge preserved).

### Key Entities *(include if feature involves data)*

- **Media job**: an outgoing media message being processed. This fix adds a *lane assignment* (does it need the shared transcoder?) and a *byte cost* (for the memory budget), both computed client-side at schedule time. No new stored or synced entity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a transcoding video in flight, subsequent photo sends complete without waiting for it, in 100% of attempts.
- **SC-002**: No media send remains in the "sending" state indefinitely; every send reaches a delivered state or a visible, retryable failure.
- **SC-003**: Retry on a failed media send actually re-runs the send.
- **SC-004**: An animated WebP and a GIF each deliver with animation intact.
- **SC-005**: A burst of mixed media (video + several images) completes with the app alive and peak in-flight upload memory bounded.
- **SC-006**: Tapping the failed-send banner opens the failing message's chat; with hidden-only failures it navigates nowhere.
- **SC-007**: Two video transcodes never run concurrently.
- **SC-008**: No regression to existing formats, quality tiers, or the zero-knowledge boundary.

## Assumptions

- The single shared ffmpeg.wasm instance is the only hard serialization constraint in the media pipeline; canvas/thumbnail work is safely concurrent.
- A missing thumbnail/poster is cosmetic — recipients fetch and render the full media regardless.
- Time bounds scaled to source size distinguish "legitimately slow" from "hung" well enough in practice; the upload phase keeps its own existing timeout.
- The hidden-chat predicate used by the router guard is the correct authority for the banner's carve-out.

## Out of Scope

- Changing which formats are converted (specs 2050 / 2052 own that).
- Server-side media processing or validation (would break zero-knowledge).
- Reworking the upload transport, retry backoff policy, or quality tiers.
- A cross-restart resume/queue for interrupted media sends.
