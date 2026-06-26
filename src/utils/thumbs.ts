/**
 * Pure tier-size math for spec 1014's multi-size image thumbnails. Three purpose-fit tiers are
 * generated per image (and per video, from its poster): the chat bubble, the all-media grid, and the
 * full-screen viewer's bottom strip. The sender transmits the largest (bubble) tier inline in the
 * E2EE `MediaRef.poster`; both sides derive the smaller two locally by downscaling it. The actual
 * pixel work (createImageBitmap/canvas) lives in media-meta.ts; this module is the DOM-free dimension
 * math so it's unit-testable and gated in coverage.
 */

/** Max-edge (px) for each tier. Sharp at the ~44 / ~130 / ~240px display sizes on 2–3× DPI. */
export const THUMB_TIERS = { strip: 128, grid: 320, bubble: 512 } as const;
export type ThumbTier = keyof typeof THUMB_TIERS;

/**
 * Target dimensions for a thumbnail whose longest edge is at most `maxEdge`, preserving aspect ratio
 * and **never upscaling** (a source already within `maxEdge` is returned unchanged). Clamps to ≥1px
 * and tolerates zero/degenerate input.
 */
export function thumbDims(srcW: number, srcH: number, maxEdge: number): { w: number; h: number } {
  const w = Math.max(0, Math.floor(srcW || 0));
  const h = Math.max(0, Math.floor(srcH || 0));
  const big = Math.max(w, h);
  const scale = big > maxEdge && big > 0 ? maxEdge / big : 1;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * On-wire poster budget (spec 1018). The bubble-tier thumbnail travels INSIDE the sealed E2EE
 * message (MediaRef.poster), so its quality trades off against ciphertext size and sync speed.
 * We generate at the crispest JPEG quality whose encoded size stays within ~40KB, stepping the
 * quality down only when a busy image would exceed the cap. The cap is a soft target: if even the
 * lowest step is over budget we still ship the smallest result rather than blocking the send.
 */
export const THUMB_MAX_BYTES = 40 * 1024;

/** JPEG qualities tried in order (crispest first). Stop at the first that fits THUMB_MAX_BYTES. */
export const JPEG_QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5] as const;

/**
 * Estimate the decoded byte length of a base64 `data:` URL (e.g. a JPEG produced by
 * canvas.toDataURL) WITHOUT allocating the bytes — base64 encodes 3 bytes per 4 chars, minus any
 * `=` padding. Returns 0 for a string that isn't a data URL. Pure (DOM-free) so it's unit-testable.
 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64Len = dataUrl.length - comma - 1;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64Len * 3) / 4) - padding);
}

/**
 * Pick the crispest JPEG quality whose encoded size (from `measure(q)`) fits `maxBytes`. Steps
 * through `steps` (descending quality) and returns the first that fits; if none fit, returns the
 * lowest step (the smallest output) so a poster still ships. `measure` performs the actual encode
 * (e.g. via canvas), keeping this function pure/testable with a fake measurer.
 */
export function chooseJpegQuality(
  measure: (quality: number) => number,
  maxBytes: number = THUMB_MAX_BYTES,
  steps: readonly number[] = JPEG_QUALITY_STEPS,
): { quality: number; bytes: number } {
  let last = { quality: steps[steps.length - 1], bytes: Infinity };
  for (const q of steps) {
    const bytes = measure(q);
    last = { quality: q, bytes };
    if (bytes <= maxBytes) return last;
  }
  return last;
}
