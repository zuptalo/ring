import { describe, it, expect, vi, beforeEach } from 'vitest';

// The WebCodecs + ffmpeg engines are browser-only; here we mock them and assert the
// ORCHESTRATION decisions of compressVideoAdaptive (spec 2007). A real transcode is
// exercised by the e2e suite + on-device verification, not vitest.
vi.mock('./media-video-webcodecs', () => ({
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
