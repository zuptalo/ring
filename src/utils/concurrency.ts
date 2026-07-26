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

/**
 * Resolve `promise`, but if it hasn't settled within `ms`, resolve `fallback` instead.
 * A rejection also resolves `fallback` — this is the BEST-EFFORT variant used for
 * optional work (e.g. a thumbnail decode) that must never hang or throw its way into
 * wedging the caller. The underlying promise is abandoned, not cancelled (there is no
 * portable cancel for `createImageBitmap`); it simply resolves to nothing observed.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (v: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(fallback), ms);
    promise.then(
      (v) => done(v),
      () => done(fallback),
    );
  });
}

/**
 * Race `promise` against a timeout that REJECTS. Unlike `withTimeout`, a timeout here is
 * an error the caller handles — used by the media-job watchdog so a hung encode/decode
 * becomes a (retryable) job failure instead of holding its lane forever. A normal
 * settle clears the timer so the rejection can't fire late.
 */
export function raceTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * A byte-budget semaphore. `createByteBudget(maxBytes)` returns `acquire(bytes, task)`,
 * which runs `task` only while the sum of in-flight `bytes` stays within `maxBytes`.
 *
 * Why: sealing media holds the plaintext AND ciphertext in the heap together, so several
 * large uploads at once is the out-of-memory (jetsam) risk on a phone. With the media
 * lanes able to run work concurrently, this caps the PEAK across all of them.
 *
 * Admission: a new item runs immediately if it fits alongside what's in flight
 * (`inUse + need <= maxBytes`); otherwise it queues, and the queue drains FIFO as budget
 * frees. So a small item is never made to wait behind a big upload it could fit beside
 * (the product goal — small media keeps flowing) — big items are the ones that wait. A
 * single item LARGER than the whole budget still runs when the budget is otherwise empty,
 * so it can never deadlock. Media bursts are finite, so a queued large item drains as the
 * in-flight uploads complete.
 */
export function createByteBudget(
  maxBytes: number,
): <T>(bytes: number, task: () => Promise<T>) => Promise<T> {
  let inUse = 0;
  const queue: Array<{ need: number; start: () => void }> = [];

  const drain = (): void => {
    // Admit only from the head (FIFO) so a large waiter can't be perpetually skipped by a
    // stream of small ones. `inUse === 0` is the escape hatch that lets a lone oversize
    // item run rather than wait forever for a budget it can never fit.
    while (queue.length > 0) {
      const head = queue[0];
      if (inUse !== 0 && inUse + head.need > maxBytes) break;
      queue.shift();
      inUse += head.need;
      head.start();
    }
  };

  return function acquire<T>(bytes: number, task: () => Promise<T>): Promise<T> {
    const need = Math.max(0, bytes);
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            inUse -= need;
            drain();
          });
      };
      if (inUse === 0 || inUse + need <= maxBytes) {
        inUse += need;
        start();
      } else {
        queue.push({ need, start });
      }
    });
  };
}
