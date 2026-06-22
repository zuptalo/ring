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

export interface VideoPreset {
  maxEdge: number; // longest side, px
  bitrate: number; // target video bitrate, bits/s
}
// Target resolution + bitrate per tier. maxEdge mirrors QUALITY_TIERS in media-encode.ts
// (the picker's suitability threshold). '4k' keeps 2160p but re-encodes the source's
// (often huge, HEVC) bitrate down to a sane H.264 one — shrinking the file AND making
// it play cross-platform (Android can't reliably decode HEVC). Honest labeling demotes
// any tier that can't actually shrink to 'original' (spec 2007).
export const VIDEO_PRESETS: Record<'sd' | 'hd' | 'fhd' | '4k', VideoPreset> = {
  sd: { maxEdge: 640, bitrate: 1_000_000 },
  hd: { maxEdge: 1280, bitrate: 2_500_000 },
  fhd: { maxEdge: 1920, bitrate: 5_000_000 },
  '4k': { maxEdge: 3840, bitrate: 18_000_000 },
};

// WebCodecs is the fast path; flip to false to force the ffmpeg path everywhere
// (e.g. if a device produces bad WebCodecs output).
const WEBCODECS_ENABLED = true;

export async function compressVideoAdaptive(
  blob: Blob,
  quality: 'sd' | 'hd' | 'fhd' | '4k',
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const preset = VIDEO_PRESETS[quality];
  console.info('[video] compress start', { quality, type: blob.type, bytes: blob.size, preset });

  // 1. WebCodecs fast path, mp4/mov containers only (mp4box demux).
  if (WEBCODECS_ENABLED && /(mp4|quicktime|m4v)/i.test(blob.type)) {
    try {
      const { webCodecsSupported, webcodecsTranscode } = await import('./media-video-webcodecs');
      const supported = webCodecsSupported();
      console.info('[video] webcodecs supported?', supported);
      if (supported) {
        const out = await webcodecsTranscode(blob, preset, onProgress);
        console.info('[video] webcodecs output', { bytes: out.size, vs: blob.size });
        if (out.size > 0 && out.size < blob.size) return out;
        console.warn('[video] webcodecs output not smaller; trying ffmpeg');
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
    const out = await ffmpegTranscode(blob, preset, onProgress);
    console.info('[video] ffmpeg output', { bytes: out.size, vs: blob.size });
    return out;
  } catch (e) {
    console.warn('[video] ffmpeg transcode FAILED; sending original', e);
  }

  // 3. Give up → original (never block the send).
  console.warn('[video] no engine succeeded, sending original', { bytes: blob.size });
  return blob;
}
