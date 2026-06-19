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
