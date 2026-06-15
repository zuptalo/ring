// A tiny per-key async mutex: serialize critical sections that share a key, while
// letting different keys run concurrently.
//
// Why: message-row updates are read-modify-write (read the row, change a few
// fields, write it back). When two of those run concurrently for the SAME message
// — e.g. a `downloaded` cleanup receipt and a status transition — the later write
// can clobber the earlier one from a stale snapshot, which is what destabilized
// status reporting. Running each message id's mutations through `run(id, fn)`
// forces them to take turns, so every section observes the latest persisted row.

export class KeyedMutex {
  // The tail promise per key. Each tail is rejection-proof so one failed section
  // never poisons the queue for that key.
  private tails = new Map<string, Promise<void>>();

  /** Run `fn` after any in-flight section for `key` settles. Returns fn's result
   *  (or rejection) to THIS caller; a rejection does not break the chain for the
   *  next caller. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Run fn whether prev fulfilled or rejected — sections are independent.
    const result = prev.then(fn, fn);
    // The stored tail swallows fn's outcome so the next section always proceeds.
    const tail = result.then(
      () => {},
      () => {},
    );
    this.tails.set(key, tail);
    // Drop the key once its queue drains, so the map doesn't grow unbounded.
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Whether a section is currently queued/running for `key` (test/introspection). */
  busy(key: string): boolean {
    return this.tails.has(key);
  }
}
