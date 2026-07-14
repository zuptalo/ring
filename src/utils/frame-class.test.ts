// Spec 1050: per-recipient frame classification — the client half of
// contracts/push-routing.md. Pure tables; the send sites in queries.ts thread
// the results onto outgoing frames.
import { describe, it, expect } from 'vitest';
import {
  classifyGroupMessage,
  classifyReactionRecipient,
  mintPrid,
  adoptPrid,
} from './frame-class';

const SELF = 'me-1';

describe('spec 1050 — classifyGroupMessage (mention class per recipient)', () => {
  const base = { body: 'hi', kind: 'text', timestamp: 1 };

  it('a plain group message is message-class for every member', () => {
    expect(classifyGroupMessage('u1', base as never)).toBe('message');
  });

  it('an @mentioned member gets mention class; others stay message', () => {
    const p = { ...base, mentions: ['u2'] } as never;
    expect(classifyGroupMessage('u2', p)).toBe('mention');
    expect(classifyGroupMessage('u3', p)).toBe('message');
  });

  it('a reply classifies its quoted author as mention', () => {
    const p = { ...base, reply: { id: 'm1', senderId: 'u4', preview: 'x' } } as never;
    expect(classifyGroupMessage('u4', p)).toBe('mention');
    expect(classifyGroupMessage('u5', p)).toBe('message');
  });

  it('@everyone marks every member mention (owner validation stays on receive, spec 1020)', () => {
    const p = { ...base, mentionsEveryone: true } as never;
    expect(classifyGroupMessage('u6', p)).toBe('mention');
  });
});

describe('spec 1050 — classifyReactionRecipient (author + co-reactors loud)', () => {
  const target = {
    id: 'm1',
    senderId: 'author-1',
    reactions: [
      { userId: 'co-1', emoji: '❤️', at: 1 },
      { userId: SELF, emoji: '👍', at: 2 },
    ],
  } as never;

  it('the author gets reaction class on an add', () => {
    expect(classifyReactionRecipient('author-1', target, false, SELF)).toBe('reaction');
  });

  it('a prior co-reactor gets reaction class on an add', () => {
    expect(classifyReactionRecipient('co-1', target, false, SELF)).toBe('reaction');
  });

  it('a bystander gets housekeeping', () => {
    expect(classifyReactionRecipient('bystander', target, false, SELF)).toBe('housekeeping');
  });

  it('REMOVALS are housekeeping for everyone, author included', () => {
    expect(classifyReactionRecipient('author-1', target, true, SELF)).toBe('housekeeping');
    expect(classifyReactionRecipient('co-1', target, true, SELF)).toBe('housekeeping');
  });

  it("the sender's own reaction never makes a recipient loud (self is not a co-reactor signal)", () => {
    const onlyMine = { id: 'm2', senderId: 'author-1', reactions: [{ userId: SELF, emoji: '👍', at: 1 }] } as never;
    expect(classifyReactionRecipient('someone', onlyMine, false, SELF)).toBe('housekeeping');
  });

  it("an own-message row (senderId 'me') classifies via the outgoing marker on 1:1 sends", () => {
    const mine = { id: 'm3', senderId: 'me', outgoing: true, reactions: [] } as never;
    // Reacting to MY OWN message: the peer is neither author nor co-reactor.
    expect(classifyReactionRecipient('peer-1', mine, false, SELF)).toBe('housekeeping');
  });
});

describe('spec 1050 — prid mint/adopt', () => {
  it('mints 16 random bytes as unpadded base64url, unique across calls', () => {
    const a = mintPrid();
    const b = mintPrid();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });

  it('adopt keeps the lexicographically smaller id so both sides converge', () => {
    expect(adoptPrid(undefined, 'bbb')).toBe('bbb');
    expect(adoptPrid('aaa', 'bbb')).toBe('aaa');
    expect(adoptPrid('bbb', 'aaa')).toBe('aaa');
    expect(adoptPrid('aaa', undefined)).toBe('aaa');
    expect(adoptPrid(undefined, undefined)).toBeUndefined();
  });
});
