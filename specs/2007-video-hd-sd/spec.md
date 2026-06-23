# Feature Specification: HD/SD video sends are transcoded for real on device

**Feature Branch**: `fix/2007-video-hd-sd`

**Created**: 2026-06-22

**Status**: in-review
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "When a user shares a video and picks HD or SD send quality, the video must actually be transcoded to that quality on-device before sending — downscaled resolution and reduced file size. Today, only the metadata label changes (\"HD\"/\"SD\") while the original full-quality bytes are sent unchanged: a 2160p / 66.8 MB clip is sent identically for Original, HD, and SD. \"Original\" must continue to send the file exactly as-is. For HD/SD the transcode must reliably happen on real devices, especially iOS with large 4K .mov clips. A clip must never be labeled a quality it did not actually achieve."

## Context

A user reported that choosing **HD** or **SD** when sharing a video has no real
effect: the recipient still receives the full-quality original. The attached
evidence shows the same clip sent three ways — **Original**, **HD**, and **SD** —
all reading **2160p · 0:22 · 66.8 MB**. Identical resolution and byte size across
all three tiers means the lower-quality tiers transmitted the original bytes and
only the on-screen label differed.

This is both a data-cost problem (users who deliberately pick a smaller tier to
save bandwidth/storage still pay the full cost) and a trust problem (the app
tells the user it sent "HD" when it sent the untouched 4K original). The most
likely affected case is a phone-captured 4K clip on iOS, where the higher cost of
on-device transcoding makes a silent degrade-to-original most likely.

## Clarifications

### Session 2026-06-22

These decisions were resolved with delegated authority (the maintainer asked the
pipeline to proceed autonomously); they are recorded here as the canonical answers.

- Q: How is the quality badge's tier word decided when the source is already
  smaller than the picked tier (e.g. a 720p clip sent as "HD")? → A: **Byte-based
  honesty.** The tier word ("HD"/"SD") is shown only when the app actually
  re-encoded the clip to that tier. If the original bytes were transmitted — for
  *any* reason, including the source already being at/below the tier or a
  transcode that could not reduce the file — the clip is labeled **Original**. The
  displayed resolution/duration/size always describe the delivered file.
- Q: When a transcode cannot reduce the file, should the user be blocked or warned
  *before* the send, or only see honest labeling *after*? → A: **After-the-fact
  honesty, never blocked.** The send always completes; if only the original could
  be sent, the clip is presented as Original. No pre-send confirmation gate is
  added.
- Q: Do the HD/SD resolution targets themselves change? → A: **No.** The existing
  per-tier resolution caps are retained; this work makes them *enforced*, not
  *redefined*.

### Session 2026-06-22 (tier expansion)

Scope extension requested while 2007 was in-progress: add **Full HD** and **4K**
quality tiers and only offer tiers suitable for the chosen media.

- Q: What is the tier set and what do the new tiers do? → A: **SD / HD (720p) /
  Full HD (1080p) / 4K (2160p) / Original.** Each non-Original tier **re-encodes to
  H.264** at a target resolution + bitrate (SD 640/1 Mbps, HD 1280/2.5 Mbps, Full HD
  1920/5 Mbps, 4K 3840/18 Mbps). The 4K tier keeps 2160p but re-encodes the source's
  (often huge, HEVC) bitrate down — shrinking the file *and* making it play on
  Android. Honest labeling (FR-007) still governs: a tier that can't actually shrink
  the file is sent + labeled Original.
- Q: Which media gets the expanded tiers + suitability filtering? → A: **Both photos
  and videos.** The tier names map to the same pixel caps for both.
- Q: How is "suitable" decided? → A: A tier is offered only when the source's longest
  edge is **≥ the tier's resolution**, so it never upscales; Original is always
  offered. For a batch, suitability is based on the **largest** source. When only
  Original applies (a source smaller than the smallest tier), the picker is skipped.

### Session 2026-06-23 (4K dropped after on-device testing)

- Q: Keep the 4K (2160p) tier? → A: **No — dropped for both photos and videos.**
  On-device testing on an iPhone 15 Pro showed: (a) the 4K **video** re-encode is
  unreliable and very slow (the iOS hardware H.264 encoder stalls at 2160p, then
  falls back to Original), and (b) a 4K **photo** re-encode gives no meaningful size
  reduction over Original. Full HD (1080p) becomes the top tier — it delivers a
  large, reliable reduction — with Original for full fidelity. SD / HD / Full HD all
  verified working on-device with correct resolution, size, and metadata.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choosing HD or SD actually shrinks the video (Priority: P1)

A user shares a large, high-resolution video from their phone and picks **SD** (or
**HD**) because they want a smaller, faster, cheaper send. The recipient receives a
genuinely smaller clip at the lower resolution — not the full original.

**Why this priority**: This is the entire point of the quality picker and the
reported defect. Without it, the SD/HD options are decorative and actively
mislead users about their bandwidth and storage use.

**Independent Test**: From a device, share a 2160p clip choosing SD; confirm on
the recipient side that the received video's resolution is capped to the SD tier
and its byte size is materially smaller than the original. Repeat for HD and
confirm HD is between SD and Original in both resolution and size.

**Acceptance Scenarios**:

1. **Given** a 2160p source video, **When** the sender picks SD, **Then** the
   delivered clip's longest edge is at most the SD cap and its file size is
   meaningfully smaller than the original.
2. **Given** the same 2160p source, **When** the sender picks HD, **Then** the
   delivered clip's longest edge is at most the HD cap, smaller than the original
   but larger than the SD version.
3. **Given** a large 4K `.mov` captured on an iPhone, **When** the sender picks HD
   or SD, **Then** the clip is actually re-encoded on the device before it leaves,
   not sent as the original, and the app does not freeze or lose the send.
4. **Given** a slow transcode, **When** it is running, **Then** the sender sees
   real, advancing progress and the rest of the app stays usable.

---

### User Story 2 - The badge never lies about what was sent (Priority: P1)

The quality/size badge on a sent video always describes the file the recipient
actually received. If the system was unable to produce a smaller file, the video
is presented honestly as original quality rather than mislabeled HD/SD.

**Why this priority**: Even once transcoding works on most devices, some clips
(unusual codecs, already-small sources, capability gaps) cannot be reduced. The
app must never claim a quality it did not deliver — the reported screenshot is
exactly this failure (label said HD/SD, bytes were original).

**Independent Test**: Force a case where transcoding cannot reduce the file (e.g.
an already-tiny clip or an unsupported source) and confirm the badge reports the
true resolution/size and does not display "HD" or "SD".

**Acceptance Scenarios**:

1. **Given** a send where the transcode could not produce a smaller file, **When**
   the message appears, **Then** it is labeled as original quality (not HD/SD) and
   the resolution/duration/size shown match the bytes actually sent.
2. **Given** a successful SD transcode, **When** the message appears, **Then** the
   badge shows the SD label together with the reduced resolution and size — and
   these are internally consistent (the resolution shown is the reduced one).
3. **Given** any sent video, **When** its badge shows a resolution, **Then** that
   resolution equals the resolution of the file the recipient downloads.

---

### User Story 3 - Original quality is sent untouched (Priority: P2)

A user who picks **Original** receives the exact same bytes and embedded metadata
they would get by sharing the file directly — no re-encoding, no quality loss.

**Why this priority**: This already works today and must be preserved as a
regression guard while the HD/SD path is fixed. "Original" is the trustworthy
escape hatch for users who care about fidelity.

**Independent Test**: Send a clip at Original and verify the received file is
byte-for-byte identical to the source (same size, same container/metadata).

**Acceptance Scenarios**:

1. **Given** any source video, **When** the sender picks Original, **Then** the
   delivered file is byte-identical to the source and its badge reads "Original"
   with the source's true resolution, duration, and size.

---

### Edge Cases

- **Source already at/below a tier**: a 480p clip sent as "HD" cannot be made
  larger; it must be sent as-is and labeled truthfully (original quality), never
  upscaled.
- **Transcode would grow the file**: if re-encoding a short/already-compressed
  clip produces a larger file, the smaller (original) file is sent and labeled
  honestly.
- **Unsupported codec / capability gap**: if the device cannot re-encode the
  source, the send still completes (original) and is labeled honestly — never
  blocked, never mislabeled.
- **Very large / long 4K clips on a phone**: transcoding must complete without
  exhausting memory, freezing the UI, or silently giving up to the original.
- **Portrait vs. landscape**: the resolution cap applies to the longest edge so
  aspect ratio is preserved for both orientations.
- **Video with no audio track**: transcodes correctly with no audio rather than
  failing.
- **App reload mid-transcode**: an interrupted encode resumes or restarts and
  still results in either a correctly transcoded send or an honestly labeled
  original — never a phantom or mislabeled message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the sender selects HD or SD, the video that is encrypted and
  uploaded MUST be a re-encoded version whose longest edge does not exceed the
  selected tier's resolution cap (SD smaller than HD), unless the source is
  already within that cap.
- **FR-002**: An HD/SD send MUST result in a file smaller than the original
  whenever the source exceeds the tier; the smaller tier (SD) MUST produce a file
  no larger than the higher tier (HD) for the same source.
- **FR-003**: Selecting Original MUST transmit the source file's exact bytes and
  embedded metadata, with no re-encoding.
- **FR-004**: All transcoding MUST happen on the sender's device before any video
  bytes leave it, preserving the zero-knowledge boundary (the server only ever
  relays the already-reduced, encrypted file).
- **FR-005**: The system MUST successfully transcode common phone-capture video,
  explicitly including large 2160p/4K clips on iOS, without silently falling back
  to sending the original.
- **FR-006**: A video send MUST NOT be blocked or lost because transcoding is
  slow or fails; if the system cannot produce a reduced file, it MUST fall back to
  sending the original AND apply FR-007.
- **FR-007**: The quality badge MUST reflect the file actually sent. A video MUST
  NOT be labeled HD or SD unless the app actually re-encoded it to that tier;
  whenever the original bytes are transmitted — including when the source was
  already at/below the picked tier, or a transcode could not reduce the file — the
  clip MUST be labeled as original quality.
- **FR-008**: The resolution, duration, and byte-size shown on a sent video MUST
  match the file the recipient downloads, and MUST be mutually consistent (the
  displayed resolution is the resolution of the delivered file).
- **FR-009**: While a transcode runs, the sender MUST see accurate progress and
  the rest of the app MUST remain responsive.
- **FR-010**: The system MUST NOT upscale a source that is already below the
  selected tier; it sends the source as-is and labels it truthfully.
- **FR-011**: The send-quality picker MUST offer the tiers SD, HD (720p), Full HD
  (1080p), and Original, for both photos and videos. Each non-Original tier
  re-encodes the media to that tier's target resolution + bitrate/quality. (A 4K
  tier was evaluated and dropped — see Clarifications 2026-06-23.)
- **FR-012**: The picker MUST offer only tiers a given source can actually produce:
  a tier is shown only when the source's longest edge is at least that tier's
  resolution (never upscaling); Original is always offered. For multiple items chosen
  together, suitability is based on the largest source. When only Original applies,
  the quality choice MAY be skipped.
- **FR-013**: The Full HD tier MUST re-encode at its target resolution even when no
  downscale is needed, to reduce a high-bitrate source's size and produce a
  cross-platform-playable H.264 result; if it cannot reduce the file, FR-007 applies
  (sent + labeled Original).
- **FR-014**: After a media send completes, the sender's on-device copy MUST be the
  media that was actually sent (the compressed blob for an HD/SD/Full HD send), not
  the full original. The reported storage usage and the bubble badge MUST therefore
  agree, and sent items MUST be counted and cleaned up the same way as received
  items. (The original is retained during encode/upload so a retry can re-encode it,
  and is swapped for the sent blob only on success. Original-quality sends keep the
  full bytes.)
- **FR-015**: Media or documents DELETED to free space MUST NOT remain in the
  "Media, links & docs" gallery (Media grid, Docs list) or its fullscreen viewer —
  they leave a "removed to free space" placeholder in the chat itself, but no empty
  tile/row in the gallery. Items "freed keeping previews" still appear (their preview
  remains). Links are text, never blob-backed, so cleanup never affects them.
- **FR-016**: An on-device transcoded video MUST be playable on the platforms Ring
  targets, including iOS Safari / the installed iOS PWA (QuickTime is stricter than
  Chromium/macOS). The muxed output MUST start both tracks at t=0 with A/V sync
  preserved, so iOS reports a valid duration and plays it — for both the sender's
  stored copy and recipients.

### Key Entities *(include if feature involves data)*

- **Outgoing video message**: the requested quality tier (Original/HD/SD), the
  *achieved* quality (what was actually sent), and the delivered file's dimensions,
  duration, and byte size. The distinction between *requested* and *achieved*
  quality is central — the badge is driven by *achieved*, not *requested*.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a 2160p source, an SD send delivers a clip whose longest edge is
  capped to the SD tier and whose byte size is at least 60% smaller than the
  original.
- **SC-002**: For the same 2160p source, an HD send delivers a clip smaller than
  the original and larger than the SD version, capped to the HD tier.
- **SC-003**: An Original send delivers a file byte-identical to the source.
- **SC-004**: Across all supported send paths, 0% of videos are mislabeled — every
  clip badged HD or SD is genuinely at or below that tier, and every clip that
  could not be reduced is badged as original quality.
- **SC-005**: A 2160p clip of typical length (≈20–30 s) shared from a current iPhone
  is transcoded on-device and sent at the chosen tier without the app freezing and
  without losing the send.
- **SC-006**: 100% of attempted video sends complete (transcoded or honestly
  labeled original); none are silently dropped due to transcode failure.
- **SC-007**: For the exact reported scenario (2160p · 0:22 · 66.8 MB), sending the
  same clip at Original, HD, and SD yields three visibly different sizes and the
  HD/SD versions report lower resolutions than the original.
- **SC-008**: A source ≥1080p offers SD, HD, Full HD, and Original and yields four
  descending sizes (SD < HD < Full HD < Original); a 720p source offers only SD, HD,
  and Original (never Full HD).
- **SC-009**: After a compressed send, the sender's on-device stored bytes for that
  item equal the sent size (not the original), so the storage figure in Settings
  matches the badge; an Original send stores the full bytes.

## Assumptions

- The existing three-tier picker (Original / HD / SD) and its resolution targets
  are retained; this work makes HD/SD behave, not redesign the picker.
- "Honest labeling" means: when only the original could be sent, the clip is
  presented as original quality after the fact; the user is not required to
  re-confirm or re-pick before the send completes (sends are never blocked).
- The resolution caps for HD and SD remain the current product values; the spec
  fixes that they are *enforced*, not what their exact pixel values are.
- The fix targets the supported client platforms (installed PWA on iOS and
  Android/Chromium); server behavior is unchanged since the server only relays
  opaque encrypted blobs.
- A modest size increase is acceptable only when a source is already small enough
  that re-encoding cannot help, in which case the original is sent and labeled
  honestly.
