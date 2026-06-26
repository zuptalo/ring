# Phase 1 Data Model: Media Sharing & Viewer Improvements

This feature changes **how** media is oriented and previewed and **how** the viewer handles gestures
— not the data shapes. The entities below already exist; the table notes what (if anything) changes.
**No new object store, no `DB_VERSION` bump, no SQL migration.**

## Entities

### Media message (subset of `Message`, `src/db/types.ts:238-300`)

| Field | Type | Role | Change in 1018 |
|-------|------|------|----------------|
| `posterData` | `string?` (data URL) | Sender-embedded thumbnail/poster shown before/without download | **Quality only** — generated at ~512px/≤~40KB instead of 480/400 @ low quality. Same field, same type. |
| `mediaWidth` | `number?` | Intrinsic media pixel width | Unchanged shape; for video it MUST reflect the **display** (post-rotation) dimensions so bubbles/grid lay out upright (US1). |
| `mediaHeight` | `number?` | Intrinsic media pixel height | Same as above. |
| `mediaId` | `string?` | Link to the `Media` store row (blob + tiers) | Unchanged. |

### MediaRef (sealed wire format, `src/services/crypto/message.ts:18-30`)

| Field | Type | Role | Change in 1018 |
|-------|------|------|----------------|
| `poster` | `string?` (data URL JPEG) | Thumbnail carried **inside** the encrypted `MessagePayload` | **Quality/size only** (≤~40KB). No shape change. Stays inside ciphertext (Principle I). |
| `width` / `height` | `number?` | Media dimensions for layout | Must carry **display** (oriented) dimensions for video (US1). |

> The poster is part of `MessagePayload.mediaRef`, which is JSON-serialized and sealed by the ratchet
> (`sealMessage`). Raising poster quality increases ciphertext length only; readability is unchanged.

### Media store row (`Media`, `src/db/types.ts:418-438`)

| Field | Type | Role | Change in 1018 |
|-------|------|------|----------------|
| `posterBlob` | `Blob?` | "bubble" tier (512px) after receive | Improves automatically (derived from the higher-quality wire poster). |
| `posterGrid` | `Blob?` | "grid" tier (320px), derived locally | Improves automatically (derived from bubble). |
| `posterStrip` | `Blob?` | "strip" tier (128px), derived locally | Improves automatically. |

Tier sizes are defined in `src/utils/thumbs.ts` (bubble 512 / grid 320 / strip 128) — unchanged.

### Media viewer session (in-memory, `src/components/MediaViewer.vue`)

Transient UI state, never persisted:

| Field | Type | Role | Change in 1018 |
|-------|------|------|----------------|
| `zoom.scale` | `number` (1–5) | Current zoom factor | Unchanged limits; pinch now centers on focal point. |
| `zoom.tx` / `zoom.ty` | `number` | Pan translation | Gains rubber-band overscroll + inertial settle (replacing hard clamp). |
| current item index | `number` | Which item is shown | On change, zoom state MUST reset to fit-to-screen (FR-012). |
| `velocity` (new) | `number` x/y | Pan release velocity for inertia | New transient field driving the momentum rAF loop. |

## Validation / invariants

- **Orientation (US1):** for any source rotation ∈ {0,90,180,270}, the re-encoded video and its
  `mediaWidth/mediaHeight`/`poster` MUST represent the **upright (display)** orientation. A 0°/no-matrix
  source MUST be left unrotated (no double-correction, FR-003).
- **Thumbnail budget (US2):** generated poster ≤ ~40KB, longest edge ~512px; on overflow, reduce
  quality rather than dimensions. Generation failure → fall back to current behavior (never block send).
- **Backward compatibility:** messages created before 1018 keep their existing posters/encodings and
  MUST still render (FR-008); no historical re-processing.
- **Viewer (US3):** zoom resets to fit-to-screen on item change; pan is bounded after settle (no way to
  leave content permanently off-screen); pinch never triggers item paging (FR-013).

## State transitions

None persisted. The only lifecycle is the viewer's per-item zoom/pan, which resets to
`{ scale: 1, tx: 0, ty: 0 }` whenever the current item changes.
