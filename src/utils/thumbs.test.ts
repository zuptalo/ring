import { describe, it, expect } from 'vitest';
import { THUMB_TIERS, thumbDims, THUMB_MAX_BYTES, JPEG_QUALITY_STEPS, dataUrlBytes, chooseJpegQuality } from './thumbs';

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

// spec 1018 US2: the on-wire (bubble) poster is generated at 512px with JPEG quality stepped down
// only as needed to stay within a ~40KB ciphertext budget. The byte-estimation and quality-choice
// logic is DOM-free so it's unit-testable here; the canvas encode that uses it lives in media-meta.ts.

describe('thumbnail size budget (spec 1018)', () => {
  it('targets the 512px bubble tier and a ~40KB cap', () => {
    expect(THUMB_TIERS.bubble).toBe(512);
    expect(THUMB_MAX_BYTES).toBe(40 * 1024);
    // Quality steps must be descending so we try crispest first, then degrade.
    expect(JPEG_QUALITY_STEPS.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < JPEG_QUALITY_STEPS.length; i++) {
      expect(JPEG_QUALITY_STEPS[i]).toBeLessThan(JPEG_QUALITY_STEPS[i - 1]);
    }
  });

  it('dataUrlBytes estimates decoded byte length from a base64 data URL', () => {
    // "AAAA" decodes to 3 bytes; "AAA=" → 2 bytes; "AA==" → 1 byte.
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/jpeg;base64,AA==')).toBe(1);
    expect(dataUrlBytes('not-a-data-url')).toBe(0);
  });

  it('chooseJpegQuality keeps the crispest quality whose size fits the budget', () => {
    // Fake measure: smaller quality → smaller bytes. 0.82→60KB, 0.72→45KB, 0.62→30KB, 0.5→18KB.
    const sizes: Record<number, number> = { 0.82: 60_000, 0.72: 45_000, 0.62: 30_000, 0.5: 18_000 };
    const pick = chooseJpegQuality((q) => sizes[q], 40 * 1024);
    expect(pick.quality).toBe(0.62); // first step at/under 40KB
    expect(pick.bytes).toBe(30_000);
  });

  it('chooseJpegQuality returns the crispest step immediately when it already fits', () => {
    const pick = chooseJpegQuality(() => 10_000, 40 * 1024);
    expect(pick.quality).toBe(JPEG_QUALITY_STEPS[0]);
  });

  it('chooseJpegQuality falls back to the lowest (smallest) step when nothing fits', () => {
    const pick = chooseJpegQuality(() => 500_000, 40 * 1024); // everything over budget
    expect(pick.quality).toBe(JPEG_QUALITY_STEPS[JPEG_QUALITY_STEPS.length - 1]);
  });
});
