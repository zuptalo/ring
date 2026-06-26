/**
 * Read media facts (dimensions, duration) and generate a video thumbnail on the
 * sender. Everything here is best-effort and time-bounded: a video/image element
 * that never fires its load/seek event (common on iOS for large clips) must not
 * hang the send pipeline, so each call resolves on a timeout with whatever it has.
 */
import { createLimiter } from '@/utils/concurrency';
import { THUMB_TIERS, THUMB_MAX_BYTES, chooseJpegQuality, dataUrlBytes } from '@/utils/thumbs';

/** Encode a canvas to a JPEG data URL at the crispest quality within the poster byte budget
 *  (spec 1018). Re-encodes per quality step via toDataURL; the chosen step's URL is the last one
 *  measured, so we keep it. Used for the on-wire video poster. */
function jpegDataUrlUnderBudget(c: HTMLCanvasElement): string {
  let chosen = '';
  chooseJpegQuality((q) => {
    chosen = c.toDataURL('image/jpeg', q);
    return dataUrlBytes(chosen);
  });
  return chosen;
}

/** Encode a canvas to a JPEG Blob at the crispest quality within the poster byte budget (spec 1018).
 *  The quality is chosen from cheap toDataURL size estimates, then encoded once as a Blob (smaller
 *  than a data URL on the wire). Used for the on-wire image poster + derived tiers. */
function jpegBlobUnderBudget(c: HTMLCanvasElement): Promise<Blob | undefined> {
  const { quality } = chooseJpegQuality((q) => dataUrlBytes(c.toDataURL('image/jpeg', q)));
  return new Promise<Blob | undefined>((res) => c.toBlob((b) => res(b ?? undefined), 'image/jpeg', quality));
}
export interface VideoMeta {
  width?: number;
  height?: number;
  durationSec?: number;
}
export interface ImageMeta {
  width?: number;
  height?: number;
}

/** Intrinsic video facts from an offscreen <video> (metadata only). */
export function readVideoMeta(blob: Blob, timeoutMs = 8000): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    let settled = false;
    const done = (meta: VideoMeta) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = setTimeout(() => done({}), timeoutMs);
    v.muted = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () =>
      done({
        width: v.videoWidth || undefined,
        height: v.videoHeight || undefined,
        durationSec: Number.isFinite(v.duration) ? v.duration : undefined,
      });
    v.onerror = () => done({});
    v.src = url;
  });
}

/** Intrinsic image dimensions. */
export function readImageMeta(blob: Blob, timeoutMs = 6000): Promise<ImageMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let settled = false;
    const done = (meta: ImageMeta) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = setTimeout(() => done({}), timeoutMs);
    img.onload = () => done({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
    img.onerror = () => done({});
    img.src = url;
  });
}

// Cap concurrent poster generations. Each one decodes a real <video>, so an
// unbounded herd (one per video in a media-heavy chat) saturated the device's
// decoders and froze/crashed the app. Two at a time keeps thumbnails filling in
// promptly while staying well within device limits (spec 2002).
const posterLimiter = createLimiter(2);

/** A small first-frame JPEG thumbnail (data URL) sent with a video message so the
 *  recipient sees a preview without downloading the clip. Time-bounded and
 *  iOS-robust: the <video> is attached (hidden) to the DOM and decoded via
 *  play() + requestVideoFrameCallback, because an offscreen seek-to-frame often
 *  never fires on iOS Safari.
 *
 *  Runs through a shared concurrency limiter so that, however many videos need a
 *  poster at once, only a couple decode simultaneously (spec 2002). */
export function generateVideoPoster(blob: Blob, maxEdge = THUMB_TIERS.bubble, timeoutMs = 10000): Promise<string | undefined> {
  return posterLimiter(() => generateVideoPosterUnlimited(blob, maxEdge, timeoutMs));
}

function generateVideoPosterUnlimited(blob: Blob, maxEdge: number, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    // Off-screen but in the DOM so iOS actually decodes frames.
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);

    let settled = false;
    const finish = (out?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        v.pause();
      } catch {
        /* ignore */
      }
      v.remove();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = setTimeout(() => finish(), timeoutMs);

    const capture = () => {
      if (!v.videoWidth || !v.videoHeight) return; // frame not ready yet
      try {
        const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(v.videoWidth * scale));
        c.height = Math.max(1, Math.round(v.videoHeight * scale));
        const cx = c.getContext('2d');
        if (!cx) return finish();
        cx.drawImage(v, 0, 0, c.width, c.height);
        // spec 1018: 512px poster at the crispest quality that stays within the ~40KB wire budget.
        finish(jpegDataUrlUnderBudget(c));
      } catch {
        finish();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvfc = (v as any).requestVideoFrameCallback?.bind(v);
    if (rvfc) {
      // Capture a frame a fraction of a second in, not frame 0 — the very first frame
      // of a clip (especially a camera recording) is often black during warm-up.
      const SKIP = 0.2;
      const tick = (): void => {
        if (v.currentTime >= SKIP || v.currentTime >= (v.duration || SKIP)) capture();
        else rvfc(tick);
      };
      rvfc(tick);
      void v.play().catch(() => {
        // play blocked → fall back to seek-based capture
        v.onseeked = capture;
        try {
          v.currentTime = SKIP;
        } catch {
          /* timeout handles it */
        }
      });
    } else {
      v.onseeked = capture;
      v.onloadeddata = () => {
        try {
          v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
        } catch {
          capture();
        }
      };
    }
    v.onerror = () => finish();
    v.src = url;
  });
}

/** A small downscaled thumbnail (Blob) for an image, so lists / grids / the viewer's
 *  bottom strip render a lightweight preview instead of decoding the full-resolution
 *  image as rows recycle (the big driver of media-heavy scroll jank). Returns
 *  undefined if the image is already within `maxEdge` or decoding fails — the caller
 *  then just uses the full image. Bounded by the shared limiter like video posters. */
export function generateImageThumb(blob: Blob, maxEdge = THUMB_TIERS.bubble): Promise<Blob | undefined> {
  return posterLimiter(() => generateImageThumbUnlimited(blob, maxEdge));
}

async function generateImageThumbUnlimited(blob: Blob, maxEdge: number): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const big = Math.max(bmp.width, bmp.height);
    if (big <= maxEdge) {
      bmp.close?.();
      return undefined; // already small — no point storing a second copy
    }
    const scale = maxEdge / big;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const cx = c.getContext('2d');
    if (!cx) {
      bmp.close?.();
      return undefined;
    }
    cx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    // spec 1018: step JPEG quality down only as needed to stay within the ~40KB wire budget,
    // so a busy photo degrades quality rather than bloating the sealed message.
    return await jpegBlobUnderBudget(c);
  } catch {
    return undefined;
  }
}

// Separate concurrency limiter for IMAGE thumbnails (spec 1014). Kept distinct from the video-poster
// limiter so a media-heavy image grid filling in its thumbnails never queues behind (or starves)
// the heavier video-poster decodes, and vice versa. Slightly higher cap — image downscales are far
// cheaper than decoding a <video>.
const imageThumbLimiter = createLimiter(3);

/** Downscale an image Blob to `maxEdge` (image-thumb limiter), returning undefined when the source is
 *  already within `maxEdge` (the caller falls back to the larger tier). Spec 1014. */
export function makeImageThumb(blob: Blob, maxEdge: number): Promise<Blob | undefined> {
  return imageThumbLimiter(() => generateImageThumbUnlimited(blob, maxEdge));
}

/** Derive the GRID (320) and STRIP (128) thumbnail tiers from the already-generated/received bubble
 *  tier (`posterBlob`). Both sides do this locally (send / receive / backfill) so only the bubble
 *  tier crosses the wire (spec 1014, research D1). A tier comes back undefined when the bubble tier
 *  is already within that tier's max edge — the caller then reuses the larger tier for that surface. */
export async function deriveTiers(posterBlob: Blob): Promise<{ grid?: Blob; strip?: Blob }> {
  const [grid, strip] = await Promise.all([
    makeImageThumb(posterBlob, THUMB_TIERS.grid),
    makeImageThumb(posterBlob, THUMB_TIERS.strip),
  ]);
  return { grid, strip };
}

/** Blob → data URL (used to put the bubble tier on the wire as MediaRef.poster, spec 1014). */
export function blobToDataUrl(blob: Blob): Promise<string | undefined> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : undefined);
    r.onerror = () => resolve(undefined);
    r.readAsDataURL(blob);
  });
}

/** A short resolution label from pixel dimensions, e.g. 1280×720 → "720p". */
export function resolutionLabel(width?: number, height?: number): string {
  if (!width || !height) return '';
  return `${Math.min(width, height)}p`;
}

/** A human byte size, e.g. 4_400_000 → "4.2 MB". */
export function fileSizeLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
