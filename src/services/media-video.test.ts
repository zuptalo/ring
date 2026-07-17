import { describe, it, expect, vi, beforeEach } from 'vitest';

// The WebCodecs + ffmpeg engines are browser-only; here we mock them and assert the
// ORCHESTRATION decisions of compressVideoAdaptive (spec 2007). A real transcode is
// exercised by the e2e suite + on-device verification, not vitest.
vi.mock('./media-video-webcodecs', async (importOriginal) => ({
  // Keep the real pure helpers (the spec 2041 box scanner is unit-tested here);
  // only the engine entry points are mocked.
  ...(await importOriginal<object>()),
  webCodecsSupported: vi.fn(() => true),
  webcodecsTranscode: vi.fn(),
}));
vi.mock('./media-video-ffmpeg', () => ({
  ffmpegTranscode: vi.fn(),
}));

import { compressVideoAdaptive, shouldUploadAsIs, sniffMp4CodecIsPlainH264, VIDEO_PRESETS } from './media-video';
import { webcodecsTranscode } from './media-video-webcodecs';
import { ffmpegTranscode } from './media-video-ffmpeg';

const mp4 = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });

describe('compressVideoAdaptive fallback ladder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the WebCodecs output when it is genuinely smaller (no ffmpeg)', async () => {
    const src = mp4(1000);
    const small = mp4(300);
    vi.mocked(webcodecsTranscode).mockResolvedValue(small);
    const out = await compressVideoAdaptive(src, 'hd');
    expect(out).toBe(small);
    expect(ffmpegTranscode).not.toHaveBeenCalled();
  });

  it('falls through to ffmpeg when WebCodecs throws', async () => {
    const src = mp4(1000);
    const small = mp4(400);
    vi.mocked(webcodecsTranscode).mockRejectedValue(new Error('no H.264 encoder'));
    vi.mocked(ffmpegTranscode).mockResolvedValue(small);
    const out = await compressVideoAdaptive(src, 'sd');
    expect(out).toBe(small);
  });

  it('sends the ORIGINAL (no ffmpeg detour) when a completed WebCodecs pass is not smaller (spec 2034 FR-001)', async () => {
    // A hardware re-encode that can't shrink the clip means the source is already
    // efficient for the preset. The old ffmpeg fallback here cost a silent ~30 MB
    // wasm download + a slow second transcode while the posting bar sat near 0%.
    const src = mp4(1000);
    vi.mocked(webcodecsTranscode).mockResolvedValue(mp4(1000)); // not smaller
    const out = await compressVideoAdaptive(src, 'sd');
    expect(out).toBe(src);
    expect(ffmpegTranscode).not.toHaveBeenCalled();
  });

  it('never blocks the send: returns the ORIGINAL blob when both engines fail (FR-006)', async () => {
    const src = mp4(1000);
    vi.mocked(webcodecsTranscode).mockRejectedValue(new Error('boom'));
    vi.mocked(ffmpegTranscode).mockRejectedValue(new Error('oom / too large'));
    const out = await compressVideoAdaptive(src, 'hd');
    expect(out).toBe(src);
  });
});

describe('upload-as-is gate (spec 2038)', () => {
  const hd = VIDEO_PRESETS.hd;
  const base = { sizeBytes: 15_000_000, durationSec: 40, width: 1280, height: 720, h264Compatible: true };

  it('an efficient, preset-fitting H.264 clip skips the transcode', () => {
    // 15MB / 40s = 3.0 Mbps ≤ 1.5 × 2.5 Mbps
    expect(shouldUploadAsIs(base, hd)).toBe(true);
  });
  it('a fat bitrate transcodes', () => {
    expect(shouldUploadAsIs({ ...base, sizeBytes: 60_000_000 }, hd)).toBe(false); // 12 Mbps
  });
  it('4K-class resolution always transcodes, whatever the bitrate', () => {
    expect(shouldUploadAsIs({ ...base, width: 3840, height: 2160 }, hd)).toBe(false);
  });
  it('incompatible codecs always transcode', () => {
    expect(shouldUploadAsIs({ ...base, h264Compatible: false }, hd)).toBe(false);
  });
  it('zero/unknown duration never skips', () => {
    expect(shouldUploadAsIs({ ...base, durationSec: 0 }, hd)).toBe(false);
  });

  const buf = (s: string) => new TextEncoder().encode(`....${s}....avc1....`);
  it('codec sniff accepts plain H.264 and rejects modern-codec markers', () => {
    expect(sniffMp4CodecIsPlainH264(new TextEncoder().encode('..moov..avc1..'))).toBe(true);
    expect(sniffMp4CodecIsPlainH264(buf('hvc1'))).toBe(false);
    expect(sniffMp4CodecIsPlainH264(buf('hev1'))).toBe(false);
    expect(sniffMp4CodecIsPlainH264(buf('av01'))).toBe(false);
    expect(sniffMp4CodecIsPlainH264(buf('vp09'))).toBe(false);
    expect(sniffMp4CodecIsPlainH264(new TextEncoder().encode('..no codec here..'))).toBe(false);
  });
});

/* ---- spec 2041: header-only codec sniff + box scanner ---- */

/** Build a synthetic top-level box: 4-byte size, 4-byte type, payload. */
function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}
const fourcc = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('scanTopLevelBoxes (spec 2041)', () => {
  it('indexes a moov-last (iPhone camera) layout without touching media data', async () => {
    const { scanTopLevelBoxes } = await import('./media-video-webcodecs');
    const blob = new Blob([box('ftyp', fourcc('isom')), box('mdat', new Uint8Array(1000)), box('moov', fourcc('avc1'))]);
    const boxes = await scanTopLevelBoxes(blob);
    expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'mdat', 'moov']);
    expect(boxes[1].size).toBe(1008);
    expect(boxes[2].start).toBe(12 + 1008);
  });

  it('handles a 64-bit largesize mdat', async () => {
    const { scanTopLevelBoxes } = await import('./media-video-webcodecs');
    const payload = new Uint8Array(100);
    const big = new Uint8Array(16 + payload.length) as Uint8Array<ArrayBuffer>;
    const dv = new DataView(big.buffer);
    dv.setUint32(0, 1); // size==1 → largesize follows
    for (let i = 0; i < 4; i++) big[4 + i] = 'mdat'.charCodeAt(i);
    dv.setUint32(8, 0);
    dv.setUint32(12, big.length);
    const blob = new Blob([box('ftyp', fourcc('isom')), big, box('moov', fourcc('avc1'))]);
    const boxes = await scanTopLevelBoxes(blob);
    expect(boxes[1]).toMatchObject({ type: 'mdat', size: big.length, headerLen: 16 });
  });

  it('rejects a non-mp4 byte stream', async () => {
    const { scanTopLevelBoxes } = await import('./media-video-webcodecs');
    await expect(scanTopLevelBoxes(new Blob([new Uint8Array(64).fill(0xab)]))).rejects.toThrow(/not an mp4/);
  });
});

describe('sniffBlobCodecIsPlainH264 (spec 2041)', () => {
  it('finds avc1 in the moov without reading mdat', async () => {
    const { sniffBlobCodecIsPlainH264 } = await import('./media-video');
    // mdat contains an hvc1 marker to prove it is NOT scanned (only moov is).
    const blob = new Blob([box('ftyp', fourcc('isom')), box('mdat', fourcc('hvc1')), box('moov', fourcc('avc1'))]);
    expect(await sniffBlobCodecIsPlainH264(blob)).toBe(true);
  });

  it('rejects an HEVC moov', async () => {
    const { sniffBlobCodecIsPlainH264 } = await import('./media-video');
    const blob = new Blob([box('ftyp', fourcc('isom')), box('moov', fourcc('hvc1'))]);
    expect(await sniffBlobCodecIsPlainH264(blob)).toBe(false);
  });

  it('an unscannable container is simply not-compatible (transcode as before)', async () => {
    const { sniffBlobCodecIsPlainH264 } = await import('./media-video');
    expect(await sniffBlobCodecIsPlainH264(new Blob([new Uint8Array(32).fill(1)]))).toBe(false);
  });
});
