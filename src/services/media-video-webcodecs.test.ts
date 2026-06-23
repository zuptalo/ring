import { describe, it, expect } from 'vitest';
import { synthAacAsc } from './media-video-webcodecs';

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
