import { describe, it, expect } from 'vitest';
import { achievedQuality, availableQualities, qualityLabel } from './media-encode';

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
    expect(achievedQuality('4k', 1000, blob(900))).toBe('4k');
  });

  it('falls back to original when the transcode could not shrink the file', () => {
    // engine fell through to the source (equal size) → not a real tier send
    expect(achievedQuality('sd', 1000, blob(1000))).toBe('original');
    expect(achievedQuality('4k', 1000, blob(1000))).toBe('original');
    // re-encode grew the file (already-compressed source) → also original
    expect(achievedQuality('hd', 1000, blob(1200))).toBe('original');
  });

  it('treats a zero-byte edge without claiming a tier it did not achieve', () => {
    expect(achievedQuality('sd', 0, blob(0))).toBe('original');
  });
});

describe('availableQualities (picker suitability)', () => {
  it('offers only tiers the source can produce — never upscales (spec 2007)', () => {
    // 4K source: every tier + original.
    expect(availableQualities(3840)).toEqual(['sd', 'hd', 'fhd', '4k', 'original']);
    // 1080p source: 4K is dropped (would upscale); Full HD re-encodes same-res.
    expect(availableQualities(1920)).toEqual(['sd', 'hd', 'fhd', 'original']);
    // 720p source: only SD downscales / HD re-encodes same-res.
    expect(availableQualities(1280)).toEqual(['sd', 'hd', 'original']);
    // Small source below the smallest tier → nothing to choose but Original.
    expect(availableQualities(480)).toEqual(['original']);
  });

  it('offers all tiers when the source size is unknown (honest labeling demotes later)', () => {
    expect(availableQualities(undefined)).toEqual(['sd', 'hd', 'fhd', '4k', 'original']);
  });
});

describe('qualityLabel', () => {
  it('names every tier', () => {
    expect(['sd', 'hd', 'fhd', '4k', 'original'].map((q) => qualityLabel(q as never))).toEqual([
      'SD',
      'HD',
      'Full HD',
      '4K',
      'Original',
    ]);
  });
});
