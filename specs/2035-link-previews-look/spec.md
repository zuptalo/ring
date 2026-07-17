# Feature Specification: Link Previews Look Sharp

**Feature Branch**: `fix/2035-link-previews-look`

**Created**: 2026-07-14

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped. -->

**Input**: User bug report (2026-07-14, iPhone screenshot): a shared YouTube link's preview shows a massively blurry, stretched red play-button image instead of the video's thumbnail.

## Diagnosis (from the field repro)

YouTube DOES serve a full-quality `og:image` (maxresdefault.jpg) to Ring's unfurl
agent — but on the reported page it sits at byte offset ~641 KB, past the unfurl
relay's 512 KiB HTML cap. The sender's client never sees the tag, falls back to
the page favicon/apple-touch-icon (≤192 px), and the bubble's link card renders
ANY image `width:100%; object-fit:cover` — upscaling the icon ~6× into the blurry
hero the user saw. Two independent defects: the cap silently starves big pages of
their og tags, and the renderer has no floor below which an image is treated as
an icon rather than a hero.

## Requirements

- **FR-001**: The unfurl relay's HTML cap MUST cover real-world og-tag offsets on
  major pages (YouTube ≈ 641 KB today): raise to 1.5 MiB, still bounded. A
  regression test pins that a page with og tags past 512 KiB unfurls fully.
- **FR-002**: The link card MUST never upscale a preview image into the hero
  slot: images whose natural width is below a hero threshold (200 px) render as
  a small fixed-size icon beside the title/description instead. Previews
  without a recorded width keep today's hero presentation.
- **FR-003**: No wire or crypto change — `LinkPreview.imageWidth` already rides
  sealed in the payload; only the relay cap (server) and the card CSS/markup
  (client) change.

## Zero-Knowledge Impact

None — the relay still streams unparsed bytes and stores nothing; the preview is
still built and sealed on the sender's device.

## Success Criteria

- **SC-001**: A youtu.be link produces a sharp video-thumbnail hero (verified
  against the live site through the relay).
- **SC-002**: A page with only a favicon renders a compact icon card, never a
  stretched blurry hero (unit-verifiable via the width gate; visual via drive).
- **SC-003**: Existing unfurl SSRF guards and limits tests stay green.
