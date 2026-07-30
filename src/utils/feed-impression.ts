/**
 * When a post in the feed counts as "seen" (spec 1065 FR-014).
 *
 * The rule: at least half of it on screen, continuously, for a second. Flicking
 * the feed past a post does not count, which matters because the author is shown
 * this number and a count inflated by fast scrolling would be a lie.
 *
 * Kept DOM-free on purpose. The directive owns the IntersectionObserver and feeds
 * ratios in here; this module owns the timing rule and the once-per-post
 * guarantee, so both can be tested without a browser.
 *
 * Once-only matters beyond tidiness: the recorded moment is a person's FIRST
 * sighting and the server ignores later ones, so re-reporting would be pure waste.
 * The device also persists what it has reported (see `wall.viewsReported`), and
 * that set is seeded in here so a post seen in a previous session is not
 * re-reported in this one.
 */

/** Fraction of the post that must be on screen. Matches the visibility threshold
 *  chat already uses to decide a message was seen. */
export const IMPRESSION_RATIO = 0.5;

/** How long it must stay there. Long enough to exclude a scroll-by, short enough
 *  that a genuine glance counts. */
export const IMPRESSION_DWELL_MS = 1000;

/**
 * Whether a sighting may be reported at all (spec 1065 FR-013/FR-015/FR-017b).
 *
 * Pulled out as a pure predicate on purpose. These three conditions are the only
 * thing keeping view reporting honest, and now that the feed reports sightings —
 * not just deliberate opens — there are two call sites instead of one. A gate
 * that lives inline in an async function is a gate someone bypasses by calling
 * the endpoint directly; a named predicate with tests is one they have to
 * deliberately ignore.
 */
export function mayReportView(opts: {
  /** Your own post. You are never in your own viewer list. */
  outgoing: boolean;
  /** The reciprocal "Seen receipts" setting. Client-enforced on both sides; the
   *  server has no idea it exists, so nothing else can enforce it. */
  seenReceiptsOn: boolean;
  /** Already reported by this device, this session or a previous one. */
  alreadyReported: boolean;
}): boolean {
  return !opts.outgoing && opts.seenReceiptsOn && !opts.alreadyReported;
}

export class ImpressionTracker {
  private readonly report: (postId: string) => void;
  /** Posts on screen past the threshold → the moment they crossed it. */
  private readonly since = new Map<string, number>();
  /** Reported this session or in a previous one. Never reported twice. */
  private readonly done: Set<string>;
  private clock = 0;

  constructor(report: (postId: string) => void, alreadyReported: readonly string[] = []) {
    this.report = report;
    this.done = new Set(alreadyReported);
  }

  /** A post's visible fraction changed. `at` is a monotonic ms reading. */
  observe(postId: string, ratio: number, at: number): void {
    this.clock = Math.max(this.clock, at);
    if (this.done.has(postId)) return;
    if (ratio >= IMPRESSION_RATIO) {
      // Only start the clock on the transition onto screen — an observer that
      // re-fires while a post stays visible must not keep restarting the dwell.
      if (!this.since.has(postId)) this.since.set(postId, at);
    } else {
      // Left the threshold before it elapsed: the next return starts over,
      // rather than accumulating glimpses into a phantom second.
      this.since.delete(postId);
    }
    this.settle();
  }

  /** Advance to `at` and report anything whose dwell has now elapsed. The
   *  directive calls this on a timer, because the observer only fires on
   *  threshold changes and a post that simply sits on screen produces no events. */
  tick(at: number): void {
    this.clock = Math.max(this.clock, at);
    this.settle();
  }

  /** Stop tracking a post (its row left the DOM) without reporting it. */
  drop(postId: string): void {
    this.since.delete(postId);
  }

  private settle(): void {
    for (const [postId, from] of this.since) {
      if (this.clock - from < IMPRESSION_DWELL_MS) continue;
      this.since.delete(postId);
      this.done.add(postId);
      this.report(postId);
    }
  }
}
