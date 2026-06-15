import { describe, it, expect } from 'vitest';
import { createLimiter } from './concurrency';

/** A deferred we can resolve from the test to control task completion timing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createLimiter', () => {
  it('never runs more than `max` tasks concurrently (the poster-storm regression)', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 8 }, () => deferred<void>());

    const runs = gates.map((g, i) =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise; // hold the task "running" until we release it
        active--;
        return i;
      }),
    );

    // Let the limiter schedule the first batch.
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBeLessThanOrEqual(2);

    // Release tasks one at a time; peak must never exceed the cap.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(active).toBeLessThanOrEqual(2);
    }

    const results = await Promise.all(runs);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(2); // with 8 tasks and cap 2, the cap is actually reached
  });

  it('runs immediately when under the cap', async () => {
    const limit = createLimiter(3);
    const out = await Promise.all([limit(async () => 'a'), limit(async () => 'b')]);
    expect(out).toEqual(['a', 'b']);
  });

  it('a rejecting task frees its slot for the next queued task', async () => {
    const limit = createLimiter(1);
    const order: string[] = [];
    const a = limit(async () => {
      order.push('a');
      throw new Error('boom');
    }).catch(() => order.push('a-failed'));
    const b = limit(async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'a-failed', 'b']);
  });
});
