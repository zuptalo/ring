// Unit test for startHiddenChat (spec 1019, US2): a hidden chat is a distinct
// group conversation, added to the hidden set, leaving any existing 1:1 untouched.
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ groups: [] as Array<{ name: string; members: string[] }>, hidden: [] as string[] }));

vi.mock('@/db/queries', () => ({
  createGroup: async (name: string, members: string[]) => {
    h.groups.push({ name, members });
    return `grp-${members.join('-')}-${h.groups.length}`;
  },
}));
vi.mock('@/services/hidden-chats', () => ({
  addHidden: async (id: string) => {
    h.hidden.push(id);
  },
}));

import { startHiddenChat } from './hidden-chats-start';

describe('startHiddenChat', () => {
  it('creates a distinct 2-person group and adds it to the hidden set (FR-017)', async () => {
    const id = await startHiddenChat('contact-1');
    expect(h.groups).toEqual([{ name: '', members: ['contact-1'] }]);
    expect(h.hidden).toContain(id);
  });
});
