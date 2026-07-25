/**
 * Outgoing-media compression. Photos are re-encoded on a canvas here; videos are
 * transcoded by a platform-adaptive engine (WebCodecs where available, else
 * ffmpeg.wasm, see media-video.ts). 'original' always passes the blob through
 * untouched, and every path falls back to the original blob on any failure so a
 * send is never blocked by compression.
 */
import { compressVideoAdaptive } from './media-video';
import { isHeic } from './media-portability';

export type Quality = 'sd' | 'hd' | 'fhd' | 'original';
export type Tier = Exclude<Quality, 'original'>;

/**
 * The send-quality tiers, smallest → largest target resolution. The `maxEdge` (longest
 * side, px) is the SINGLE SOURCE OF TRUTH that drives both the badge label and which
 * tiers the picker offers for a given source (spec 2007). A tier is offered only when
 * the source is at least that resolution — `maxEdge` doubles as the suitability
 * threshold, so we never offer a tier that would upscale. Names are resolution-based
 * (720p/1080p) and mean the same pixels for photos and videos.
 *
 * Full HD (1080p) is the top tier: a 4K re-encode tier was tried and dropped — on-device
 * H.264 encoding at 2160p is unreliable/very slow (notably the iOS hardware encoder),
 * and a 4K photo re-encode barely beats Original. Full HD already delivers a large,
 * reliable reduction; Original remains for full fidelity.
 */
export const QUALITY_TIERS: { key: Tier; maxEdge: number; label: string }[] = [
  { key: 'sd', maxEdge: 640, label: 'SD' },
  { key: 'hd', maxEdge: 1280, label: 'HD' },
  { key: 'fhd', maxEdge: 1920, label: 'Full HD' },
];

const QUALITY_LABELS: Record<Quality, string> = {
  sd: 'SD',
  hd: 'HD',
  fhd: 'Full HD',
  original: 'Original',
};

/** Human label for the badge / picker (e.g. 'Full HD'). */
export function qualityLabel(q: Quality): string {
  return QUALITY_LABELS[q] ?? '';
}

/**
 * The quality tiers worth offering for a source whose longest edge is `longEdge` px,
 * plus 'original'. A tier shows only when the source is at least its resolution
 * (`longEdge >= maxEdge`), so it either downscales or re-encodes same-resolution at a
 * lower bitrate — never upscales. When the source size is unknown, offer every tier
 * (the honest-labeling pass demotes any that can't actually shrink to 'original').
 * For a batch, pass the LARGEST source's long edge so every tier that benefits at
 * least one item is offered (spec 2007).
 */
export function availableQualities(longEdge?: number): Quality[] {
  const tiers = QUALITY_TIERS.filter((t) => !longEdge || longEdge >= t.maxEdge).map((t) => t.key);
  return [...tiers, 'original'];
}

interface ImagePreset {
  maxEdge: number; // longest side, px
  quality: number; // JPEG quality 0..1
}
const IMAGE_PRESETS: Record<Tier, ImagePreset> = {
  sd: { maxEdge: 640, quality: 0.6 },
  hd: { maxEdge: 1280, quality: 0.72 },
  fhd: { maxEdge: 1920, quality: 0.8 },
};

// Formats we NEVER re-encode on send. Re-encoding goes through a canvas + JPEG export,
// which flattens an animated GIF / animated WebP to a single static frame (and drops
// WebP's alpha + already-efficient compression). Passing the original bytes through
// keeps animation intact for the recipient and preserves transparency. WebP is already
// well-compressed, so skipping the JPEG re-encode costs little even for static ones.
const PRESERVED_IMAGE_MIME = new Set(['image/gif', 'image/webp']);

/** Whether outgoing media of this MIME type must be sent untouched (animation/alpha). */
export function isPreservedImageMime(mime: string): boolean {
  return PRESERVED_IMAGE_MIME.has(mime);
}

/** Re-encode a photo to the SD/HD preset (downscaled JPEG). Returns the original
 *  blob for 'original', for animated/efficient formats (GIF/WebP), if the re-encode
 *  would be larger, or on any error. */
export async function compressImage(blob: Blob, quality: Quality): Promise<Blob> {
  // (spec 2050) HEIC/HEIF → JPEG first, on ALL senders, so the photo is viewable on every
  // browser (raw HEIC renders only on Safari). Done BEFORE the quality/preserve checks and
  // OUTSIDE the fallback try below: a genuine decode failure must propagate so the caller
  // can fail the send honestly rather than upload raw HEIC.
  let src = blob;
  if (isHeic(blob.type)) {
    const { decodeHeicToJpeg } = await import('./heic-decode');
    src = await decodeHeicToJpeg(blob);
  }
  if (quality === 'original') return src;
  if (isPreservedImageMime(src.type)) return src; // keep GIF/WebP animation + alpha
  const preset = IMAGE_PRESETS[quality];
  if (!preset) return src;
  try {
    const bitmap = await createImageBitmap(src);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, preset.maxEdge / longest);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return src;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    // (spec 2050) Preserve transparency: a PNG with an alpha channel is exported as PNG
    // (alpha-capable), never flattened to an opaque JPEG. Opaque images (incl. opaque PNGs)
    // keep the smaller JPEG downscale.
    const keepAlpha = /png/i.test(src.type) && canvasHasAlpha(ctx, w, h);
    const out = keepAlpha
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', preset.quality));
    // Keep whichever is smaller; re-encoding an already-tiny/optimized image can grow it.
    // For an alpha PNG that grew, we still return the ORIGINAL (which keeps its transparency).
    return out && out.size < src.size ? out : src;
  } catch {
    return src;
  }
}

/** (spec 2050) Whether the drawn canvas has any non-opaque pixel. Early-exits on the first
 *  transparent pixel, so a transparent logo/sticker is detected fast; a fully-opaque image
 *  scans through (bounded, one-time per send). */
function canvasHasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // getImageData can throw on a tainted canvas; assume no alpha (fall back to JPEG).
    return false;
  }
}

/** Transcode a video to the SD/HD preset; passthrough for 'original'. Delegates
 *  to the adaptive engine, which itself falls back to the original on failure.
 *  `onProgress` reports 0..1 during the transcode. */
export function compressVideo(
  blob: Blob,
  quality: Quality,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  if (quality === 'original') return Promise.resolve(blob);
  return compressVideoAdaptive(blob, quality, onProgress);
}

/**
 * The quality a send ACTUALLY achieved, as opposed to the one the user requested.
 *
 * The HD/SD/Original badge must never claim a tier the bytes aren't: a transcode
 * legitimately can't shrink some clips (capability gaps, already-small sources, an
 * engine that fell through to the original — see media-video.ts). `compressImage`/
 * `compressVideo` return the *original blob* in exactly those cases, so "did a real
 * re-encode happen?" is simply "is the uploaded blob smaller than the source?".
 *
 * Returns the requested tier only when a genuinely smaller blob was produced;
 * otherwise 'original' — including when the request was already 'original'. This is
 * the single source of truth for the labeling invariant (spec 2007 FR-007/FR-008),
 * shared by the chat send path and the Posts path so they can't drift.
 */
export function achievedQuality(
  requested: Quality | undefined,
  originalSize: number,
  uploaded: Blob,
): Quality {
  if (!requested || requested === 'original') return 'original';
  // A real downscale/re-encode always shrinks the bytes; equal-or-larger means the
  // engine sent the original (compress* returns the source ref on failure/no-gain).
  return uploaded.size < originalSize ? requested : 'original';
}

/** A human label for a byte size (for the quality sheet hints). */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
