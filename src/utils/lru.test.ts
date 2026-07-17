import { describe, it, expect } from 'vitest';
import { selectEvictions } from './lru';

describe('selectEvictions (bounded media cache policy)', () => {
  const keep = (...ids: string[]) => new Set(ids);

  it('evicts nothing while at or under the cap', () => {
    expect(selectEvictions(['a', 'b', 'c'], keep(), 3)).toEqual([]);
    expect(selectEvictions(['a', 'b'], keep(), 5)).toEqual([]);
  });

  it('evicts the oldest (least-recently-used) keys to get back to the cap', () => {
    // order is LRU-first; two over the cap of 3 → drop the two oldest.
    expect(selectEvictions(['a', 'b', 'c', 'd', 'e'], keep(), 3)).toEqual(['a', 'b']);
  });

  it('never evicts a protected (on-screen / pinned) key', () => {
    // 'a' and 'b' are the oldest but protected → evict the next oldest unprotected.
    expect(selectEvictions(['a', 'b', 'c', 'd', 'e'], keep('a', 'b'), 3)).toEqual(['c', 'd']);
  });

  it('leaves the cache above the cap rather than evict protected keys', () => {
    // Everything over the cap is protected → nothing evictable; cap is exceeded.
    expect(selectEvictions(['a', 'b', 'c', 'd'], keep('a', 'b', 'c', 'd'), 2)).toEqual([]);
  });
});
