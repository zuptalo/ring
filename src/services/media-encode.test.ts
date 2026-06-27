import { describe, it, expect } from 'vitest';
import { achievedQuality, availableQualities, qualityLabel, compressImage, isPreservedImageMime } from './media-encode';

// spec 2007 — the badge must reflect the quality actually sent, never the one
// requested. achievedQuality() is the single source of truth for that invariant.
const blob = (bytes: number) => new Blob([new Uint8Array(Math.max(0, bytes))]);

describe('achievedQuality', () => {
  it('reports original when original/undefined was requested', () => {
    expect(achievedQuality('original', 1000, blob(1000))).toBe('original');
    expect(achievedQuality(undefined, 1000, blob(10))).toBe('original');
  });

  it('reports the requested tier only when the upload is genuinely smaller', () => {
    expect(achievedQuality('sd', 1000, blob(400))).toBe('sd');
    expect(achievedQuality('hd', 1000, blob(700))).toBe('hd');
    expect(achievedQuality('fhd', 1000, blob(800))).toBe('fhd');
  });

  it('falls back to original when the transcode could not shrink the file', () => {
    // engine fell through to the source (equal size) → not a real tier send
    expect(achievedQuality('sd', 1000, blob(1000))).toBe('original');
    expect(achievedQuality('fhd', 1000, blob(1000))).toBe('original');
    // re-encode grew the file (already-compressed source) → also original
    expect(achievedQuality('hd', 1000, blob(1200))).toBe('original');
  });

  it('treats a zero-byte edge without claiming a tier it did not achieve', () => {
    expect(achievedQuality('sd', 0, blob(0))).toBe('original');
  });
});

describe('availableQualities (picker suitability)', () => {
  it('offers only tiers the source can produce — never upscales (spec 2007)', () => {
    // 4K source: every tier (Full HD is the top) + original.
    expect(availableQualities(3840)).toEqual(['sd', 'hd', 'fhd', 'original']);
    // 1080p source: Full HD re-encodes same-res.
    expect(availableQualities(1920)).toEqual(['sd', 'hd', 'fhd', 'original']);
    // 720p source: only SD downscales / HD re-encodes same-res.
    expect(availableQualities(1280)).toEqual(['sd', 'hd', 'original']);
    // Small source below the smallest tier → nothing to choose but Original.
    expect(availableQualities(480)).toEqual(['original']);
  });

  it('offers all tiers when the source size is unknown (honest labeling demotes later)', () => {
    expect(availableQualities(undefined)).toEqual(['sd', 'hd', 'fhd', 'original']);
  });
});

// Animated/efficient formats must never be re-encoded on send: the canvas+JPEG path
// would flatten a GIF/animated-WebP to one static frame (and drop WebP alpha). compressImage
// returns the ORIGINAL blob untouched for these, so animation survives to the recipient.
describe('compressImage preserves animated/efficient formats', () => {
  it('flags GIF and WebP as preserved, others not', () => {
    expect(isPreservedImageMime('image/gif')).toBe(true);
    expect(isPreservedImageMime('image/webp')).toBe(true);
    expect(isPreservedImageMime('image/jpeg')).toBe(false);
    expect(isPreservedImageMime('image/png')).toBe(false);
  });

  it('returns the original GIF/WebP blob unchanged even at a non-original tier', async () => {
    const gif = new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: 'image/gif' });
    const webp = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' });
    // hd would normally re-encode to JPEG; for these it must hand back the SAME blob.
    expect(await compressImage(gif, 'hd')).toBe(gif);
    expect(await compressImage(webp, 'sd')).toBe(webp);
    // 'original' is a passthrough for everything, as before.
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await compressImage(png, 'original')).toBe(png);
  });
});

describe('qualityLabel', () => {
  it('names every tier', () => {
    expect(['sd', 'hd', 'fhd', 'original'].map((q) => qualityLabel(q as never))).toEqual([
      'SD',
      'HD',
      'Full HD',
      'Original',
    ]);
  });
});
