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

/** The audio AudioSpecificConfig (esds DecoderSpecificInfo) for a copied track. */
function audioSpecificConfig(file: any, trackId: number): Uint8Array | undefined {
  try {
    const trak = file.getTrackById(trackId);
    const esds = trak.mdia.minf.stbl.stsd.entries[0]?.esds;
    const asc = esds?.esd?.descs?.[0]?.descs?.[0]?.data;
    return asc ? new Uint8Array(asc) : undefined;
  } catch {
    return undefined;
  }
}

export async function webcodecsTranscode(
  blob: Blob,
  preset: VideoPreset,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  if (!webCodecsSupported()) throw new Error('WebCodecs unavailable');

  const file = MP4Box.createFile();
  const info = await new Promise<any>((resolve, reject) => {
    file.onReady = resolve;
    file.onError = (e: string) => reject(new Error(`mp4box: ${e}`));
    const ab = blob.arrayBuffer() as Promise<ArrayBuffer & { fileStart?: number }>;
    void ab.then((buf) => {
      (buf as any).fileStart = 0;
      file.appendBuffer(buf as any);
      file.flush();
    });
  });

  const vTrack = info.videoTracks?.[0];
  if (!vTrack) throw new Error('no video track');
  const aTrack = info.audioTracks?.[0];

  const sw = vTrack.video.width;
  const sh = vTrack.video.height;
  const scale = Math.min(1, preset.maxEdge / Math.max(sw, sh));
  const tw = Math.max(2, Math.round((sw * scale) / 2) * 2);
  const th = Math.max(2, Math.round((sh * scale) / 2) * 2);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: 'in-memory',
    video: { codec: 'avc', width: tw, height: th },
    audio: aTrack
      ? { codec: 'aac', sampleRate: aTrack.audio.sample_rate, numberOfChannels: aTrack.audio.channel_count }
      : undefined,
  });

  console.info('[webcodecs] tracks', {
    video: vTrack.codec,
    src: `${sw}x${sh}`,
    target: `${tw}x${th}`,
    audio: aTrack?.codec,
  });

  // --- pick a supported H.264 encoder config (Safari is picky about profile/level) ---
  const base = { width: tw, height: th, bitrate: preset.bitrate, framerate: vTrack.video?.frame_rate || 30 };
  const candidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f', 'avc1.42e01e'];
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
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure(encoderConfig);
  console.info('[webcodecs] encoder configured', encoderConfig.codec);

  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  let n = 0;
  const decoder = new VideoDecoder({
    output: (frame) => {
      ctx.drawImage(frame, 0, 0, tw, th);
      const out = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
      encoder.encode(out, { keyFrame: n % 150 === 0 });
      out.close();
      frame.close();
      n++;
      if (vTrack.nb_samples) onProgress?.(n / vTrack.nb_samples);
    },
    error: (e) => {
      throw e;
    },
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
  const asc = aTrack ? audioSpecificConfig(file, aTrack.id) : undefined;
  console.info('[webcodecs] audio config', { hasAudio: !!aTrack, ascBytes: asc?.byteLength ?? 0 });
  if (aTrack && !asc) throw new Error('cannot read audio config'); // avoid a silent result
  const videoChunks: EncodedVideoChunk[] = [];
  let audioCount = 0;

  await new Promise<void>((resolve, reject) => {
    let done = 0;
    const total = aTrack ? 2 : 1;
    file.onSamples = (id: number, _u: any, samples: any[]) => {
      try {
        if (id === vTrack.id) {
          for (const s of samples) {
            videoChunks.push(
              new EncodedVideoChunk({
                type: s.is_sync ? 'key' : 'delta',
                timestamp: (s.cts / s.timescale) * 1e6,
                duration: (s.duration / s.timescale) * 1e6,
                data: s.data,
              }),
            );
          }
          if (samples.length && samples[samples.length - 1].number + 1 >= vTrack.nb_samples) {
            done++;
            if (done >= total) resolve();
          }
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
          if (samples.length && samples[samples.length - 1].number + 1 >= aTrack.nb_samples) {
            done++;
            if (done >= total) resolve();
          }
        }
      } catch (e) {
        reject(e as Error);
      }
    };
    file.setExtractionOptions(vTrack.id, null, { nbSamples: Number.POSITIVE_INFINITY });
    if (aTrack) file.setExtractionOptions(aTrack.id, null, { nbSamples: Number.POSITIVE_INFINITY });
    file.start();
    file.flush();
    // Safety: if onSamples never reports completion, resolve after extraction.
    setTimeout(resolve, 0);
  });

  for (const chunk of videoChunks) decoder.decode(chunk);
  await decoder.flush();
  await encoder.flush();
  muxer.finalize();

  if (aTrack && audioCount === 0) throw new Error('audio was dropped'); // guard

  const { buffer } = muxer.target as ArrayBufferTarget;
  const result = new Blob([buffer], { type: 'video/mp4' });
  if (!result.size) throw new Error('empty output');
  return result;
}
