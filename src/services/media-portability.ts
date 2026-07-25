// (spec 2050) Pure media-portability decisions — dependency-free so they're
// unit-testable in the Node env and shared across the encode paths. The rule that
// closes the WebM silent-fail bug: a non-portable video container must transcode to
// MP4 before send, regardless of the chosen quality (including 'original').

// Containers that play natively on every target browser, incl. Safari/iOS.
const PORTABLE_VIDEO = /(mp4|quicktime|m4v)/i;

export function isPortableVideo(mime: string): boolean {
  return PORTABLE_VIDEO.test(mime || '');
}

/**
 * True when a video's container is NOT natively portable (e.g. webm/mkv) and therefore
 * MUST be transcoded to MP4 before sending — independent of quality. This is the guard
 * that prevents the `original`-quality / oversize / ffmpeg-skip paths from shipping raw
 * WebM that Safari/iOS can't decode. Non-video inputs return false.
 */
export function needsMandatoryTranscode(mime: string, _quality: string): boolean {
  const m = (mime || '').toLowerCase();
  if (!m.startsWith('video/')) return false;
  return !isPortableVideo(m);
}

export function isHeic(mime: string): boolean {
  return /(heic|heif)/i.test(mime || '');
}

/** A raster image whose transparency must be preserved (don't flatten to opaque JPEG). */
export function imageNeedsAlphaPreserve(mime: string, hasAlpha: boolean): boolean {
  return hasAlpha && /png/i.test(mime || '');
}
