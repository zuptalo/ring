/**
 * Shared media-playback helpers used by every player (video, voice, audio card,
 * and the record-preview): a robust "play once it's actually ready" and the common
 * speed-cycle.
 */

/** Selectable playback speeds, cycled in order. */
export const PLAYBACK_RATES = [1, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/** Next rate in the 1× → 1.5× → 2× → 1× cycle. */
export function nextRate(r: number): PlaybackRate {
  const i = PLAYBACK_RATES.indexOf(r as PlaybackRate);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

/** Display label, e.g. "1×", "1.5×". */
export function rateLabel(r: number): string {
  return `${r}×`;
}

/**
 * Play a media element only once it has enough buffered to actually produce sound.
 *
 * Fixes the "first tap is silent" bug: a freshly-attached blob URL (preload metadata,
 * or a just-set src) can be at readyState 0/1, so calling play() immediately starts
 * the clock but emits no audio until the data decodes — which is why a second tap, or
 * letting it run to the end and replaying, worked. We wait for `canplay` (with a
 * safety timeout so we never hang) before play(), and swallow the autoplay/codec
 * rejection. Returns when playback has started (or been given up on).
 */
export async function playWhenReady(el: HTMLMediaElement): Promise<void> {
  try {
    if (el.readyState < 3 /* HAVE_FUTURE_DATA */) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          el.removeEventListener('canplay', done);
          resolve();
        };
        el.addEventListener('canplay', done, { once: true });
        setTimeout(done, 1500); // never block the tap forever
      });
    }
    await el.play();
  } catch {
    /* autoplay policy / unsupported codec — leave it paused, the UI reflects it */
  }
}
