# Contracts: Multi-Size Thumbnails + Album Viewer (spec 1014)

No new network/server interface. The contracts are (1) the reused E2EE wire field, (2) the
thumbnail-generation + storage API, and (3) the observable viewer/cleanup behavior the tests assert.

## 1. Wire contract — REUSED, minimally extended

The only artifact crossing the client/server boundary is the existing **sealed media message** with
its `MediaRef`:

```
MediaRef { ...existing..., poster?: string /* small JPEG data URL, E2EE */ }
```

- **Change**: `poster` is now populated for **images** (the 512px bubble tier), not just videos.
- The full image remains a separate encrypted blob (capability id), fetched on demand.
- **Invariant**: the server sees only opaque ciphertext (a `poster`-bearing sealed message + the
  encrypted blob); no plaintext, no new frame/endpoint, no new metadata beyond a modestly larger
  encrypted body (same nature as today's video poster).

## 2. Thumbnail + storage API (client, internal)

```
// media-meta.ts — size-parameterized thumbnail generation
generateThumb(srcBlob, maxEdge, quality) -> Blob            // images; reused for the 3 tiers
// derive the two smaller tiers from the large (bubble) tier:
deriveTiers(posterBlob) -> { grid: Blob /*320*/, strip: Blob /*128*/ }

// queries.ts — storage + cleanup (extended)
storageByType()  -> { total, byKind, thumbnailBytes }       // originals vs thumbnails distinct
storageByChat()  -> [{ chatId, name, bytes, thumbnailBytes, count }]
deleteMedia(...) -> removes blob + posterBlob + posterGrid + posterStrip (no orphans)
freeKeepingPreviews(scope) -> deletes blob, sets mediaCleared, keeps the tiers
clearChatMedia(chatId, opts) -> per-chat cleanup
```

**Contract for tiers:** `posterBlob` (bubble 512) is sent/persisted; `posterGrid` (320) and
`posterStrip` (128) are derived from `posterBlob` and persisted; videos derive grid/strip from their
existing poster (no re-encode). Generation never blocks the send path; backfill is bounded/background.

## 3. Behavior contracts (asserted by e2e + quickstart)

**Thumbnails (US1):**
- An incoming image with auto-download OFF shows a bubble + grid preview **without** fetching the full
  image (from the sent `poster` → `posterBlob`).
- The chat bubble renders from `posterBlob` (never the full image); grid from `posterGrid`; viewer
  strip from `posterStrip`; viewer main from the full `blob`.
- Reopening the all-media grid shows persisted tiers (no regeneration / loading flash).

**Robustness (US2):**
- Deleting/clearing the viewed item (or all media) never yields a broken image or out-of-range error —
  placeholder or graceful close. Cleared/undownloaded items render a placeholder.
- Large-album swiping holds only a small fixed window of full-resolution images in memory.
- Zoom resets per item (no bleed); the active item always matches what's shown.

**Navigation (US3):**
- Position indicator present; ←/→ move and Esc closes (focus trapped, restored on close); the strip
  centers the active item; closing restores the prior grid/chat scroll position.

**Cleanup (US4):**
- Storage usage includes thumbnail bytes (shown distinctly); deleting media leaves no orphan tiers;
  "free space, keep previews" removes originals while previews still render; per-chat cleanup defaults
  to the current chat with an app-wide option.

**a11y / RTL / theme (US5):**
- Images/controls have meaningful labels; viewer operable without a pointer; RTL navigation/strip
  order correct; viewer respects light/dark via theme tokens.

## 4. Invariants / non-regressions
- No image plaintext crosses the wire; server relays only opaque ciphertext (SC-009).
- Spec-1011/1012/1013 chat-scroll behavior unchanged (the bubble swap is a same-size image source).
- `DB_VERSION` 7→8 migration preserves all existing media (additive fields only).
