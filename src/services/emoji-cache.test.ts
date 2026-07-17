import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadEmojiLottie, clearEmojiCache, emojiCacheSize } from './emoji-cache';

describe('emoji lottie cache (spec 1017)', () => {
  beforeEach(() => {
    clearEmojiCache();
    vi.restoreAllMocks();
  });
  afterEach(() => clearEmojiCache());

  it('fetches once, then serves repeat views from cache (no second request)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ v: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const a = await loadEmojiLottie('1f600');
    const b = await loadEmojiLottie('1f600');
    expect(a).toEqual({ v: 1 });
    expect(b).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // SC-001: cached, no refetch
  });

  it('de-dupes concurrent loads of the same emoji into one request', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((res) => (resolve = res)));
    vi.stubGlobal('fetch', fetchMock);

    const p1 = loadEmojiLottie('1f9e1');
    const p2 = loadEmojiLottie('1f9e1');
    resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('negative-caches a 404 (no animation) so it is not refetched', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadEmojiLottie('2705')).toBeNull();
    expect(await loadEmojiLottie('2705')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // known-missing cached
  });

  it('does NOT cache a transient network error — a later view retries', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadEmojiLottie('1f680')).toBeNull(); // failed, not cached
    expect(await loadEmojiLottie('1f680')).toEqual({ v: 2 }); // retried successfully
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds the cache so it cannot grow without limit (SC-003)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ v: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 400; i++) await loadEmojiLottie(`cp_${i}`);
    expect(emojiCacheSize()).toBeLessThanOrEqual(256);
  });
});
