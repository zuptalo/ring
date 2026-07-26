/**
 * Platform-adaptive video transcoding for SD/HD sends.
 *
 *  1. WebCodecs (Chrome/Android, recent Safari): fast, native, no download.
 *  2. ffmpeg.wasm (everywhere, incl. iOS Safari): lazy-loaded ~30 MB transcoder,
 *     single-threaded core so no cross-origin isolation (COOP/COEP) is needed.
 *  3. Original blob: the final net.
 *
 * Each layer falls through to the next on failure or lack of support, so a send
 * is never blocked by compression. Both engines are dynamically imported so
 * their heavy code/wasm only loads when a video is actually compressed.
 */

import { isPortableVideo } from './media-portability';

export interface VideoPreset {
  maxEdge: number; // longest side, px
  bitrate: number; // target video bitrate, bits/s
}
// Target resolution + bitrate per tier. maxEdge mirrors QUALITY_TIERS in media-encode.ts
// (the picker's suitability threshold). Full HD (1080p) is the top tier — a 4K re-encode
// was dropped because 2160p H.264 encoding is unreliable/very slow on-device (esp. the
// iOS hardware encoder). Honest labeling demotes any tier that can't actually shrink the
// clip to 'original' (spec 2007).
export const VIDEO_PRESETS: Record<'sd' | 'hd' | 'fhd', VideoPreset> = {
  sd: { maxEdge: 640, bitrate: 1_000_000 },
  hd: { maxEdge: 1280, bitrate: 2_500_000 },
  fhd: { maxEdge: 1920, bitrate: 5_000_000 },
};


/* ---- spec 2038: upload-as-is gate ---- */

// A clip already within 1.5× of the preset's target bitrate gains little from a
// re-encode; re-encoding it anyway costs time, battery, quality — and on weak
// devices the transcode is the memory-heavy step behind the spec-2037 loop.
const AS_IS_BITRATE_FACTOR = 1.5;

/** Pure rule: may this clip skip the transcode entirely? Codec compatibility is
 *  the caller's input (see sniffMp4Codecs) — this only judges the numbers. */
// (spec 2041) The largest video we ever hand to the seal+upload path unconverted.
// Encryption holds plaintext AND ciphertext in the heap at once, so shipping an
// arbitrarily large original is the same out-of-memory kill the transcode fix
// removed — and the server caps a blob at 256 MiB anyway. Anything above this
// must convert or fail honestly (never crash the app trying).
export const ORIGINAL_MAX_BYTES = 128 << 20;

/** Pure rule: may this clip skip the transcode entirely? Codec compatibility is
 *  the caller's input (see sniffMp4Codecs) — this only judges the numbers. */
export function shouldUploadAsIs(
  info: { sizeBytes: number; durationSec: number; width: number; height: number; h264Compatible: boolean },
  preset: VideoPreset,
): boolean {
  if (!info.h264Compatible) return false;
  if (!(info.durationSec > 0)) return false;
  if (info.sizeBytes > ORIGINAL_MAX_BYTES) return false; // must shrink first (spec 2041)
  if (Math.max(info.width, info.height) > preset.maxEdge) return false; // 4K-class → downscale
  const bps = (info.sizeBytes * 8) / info.durationSec;
  return bps <= preset.bitrate * AS_IS_BITRATE_FACTOR;
}

/** Scan an MP4/QuickTime file's bytes for codec FourCCs. Returns whether the clip
 *  is plain H.264 (universally playable on Apple/Android/desktop) with no
 *  modern-codec track (HEVC/AV1/VP9 — typical recent phone captures) that would
 *  need the compatibility transcode. A dumb byte scan is deliberate: it needs no
 *  demuxer, handles moov-at-end files, and a false negative only means we
 *  transcode like before. */
/** (spec 2041) sniffMp4CodecIsPlainH264 over a Blob without loading the media
 *  data: reads only the non-mdat top-level boxes (ftyp/moov/…, where the sample
 *  descriptions live). Any scan failure or an implausibly large header region
 *  returns false — "not known-compatible", so the caller transcodes as before. */
export async function sniffBlobCodecIsPlainH264(blob: Blob): Promise<boolean> {
  const HEADER_SNIFF_MAX_BYTES = 16 << 20;
  try {
    const { scanTopLevelBoxes } = await import('./media-video-webcodecs');
    const boxes = (await scanTopLevelBoxes(blob)).filter((b) => b.type !== 'mdat');
    const total = boxes.reduce((n, b) => n + b.size, 0);
    if (total === 0 || total > HEADER_SNIFF_MAX_BYTES) return false;
    const parts = await Promise.all(
      boxes.map(async (b) => new Uint8Array(await blob.slice(b.start, b.start + b.size).arrayBuffer())),
    );
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      bytes.set(p, off);
      off += p.length;
    }
    return sniffMp4CodecIsPlainH264(bytes);
  } catch {
    return false;
  }
}

export function sniffMp4CodecIsPlainH264(bytes: Uint8Array): boolean {
  const has = (fourcc: string): boolean => {
    const a = fourcc.charCodeAt(0), b = fourcc.charCodeAt(1), c = fourcc.charCodeAt(2), d = fourcc.charCodeAt(3);
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return true;
    }
    return false;
  };
  if (has('hvc1') || has('hev1') || has('av01') || has('vp09') || has('vp08')) return false;
  return has('avc1') || has('avc3');
}

/** Cheap metadata probe (duration + dimensions) via a detached <video> element —
 *  loads headers only, decodes no frames. Null on any failure/timeout. */
function probeVideoMeta(blob: Blob): Promise<{ durationSec: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const finish = (out: { durationSec: number; width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(out);
    };
    const timer = setTimeout(() => finish(null), 5000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      const d = v.duration;
      finish(Number.isFinite(d) && d > 0 ? { durationSec: d, width: v.videoWidth, height: v.videoHeight } : null);
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    v.src = url;
  });
}

// WebCodecs is the fast path; flip to false to force the ffmpeg path everywhere
// (e.g. if a device produces bad WebCodecs output).
const WEBCODECS_ENABLED = true;


/** (spec 2038) Final sanity gate on ANY transcode output: if the browser cannot
 *  even read its metadata, the file is broken — never upload it (a corrupt
 *  partial output once shipped as an unplayable 0-duration post). Outside a DOM
 *  (unit tests) this trusts the engine result. */
async function transcodeOutputPlayable(out: Blob): Promise<boolean> {
  if (typeof document === 'undefined') return true;
  const meta = await probeVideoMeta(out);
  return meta !== null && meta.durationSec > 0;
}

export async function compressVideoAdaptive(
  blob: Blob,
  quality: 'sd' | 'hd' | 'fhd',
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const preset = VIDEO_PRESETS[quality];
  console.info('[video] compress start', { quality, type: blob.type, bytes: blob.size, preset });

  // (spec 2038) A clip that is already efficient AND universally playable ships
  // as-is: no engine load, no re-encode, straight to upload. Any probe failure
  // just falls through to the normal ladder.
  if (typeof document !== 'undefined' && /(mp4|quicktime|m4v)/i.test(blob.type)) {
    try {
      const meta = await probeVideoMeta(blob);
      if (meta) {
        // (spec 2041) Sniff the codec from the METADATA boxes only. The codec
        // FourCCs live in the moov sample descriptions, so reading the non-mdat
        // boxes (a few MB even for a long clip) replaces the old whole-file
        // arrayBuffer() read — which put the entire video in the heap just to
        // answer a yes/no question. An oversized or unscannable header simply
        // means "not known-compatible" → the normal transcode ladder.
        const h264Compatible = await sniffBlobCodecIsPlainH264(blob);
        if (shouldUploadAsIs({ sizeBytes: blob.size, durationSec: meta.durationSec, width: meta.width, height: meta.height, h264Compatible }, preset)) {
          console.info('[video] uploading as-is (spec 2038)', { bps: Math.round((blob.size * 8) / meta.durationSec), ...meta });
          return blob;
        }
      }
    } catch (e) {
      console.info('[video] as-is probe failed; transcoding as usual', e);
    }
  }

  // 1. WebCodecs fast path, mp4/mov containers only (mp4box demux).
  if (WEBCODECS_ENABLED && /(mp4|quicktime|m4v)/i.test(blob.type)) {
    try {
      const { webCodecsSupported, webcodecsTranscode } = await import('./media-video-webcodecs');
      const supported = webCodecsSupported();
      console.info('[video] webcodecs supported?', supported);
      if (supported) {
        const out = await webcodecsTranscode(blob, preset, onProgress);
        console.info('[video] webcodecs output', { bytes: out.size, vs: blob.size });
        if (out.size > 0 && out.size < blob.size && (await transcodeOutputPlayable(out))) return out;
        // A COMPLETED hardware re-encode that isn't smaller means the source is
        // already efficiently compressed for this preset — the honest result is
        // the original (achievedQuality labels it so). Falling into ffmpeg here
        // cost a silent ~30 MB wasm download plus a slow single-threaded second
        // transcode that almost never shrinks such a clip either, and the
        // posting progress bar sat near 0% for the whole detour. ffmpeg remains
        // the fallback for webcodecs FAILURES only.
        console.info('[video] webcodecs output not smaller — source already efficient, sending original');
        return originalOrThrow(blob);
      }
    } catch (e) {
      console.warn('[video] WebCodecs transcode FAILED; trying ffmpeg', e);
    }
  } else {
    console.info('[video] webcodecs path skipped', { enabled: WEBCODECS_ENABLED, type: blob.type });
  }

  // 2. ffmpeg.wasm universal path.
  try {
    const { ffmpegTranscode } = await import('./media-video-ffmpeg');
    // Non-portable source (webm): keep the mp4 for interop even if not smaller.
    const out = await ffmpegTranscode(blob, preset, onProgress, {
      keepEvenIfLarger: !isPortableVideo(blob.type),
    });
    console.info('[video] ffmpeg output', { bytes: out.size, vs: blob.size });
    if (out !== blob && !(await transcodeOutputPlayable(out))) {
      console.warn('[video] ffmpeg output unreadable; sending original');
      return originalOrThrow(blob);
    }
    return out === blob ? originalOrThrow(blob) : out;
  } catch (e) {
    if ((e as Error)?.message?.includes('too big to send')) throw e;
    console.warn('[video] ffmpeg transcode FAILED; sending original', e);
  }

  // 3. Give up → original (never block the send — unless shipping it would
  // crash the app; see originalOrThrow).
  console.warn('[video] no engine succeeded, sending original', { bytes: blob.size });
  return originalOrThrow(blob);
}

/** (spec 2041) The "ship the original" escape hatch, bounded. Sealing holds
 *  plaintext + ciphertext in the heap together, so an oversized original is the
 *  same jetsam kill the streaming transcode removed. A clean, explained failure
 *  card beats a crashed app. */
function originalOrThrow(blob: Blob): Blob {
  // (spec 2050 revised) Best-effort: if conversion couldn't run, still SEND the original
  // rather than blocking. A raw webm plays on Chrome/Firefox/Android (only Safari/iOS can't
  // decode VP8/VP9) — not being able to send at all is worse. We only refuse an original
  // that is too large to seal without risking an OOM crash (unchanged memory-safety guard).
  if (blob.size > ORIGINAL_MAX_BYTES) {
    throw new Error('This video is too big to send. Try a shorter or smaller clip.');
  }
  return blob;
}
