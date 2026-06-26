// Spec 1019 (US5/FR-019): hidden-chat call exclusion keys. A hidden 1:1 must drop
// calls keyed on the PEER id; a hidden group must drop calls keyed on the GROUP id.
import { describe, it, expect } from 'vitest';
import { hiddenCallKeys } from './hidden-calls';
import type { Chat } from './types';

const chat = (over: Partial<Chat>): Chat => ({
  id: 'x', name: '', avatar: '', isGroup: false, participantIds: [],
  lastMessage: '', lastMessageTime: 0, unread: 0, updatedAt: 0, ...over,
}) as Chat;

describe('hiddenCallKeys', () => {
  it('keys a hidden 1:1 on the peer id (and the chat id)', () => {
    const chats = [chat({ id: 'c1', isGroup: false, participantIds: ['peerA'] })];
    const keys = hiddenCallKeys(chats, new Set(['c1']));
    expect(keys.has('peerA')).toBe(true); // 1:1 calls store contactId = peer id
    expect(keys.has('c1')).toBe(true);
  });

  it('keys a hidden group on the group/chat id', () => {
    const chats = [chat({ id: 'g1', isGroup: true, participantIds: ['m1', 'm2'] })];
    const keys = hiddenCallKeys(chats, new Set(['g1']));
    expect(keys.has('g1')).toBe(true); // group calls store contactId = room/group id
    expect(keys.has('m1')).toBe(false); // members are not call keys
  });

  it('ignores non-hidden chats entirely', () => {
    const chats = [
      chat({ id: 'c1', participantIds: ['peerA'] }),
      chat({ id: 'c2', participantIds: ['peerB'] }),
    ];
    const keys = hiddenCallKeys(chats, new Set(['c2']));
    expect(keys.has('peerB')).toBe(true);
    expect(keys.has('peerA')).toBe(false);
    expect([...keys].sort()).toEqual(['c2', 'peerB']);
  });
});
