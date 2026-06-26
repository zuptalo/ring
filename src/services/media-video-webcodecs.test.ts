import { describe, it, expect } from 'vitest';
import { synthAacAsc, rotationFromMatrix } from './media-video-webcodecs';

// spec 1018 US1 — the WebCodecs re-encode used to ignore the MP4 track display matrix, so a portrait
// phone capture (landscape coded frames + a 90° matrix) was re-encoded as landscape and arrived
// rotated for the recipient. rotationFromMatrix derives the upright rotation from the tkhd matrix
// (raw 16.16/2.30 fixed-point ints, as mp4box exposes it) so the transcode can bake it into pixels.
describe('rotationFromMatrix (tkhd display matrix → upright degrees)', () => {
  const F = 65536; // 1.0 in 16.16 fixed point
  const BR = 1 << 30; // 1.0 in 2.30 fixed point (the bottom-right matrix term)
  it('reads 0° from the identity matrix', () => {
    expect(rotationFromMatrix([F, 0, 0, 0, F, 0, 0, 0, BR])).toBe(0);
  });
  it('reads 90° (portrait phone capture)', () => {
    expect(rotationFromMatrix([0, F, 0, -F, 0, 0, 0, 0, BR])).toBe(90);
  });
  it('reads 180° (upside-down)', () => {
    expect(rotationFromMatrix([-F, 0, 0, 0, -F, 0, 0, 0, BR])).toBe(180);
  });
  it('reads 270° (the other sideways)', () => {
    expect(rotationFromMatrix([0, -F, 0, F, 0, 0, 0, 0, BR])).toBe(270);
  });
  it('treats a missing/degenerate matrix as upright (no double-rotation)', () => {
    expect(rotationFromMatrix(undefined)).toBe(0);
    expect(rotationFromMatrix(null)).toBe(0);
    expect(rotationFromMatrix([])).toBe(0);
    expect(rotationFromMatrix([0, 0, 0, 0, 0])).toBe(0);
  });
});

// spec 2007 — iPhone .mov files don't expose a parseable esds here, so we synthesize a
// standard AAC-LC AudioSpecificConfig from the track's sample rate + channels. A wrong
// ASC would corrupt the copied audio, so pin the exact bytes for common rates.
describe('synthAacAsc (AAC-LC AudioSpecificConfig)', () => {
  it('builds the canonical 2-byte config for common rates/channels', () => {
    // 44100 Hz (freq index 4), stereo: objType=2 → 0x12 0x10
    expect(Array.from(synthAacAsc(44100, 2)!)).toEqual([0x12, 0x10]);
    // 48000 Hz (freq index 3), stereo → 0x11 0x90
    expect(Array.from(synthAacAsc(48000, 2)!)).toEqual([0x11, 0x90]);
    // 48000 Hz, mono → channel config 1
    expect(Array.from(synthAacAsc(48000, 1)!)).toEqual([0x11, 0x88]);
  });

  it('returns undefined for unsupported rates/channels (caller falls through)', () => {
    expect(synthAacAsc(12345, 2)).toBeUndefined();
    expect(synthAacAsc(44100, 0)).toBeUndefined();
    expect(synthAacAsc(undefined, undefined)).toBeUndefined();
  });
});
