/**
 * A tiny concurrency limiter. `createLimiter(max)` returns a function that wraps
 * async tasks so at most `max` run at once; the rest queue and start as slots free.
 *
 * Why this exists: video poster (thumbnail) generation spins up a decoding
 * `<video>` element per clip. Firing one per video in a media-heavy chat ran dozens
 * of decoders at once, saturating the device and freezing/crashing the app
 * (spec 2002). Routing generation through a shared limiter caps the peak so the UI
 * stays responsive.
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = (): void => {
    active--;
    if (queue.length > 0 && active < max) {
      const start = queue.shift() as () => void;
      start();
    }
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active++;
        // Promise.resolve().then(task) so a throwing (non-async) task still rejects
        // the returned promise instead of throwing synchronously here.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(release);
      };
      if (active < max) start();
      else queue.push(start);
    });
  };
}
