// spec 2050 — regression tests for the media-portability decisions (bug fix begins
// with a failing test, Constitution III). The webm case is the reported bug.
import { describe, it, expect } from 'vitest';
import {
  isPortableVideo,
  needsMandatoryTranscode,
  isHeic,
  imageNeedsAlphaPreserve,
} from './media-portability';

describe('spec 2050: isPortableVideo', () => {
  it('mp4/mov/m4v are portable; webm/mkv are not', () => {
    expect(isPortableVideo('video/mp4')).toBe(true);
    expect(isPortableVideo('video/quicktime')).toBe(true);
    expect(isPortableVideo('video/x-m4v')).toBe(true);
    expect(isPortableVideo('video/webm')).toBe(false);
    expect(isPortableVideo('video/x-matroska')).toBe(false);
  });
});

describe('spec 2050: needsMandatoryTranscode (the webm silent-fail guard)', () => {
  it('non-portable video must transcode regardless of quality', () => {
    expect(needsMandatoryTranscode('video/webm', 'original')).toBe(true);
    expect(needsMandatoryTranscode('video/webm', 'hd')).toBe(true);
    expect(needsMandatoryTranscode('video/x-matroska', 'original')).toBe(true);
  });
  it('portable video never needs a mandatory transcode', () => {
    expect(needsMandatoryTranscode('video/mp4', 'original')).toBe(false);
    expect(needsMandatoryTranscode('video/quicktime', 'hd')).toBe(false);
  });
  it('non-video inputs are not videos to transcode', () => {
    expect(needsMandatoryTranscode('image/png', 'original')).toBe(false);
    expect(needsMandatoryTranscode('image/heic', 'original')).toBe(false);
    expect(needsMandatoryTranscode('', 'original')).toBe(false);
  });
});

describe('spec 2050: isHeic', () => {
  it('matches heic/heif only', () => {
    expect(isHeic('image/heic')).toBe(true);
    expect(isHeic('image/heif')).toBe(true);
    expect(isHeic('image/jpeg')).toBe(false);
    expect(isHeic('image/png')).toBe(false);
  });
});

describe('spec 2050: imageNeedsAlphaPreserve', () => {
  it('only a PNG WITH alpha needs preserving', () => {
    expect(imageNeedsAlphaPreserve('image/png', true)).toBe(true);
    expect(imageNeedsAlphaPreserve('image/png', false)).toBe(false);
    expect(imageNeedsAlphaPreserve('image/jpeg', true)).toBe(false);
  });
});
