/**
 * Read media facts (dimensions, duration) and generate a video thumbnail on the
 * sender. Everything here is best-effort and time-bounded: a video/image element
 * that never fires its load/seek event (common on iOS for large clips) must not
 * hang the send pipeline, so each call resolves on a timeout with whatever it has.
 */
import { createLimiter } from '@/utils/concurrency';
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
export function generateVideoPoster(blob: Blob, maxEdge = 480, timeoutMs = 10000): Promise<string | undefined> {
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
        finish(c.toDataURL('image/jpeg', 0.6));
      } catch {
        finish();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvfc = (v as any).requestVideoFrameCallback?.bind(v);
    if (rvfc) {
      rvfc(() => capture());
      void v.play().catch(() => {
        // play blocked → fall back to seek-based capture
        v.onseeked = capture;
        try {
          v.currentTime = 0.05;
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
