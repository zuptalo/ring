// Spec 1032 (T003) — the cross-context named locks that make the SW a safe second
// writer of ratchet state. These tests drive withInboundLock / withSessionLock
// against a FAKE navigator.locks (a faithful little exclusive-lock manager with
// AbortSignal support), asserting: mutual exclusion, FIFO ordering, the SW-side
// timeout raising a typed LockTimeoutError without running the section, and the
// missing-API fallback still serializing within the context.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  withInboundLock,
  withSessionLock,
  locksAvailable,
  LockTimeoutError,
  INBOUND_LOCK,
  sessionLockName,
} from './cross-lock';

/* ---- a minimal exclusive LockManager fake (grant order = request order) ---- */

type Waiter = { name: string; grant: () => void; signal?: AbortSignal };

class FakeLocks {
  held = new Set<string>();
  queue: Waiter[] = [];
  granted: string[] = []; // grant log, for ordering asserts

  request<T>(
    name: string,
    opts: { mode: 'exclusive'; signal?: AbortSignal },
    cb: () => T | Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tryRun = () => {
        this.held.add(name);
        this.granted.push(name);
        Promise.resolve()
          .then(cb)
          .then(resolve, reject)
          .finally(() => {
            this.held.delete(name);
            this.pump();
          });
      };
      const w: Waiter = { name, grant: tryRun, signal: opts.signal };
      if (opts.signal) {
        if (opts.signal.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        opts.signal.addEventListener('abort', () => {
          const i = this.queue.indexOf(w);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(new DOMException('aborted', 'AbortError'));
          }
        });
      }
      this.queue.push(w);
      this.pump();
    });
  }

  private pump(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const w = this.queue[i];
      if (!this.held.has(w.name)) {
        this.queue.splice(i, 1);
        w.grant();
        return; // one grant per pump; the section's finally pumps again
      }
    }
  }
}

// Node's globalThis.navigator is getter-only, so swap it via vitest's stubGlobal.
let fake: FakeLocks;
const noLocks = () => vi.stubGlobal('navigator', undefined);

beforeEach(() => {
  fake = new FakeLocks();
  vi.stubGlobal('navigator', { locks: fake });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('cross-lock: mutual exclusion + ordering', () => {
  it('locksAvailable reflects the presence of navigator.locks', () => {
    expect(locksAvailable()).toBe(true);
    noLocks();
    expect(locksAvailable()).toBe(false);
  });

  it('two sections on the same session lock never interleave, and run FIFO', async () => {
    const events: string[] = [];
    const a = withSessionLock('chat-1', async () => {
      events.push('a-start');
      await sleep(20);
      events.push('a-end');
    });
    const b = withSessionLock('chat-1', async () => {
      events.push('b-start');
      await sleep(5);
      events.push('b-end');
    });
    await Promise.all([a, b]);
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('different chats run concurrently (per-chat locks, not one global)', async () => {
    const events: string[] = [];
    const a = withSessionLock('chat-1', async () => {
      events.push('a-start');
      await sleep(20);
      events.push('a-end');
    });
    const b = withSessionLock('chat-2', async () => {
      events.push('b-start');
      await sleep(5);
      events.push('b-end');
    });
    await Promise.all([a, b]);
    expect(events.slice(0, 2)).toEqual(['a-start', 'b-start']); // b didn't wait for a
  });

  it('inbound → session nesting acquires in the documented outer→inner order', async () => {
    await withInboundLock(async () => {
      await withSessionLock('chat-1', async () => {});
    });
    expect(fake.granted).toEqual([INBOUND_LOCK, sessionLockName('chat-1')]);
  });

  it('a rejecting section releases the lock for the next waiter', async () => {
    const failing = withSessionLock('chat-1', async () => {
      throw new Error('boom');
    });
    const after = withSessionLock('chat-1', async () => 'ran');
    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ran');
  });
});

describe('cross-lock: SW-side timeout (degrade-to-preview trigger)', () => {
  it('raises LockTimeoutError when the lock is held past timeoutMs, without running fn', async () => {
    let release!: () => void;
    const holder = withSessionLock('chat-1', () => new Promise<void>((r) => (release = r)));
    await sleep(1); // let the holder acquire
    let ran = false;
    // Bypass the in-context mutex by contending from "another context": call the
    // fake directly for the holder? No — contend via a DIFFERENT helper instance
    // isn't possible (module-level mutex), so simulate the cross-context case by
    // having the FAKE hold the name out from under the helper.
    fake.held.add(sessionLockName('chat-2'));
    const waiter = withSessionLock(
      'chat-2',
      async () => {
        ran = true;
      },
      { timeoutMs: 20 },
    );
    await expect(waiter).rejects.toBeInstanceOf(LockTimeoutError);
    expect(ran).toBe(false);
    fake.held.delete(sessionLockName('chat-2'));
    release();
    await holder;
  });

  it('a granted lock ignores the timeout (the signal only guards acquisition)', async () => {
    const out = await withSessionLock(
      'chat-1',
      async () => {
        await sleep(30); // longer than the timeout — must NOT abort a running section
        return 'done';
      },
      { timeoutMs: 10 },
    );
    expect(out).toBe('done');
  });

  it('F2: the timeout covers the in-context QUEUE wait, not just the Web Lock request', async () => {
    // A same-context caller parked on the cross-context lock holds the KeyedMutex
    // slot; a later timed caller must still degrade at its deadline instead of
    // waiting in the queue forever.
    fake.held.add(sessionLockName('chat-9')); // "another context" holds the Web Lock
    const parked = withSessionLock('chat-9', async () => 'never'); // untimed → waits, occupies the slot
    await sleep(1);
    let ran = false;
    const timed = withSessionLock(
      'chat-9',
      async () => {
        ran = true;
      },
      { timeoutMs: 25 },
    );
    await expect(timed).rejects.toBeInstanceOf(LockTimeoutError);
    expect(ran).toBe(false);
    fake.held.delete(sessionLockName('chat-9'));
    fake['pump']();
    await parked; // the parked holder completes once the lock frees
  });

  it("F6: a section error after the deadline fired is the section's error, never LockTimeoutError", async () => {
    await expect(
      withSessionLock(
        'chat-1',
        async () => {
          await sleep(30); // deadline (10ms) fires mid-section
          throw new Error('quota exceeded');
        },
        { timeoutMs: 10 },
      ),
    ).rejects.toThrow('quota exceeded');
  });
});

describe('cross-lock: missing-API fallback (in-context serialization only)', () => {
  it('still serializes same-name sections through the KeyedMutex', async () => {
    noLocks(); // no Web Locks anywhere
    const events: string[] = [];
    const a = withInboundLock(async () => {
      events.push('a-start');
      await sleep(15);
      events.push('a-end');
    });
    const b = withInboundLock(async () => {
      events.push('b-start');
      events.push('b-end');
    });
    await Promise.all([a, b]);
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
