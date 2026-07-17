/**
 * WebCodecs video transcoder, the fast, native path (Chrome/Android, and recent
 * Safari). Demuxes the source mp4 with mp4box, re-encodes the video track to the
 * target resolution/bitrate via VideoDecoder→canvas→VideoEncoder, copies the
 * audio track through unchanged, and re-muxes with mp4-muxer.
 *
 * It is deliberately strict: anything it can't handle cleanly (non-mp4 input,
 * unsupported codec, or (critically) a source that has audio it couldn't copy)
 * throws, so the caller falls back to ffmpeg.wasm. The orchestrator's final net
 * is the original blob, so a send is never blocked.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
// mp4box ships no first-class types; treat it loosely.
import MP4Box from 'mp4box';
import type { VideoPreset } from './media-video';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function webCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof EncodedVideoChunk !== 'undefined' &&
    typeof EncodedAudioChunk !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

/**
 * Derive the upright rotation (0/90/180/270) a video should be displayed at, from its MP4 track
 * display matrix (tkhd `matrix`, as mp4box exposes it: 9 raw fixed-point ints [a b u c d v x y w]).
 * Rotation is encoded in the top-left 2×2 (a=matrix[0], b=matrix[1]); the angle is atan2(b, a), and
 * since atan2 uses only the ratio the fixed-point scale is irrelevant. A missing/degenerate matrix
 * means "already upright" → 0, so an un-rotated source is never double-corrected (spec 1018 FR-003).
 */
export function rotationFromMatrix(matrix?: number[] | null): 0 | 90 | 180 | 270 {
  if (!matrix || matrix.length < 5) return 0;
  const a = matrix[0];
  const b = matrix[1];
  if (a === 0 && b === 0) return 0;
  let deg = Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90;
  deg = ((deg % 360) + 360) % 360;
  return deg === 90 || deg === 180 || deg === 270 ? deg : 0;
}

/** Read the upright display rotation for a track from its tkhd matrix (best-effort → 0). */
function trackRotation(file: any, trackId: number): 0 | 90 | 180 | 270 {
  try {
    return rotationFromMatrix(file.getTrackById(trackId)?.tkhd?.matrix);
  } catch {
    return 0;
  }
}

/** Pull the codec config (avcC/hvcC/…) bytes for a track, for the decoder. */
function trackDescription(file: any, trackId: number): Uint8Array | undefined {
  const trak = file.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(ds);
      return new Uint8Array(ds.buffer, 8); // strip the 8-byte box header
    }
  }
  return undefined;
}

/** The audio AudioSpecificConfig (esds DecoderSpecificInfo) for a copied track.
 *  mp4box nests the descriptor differently across containers (iPhone .mov vs .mp4),
 *  so we walk the descriptor tree for the first entry that carries `.data` rather
 *  than assuming a fixed `descs[0].descs[0]` path. */
function audioSpecificConfig(file: any, trackId: number): Uint8Array | undefined {
  try {
    const trak = file.getTrackById(trackId);
    const esds = trak.mdia.minf.stbl.stsd.entries.map((e: any) => e?.esds).find(Boolean);
    if (!esds) return undefined;
    // Depth-first search for a DecoderSpecificInfo node (the one carrying `.data`).
    const stack: any[] = [esds.esd, ...(esds.esd?.descs ?? [])];
    while (stack.length) {
      const node = stack.shift();
      if (!node) continue;
      // A valid AudioSpecificConfig is ≥2 bytes. Some containers nest a stray 1-byte
      // descriptor (e.g. an SLConfig) ahead of the real DecoderSpecificInfo, so skip
      // too-short `.data` and keep walking — returning it would mux a broken (silent)
      // track. If nothing valid is found we fall back to a synthesized ASC.
      if (node.data && node.data.length >= 2) return new Uint8Array(node.data);
      if (Array.isArray(node.descs)) stack.push(...node.descs);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Standard AAC-LC AudioSpecificConfig (2 bytes) synthesized from the sample rate +
 *  channel count, used when the container's esds can't be parsed. iPhone audio is
 *  AAC-LC and we copy the samples through unchanged, so a synthesized config is
 *  correct and lets the transcode proceed (spec 2007) instead of failing the send. */
export function synthAacAsc(sampleRate?: number, channels?: number): Uint8Array | undefined {
  const FREQS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const fi = FREQS.indexOf(sampleRate ?? 0);
  const ch = channels ?? 0;
  if (fi < 0 || ch < 1 || ch > 7) return undefined;
  const objectType = 2; // AAC-LC
  return new Uint8Array([(objectType << 3) | (fi >> 1), ((fi & 1) << 7) | (ch << 3)]);
}

/* ---- streaming demux (spec 2041) ----
 * The old demux read the WHOLE source into one ArrayBuffer for mp4box and then
 * copied every compressed sample into EncodedVideoChunks before decoding — on a
 * phone that's 2× the file in the JS heap before a single frame decodes, and it
 * was the out-of-memory kill (iOS jetsam) behind the "app crashes while posting
 * a video" report. The streaming demux keeps input-side memory O(window):
 *  1. scan the top-level box layout with tiny header reads (no media data),
 *  2. feed mp4box only the metadata boxes plus each mdat's bare HEADER — mp4box
 *     skips a header-only mdat (processIncompleteMdat seeks to its end), so a
 *     trailing moov (every iPhone camera file) parses without buffering mdat,
 *  3. pump the mdat bodies through in bounded windows, decoding as samples
 *     surface and releasing consumed sample data (appendBuffer drops fully-used
 *     buffers via cleanBuffers on every call).
 */

/** One top-level box in an mp4 container. */
export interface Mp4BoxRange {
  type: string;
  start: number;
  size: number;
  headerLen: number;
}

/** Index the top-level boxes of an mp4 by reading only their headers (8–16 bytes
 *  each) — a handful of tiny slice reads, never the media data. Throws on
 *  anything that doesn't look like an ISO-BMFF layout, which sends the caller
 *  down the ffmpeg/original fallback exactly like the old parse timeout did. */
export async function scanTopLevelBoxes(blob: Blob): Promise<Mp4BoxRange[]> {
  const out: Mp4BoxRange[] = [];
  let off = 0;
  while (off + 8 <= blob.size) {
    const head = new DataView(await blob.slice(off, Math.min(off + 16, blob.size)).arrayBuffer());
    let size: number = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error(`not an mp4: bad box type at ${off}`);
    let headerLen = 8;
    if (size === 1) {
      // 64-bit largesize (large mdat)
      if (head.byteLength < 16) throw new Error('not an mp4: truncated largesize box');
      size = head.getUint32(8) * 2 ** 32 + head.getUint32(12);
      headerLen = 16;
    } else if (size === 0) {
      size = blob.size - off; // box extends to EOF
    }
    if (size < headerLen || off + size > blob.size) throw new Error(`not an mp4: bad box size at ${off}`);
    out.push({ type, start: off, size, headerLen });
    off += size;
  }
  if (off !== blob.size) throw new Error('not an mp4: trailing garbage');
  return out;
}

// Bytes of mdat pumped through mp4box per step. Big enough that a 400 MB clip is
// a few dozen appends, small enough that input-side heap stays trivial.
const DEMUX_WINDOW_BYTES = 16 << 20;

export async function webcodecsTranscode(
  blob: Blob,
  preset: VideoPreset,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  if (!webCodecsSupported()) throw new Error('WebCodecs unavailable');

  const boxes = await scanTopLevelBoxes(blob);
  if (!boxes.some((b) => b.type === 'moov')) throw new Error('not an mp4: no moov box');

  const file = MP4Box.createFile();
  // Parse errors surface via onError DURING appendBuffer; capture and rethrow
  // between appends so a corrupt container is a clean rejection (spec 2007
  // FR-006) — the orchestrator falls through to ffmpeg/original.
  let parseError: Error | null = null;
  file.onError = (e: string) => {
    parseError ??= new Error(`mp4box: ${e}`);
  };
  let readyInfo: any = null;
  file.onReady = (i: any) => {
    readyInfo = i;
  };
  const appendRange = async (start: number, end: number) => {
    const buf = (await blob.slice(start, end).arrayBuffer()) as ArrayBuffer & { fileStart: number };
    buf.fileStart = start;
    file.appendBuffer(buf);
    if (parseError) throw parseError;
  };
  // Metadata boxes in full; mdat as bare header (mp4box skips over a header-only
  // mdat to keep parsing the boxes that follow it — the trailing-moov layout).
  for (const b of boxes) {
    if (b.type === 'mdat') await appendRange(b.start, b.start + b.headerLen);
    else await appendRange(b.start, b.start + b.size);
  }
  if (!readyInfo) throw new Error('mp4box: moov did not parse (unsupported container?)');
  const info = readyInfo;

  const vTrack = info.videoTracks?.[0];
  if (!vTrack) throw new Error('no video track');
  const aTrack = info.audioTracks?.[0];

  const sw = vTrack.video.width;
  const sh = vTrack.video.height;
  const scale = Math.min(1, preset.maxEdge / Math.max(sw, sh));
  // Scaled CODED dimensions (the decoder emits frames at the coded orientation).
  const tw = Math.max(2, Math.round((sw * scale) / 2) * 2);
  const th = Math.max(2, Math.round((sh * scale) / 2) * 2);
  // spec 1018 US1: bake the track's display rotation into the output pixels so the recipient
  // sees it upright regardless of player metadata support. For 90°/270° the displayed frame is
  // portrait, so the OUTPUT (canvas/encoder/muxer) dimensions are the coded ones swapped.
  const rotation = trackRotation(file, vTrack.id);
  const swapWH = rotation === 90 || rotation === 270;
  const outW = swapWH ? th : tw; // display (upright) width
  const outH = swapWH ? tw : th; // display (upright) height

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: 'in-memory',
    // Normalize both tracks so the first sample is at t=0 (preserving A/V sync). An
    // iPhone clip's first decoded frame often has a non-zero presentation time; left as
    // muxed, QuickTime/iOS Safari report a 0:00 duration and refuse to play (Chromium
    // and macOS are lenient — which is why this only showed up on the iPhone). This also
    // makes the compressed clip play for iOS *recipients*, not just the sender (spec 2007).
    firstTimestampBehavior: 'cross-track-offset',
    video: { codec: 'avc', width: outW, height: outH },
    audio: aTrack
      ? { codec: 'aac', sampleRate: aTrack.audio.sample_rate, numberOfChannels: aTrack.audio.channel_count }
      : undefined,
  });

  console.info('[webcodecs] tracks', {
    video: vTrack.codec,
    src: `${sw}x${sh}`,
    target: `${outW}x${outH}`,
    rotation,
    audio: aTrack?.codec,
  });

  // --- pick a supported H.264 encoder config (Safari is picky about profile/level) ---
  // Order matters: Main / Constrained-Baseline before High — iOS Safari's H.264 encoder
  // reports/handles High (avc1.64*) the least reliably (spec 2007; w3c/webcodecs#686/#492).
  // Level 4.0 covers the top tier (Full HD / 1080p); isConfigSupported filters out any
  // profile/level the device + target resolution can't do.
  const base = { width: outW, height: outH, bitrate: preset.bitrate, framerate: vTrack.video?.frame_rate || 30 };
  const candidates = ['avc1.4d0028', 'avc1.42e028', 'avc1.42001f', 'avc1.42e01e', 'avc1.640028'];
  let encoderConfig: VideoEncoderConfig | null = null;
  for (const codec of candidates) {
    const cfg: VideoEncoderConfig = { codec, ...base };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const support = (VideoEncoder as any).isConfigSupported
        ? await VideoEncoder.isConfigSupported(cfg)
        : { supported: true };
      console.info('[webcodecs] encoder candidate', codec, support?.supported);
      if (support?.supported) {
        encoderConfig = (support.config as VideoEncoderConfig) ?? cfg;
        break;
      }
    } catch (e) {
      console.warn('[webcodecs] encoder isConfigSupported threw', codec, e);
    }
  }
  if (!encoderConfig) throw new Error('no supported H.264 encoder config (Safari may not encode H.264)');

  // --- video re-encode pipeline ---
  // WebCodecs surfaces decode/encode failures through the async `error` callback, NOT
  // by throwing from encode()/decode(). Capturing the first error here (and rethrowing
  // after flush) makes the failure deterministic: webcodecsTranscode rejects and the
  // orchestrator falls cleanly through to ffmpeg/original instead of hanging or
  // throwing into an unhandled context (spec 2007).
  let fatalError: Error | null = null;
  const fail = (e: unknown) => {
    fatalError ??= e instanceof Error ? e : new Error(String(e));
  };
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  });
  encoder.configure(encoderConfig);
  console.info('[webcodecs] encoder configured', encoderConfig.codec);

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const rad = (rotation * Math.PI) / 180;
  let n = 0;
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (rotation === 0) {
        ctx.drawImage(frame, 0, 0, tw, th);
      } else {
        // Rotate the scaled coded frame (tw×th) about the output centre so it fills outW×outH
        // upright. translate→rotate→draw-centred bakes the orientation into the encoded pixels.
        ctx.save();
        ctx.translate(outW / 2, outH / 2);
        ctx.rotate(rad);
        ctx.drawImage(frame, -tw / 2, -th / 2, tw, th);
        ctx.restore();
      }
      const out = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
      encoder.encode(out, { keyFrame: n % 150 === 0 });
      out.close();
      frame.close();
      n++;
      if (vTrack.nb_samples) onProgress?.(n / vTrack.nb_samples);
    },
    error: fail,
  });
  const decoderConfig: VideoDecoderConfig = {
    codec: vTrack.codec,
    description: trackDescription(file, vTrack.id),
    codedWidth: sw,
    codedHeight: sh,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((VideoDecoder as any).isConfigSupported) {
    const ds = await VideoDecoder.isConfigSupported(decoderConfig);
    console.info('[webcodecs] decoder supported?', vTrack.codec, ds?.supported);
    if (!ds?.supported) throw new Error(`decoder unsupported for ${vTrack.codec}`);
  }
  decoder.configure(decoderConfig);

  // --- collect samples (video → decoder, audio → copied into muxer) ---
  // Prefer the container's real ASC; fall back to a synthesized AAC-LC config from the
  // track's sample rate/channels (iPhone .mov esds often isn't parseable here). Only
  // truly give up — and let the orchestrator fall through — if neither is available.
  const asc = aTrack
    ? (audioSpecificConfig(file, aTrack.id) ?? synthAacAsc(aTrack.audio?.sample_rate, aTrack.audio?.channel_count))
    : undefined;
  console.info('[webcodecs] audio config', {
    hasAudio: !!aTrack,
    ascBytes: asc?.byteLength ?? 0,
    synthesized: !!aTrack && !audioSpecificConfig(file, aTrack.id) && !!asc,
  });
  if (aTrack && !asc) throw new Error('cannot read audio config'); // avoid a silent result

  // (spec 2038) BACKPRESSURE: flooding the decoder let decoded frames pile up
  // faster than the canvas→encoder leg drained them — a single 4K frame is
  // ~33 MB; a long clip queued hundreds. Wait until both queues drain below the
  // cap before decoding the next chunk. The 'dequeue' event wakes us where
  // supported; the timer is the safety net.
  const MAX_QUEUE = 8;
  const queuesDrained = () => decoder.decodeQueueSize < MAX_QUEUE && encoder.encodeQueueSize < MAX_QUEUE;
  const awaitQueues = async () => {
    while (!queuesDrained()) {
      if (fatalError) throw fatalError;
      await new Promise<void>((resolve) => {
        const t = setTimeout(done, 20);
        function done(): void {
          clearTimeout(t);
          decoder.removeEventListener?.('dequeue', done);
          encoder.removeEventListener?.('dequeue', done);
          resolve();
        }
        decoder.addEventListener?.('dequeue', done);
        encoder.addEventListener?.('dequeue', done);
      });
    }
  };

  // (spec 2041) Samples are converted the moment mp4box surfaces them (both
  // chunk constructors and the muxer COPY the bytes, so the mp4box-side sample
  // data is released immediately after each batch), video chunks are decoded
  // with backpressure between windows, and the per-batch release plus
  // appendBuffer's cleanBuffers keep the demux-side heap bounded by the window
  // size instead of the file size.
  let pendingVideo: EncodedVideoChunk[] = [];
  let videoCount = 0;
  let audioCount = 0;
  file.onSamples = (id: number, _u: any, samples: any[]) => {
    if (!samples.length) return;
    if (id === vTrack.id) {
      for (const s of samples) {
        pendingVideo.push(
          new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: (s.cts / s.timescale) * 1e6,
            duration: (s.duration / s.timescale) * 1e6,
            data: s.data,
          }),
        );
      }
      videoCount += samples.length;
    } else if (aTrack && id === aTrack.id) {
      for (const s of samples) {
        const chunk = new EncodedAudioChunk({
          type: 'key',
          timestamp: (s.cts / s.timescale) * 1e6,
          duration: (s.duration / s.timescale) * 1e6,
          data: s.data,
        });
        muxer.addAudioChunk(chunk, {
          decoderConfig: {
            codec: 'mp4a.40.2',
            sampleRate: aTrack.audio.sample_rate,
            numberOfChannels: aTrack.audio.channel_count,
            description: asc,
          },
        } as any);
        audioCount++;
      }
    } else {
      return;
    }
    file.releaseUsedSamples(id, samples[samples.length - 1].number + 1);
  };
  const drainPendingVideo = async () => {
    if (!pendingVideo.length) return;
    const batch = pendingVideo;
    pendingVideo = [];
    for (const chunk of batch) {
      await awaitQueues();
      decoder.decode(chunk);
    }
  };

  file.setExtractionOptions(vTrack.id, null, { nbSamples: 200 });
  if (aTrack) file.setExtractionOptions(aTrack.id, null, { nbSamples: 200 });
  file.start();

  // Pump each mdat's BODY through in bounded windows (the headers went in during
  // the open phase). Windows are appended in file order; mp4box surfaces samples
  // as their bytes become contiguous, onSamples converts them, and we decode
  // between appends so the frame queues never outrun the encoder.
  for (const b of boxes) {
    if (b.type !== 'mdat') continue;
    let off = b.start + b.headerLen;
    const end = b.start + b.size;
    while (off < end) {
      const next = Math.min(end, off + DEMUX_WINDOW_BYTES);
      await appendRange(off, next);
      off = next;
      await drainPendingVideo();
      if (fatalError) throw fatalError;
    }
  }
  file.flush();
  if (parseError) throw parseError;
  await drainPendingVideo();

  // Completeness guard (spec 2007 lesson, kept from the collect-first design):
  // a truncated extraction must be a clean REJECTION, never silently muxed as a
  // shorter clip — the orchestrator falls through to ffmpeg/original instead.
  if (videoCount < vTrack.nb_samples || (aTrack && audioCount < aTrack.nb_samples)) {
    throw new Error(
      `mp4box sample extraction incomplete (video ${videoCount}/${vTrack.nb_samples}, audio ${audioCount}/${aTrack?.nb_samples ?? 0})`,
    );
  }

  await decoder.flush();
  await encoder.flush();
  // A decode/encode error reported asynchronously (captured by `fail`) becomes a
  // deterministic rejection here, so the orchestrator falls through cleanly.
  if (fatalError) throw fatalError;
  muxer.finalize();

  if (aTrack && audioCount === 0) throw new Error('audio was dropped'); // guard

  const { buffer } = muxer.target as ArrayBufferTarget;
  const result = new Blob([buffer], { type: 'video/mp4' });
  if (!result.size) throw new Error('empty output');
  return result;
}
