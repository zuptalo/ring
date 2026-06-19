import { describe, it, expect } from 'vitest';
import { THUMB_TIERS, thumbDims } from './thumbs';

// Pure tier-size math for spec 1014's three image thumbnail tiers (bubble/grid/strip).
// The actual downscaling (canvas/createImageBitmap) lives in media-meta.ts (needs the DOM);
// here we only test the dimension math, which must be aspect-preserving and never upscale.

describe('THUMB_TIERS', () => {
  it('defines the three max-edge tiers (strip < grid < bubble)', () => {
    expect(THUMB_TIERS.strip).toBe(128);
    expect(THUMB_TIERS.grid).toBe(320);
    expect(THUMB_TIERS.bubble).toBe(512);
    expect(THUMB_TIERS.strip).toBeLessThan(THUMB_TIERS.grid);
    expect(THUMB_TIERS.grid).toBeLessThan(THUMB_TIERS.bubble);
  });
});

describe('thumbDims (aspect-preserving, no upscale)', () => {
  it('scales a landscape image down so its long edge equals maxEdge', () => {
    expect(thumbDims(4000, 3000, 512)).toEqual({ w: 512, h: 384 });
  });

  it('scales a portrait image down so its long edge equals maxEdge', () => {
    expect(thumbDims(3000, 4000, 320)).toEqual({ w: 240, h: 320 });
  });

  it('never upscales: a source already within maxEdge is returned unchanged', () => {
    expect(thumbDims(100, 80, 128)).toEqual({ w: 100, h: 80 });
  });

  it('clamps to at least 1px and tolerates zero/degenerate input', () => {
    expect(thumbDims(0, 0, 128)).toEqual({ w: 1, h: 1 });
    const tiny = thumbDims(2000, 1, 128); // 1px-tall panorama
    expect(tiny.w).toBe(128);
    expect(tiny.h).toBe(1);
  });
});
