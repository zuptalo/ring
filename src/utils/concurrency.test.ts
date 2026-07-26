import { describe, it, expect } from 'vitest';
import { createLimiter, withTimeout, raceTimeout, createByteBudget } from './concurrency';

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

describe('withTimeout', () => {
  it('resolves the promise value when it settles in time', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 1000, 'fallback')).toBe('ok');
  });

  it('resolves the fallback when the promise never settles (the createImageBitmap hang)', async () => {
    const never = new Promise<string>(() => {}); // never settles
    expect(await withTimeout(never, 5, 'fallback')).toBe('fallback');
  });

  it('resolves the fallback on rejection (best-effort, never throws)', async () => {
    expect(await withTimeout(Promise.reject(new Error('boom')), 1000, 'fallback')).toBe('fallback');
  });
});

describe('raceTimeout', () => {
  it('resolves the promise value when it settles in time', async () => {
    expect(await raceTimeout(Promise.resolve(42), 1000, 'too slow')).toBe(42);
  });

  it('rejects with the message when the promise hangs past the deadline', async () => {
    const never = new Promise<number>(() => {});
    await expect(raceTimeout(never, 5, 'media-job stalled')).rejects.toThrow('media-job stalled');
  });

  it('propagates the underlying rejection when it loses the race', async () => {
    await expect(raceTimeout(Promise.reject(new Error('real error')), 1000, 'timeout')).rejects.toThrow(
      'real error',
    );
  });
});

describe('createByteBudget', () => {
  it('runs items concurrently while their total stays within the budget', async () => {
    const acquire = createByteBudget(100);
    let active = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    // 3 items of 40 bytes each: two fit (80 <= 100), the third must wait.
    const runs = gates.map((g) =>
      acquire(40, async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise;
        active--;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2); // 40+40 admitted, third queued (120 > 100)
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(2);
    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
  });

  it('serializes items that individually exceed the budget without deadlocking', async () => {
    const acquire = createByteBudget(100);
    const order: string[] = [];
    // Each needs 200 (> 100). The empty-budget escape hatch lets each run alone, in FIFO order.
    const a = acquire(200, async () => {
      order.push('a');
    });
    const b = acquire(200, async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('lets a small item run alongside a big one when it fits (small media not blocked by big)', async () => {
    const acquire = createByteBudget(100);
    const order: string[] = [];
    const big = deferred<void>();
    // 'big' (90) admits first and holds the budget.
    const p1 = acquire(90, async () => {
      order.push('big');
      await big.promise;
    });
    await Promise.resolve();
    // 'wide' (80) can't fit beside big (90+80 > 100) → queues until big frees.
    const p2 = acquire(80, async () => {
      order.push('wide');
    });
    // 'small' (5) fits beside big (95 <= 100) → runs immediately, not blocked behind the big upload.
    const p3 = acquire(5, async () => {
      order.push('small');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['big', 'small']); // small got through; wide still waiting on budget
    big.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['big', 'small', 'wide']);
  });
});
