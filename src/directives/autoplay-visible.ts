/**
 * `v-autoplay-visible` — inline, attention-respecting media autoplay for feeds.
 *
 * Applied to a `<video>` element (the Wall feed today; reusable for chat media later), it
 * plays the video — muted, inline — once the element is sufficiently on screen, and pauses
 * it when it scrolls away. A single shared coordinator guarantees that AT MOST ONE video
 * plays at a time across the whole app: scrolling from one playable post to the next hands
 * playback over, and audio never stacks. Hiding the tab or backgrounding the app stops
 * playback too. Honours the user's reduced-motion / data-saver preference by not autoplaying
 * at all (a tap still opens/plays the media).
 *
 * The currently-playing element carries a reflected `data-autoplaying="true"` attribute, both
 * so styling can hide the manual play affordance and so tests can assert the visibility logic
 * deterministically without depending on a real decode succeeding.
 */
import { ref, type Directive } from 'vue';

// Shared mute state for feed autoplay. Videos START muted (browsers block UNMUTED autoplay
// without a user gesture). The inline speaker toggle flips this for ALL feed videos at once —
// once you unmute (the tap is the gesture), every video that autoplays plays WITH sound until
// you mute again. Persisting "muted" is the social-feed norm (TikTok/Reels).
export const autoplayMuted = ref(true);

// Toggle/set the shared mute state and apply it to the video playing right now. Unmuting is a
// user gesture, so we (re)start the current clip to make sure it actually plays with audio.
export function setAutoplayMuted(muted: boolean): void {
  autoplayMuted.value = muted;
  if (current) {
    current.muted = muted;
    if (!muted) void current.play().catch(() => {});
  }
}

// Visible fraction at which a video starts playing / stops. The gap (hysteresis) keeps a
// video that's hovering around the boundary from flickering between play and pause.
const PLAY_AT = 0.6;
const STOP_AT = 0.25;

const registered = new Set<HTMLVideoElement>();
const ratios = new Map<HTMLVideoElement, number>();
let current: HTMLVideoElement | null = null;
let io: IntersectionObserver | null = null;

// Respect the platform/user signals that say "don't autoplay": reduced-motion and the
// Save-Data hint. When either is on we never autoplay (tap-to-play still works).
function lowData(): boolean {
  const rm =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  return !!rm || !!conn?.saveData;
}

function setActive(el: HTMLVideoElement | null): void {
  if (current && current !== el) {
    current.removeAttribute('data-autoplaying');
    try {
      current.pause();
    } catch {
      /* element may already be gone */
    }
  }
  current = el;
  if (el) {
    el.setAttribute('data-autoplaying', 'true');
    el.muted = autoplayMuted.value; // respect the shared feed mute state (starts muted)
    void el.play().catch(() => {
      /* autoplay blocked — leave the poster frame showing */
    });
  }
}

// Pick the most-visible registered video and make it the single active one; drop the
// current one once it's mostly off screen.
function reconcile(): void {
  if (lowData()) {
    setActive(null);
    return;
  }
  let best: HTMLVideoElement | null = null;
  let bestRatio = 0;
  for (const el of registered) {
    const r = ratios.get(el) ?? 0;
    if (r > bestRatio) {
      bestRatio = r;
      best = el;
    }
  }
  if (current && (ratios.get(current) ?? 0) < STOP_AT) setActive(null);
  if (best && bestRatio >= PLAY_AT && best !== current) setActive(best);
}

function observer(): IntersectionObserver {
  if (io) return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        ratios.set(e.target as HTMLVideoElement, e.isIntersecting ? e.intersectionRatio : 0);
      }
      reconcile();
    },
    { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] },
  );
  // Hiding the tab / backgrounding the app must silence any playing video.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setActive(null);
  });
  return io;
}

export const vAutoplayVisible: Directive<HTMLVideoElement> = {
  mounted(el) {
    el.muted = autoplayMuted.value;
    el.setAttribute('playsinline', '');
    if (!el.getAttribute('preload')) el.setAttribute('preload', 'metadata');
    registered.add(el);
    ratios.set(el, 0);
    observer().observe(el);
  },
  unmounted(el) {
    io?.unobserve(el);
    registered.delete(el);
    ratios.delete(el);
    if (current === el) current = null;
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    reconcile(); // a newly-uncovered video may now be the most visible
  },
};
