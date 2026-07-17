import { describe, it, expect } from 'vitest';
import { userColor, userColorBright } from './user-color';

describe('user-color', () => {
  it('is stable for the same id (hash fallback, no member list)', () => {
    expect(userColor('alice')).toBe(userColor('alice'));
    expect(userColorBright('alice')).toBe(userColorBright('alice'));
  });

  it('returns a hex color', () => {
    expect(userColor('alice')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(userColorBright('bob')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('assigns members from opposite halves of the wheel for adjacency', () => {
    const members = ['a', 'b', 'c', 'd'];
    // member 0 → palette index 0, member 1 → index HALF (7): distinct + far apart.
    expect(userColor('a', members)).not.toBe(userColor('b', members));
    expect(userColor('a', members)).toBe('#e0564f'); // first palette entry
  });

  it('falls back to the stable hash for an id not in the member list', () => {
    const members = ['a', 'b'];
    expect(userColor('z', members)).toBe(userColor('z'));
  });

  it('cycles the palette for very large groups without throwing', () => {
    const members = Array.from({ length: 40 }, (_, i) => `m${i}`);
    for (const m of members) expect(userColor(m, members)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
