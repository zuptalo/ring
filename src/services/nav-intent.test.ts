// (notify-nav fix) A generic notification can't name the chat, so it encodes a
// "route me to the relevant chat" intent instead of the dead-end /tabs/chats. The SW
// builds it; the app resolves it after unlock (with full DB access) to the newest
// unread chat — the one that just received the triggering message, 1:1 OR group. A
// rich note's real /chat/<id> deep-link must NOT be intercepted.
import { describe, it, expect } from 'vitest';
import { relevantNav, isRelevantNav } from './nav-intent';

describe('nav-intent: relevant-chat notification routing', () => {
  it('builds the relevant-chat intent', () => {
    expect(relevantNav()).toBe('ring-relevant');
  });

  it('recognizes the intent it builds', () => {
    expect(isRelevantNav(relevantNav())).toBe(true);
  });

  it('does NOT treat a real deep-link route as a relevant intent', () => {
    // A rich note carries /chat/<id> (1:1 or group) — it must route verbatim.
    expect(isRelevantNav('/chat/abc123')).toBe(false);
    expect(isRelevantNav('/chat/group-xyz')).toBe(false);
    expect(isRelevantNav('/tabs/chats')).toBe(false);
    expect(isRelevantNav('/tabs/contacts')).toBe(false);
  });

  it('treats an absent url as not-relevant (no crash)', () => {
    expect(isRelevantNav(undefined)).toBe(false);
    expect(isRelevantNav('')).toBe(false);
  });

  it('does not false-match a route that merely starts with the word', () => {
    expect(isRelevantNav('/ring-relevant-lookalike')).toBe(false);
    expect(isRelevantNav('ring-relevant:from=x')).toBe(false);
  });
});
