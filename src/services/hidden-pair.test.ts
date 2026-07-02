// Unit tests for the per-person hidden/visible invariant core (spec 1027, R8).
// Pure module — no idb, no mocks needed. Encodes INV-1 (at most one hidden chat
// per person), INV-2 (at most one visible), and rule R stage 1 (pre-decrypt
// session resolution), including the legacy INV-3-violating state (a hidden AND
// a visible plain 1:1 with the same peer, residue of bug B1) which is tolerated
// read-only.
import { describe, it, expect } from 'vitest';
import type { Chat } from '@/db/types';
import {
  chatsWithPeer,
  canHide,
  canUnhide,
  planStartDirectChat,
  resolveInboundDirectChat,
} from './hidden-pair';

let seq = 0;
function chat(over: Partial<Chat>): Chat {
  seq += 1;
  return {
    id: over.id ?? `c${seq}`,
    name: 'x',
    avatar: '',
    isGroup: false,
    participantIds: [],
    lastMessage: '',
    lastMessageTime: 0,
    unread: 0,
    updatedAt: 0,
    ...over,
  };
}

const P = 'peer-1';
const oneToOne = (id: string, extra: Partial<Chat> = {}) =>
  chat({ id, isGroup: false, participantIds: [P], ...extra });
const pairConv = (id: string) => chat({ id, isGroup: true, participantIds: [P] });
const bigGroup = (id: string) => chat({ id, isGroup: true, participantIds: [P, 'peer-2'] });
const hidden = (...ids: string[]) => new Set(ids);

describe('chatsWithPeer', () => {
  it('counts plain 1:1s and pair conversations, never multi-member groups', () => {
    const chats = [oneToOne('a'), pairConv('b'), bigGroup('g'), chat({ id: 'other', participantIds: ['peer-2'] })];
    expect(chatsWithPeer(chats, P).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('is empty for an unknown peer', () => {
    expect(chatsWithPeer([oneToOne('a')], 'nobody')).toEqual([]);
  });
});

describe('canHide (INV-1: at most one hidden chat per person)', () => {
  it('allows hiding the only chat with a person', () => {
    expect(canHide([oneToOne('a')], hidden(), 'a')).toEqual({ ok: true });
  });

  it('blocks hiding when another chat with the same person is already hidden', () => {
    const r = canHide([oneToOne('a'), pairConv('b')], hidden('a'), 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already have a hidden chat/i);
  });

  it('blocks the legacy state too: hiding the visible plain 1:1 next to a hidden one', () => {
    // Pre-1027 bug B1 could leave a hidden AND a visible plain 1:1 for one peer.
    const r = canHide([oneToOne('a'), oneToOne('b')], hidden('a'), 'b');
    expect(r.ok).toBe(false);
  });

  it('is idempotent for an already-hidden chat (its own id does not block it)', () => {
    expect(canHide([oneToOne('a')], hidden('a'), 'a')).toEqual({ ok: true });
  });

  it('always allows hiding a multi-member group, even with a hidden 1:1 sharing a member', () => {
    expect(canHide([oneToOne('a'), bigGroup('g')], hidden('a'), 'g')).toEqual({ ok: true });
  });

  it('allows hiding for an unknown chat id (nothing to compare against)', () => {
    expect(canHide([], hidden(), 'ghost')).toEqual({ ok: true });
  });
});

describe('canUnhide (INV-2: at most one visible chat per person)', () => {
  it('allows unhiding when nothing visible exists for that person', () => {
    expect(canUnhide([oneToOne('a')], hidden('a'), 'a')).toEqual({ ok: true });
  });

  it('blocks unhiding while a visible chat with the same person exists', () => {
    const r = canUnhide([oneToOne('a'), pairConv('b')], hidden('a'), 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already have a chat/i);
  });

  it('blocks the legacy state: unhiding next to a visible plain 1:1', () => {
    expect(canUnhide([oneToOne('a'), oneToOne('b')], hidden('a'), 'a').ok).toBe(false);
  });

  it('a pending placeholder still blocks (it becomes visible on accept)', () => {
    const r = canUnhide([oneToOne('a'), oneToOne('b', { pending: true })], hidden('a'), 'a');
    expect(r.ok).toBe(false);
  });

  it('another HIDDEN chat with the same person does not block unhiding', () => {
    // Only visible chats enforce INV-2 (a second hidden one is an INV-1 legacy
    // state; unhiding one of them is the way OUT of it).
    expect(canUnhide([oneToOne('a'), pairConv('b')], hidden('a', 'b'), 'a')).toEqual({ ok: true });
  });

  it('always allows unhiding a multi-member group', () => {
    expect(canUnhide([bigGroup('g'), oneToOne('a')], hidden('g'), 'g')).toEqual({ ok: true });
  });
});

describe('planStartDirectChat (user-initiated "start a conversation")', () => {
  it('opens the existing visible plain 1:1', () => {
    const chats = [oneToOne('v')];
    expect(planStartDirectChat(chats, hidden(), P)).toEqual({ action: 'open', chatId: 'v' });
  });

  it('opens the existing visible pair conversation (the coexistence steady state)', () => {
    const chats = [oneToOne('h'), pairConv('p')];
    expect(planStartDirectChat(chats, hidden('h'), P)).toEqual({ action: 'open', chatId: 'p' });
  });

  it('creates a pair conversation when the only chat is a hidden plain 1:1 (FR-004)', () => {
    const chats = [oneToOne('h')];
    expect(planStartDirectChat(chats, hidden('h'), P)).toEqual({ action: 'createPair' });
  });

  it('creates a plain 1:1 when the hidden thread is a pair conversation and no 1:1 exists', () => {
    const chats = [pairConv('hp')];
    expect(planStartDirectChat(chats, hidden('hp'), P)).toEqual({ action: 'createOneToOne' });
  });

  it('creates a plain 1:1 for a brand-new peer', () => {
    expect(planStartDirectChat([], hidden(), P)).toEqual({ action: 'createOneToOne' });
  });

  it('never resolves to a hidden chat (the #544 loophole stays closed)', () => {
    const chats = [oneToOne('h'), pairConv('hp')];
    const plan = planStartDirectChat(chats, hidden('h', 'hp'), P);
    // Both threads hidden (legacy INV-1 breach): nothing visible may open.
    expect(plan.action).not.toBe('open');
  });

  it('prefers the non-pending plain 1:1, then the pair conversation, then a pending placeholder', () => {
    const chats = [oneToOne('pend', { pending: true }), pairConv('p'), oneToOne('v')];
    expect(planStartDirectChat(chats, hidden(), P)).toEqual({ action: 'open', chatId: 'v' });
    expect(planStartDirectChat([oneToOne('pend', { pending: true }), pairConv('p')], hidden(), P))
      .toEqual({ action: 'open', chatId: 'p' });
    expect(planStartDirectChat([oneToOne('pend', { pending: true })], hidden(), P))
      .toEqual({ action: 'open', chatId: 'pend' });
  });
});

describe('resolveInboundDirectChat (rule R stage 1, pre-decrypt)', () => {
  it('prefers the visible plain 1:1', () => {
    const chats = [oneToOne('v'), pairConv('p')];
    expect(resolveInboundDirectChat(chats, hidden(), P)?.id).toBe('v');
  });

  it('falls back to the hidden plain 1:1 when no visible one exists', () => {
    const chats = [oneToOne('h'), pairConv('p')];
    expect(resolveInboundDirectChat(chats, hidden('h'), P)?.id).toBe('h');
  });

  it('never returns a pair conversation (those route by groupId post-decrypt)', () => {
    expect(resolveInboundDirectChat([pairConv('p')], hidden(), P)).toBeNull();
  });

  it('returns null when nothing matches (caller consults the peer block / creates)', () => {
    expect(resolveInboundDirectChat([bigGroup('g')], hidden(), P)).toBeNull();
  });

  it('legacy state routes to the VISIBLE plain 1:1 (where the live session is)', () => {
    const chats = [oneToOne('h'), oneToOne('v')];
    expect(resolveInboundDirectChat(chats, hidden('h'), P)?.id).toBe('v');
  });

  it('prefers a non-pending visible 1:1 over a pending placeholder', () => {
    const chats = [oneToOne('pend', { pending: true }), oneToOne('real')];
    expect(resolveInboundDirectChat(chats, hidden(), P)?.id).toBe('real');
  });

  it('uses the pending placeholder when it is the only visible 1:1', () => {
    const chats = [oneToOne('pend', { pending: true }), oneToOne('h')];
    expect(resolveInboundDirectChat(chats, hidden('h'), P)?.id).toBe('pend');
  });
});
