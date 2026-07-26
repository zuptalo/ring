/**
 * ffmpeg.wasm video transcoder, the universal fallback that works everywhere,
 * including iOS Safari. Uses the single-threaded core (no SharedArrayBuffer →
 * no cross-origin-isolation / COOP+COEP requirement on the host). The ~30 MB
 * core is bundled locally (no CDN) and loaded lazily on first use.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { VideoPreset } from './media-video';

// Single-thread ESM core, served locally from public/ffmpeg (no CDN, no COOP/COEP).
// It MUST be the ESM build: @ffmpeg/ffmpeg 0.12 runs the core in a *module* worker,
// where `importScripts` is illegal — the worker therefore `await import()`s the core
// and needs its `default` export. The UMD build has no export, so it silently failed
// to load ("failed to import ffmpeg-core.js") and the whole ffmpeg fallback was dead
// (spec 2007). Loaded via toBlobURL (a plain fetch wrapped in a blob: URL) so the
// worker imports it directly instead of going through Vite's module transform.
const CORE_BASE = '/ffmpeg';

// ffmpeg.wasm is single-threaded and software-only with a ~2 GB memory wall; feeding
// it a full 4K clip reliably triggers an unrecoverable wasm Out-of-Memory that CRASHES
// the tab (a JS timeout can't catch that — only not starting can). So we refuse inputs
// above a conservative ceiling and let the caller fall through to the original (which
// is then labeled honestly). WebCodecs — hardware, memory-safe — is the primary path
// for large clips; ffmpeg is only the fallback for browsers without WebCodecs, where
// the inputs that reach it are small enough to be safe (spec 2007, research Decision 2).
const FFMPEG_MAX_INPUT_BYTES = 64 * 1024 * 1024;
// Wall-clock cap so a wedged transcode fails (→ fallback) instead of hanging the send.
const FFMPEG_TIMEOUT_MS = 120_000;

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
  // (spec 2050) For a non-portable source (e.g. webm) we want the MP4 for interop even if
  // it isn't smaller than the source — portability beats size there. Portable re-encodes
  // keep the "only if smaller" rule so we never grow an already-fine mp4.
  opts?: { keepEvenIfLarger?: boolean },
): Promise<Blob> {
  // Refuse oversize inputs BEFORE loading the 30 MB core or decoding a frame — a 4K
  // decode here would OOM-crash the tab (see FFMPEG_MAX_INPUT_BYTES). Throwing lets the
  // orchestrator fall through to the original, sent honestly as 'original'.
  if (blob.size > FFMPEG_MAX_INPUT_BYTES) {
    throw new Error(
      `input too large for ffmpeg.wasm (${blob.size} > ${FFMPEG_MAX_INPUT_BYTES}); skipping to avoid OOM`,
    );
  }
  const ff = await getFFmpeg();
  const input = 'input';
  const output = 'output.mp4';
  const onProg = ({ progress }: { progress: number }) => onProgress?.(progress);
  if (onProgress) ff.on('progress', onProg);
  await ff.writeFile(input, await fetchFile(blob));
  try {
    const rc = await ff.exec([
      '-i', input,
      // spec 1018 US1: do NOT pass -noautorotate. ffmpeg auto-applies the source display matrix,
      // baking the upright orientation into the pixels (and clearing the matrix), so the recipient
      // sees portrait clips upright — matching the WebCodecs path which rotates the canvas itself.
      // Fit within maxEdge×maxEdge keeping aspect; force even dimensions for H.264.
      '-vf', `scale=${preset.maxEdge}:${preset.maxEdge}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${preset.bitrate}`, '-maxrate', `${preset.bitrate}`,
      '-bufsize', `${preset.bitrate * 2}`, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      // spec 1018 FR-014: drop all source container metadata (GPS location, device id, creation
      // time) — ffmpeg copies it by default. The re-encoded clip carries only what's needed to play.
      '-map_metadata', '-1',
      // (spec 2050) NO -movflags +faststart: relocating the moov atom over the whole output at
      // finalize is a second in-memory pass that OOM-`Aborted()` the single-threaded wasm core on
      // larger clips (observed on a 1920p/~25s webm — full encode, then abort at mux). Chat videos
      // are fully downloaded before playback, so progressive-start buys nothing here; dropping it
      // makes the transcode actually complete.
      output,
    ], FFMPEG_TIMEOUT_MS);
    // (spec 2038) ffmpeg.wasm's exec RESOLVES with an exit code — it never
    // rejects on a conversion failure. Reading the output regardless shipped a
    // PARTIAL file that passed the smaller-than-source guard and posted as an
    // unplayable 0-duration video (the reported desktop breakage). Non-zero rc
    // → throw, so the orchestrator falls back to the original.
    if (rc !== 0) {
      throw new Error(`ffmpeg conversion failed (exit ${rc})`);
    }
    const data = (await ff.readFile(output)) as Uint8Array;
    const out = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });
    if (out.size === 0) return blob;
    // Non-portable source: keep the mp4 for interop regardless of size. Portable source:
    // keep whichever is smaller (re-encoding a small clip can grow it).
    if (opts?.keepEvenIfLarger) return out;
    return out.size < blob.size ? out : blob;
  } finally {
    if (onProgress) ff.off('progress', onProg);
    await ff.deleteFile(input).catch(() => {});
    await ff.deleteFile(output).catch(() => {});
  }
}
