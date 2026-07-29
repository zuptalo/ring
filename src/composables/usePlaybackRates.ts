/**
 * Per-message playback speed (spec 2059).
 *
 * Speed used to be one value for the whole app: every voice bubble read the same ref, so
 * speeding up one long message set the pill on every other voice message in every chat.
 * Video had the mirror-image bug — its rate lived in the player component, which the media
 * viewer destroys when you swipe away, so the speed you chose was quietly forgotten.
 *
 * Both are the same mistake about where the value belongs. A speed is a property of the thing
 * you set it on, so it hangs off that thing's id: a message id, a Wall post id, or a
 * `postId:index` for one slide of an album. Anything with a stable id can have one.
 *
 * Session-scoped on purpose. This is a "how I want to get through THIS message" choice, not a
 * durable property of the conversation, so it lives in memory and starts fresh on a new launch
 * rather than costing a database write per pill tap.
 */
import { reactive } from 'vue';
import { nextRate, type PlaybackRate } from '@/utils/playback';

/** How many messages keep a remembered speed before the least-recently-used one is dropped.
 *  Far above any realistic session's worth of deliberate changes; it exists so a long-lived
 *  tab cannot accumulate an entry for every message it ever played. */
export const RATE_CAP = 200;

const rates = reactive(new Map<string, PlaybackRate>());

// Recency is tracked SEPARATELY and non-reactively, and is deliberately NOT refreshed by
// reads. `rateFor` is called from render-time computeds (the pill in VoicePlayer, VideoPlayer);
// if reading refreshed recency by writing to `rates`, every render would mutate a structure
// that same computed had just tracked — write-during-render warnings and a computed that
// invalidates itself. Recency therefore follows the two things a person actually does: change
// a speed, or play the thing.
const usedAt = new Map<string, number>();
let tick = 0;

function markUsed(id: string): void {
  usedAt.set(id, ++tick);
}

/** Forget the least-recently-used entries until we are back within the cap. */
function evict(): void {
  if (rates.size <= RATE_CAP) return;
  const byAge = [...rates.keys()].sort((a, b) => (usedAt.get(a) ?? 0) - (usedAt.get(b) ?? 0));
  for (const id of byAge) {
    if (rates.size <= RATE_CAP) break;
    rates.delete(id);
    usedAt.delete(id);
  }
}

/** This thing's speed. Normal speed for anything nobody has changed — which is almost
 *  everything, so nothing needs seeding. Safe to call from a render/computed. */
export function rateFor(id: string): PlaybackRate {
  return rates.get(id) ?? 1;
}

/** Advance this thing to the next speed and return it. Counts as use. */
export function cycleRateFor(id: string): PlaybackRate {
  const next = nextRate(rateFor(id));
  if (next === 1) {
    // Back to normal — drop the entry instead of storing the default, so a message the user
    // cycled back to 1× doesn't occupy a slot that a message with a real preference could use.
    rates.delete(id);
    usedAt.delete(id);
    return 1;
  }
  rates.set(id, next);
  markUsed(id);
  evict();
  return next;
}

/** Note that this thing is actually being played, so it survives eviction ahead of things
 *  that were merely on screen. Called by the playback paths, never by a render. */
export function touchRate(id: string): void {
  if (rates.has(id)) markUsed(id);
}

/** Test-only: drop everything, so one test's rates can't leak into the next. */
export function __resetPlaybackRates(): void {
  rates.clear();
  usedAt.clear();
  tick = 0;
}
