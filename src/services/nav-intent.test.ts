// (notify-nav fix) A generic notification can't name the chat, so it encodes a
// "route me to the relevant chat" intent instead of the dead-end /tabs/chats. The SW
// builds it; the app parses it after unlock (with full DB access) to land on the
// sender's 1:1 chat, or the newest unread chat. These are the pure build/parse
// contracts both sides depend on.
import { describe, it, expect } from 'vitest';
import { relevantNav, parseRelevantNav } from './nav-intent';

describe('nav-intent: relevant-chat notification routing', () => {
  it('builds a bare intent when the sender is unknown', () => {
    expect(relevantNav()).toBe('ring-relevant');
    expect(relevantNav(undefined)).toBe('ring-relevant');
  });

  it('encodes the sender id when known', () => {
    expect(relevantNav('user-42')).toBe('ring-relevant:user-42');
  });

  it('round-trips the sender id through parse', () => {
    const { relevant, from } = parseRelevantNav(relevantNav('user-42'));
    expect(relevant).toBe(true);
    expect(from).toBe('user-42');
  });

  it('parses the bare intent as relevant with no sender', () => {
    expect(parseRelevantNav('ring-relevant')).toEqual({ relevant: true, from: undefined });
  });

  it('does NOT treat a real deep-link route as a relevant intent', () => {
    // A rich note carries /chat/<id> — it must route verbatim, never be intercepted.
    expect(parseRelevantNav('/chat/abc123')).toEqual({ relevant: false });
    expect(parseRelevantNav('/tabs/chats')).toEqual({ relevant: false });
    expect(parseRelevantNav('/tabs/contacts')).toEqual({ relevant: false });
  });

  it('treats an absent url as not-relevant (no crash)', () => {
    expect(parseRelevantNav(undefined)).toEqual({ relevant: false });
    expect(parseRelevantNav('')).toEqual({ relevant: false });
  });

  it('does not false-match a route that merely starts with the word', () => {
    // Defensive: only the exact sentinel or `sentinel:` prefix count.
    expect(parseRelevantNav('/ring-relevant-lookalike').relevant).toBe(false);
  });
});
