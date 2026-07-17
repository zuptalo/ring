import { describe, it, expect } from 'vitest';
import { KeyedMutex } from './keyed-mutex';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('KeyedMutex', () => {
  it('serializes sections sharing a key (no overlap)', async () => {
    const m = new KeyedMutex();
    let active = 0;
    let maxActive = 0;
    const section = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(5);
      active -= 1;
    };
    await Promise.all([m.run('k', section), m.run('k', section), m.run('k', section)]);
    expect(maxActive).toBe(1); // never two at once
  });

  it('preserves FIFO order for a key', async () => {
    const m = new KeyedMutex();
    const order: number[] = [];
    await Promise.all([
      m.run('k', async () => {
        await tick(15);
        order.push(1);
      }),
      m.run('k', async () => {
        await tick(1);
        order.push(2);
      }),
      m.run('k', async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]); // not [3,2,1] despite the delays
  });

  it('lets different keys run concurrently', async () => {
    const m = new KeyedMutex();
    let active = 0;
    let maxActive = 0;
    const section = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(5);
      active -= 1;
    };
    await Promise.all([m.run('a', section), m.run('b', section), m.run('c', section)]);
    expect(maxActive).toBeGreaterThan(1); // independent keys overlap
  });

  it('isolates errors: a throwing section does not break the queue', async () => {
    const m = new KeyedMutex();
    const ran: string[] = [];
    const p1 = m.run('k', async () => {
      ran.push('a');
      throw new Error('boom');
    });
    const p2 = m.run('k', async () => {
      ran.push('b');
      return 'ok';
    });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(ran).toEqual(['a', 'b']);
  });

  it('returns the section result to its own caller', async () => {
    const m = new KeyedMutex();
    await expect(m.run('k', async () => 42)).resolves.toBe(42);
  });

  it('drains the key map once a queue completes', async () => {
    const m = new KeyedMutex();
    await m.run('k', async () => {});
    await tick(0);
    expect(m.busy('k')).toBe(false);
  });
});
