/**
 * `v-seen-in-feed="postId"` — report a post as seen once it has genuinely been
 * looked at in the feed (spec 1065 FR-014).
 *
 * Before this, a post only counted as seen when its detail page was opened, so
 * the author's "Seen by" number missed almost everyone: most people react and
 * scroll on without ever opening a post. Counting feed sightings is what makes
 * the number mean something.
 *
 * One shared observer for the whole feed, following `autoplay-visible.ts`. A
 * per-row observer would be an allocation per post on a list that already
 * renders every post it holds, and the Wall does not window its feed.
 *
 * The timing rule and the once-per-post guarantee live in `feed-impression.ts`,
 * DOM-free and unit-tested. This file is the binding: it owns the observer, a
 * settle timer (the observer only fires on threshold *changes*, so a post that
 * simply rests on screen would otherwise never be reported), and the call into
 * the data layer.
 *
 * The call MUST go through `recordPostView`, never straight to the API: that
 * function holds the reciprocal seen-receipts gate and the never-your-own-post
 * rule, and both are client-side only. Calling the endpoint directly would
 * silently report views for someone who has turned seen receipts off.
 */
import type { Directive } from 'vue';
import { ImpressionTracker, IMPRESSION_RATIO } from '@/utils/feed-impression';
import { recordPostView } from '@/db/queries';

const els = new Map<Element, string>();
let io: IntersectionObserver | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let tracker: ImpressionTracker | null = null;

/** Roughly a fifth of the dwell: fine enough that a post is reported promptly
 *  after it settles, coarse enough to be invisible on a phone's battery. */
const SETTLE_MS = 200;

function ensure(): ImpressionTracker | null {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return null;
  if (tracker) return tracker;

  tracker = new ImpressionTracker((postId) => {
    void recordPostView(postId);
  });

  io = new IntersectionObserver(
    (entries) => {
      const at = performance.now();
      for (const e of entries) {
        const postId = els.get(e.target);
        if (postId) tracker?.observe(postId, e.intersectionRatio, at);
      }
    },
    // Two thresholds so we hear about both crossings; the rule itself compares
    // against IMPRESSION_RATIO rather than trusting isIntersecting.
    { threshold: [0, IMPRESSION_RATIO] },
  );

  timer = setInterval(() => tracker?.tick(performance.now()), SETTLE_MS);
  return tracker;
}

function teardownIfIdle(): void {
  if (els.size) return;
  io?.disconnect();
  io = null;
  if (timer !== null) clearInterval(timer);
  timer = null;
  // Deliberately keep `tracker`: it remembers what this session already reported,
  // so leaving and returning to the feed does not re-report the same posts.
}

export const vSeenInFeed: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    const postId = binding.value;
    if (!postId) return;
    if (!ensure()) return;
    els.set(el, postId);
    io?.observe(el);
  },
  updated(el, binding) {
    const postId = binding.value;
    if (els.get(el) === postId) return;
    const prev = els.get(el);
    if (prev) tracker?.drop(prev);
    if (postId) els.set(el, postId);
    else els.delete(el);
  },
  unmounted(el) {
    const postId = els.get(el);
    if (postId) tracker?.drop(postId);
    els.delete(el);
    io?.unobserve(el);
    teardownIfIdle();
  },
};
