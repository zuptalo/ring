# Data Model: Multi-Size Image Thumbnails + Album-View Overhaul (spec 1014)

Client-first. The persisted change is two new optional blobs on the existing `Media` record (plus a
repurpose of `posterBlob`) behind a forward IndexedDB migration; the wire change is reusing the
existing `MediaRef.poster` data-URL for images. No server/SQL change.

## Persisted change — `Media` (src/db/types.ts)

| Field | Type | Meaning |
|---|---|---|
| `posterBlob` | Blob \| undefined | **Repurposed as the large/bubble tier.** Video: the existing ~480–512px poster. Image: the 512px **bubble** tier (received via `MediaRef.poster`, or generated at send/backfill). Used by the chat bubble. |
| `posterGrid` | Blob \| undefined | **New.** ~320px tier for the all-media grid + in-bubble album cells. Derived locally by downscaling `posterBlob`. |
| `posterStrip` | Blob \| undefined | **New.** ~128px tier for the full-screen viewer's bottom strip. Derived locally from `posterBlob`. |

(`blob` stays the full image/original; only loaded for the viewer main image.)

### Migration (Constitution V — forward, data-preserving)
`src/db/idb.ts`: bump `DB_VERSION` **7 → 8**. The new fields are optional Blobs, so the migration is
additive — existing `Media` rows keep `blob`/`posterBlob` untouched; `posterGrid`/`posterStrip` are
filled later by the **backfill job**, not the migration. Follow the established `migrateMessageToVN` /
`onupgradeneeded` cursor pattern (a no-op transform for the additive add is acceptable; the version
bump alone opens the upgraded store). Covered by a unit in `idb.migration.test.ts`.

## Wire — `MediaRef` (src/services/crypto/message.ts), reused

`MediaRef.poster?: string` (small JPEG **data URL**, already E2EE for video) is now **also populated
for images** with the **bubble (512px)** tier. No new field/frame. The recipient stores it as
`posterBlob` and derives `posterGrid`/`posterStrip` locally. `prepareOutgoingMedia(extra.poster)`
already carries it; `receiveIncomingMedia` already reads it.

## Derived generation

| Tier | Source | When |
|---|---|---|
| `posterBlob` (bubble 512) | sender's full image (image) / first frame (video) | send + receive (from `poster`) + backfill |
| `posterGrid` (320) | downscale `posterBlob` | background (media-jobs) on send/receive/backfill |
| `posterStrip` (128) | downscale `posterBlob` | background, alongside grid |

`media-meta.ts` gains size-parameterized thumbnail generation (extend `generateImageThumb`); a
separate image-thumb concurrency limiter (distinct from the video-poster limiter) avoids grid jank.

## Storage accounting & cleanup (src/db/queries.ts)

- `storageByType()` / `storageByChat()` sum `blob.size + posterBlob + posterGrid + posterStrip`, and
  report **originals vs thumbnails** distinctly.
- Deleting a `Media` removes **all** tier blobs (no orphans).
- New action: **free space, keep previews** — delete `blob`, set `Message.mediaCleared`, keep the tiers.
- Per-chat cleanup is first-class: `AllMediaPage` defaults to this chat; `StorageManagePage` per-chat
  rows get actions; an app-wide toggle remains.

## View state / contracts

- **Viewer item** — `{ id, url(full|undefined), posterBlob/grid/strip-derived thumb, kind, … }`; the
  viewer MUST always resolve a valid in-range item or render an explicit placeholder (cleared /
  undownloaded). Index is clamped to `[0, items.length)` on every item-set change; an empty set
  resets/closes. A small fixed LRU window of full-resolution images is held (off-screen revoked).
- **Bubble / grid / strip** read their own tier (D4); the viewer main reads the full `blob`
  (re-downloading on demand when cleared, D7).

## Entities recap
- **Thumbnail tiers** — `posterBlob` (bubble/large), `posterGrid`, `posterStrip`; persisted per
  `Media`; the bubble tier is the only one on the wire (others derived locally).
- **Full image** — `Media.blob`; viewer-only; the reclaimable bulk in cleanup.
- **Storage breakdown** — per-type / per-chat totals separating originals from thumbnails.
