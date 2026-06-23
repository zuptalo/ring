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

import { compressVideoAdaptive } from './media-video';
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

  it('falls through to ffmpeg when WebCodecs output is not smaller', async () => {
    const src = mp4(1000);
    const small = mp4(450);
    vi.mocked(webcodecsTranscode).mockResolvedValue(mp4(1000)); // not smaller
    vi.mocked(ffmpegTranscode).mockResolvedValue(small);
    const out = await compressVideoAdaptive(src, 'sd');
    expect(out).toBe(small);
  });

  it('never blocks the send: returns the ORIGINAL blob when both engines fail (FR-006)', async () => {
    const src = mp4(1000);
    vi.mocked(webcodecsTranscode).mockRejectedValue(new Error('boom'));
    vi.mocked(ffmpegTranscode).mockRejectedValue(new Error('oom / too large'));
    const out = await compressVideoAdaptive(src, 'hd');
    expect(out).toBe(src);
  });
});
