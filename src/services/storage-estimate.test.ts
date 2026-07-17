// Spec 1024 (US3): the on-device storage headroom check that guards staging a post's cached
// blobs. Pure aside from navigator.storage.estimate — which we stub per-case.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { hasRoomFor } from './storage-estimate';

const MB = 1024 * 1024;

/** Install a fake navigator.storage.estimate. */
function stubEstimate(impl: (() => Promise<StorageEstimate>) | null): void {
  vi.stubGlobal('navigator', impl === null ? {} : { storage: { estimate: impl } });
}

afterEach(() => vi.unstubAllGlobals());

describe('hasRoomFor', () => {
  it('allows a zero/negative payload without even checking', async () => {
    stubEstimate(() => Promise.reject(new Error('should not be called')));
    expect(await hasRoomFor(0)).toBe(true);
    expect(await hasRoomFor(-5)).toBe(true);
  });

  it('blocks when free space is below the 2.5× headroom', async () => {
    // 100 MB payload needs 250 MB; only 200 MB free.
    stubEstimate(() => Promise.resolve({ quota: 1000 * MB, usage: 800 * MB }));
    expect(await hasRoomFor(100 * MB)).toBe(false);
  });

  it('allows when free space clears the 2.5× headroom', async () => {
    // 100 MB payload needs 250 MB; 400 MB free.
    stubEstimate(() => Promise.resolve({ quota: 1000 * MB, usage: 600 * MB }));
    expect(await hasRoomFor(100 * MB)).toBe(true);
  });

  it('never blocks a tiny post below the 50 MB floor even on a tight estimate', async () => {
    // 1 MB payload: 2.5× is only 2.5 MB, but the floor demands 50 MB free — and we have 60 MB.
    stubEstimate(() => Promise.resolve({ quota: 1000 * MB, usage: 940 * MB }));
    expect(await hasRoomFor(1 * MB)).toBe(true);
  });

  it('blocks a tiny post when free space is under the 50 MB floor', async () => {
    stubEstimate(() => Promise.resolve({ quota: 1000 * MB, usage: 970 * MB })); // 30 MB free
    expect(await hasRoomFor(1 * MB)).toBe(false);
  });

  it('does not block when the API is unavailable (returns true)', async () => {
    stubEstimate(null); // navigator without .storage
    expect(await hasRoomFor(500 * MB)).toBe(true);
  });

  it('does not block when estimate() throws', async () => {
    stubEstimate(() => Promise.reject(new Error('nope')));
    expect(await hasRoomFor(500 * MB)).toBe(true);
  });

  it('does not block when quota is missing/zero (unknown)', async () => {
    stubEstimate(() => Promise.resolve({ quota: 0, usage: 0 }));
    expect(await hasRoomFor(500 * MB)).toBe(true);
  });
});
