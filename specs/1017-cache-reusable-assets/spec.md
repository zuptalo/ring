# Feature Specification: Cache reusable assets (animated emoji + avatars) so they aren't refetched

**Feature Branch**: `feat/1017-cache-reusable-assets`

**Created**: 2026-06-24

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User request: "Make sure the reusable assets are properly cached in the app so we don't refetch them every time, like animation emojis and user's avatars as long as they aren't changed."

## Overview

Some reusable assets are re-fetched or re-materialized more than they need to be:

- **Animated emoji**: each `AnimatedEmoji` `fetch`es its Noto Lottie JSON from the self-hosted
  proxy (`/v1/emoji/{codepoints}/lottie.json`) on first visibility. There is **no runtime cache**
  (the service worker only precaches the app shell) and **no in-memory cache**, so the same emoji
  is fetched again every time it scrolls into view, every chat, every app open — even though a
  given codepoint's animation never changes.
- **Avatars**: avatars are already `data:` URLs (generated initials SVGs, or decrypted profile
  images held in IndexedDB) bound directly to `<img>` — so they do **not** hit the network. The
  goal here is only to confirm they are materialized once and reused while unchanged (keyed by the
  profile's last-updated marker), not redundantly re-read/re-decoded, and that any caching we add
  is correctly **invalidated when the avatar changes**.

The per-codepoint Lottie is immutable, so it can be cached aggressively and effectively forever;
avatars must refresh when the underlying profile changes. Everything stays self-hosted and
zero-knowledge: emoji come from our own proxy (never a third-party CDN), and avatars never leave
the device.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Animated emoji load instantly after the first time (Priority: P1)

A user who has already seen a given animated emoji sees it again (same chat, another chat, or a
later session) without it re-downloading — it appears immediately from cache.

**Why this priority**: This is the concrete, repeated network refetch the user reported; caching it
removes redundant requests and makes emoji feel instant.

**Independent Test**: Render an animated emoji, then render the same emoji again; confirm the Lottie
data is served from cache (no second network fetch) within a session, and persists across reloads.

**Acceptance Scenarios**:

1. **Given** an animated emoji has been loaded once, **When** the same emoji is shown again in the
   same session, **Then** its Lottie data is reused from an in-memory cache with no new request.
2. **Given** an animated emoji was loaded in a previous session, **When** it is shown after an app
   reload, **Then** its Lottie data is served from the persistent (service-worker) cache, not the
   network.
3. **Given** an emoji has no Lottie / the fetch fails, **When** it is shown, **Then** it falls back
   to the native glyph exactly as today (caching must not change the fallback behavior).

### User Story 2 - Avatars are reused while unchanged, refreshed when changed (Priority: P2)

Navigating between screens that show the same person's avatar doesn't re-materialize it each time;
when a profile's avatar actually changes, the new one shows.

**Why this priority**: Avatars are already local `data:` URLs, so the win is smaller (avoid
redundant work, not network), but correctness of change-invalidation matters.

**Independent Test**: Show the same contact's avatar on multiple screens; confirm it isn't
redundantly re-derived; then change the profile's avatar and confirm the new image appears.

**Acceptance Scenarios**:

1. **Given** a contact's avatar is shown on one screen, **When** the same avatar is shown on
   another, **Then** it is reused (no redundant re-read/re-decode) while the profile is unchanged.
2. **Given** a profile's avatar changes, **When** any screen shows that avatar next, **Then** the
   updated avatar is shown (the cache is keyed by a change marker, not stale forever).

### Edge Cases

- **Cache growth**: the emoji cache must be bounded (size/age) so it can't grow without limit.
- **Emoji proxy update**: if the server ever changes a codepoint's Lottie, the immutable cache
  would keep the old one — acceptable for Noto (stable), but the cache strategy must be documented
  and bust-able (e.g. via the existing app-version/precache lifecycle).
- **Offline**: a cached emoji should still animate offline; an uncached one falls back to the glyph.
- **Avatar removed**: clearing/resetting an avatar must invalidate its cached entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST serve a given animated emoji's Lottie data from cache after its first
  load — both within a session (in-memory) and across sessions/reloads (persistent), without a new
  network request for an already-cached codepoint.
- **FR-002**: The animated-emoji cache MUST be bounded (by count and/or age) so it cannot grow
  unbounded, and MUST be invalidatable through the app's existing update/precache lifecycle.
- **FR-003**: Caching MUST NOT change the existing fallback: a missing Lottie or a failed fetch
  still shows the native glyph, and animation still respects the user's reduce-motion / animation
  setting.
- **FR-004**: Avatars MUST be reused while their source profile is unchanged and MUST refresh when
  the avatar changes (any cache is keyed by a change marker such as the profile's updatedAt).
- **FR-005**: All cached assets MUST remain self-hosted/local — emoji from the first-party proxy,
  avatars never leaving the device — with no third-party CDN or new external fetch introduced.

### Zero-Knowledge Impact

- **FR-006**: Caching introduces no new server endpoint, request shape, or metadata. The emoji
  proxy request is unchanged (only its result is cached); avatars stay device-local `data:` URLs.
  The cache stores only non-sensitive, public emoji animations and the device's own avatar data —
  nothing is sent anywhere new, and the server learns nothing it didn't already.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Showing an already-seen animated emoji a second time issues **zero** additional
  network requests for its Lottie within a session.
- **SC-002**: After an app reload, a previously-seen animated emoji loads from the persistent cache
  with no network request (verifiable offline).
- **SC-003**: The emoji cache stays within its configured bound (count/age) regardless of how many
  distinct emoji are viewed.
- **SC-004**: A changed avatar is reflected on next render (no stale avatar), and an unchanged
  avatar is not redundantly re-materialized across screens.
- **SC-005**: Existing behavior is unregressed: emoji fallback to glyph, reduce-motion handling,
  and avatar rendering all unchanged; the build/test suites stay green.

## Assumptions

- Animated emoji come from the first-party proxy `/v1/emoji/{codepoints}/lottie.json`; a given
  codepoint's Lottie is immutable, so it is safe to cache aggressively.
- Avatars are already `data:` URLs (generated SVG initials or decrypted profile images from
  IndexedDB) bound directly to `<img>`; they do not hit the network, so their "caching" is about
  avoiding redundant re-materialization and correct change-invalidation, not network avoidance.
- The service worker (`src/sw.ts`, Workbox) is the right layer for the persistent emoji cache
  (a runtime route), alongside a small in-memory cache in the emoji component for same-session hits.
- This is an ad-hoc enhancement (no new user-facing UI); success is measured by request counts and
  unregressed rendering.
