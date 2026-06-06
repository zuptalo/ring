/**
 * ffmpeg.wasm video transcoder, the universal fallback that works everywhere,
 * including iOS Safari. Uses the single-threaded core (no SharedArrayBuffer →
 * no cross-origin-isolation / COOP+COEP requirement on the host). The ~30 MB
 * core is bundled locally (no CDN) and loaded lazily on first use.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { VideoPreset } from './media-video';

// Single-thread UMD core, served locally from public/ffmpeg (no CDN, no COOP/COEP).
// Loaded via toBlobURL (a plain fetch wrapped in a blob: URL) so the ffmpeg worker
// imports it directly instead of going through Vite's module transform; passing
// the bare /ffmpeg path as coreURL makes Vite try to transform a public file.
const CORE_BASE = '/ffmpeg';

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (!loading) {
    loading = (async () => {
      console.info('[ffmpeg] loading core…');
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => console.info('[ffmpeg]', message));
      await ff.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      console.info('[ffmpeg] core loaded');
      instance = ff;
      return ff;
    })();
  }
  return loading;
}

export async function ffmpegTranscode(
  blob: Blob,
  preset: VideoPreset,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const input = 'input';
  const output = 'output.mp4';
  const onProg = ({ progress }: { progress: number }) => onProgress?.(progress);
  if (onProgress) ff.on('progress', onProg);
  await ff.writeFile(input, await fetchFile(blob));
  try {
    await ff.exec([
      '-i', input,
      // Fit within maxEdge×maxEdge keeping aspect; force even dimensions for H.264.
      '-vf', `scale=${preset.maxEdge}:${preset.maxEdge}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${preset.bitrate}`, '-maxrate', `${preset.bitrate}`,
      '-bufsize', `${preset.bitrate * 2}`, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      output,
    ]);
    const data = (await ff.readFile(output)) as Uint8Array;
    const out = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });
    // Keep whichever is smaller (re-encoding a small clip can grow it).
    return out.size > 0 && out.size < blob.size ? out : blob;
  } finally {
    if (onProgress) ff.off('progress', onProg);
    await ff.deleteFile(input).catch(() => {});
    await ff.deleteFile(output).catch(() => {});
  }
}
