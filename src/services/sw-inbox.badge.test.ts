// Unit tests for the SW badge total (spec 1027 T022/T028, fixes bug B4's SW
// half): `unreadCount()` used to sum ALL chats unconditionally, so a push for a
// hidden chat bumped the badge even when the user chose badge = 'never' —
// leaking hidden activity against an explicit preference. The SW never knows
// the page's reveal session (memory-only), so 'revealed' behaves as 'never'
// here, and a locked (unreadable) hidden set falls back to `badge.lastCount`
// instead of guessing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  chats: [] as Array<{ id: string; unread: number }>,
  hidden: null as Set<string> | null, // what readHiddenSetOrNull yields
}));

vi.mock('@/db/idb', () => ({
  get: async (_s: string, key: string) =>
    h.settings.has(key) ? { key, value: h.settings.get(key) } : undefined,
  getAll: async (s: string) => (s === 'chats' ? h.chats : []),
  getByIndex: async () => [],
  put: async (_s: string, row: { key: string; value: unknown }) => {
    h.settings.set(row.key, row.value);
  },
  remove: async () => {},
  touch: () => {},
}));

vi.mock('@/services/hidden-chats', () => ({
  readHiddenSet: async () => h.hidden ?? new Set<string>(),
  readHiddenSetOrNull: async () => h.hidden,
}));

import { unreadCount } from './sw-inbox';

beforeEach(() => {
  h.settings.clear();
  h.chats = [
    { id: 'v1', unread: 2 },
    { id: 'h1', unread: 5 },
  ];
  h.hidden = new Set(['h1']);
});

describe('SW unreadCount honors privacy.hiddenChatsBadge', () => {
  it("default ('always') counts everything — unchanged behavior", async () => {
    expect(await unreadCount()).toBe(7);
  });

  it("'never' excludes hidden chats", async () => {
    h.settings.set('privacy.hiddenChatsBadge', 'never');
    expect(await unreadCount()).toBe(2);
  });

  it("'revealed' behaves as 'never' in the SW (reveal is page-memory-only)", async () => {
    h.settings.set('privacy.hiddenChatsBadge', 'revealed');
    expect(await unreadCount()).toBe(2);
  });

  it('a locked hidden set falls back to badge.lastCount — no guess, no collateral zero', async () => {
    h.settings.set('privacy.hiddenChatsBadge', 'never');
    h.settings.set('badge.lastCount', 2);
    h.hidden = null; // keystore locked → set unreadable
    expect(await unreadCount()).toBe(2);
  });

  it('a locked hidden set with no cached count yields 0 (fail closed)', async () => {
    h.settings.set('privacy.hiddenChatsBadge', 'never');
    h.hidden = null;
    expect(await unreadCount()).toBe(0);
  });
});
