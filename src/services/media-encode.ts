/**
 * Outgoing-media compression. Photos are re-encoded on a canvas here; videos are
 * transcoded by a platform-adaptive engine (WebCodecs where available, else
 * ffmpeg.wasm, see media-video.ts). 'original' always passes the blob through
 * untouched, and every path falls back to the original blob on any failure so a
 * send is never blocked by compression.
 */
import { compressVideoAdaptive } from './media-video';

export type Quality = 'sd' | 'hd' | 'original';

interface ImagePreset {
  maxEdge: number; // longest side, px
  quality: number; // JPEG quality 0..1
}
const IMAGE_PRESETS: Record<'sd' | 'hd', ImagePreset> = {
  sd: { maxEdge: 1280, quality: 0.6 },
  hd: { maxEdge: 2048, quality: 0.82 },
};

/** Re-encode a photo to the SD/HD preset (downscaled JPEG). Returns the original
 *  blob for 'original', if the re-encode would be larger, or on any error. */
export async function compressImage(blob: Blob, quality: Quality): Promise<Blob> {
  if (quality === 'original') return blob;
  const preset = IMAGE_PRESETS[quality];
  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, preset.maxEdge / longest);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', preset.quality),
    );
    // Keep whichever is smaller; re-encoding an already-tiny/optimized image can grow it.
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
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

/** A human label for a byte size (for the quality sheet hints). */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
