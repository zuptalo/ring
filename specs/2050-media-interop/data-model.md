# Data Model — Cross-browser media interop (spec 2050)

No persisted or synced entity is added. This feature adds **client-side decision logic**
and reuses the existing `Message` failure field. The server keeps storing opaque blobs.

## Portability decision (pure, `media-portability.ts`)

Computed at send time from the media blob's MIME + chosen quality; never stored.

```ts
// A video container that plays natively on all target browsers (incl. Safari/iOS).
export function isPortableVideo(mime: string): boolean;      // mp4 / quicktime(mov) / m4v

// A non-portable video MUST transcode to MP4 regardless of quality (incl. 'original').
export function needsMandatoryTranscode(mime: string, quality: string): boolean;

// HEIC/HEIF still image needing decode→JPEG before send.
export function isHeic(mime: string): boolean;               // image/heic, image/heif

// A raster image whose transparency must be preserved (don't flatten to JPEG).
export function imageNeedsAlphaPreserve(mime: string, hasAlpha: boolean): boolean;
```

## Reused: `Message.failReason`

Extend the existing failure reason set (currently `'too-large'`) with `'cant-convert'`
for a non-portable media that could not be made interoperable (drives an honest failure
card). No schema change — `failReason` is already an optional string field on `Message`.

## Media blob (unchanged wire)

An outgoing media item is a blob with a MIME type + chosen quality. This feature changes
the **bytes** it becomes (MP4 instead of WebM, JPEG instead of HEIC, alpha-preserving PNG/
WebP instead of flattened JPEG) but not the wire: the server still receives sealed,
client-encrypted ciphertext stored as `application/octet-stream` (`media-transfer.ts`
preserves `blob.type` end-to-end for the recipient's player). Nothing new is persisted,
synced, or made visible to the server.

## State / lifecycle

- The portability decision is derived per send and discarded; it is display/flow logic only.
- Conversion happens once, on the client, before encryption; a failure marks the message
  failed (existing lifecycle) with the honest reason — no partial/raw upload.
