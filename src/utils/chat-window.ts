/**
 * Pure render-window math for the bounded chat list (spec 1011, research D1).
 *
 * The view renders `rows.slice(start, end)` from the loaded contiguous run. These
 * helpers move `{start, end}` as the user scrolls — growing toward the look-ahead
 * direction and evicting the far edge — so the rendered DOM stays bounded to ROW_CAP
 * regardless of scroll distance (FR-012). They are pure index arithmetic: the view
 * supplies the loaded-row count and the direction a look-ahead sentinel fired in; no
 * DOM is touched here.
 */

/** Max rendered rows (≈ a few mobile screens + buffer). Bounds the DOM. */
export const ROW_CAP = 100;
/** One bounded read batch (≈ ½ ROW_CAP so a batch fills the buffer without overshoot). */
export const BATCH_SIZE = 50;
/** Look-ahead distance kept beyond the viewport each way; also the prefetch sentinel's
 *  rootMargin (≈ 1.5–2 mobile screens). */
export const LOOK_AHEAD_PX = 1200;
/** How many rows a single look-ahead grows the window by (kept ≤ ROW_CAP). */
export const WINDOW_STEP = BATCH_SIZE;
/** Bound on the loaded run useChatHistory keeps in memory (render window + buffer each
 *  side). Larger than ROW_CAP so the window can slide without a DB read every step. */
export const MAX_ROWS = ROW_CAP + 2 * BATCH_SIZE;

export interface RenderWindow {
  start: number;
  end: number;
}

/** The newest `rowCap` rows of a run of `total` rows (a fresh chat opens pinned here). */
export function initialWindow(total: number, rowCap: number = ROW_CAP): RenderWindow {
  const start = Math.max(0, total - rowCap);
  return { start, end: total };
}

/** Shift both edges by `delta` (e.g. after prepending `delta` older rows to the front
 *  of `rows`, so the same logical rows stay rendered). Clamped to be non-negative. */
export function shiftWindow(w: RenderWindow, delta: number): RenderWindow {
  return { start: Math.max(0, w.start + delta), end: Math.max(0, w.end + delta) };
}

export interface ComputeOpts {
  /** Which way the look-ahead sentinel fired: 'older' (scrolling up) / 'newer' (down). */
  grow: 'older' | 'newer';
  /** Rows to extend the leading edge by this step. */
  step: number;
  /** Loaded-run length (rows.length) — the window can never extend past it. */
  total: number;
  /** Max rendered rows. */
  rowCap?: number;
}

/**
 * Advance the window one look-ahead step:
 * - grow 'older' → start moves DOWN by `step` (render older rows), and end RETREATS so
 *   `end - start ≤ rowCap` (evict the newest rendered rows — the far edge).
 * - grow 'newer' → end moves UP by `step` (render newer rows), and start ADVANCES so
 *   `end - start ≤ rowCap` (evict the oldest rendered rows — the far edge).
 * Always clamped to [0, total]; the viewport stays covered because the leading edge
 * grows in the scroll direction before the far edge is evicted.
 */
export function computeWindow(w: RenderWindow, opts: ComputeOpts): RenderWindow {
  const cap = Math.min(opts.rowCap ?? ROW_CAP, opts.total);
  let { start, end } = w;
  if (opts.grow === 'older') {
    start = Math.max(0, start - opts.step);
    end = Math.min(opts.total, Math.max(end, start)); // unchanged, just clamped
    if (end - start > cap) end = start + cap; // retreat the newest edge
  } else {
    end = Math.min(opts.total, end + opts.step);
    start = Math.max(0, Math.min(start, end)); // unchanged, just clamped
    if (end - start > cap) start = end - cap; // advance the oldest edge
  }
  return { start, end };
}
