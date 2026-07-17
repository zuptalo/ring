/**
 * Pure anchor-delta math (INV-1) + the momentum/echo guard predicates (INV-5) for the
 * bounded chat window (spec 1011, research D4/D6).
 *
 * Keeping a message visually stationary across a prepend/eviction is the ≤2px bar. The
 * robust way (vs a scrollHeight delta, which skews with the spinner + late media decode)
 * is to anchor on a real rendered bubble: record its id + measured `top`, run the window
 * mutation, re-measure, and correct `scrollTop` by the delta. The view does the DOM
 * measuring; this module does the arithmetic and the decision of WHEN a correction is
 * safe to write — both directly unit-testable.
 */

export interface RenderedRow {
  /** the [data-mid] value */
  id: string;
  /** getBoundingClientRect().top, relative to the viewport */
  top: number;
}

export interface ScrollAnchor {
  id: string;
  top: number;
  /** Ordered ids from the anchor downward, captured before the mutation, so an evicted
   *  anchor falls back to the next still-rendered row. */
  fallback: string[];
}

/**
 * Pick the anchor: the topmost row fully below the viewport top (`top >= viewportTop`),
 * falling back to the first row when every row is partly scrolled off. Records the
 * fallback chain (the anchor and every row below it) for evicted-anchor recovery.
 */
export function pickAnchor(
  rendered: readonly RenderedRow[],
  viewportTop = 0,
): ScrollAnchor | null {
  if (rendered.length === 0) return null;
  let idx = rendered.findIndex((r) => r.top >= viewportTop);
  if (idx === -1) idx = 0; // all scrolled off the top → anchor on the first
  const anchor = rendered[idx];
  return { id: anchor.id, top: anchor.top, fallback: rendered.slice(idx).map((r) => r.id) };
}

/**
 * The scrollTop correction (px) that returns the anchor to its recorded `top` after a
 * mutation: `measuredTop - anchor.top`. If the anchor id was evicted, walk the fallback
 * chain to the next still-rendered row and use its measured top against the recorded
 * anchor top (a bounded approximation — the successor sat just below the anchor). Returns
 * null when nothing in the chain is still rendered (the view re-picks an anchor).
 */
export function resolveAnchorDelta(
  anchor: ScrollAnchor,
  measured: readonly RenderedRow[],
): number | null {
  const byId = new Map(measured.map((r) => [r.id, r.top]));
  for (const id of anchor.fallback.length ? anchor.fallback : [anchor.id]) {
    const top = byId.get(id);
    if (top !== undefined) return top - anchor.top;
  }
  return null;
}

/**
 * Defer a scrollTop write while a fling is in flight: true when a genuine user scroll
 * happened within `momentumQuietMs` (writing scrollTop mid-inertia fights iOS WebKit
 * momentum). `lastUserScrollAt === 0` means no user scroll yet → never defer.
 */
export function shouldDeferScrollWrite(
  now: number,
  lastUserScrollAt: number,
  momentumQuietMs: number,
): boolean {
  return lastUserScrollAt > 0 && now - lastUserScrollAt < momentumQuietMs;
}

/**
 * Whether a scroll event at `scrollTs` is the echo of our own programmatic pin/correction
 * (it lands inside the suppress window), not a genuine user scroll.
 */
export function isSelfEcho(scrollTs: number, suppressStickUntil: number): boolean {
  return scrollTs < suppressStickUntil;
}
