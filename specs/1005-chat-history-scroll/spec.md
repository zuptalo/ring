# Feature Specification: Chat History Scroll Performance & Media Caching

**Feature Branch**: `feat/1005-chat-history-scroll`

**Created**: 2026-06-16

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Browsing the chats, contacts, and calls infinite lists feels smooth — they load well in advance so there's no glitch or slowness. But the chat view isn't like that: scrolling up to previous conversations loads, but it's nothing like smooth, especially when the chat has audio, video, and images. Are we caching assets properly?"

## Overview

The tab lists (Chats, Contacts, Calls) feel smooth because they page/look ahead.
The in-chat message history does not: scrolling back through older messages is
janky, worst when those messages have media (images/video/audio), suggesting media
blobs/posters are being decoded or object-URL'd repeatedly (and possibly revoked
and regenerated) as rows recycle, rather than loaded ahead and cached.

This feature makes scrolling back through a conversation as smooth as the tab
lists: load older messages ahead of the scroll position, and resolve/cache media
(object URLs, posters, decoded blobs) so revisiting a message doesn't redo work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Smooth back-scroll through history (Priority: P1)

Scrolling up through a long conversation stays smooth — older messages are ready
before they're needed, with no stalls at the load boundary.

**Acceptance Scenarios**:

1. **Given** a long conversation, **When** I scroll up, **Then** older messages
   appear without visible stalls (the next page is fetched before I reach the top of
   the loaded range).
2. **Given** I scroll quickly, **When** the list pages in history, **Then** scroll
   position is preserved (no jump) and the frame rate stays smooth.

---

### User Story 2 - Media doesn't re-thrash on scroll (Priority: P1)

Scrolling past images/videos/audio, then back, doesn't re-decode or re-create their
assets each time; resolved object URLs/posters are cached and reused.

**Acceptance Scenarios**:

1. **Given** messages with media, **When** I scroll them out of view and back,
   **Then** their thumbnails/posters reappear instantly from cache (no flicker or
   regeneration).
2. **Given** a media-heavy chat, **When** I scroll, **Then** object URLs are reused
   (not revoked-and-recreated per row) and memory stays bounded (released when far
   off-screen, regenerated lazily if needed).

---

### Edge Cases

- Very long chats: caches MUST be bounded (evict far-off-screen assets) so memory
  doesn't grow without limit while staying smooth in the active window.
- Returning to the bottom (newest) after scrolling far up MUST be smooth and land at
  the latest message.
- Works with the existing reactive message store / live queries without breaking
  correctness (edits, deletes, new incoming messages while scrolled up).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat history MUST load older messages ahead of the scroll position
  (look-ahead paging) so reaching the top of the loaded range doesn't stall.
- **FR-002**: Paging older history MUST preserve scroll position (no content jump).
- **FR-003**: Resolved media assets (object URLs, video posters, decoded
  thumbnails) MUST be cached and reused across scroll, not regenerated per row
  recycle; posters reuse the persisted `posterBlob` cache.
- **FR-004**: Object URLs MUST NOT be revoked-then-recreated for messages still in
  (or near) the viewport; lifetime is tied to a bounded window, not per-render.
- **FR-005**: Caches MUST be bounded (evict assets far outside the viewport) to keep
  memory stable in very long chats, regenerating lazily on return.
- **FR-006**: Scrolling MUST remain correct under live changes (new/edited/deleted
  messages) without losing position or leaking assets.
- **FR-007**: Any new/changed UI MUST use stock Ionic components + existing theme
  tokens (Constitution XI) — e.g. reuse Ionic's infinite-scroll/virtual patterns as
  the tab lists do, rather than a bespoke scroller, where feasible.

## Zero-Knowledge Impact *(mandatory)*

- Client-only performance change. Media stays E2EE and on-device; this only changes
  how already-decrypted assets are paged/cached/released for display. No wire,
  server, data-model, or at-rest change.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Scrolling back through a long media-heavy chat shows no stall at the
  page boundary and no thumbnail/poster regeneration on re-view (manual device check
  + assertions where feasible).
- **SC-002**: Object URLs / posters for a given media item are created once per
  in-window appearance and reused on scroll-back (instrumented/unit-tested at the
  cache layer).
- **SC-003**: Memory stays bounded in a very long chat (assets released when far
  off-screen).
- **SC-004**: Scroll position is preserved when older pages load.

## Assumptions

- The root cause is per-render media resolution (object URL creation + poster
  decode) and/or eager revocation as rows recycle, plus no look-ahead paging — vs.
  the tab lists which page ahead. Plan will confirm against `ChatDetailPage`'s
  message rendering + `mediaInfo` resolution and the paging (`PAGE`/`visible`) logic.
- A bounded LRU-style asset cache keyed by mediaId (object URL + posterUrl) is
  sufficient; reuse the persisted `posterBlob` so posters never regenerate.
- This builds on 2002 (bounded, cached poster generation) and the 1001 warm-store
  patterns; no new dependency expected.
