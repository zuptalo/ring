import { describe, it, expect } from 'vitest';
import { uid } from './uid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uid', () => {
  it('produces an RFC-4122 v4-shaped id (version + variant bits set)', () => {
    expect(uid()).toMatch(V4);
  });

  it('is practically unique across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uid());
    expect(seen.size).toBe(1000);
  });
});
