# Research: Multi-Size Image Thumbnails + Album-View Overhaul (spec 1014)

Phase 0 — current-state map (from the album-view review workflow) and the decisions that ground the
design. Line numbers approximate.

## Current state (what exists)

- **Encode** — `src/services/media-encode.ts`: image compression presets `sd` (1280px @0.6), `hd`
  (2048px @0.82), `original` passthrough. No thumbnails.
- **Thumbnails** — `src/utils/media-meta.ts`: `generateVideoPoster` (~480px data URL),
  `generateImageThumb` (~400px Blob, only when >400px); both via a shared `posterLimiter` (concurrency 2).
- **Wire** — `src/services/crypto/message.ts` `MediaRef` carries `poster?: string` (a small JPEG
  **data URL**) inside the sealed E2EE message — this is how the **video** poster already travels.
  `prepareOutgoingMedia(..., extra:{width,height,poster,quality})` builds the `MediaRef`;
  `receiveIncomingMedia(ref)` stores the blob. The full image is a separate encrypted blob
  (capability id); the poster is inline in the per-recipient sealed message.
- **Store** — `src/db/types.ts` `Media { id, kind, mime, name, size, blob, posterBlob?, durationSec?,
  updatedAt }` — single `posterBlob` (video thumb). `DB_VERSION = 7` (after spec 1013).
- **Surfaces** — chat bubble renders the **full image** CSS-scaled to 240px (decodes full-res on
  scroll); `AllMediaPage.vue` grid generates a 400px thumb **on-demand, unpersisted**;
  `MediaViewer.vue` strip (~44px) reuses that 400px thumb; viewer main uses the full image.
- **Cleanup** — `queries.ts`: `clearAllMedia`, `deleteMediaByKind(kinds, chatId?)`,
  `deleteMediaLargerThan(bytes, chatId?)`, `storageByChat()`, `storageByType()` (sums `media.size`
  only). `StorageManagePage.vue` shows by-type + per-chat (rows non-actionable). `Message.mediaCleared`
  marks a freed blob.
- **Album view review** surfaced concrete robustness/fluidity/a11y/RTL/theme gaps (see spec US2/US3/US5).

## Decisions

### D1 — Wire transport: send ONE thumbnail tier inline, derive the rest locally
**Decision**: The sender transmits a single inline thumbnail per media via the existing
`MediaRef.poster` data-URL field (already E2EE) — for **images** populate `poster` with the **bubble
tier (512px)**; for **videos** keep the existing poster. Both sender and recipient then **derive the
grid (320px) and strip (128px) tiers locally** by downscaling that sent thumbnail, and persist all
three. The recipient therefore has every tier **before/without downloading the full image**.
**Rationale**: Reuses the established E2EE poster path (no new wire field/frame; zero-knowledge
unchanged); minimizes per-recipient payload (the sealed message is per-recipient, so sending only the
largest needed tier and deriving the two smaller ones avoids ~2× thumbnail bytes per group member);
grid/strip are exact downscales of the bubble tier (high quality, cheap). Satisfies FR-002 (previews
before download, sourced from the sender, not from the full image).
**Alternatives**: send all three tiers inline (≈2× payload, esp. in groups) — rejected; upload tiers
as a separate shared encrypted blob (adds a fetch, defeats "instant") — rejected.

### D2 — Tier sizes & format
**Decision**: max-edge **strip 128 / grid 320 / bubble 512** (clarified), JPEG at ~0.7 quality (the
existing thumb format). The bubble tier (512) is the "large" tier stored in `posterBlob`.
**Rationale**: sharp at the ~44 / ~130 / ~240px display sizes on 2–3× DPI; small bytes; 512 source
downsamples cleanly to 320/128.

### D3 — Media schema + migration
**Decision**: extend `Media` with `posterGrid?: Blob` and `posterStrip?: Blob`; **repurpose
`posterBlob` as the large/bubble tier** (video poster as today; image bubble 512 going forward).
Bump `DB_VERSION` **7 → 8** with a forward, additive migration (no data transform — existing rows
keep `blob`/`posterBlob`; the new fields are filled by the backfill job, D8).
**Rationale**: additive optional Blobs fit the flat store; reuses `posterBlob` so the bubble tier
needs no new field; Constitution V (version bump + forward migration preserving data).
**Alternatives**: a separate `thumbnails` store keyed by (mediaId,size) — more flexible but heavier;
deferred.

### D4 — Per-surface tier usage
**Decision**: chat bubble → `posterBlob` (no full image); all-media grid → `posterGrid`; viewer strip
→ `posterStrip`; viewer main → full `blob` (re-download on demand if cleared, D7). In-bubble album
grid cells → `posterGrid`.
**Rationale**: each surface decodes only what it shows (FR-004); fixes the full-res-decode-on-scroll
and oversized-strip issues.

### D5 — Generation timing
**Decision**: generate the bubble tier at **send** (outgoing) and on **receive** (from the sent
poster); derive grid/strip in the **background** (media-jobs, throttled, not on the send path).
Videos derive grid/strip from their existing poster (no re-encode).
**Rationale**: FR-006 (never block send); FR-006a (video tiers from poster).

### D6 — Backfill existing on-device media
**Decision**: a one-time, bounded background pass generates the missing tiers for media already on
device (resumes like other media jobs; gated so it doesn't compete with interactive work). Not-yet-
downloaded legacy media gets tiers when fetched.
**Rationale**: FR-006b; the perf/preview win reaches existing media-heavy chats.

### D7 — Keep-thumbnails → re-download original
**Decision**: "free space, keep previews" deletes the full `blob` but keeps the tiers; opening the
viewer main re-downloads the original on demand (still on the server as sealed ciphertext until
expiry/sender-cleanup), showing the upscaled `posterBlob` as a placeholder while fetching; if
unavailable, stay on the upscaled thumb with a retry/download affordance.
**Rationale**: clarified; reuses the existing on-demand media fetch (`receiveIncomingMedia` /
download path); best quality without keeping the bytes.

### D8 — Cleanup accounting & actions
**Decision**: extend `storageByChat`/`storageByType` to sum `blob + posterBlob + posterGrid +
posterStrip`, reporting originals vs thumbnails distinctly; deletion removes all tiers (no orphans);
add a "free space, keep previews" action (delete `blob`, set `mediaCleared`, keep tiers); make
per-chat cleanup first-class (the all-media screen defaults to this chat; StorageManagePage per-chat
rows get actions) with an app-wide option.
**Rationale**: FR-016..FR-019.

### D9 — Viewer robustness (US2)
**Decision**: clamp/guard `index` on item-set changes (watch items length; reset/close on empty);
release stale `videoApis` entries; bounds-check `nearby()` (no `items[-1]`); reset zoom per item;
add full-res LRU eviction of off-screen viewer images using the already-imported `selectEvictions`
util (hold a small fixed window); render a placeholder for cleared/undownloaded items.
**Rationale**: FR-007..FR-010; review findings.

### D10 — Navigation & fluidity (US3)
**Decision**: add a position indicator; keyboard nav (←/→ move, Esc/back close) with a focus trap +
focus restore; center the active strip thumb reliably (imperative scroll); a zoom-exit affordance so
zoom/swipe don't lock; restore the grid/chat scroll position on close.
**Rationale**: FR-011..FR-015; review.

### D11 — a11y / RTL / theme (US5) + perf
**Decision**: meaningful `alt`/ARIA on images & controls; RTL-correct carousel via direction-agnostic
navigation (`scrollIntoView` on the active slide / logical CSS) instead of physical `scrollLeft`
(which inverts on iOS Safari); viewer uses app theme tokens (not hardcoded black); gate grid
thumbnail decode on viewport visibility (IntersectionObserver) and cap concurrent decodes (a separate
image-thumb limiter).
**Rationale**: FR-021..FR-024; Constitution X/XI; review.

## Risks / mitigations
- **Group payload**: the per-recipient sealed message carries the bubble tier (~40–60KB, same order as
  today's video poster). D1 sends one tier (not three) to keep this bounded; sizes are clarified.
- **Backfill cost on huge libraries**: bounded/throttled background job (D6), resumable; `log` if a
  large batch is deferred.
- **Migration safety**: additive fields only; existing media untouched; covered by `idb.migration.test.ts`.
- **Re-download when the server blob is already purged**: graceful fallback to the upscaled thumb (D7).
- **Viewer index/zoom races**: covered by D9 (clamp + per-item reset + bounded window).

## Out of scope (confirmed)
No server/SQL/API change (server relays the same sealed envelope); no video re-encode (grid/strip from
poster); no change to the full-image compression tiers (sd/hd/original).
