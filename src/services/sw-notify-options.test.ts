// Spec 2047 — the rich per-chat notification's display options MUST NOT carry
// `renotify`. On iOS 26 / iPadOS 27 a `renotify:true` showNotification resolves but is
// never rendered on the lock screen — a silent, total failure the wake guard can't
// detect (it infers "shown" from the promise resolving). The working generic and the
// legacy lite path omit `renotify`, which is why they display. This pins that it stays
// gone, and that the per-chat `tag` (the coalescing key) is preserved.
import { describe, it, expect } from 'vitest';
import { richNoteOptions } from './sw-inbox';

describe('spec 2047: richNoteOptions', () => {
  const n = { body: 'hello', tag: 'ring:chat-1', url: '/chat/chat-1', silent: false };

  it('does NOT set renotify (the option iOS 26/iPadOS 27 accepts but never renders)', () => {
    const opts = richNoteOptions(n, '/icon.png', '/badge.png');
    expect('renotify' in opts).toBe(false);
    expect((opts as Record<string, unknown>).renotify).toBeUndefined();
  });

  it('keeps the per-chat tag so notifications still coalesce', () => {
    expect(richNoteOptions(n, '/i.png', '/b.png').tag).toBe('ring:chat-1');
  });

  it('passes icon, badge, body, and the deep-link url through', () => {
    const opts = richNoteOptions(n, '/icon.png', '/badge.png');
    expect(opts.body).toBe('hello');
    expect(opts.icon).toBe('/icon.png');
    expect(opts.badge).toBe('/badge.png');
    expect((opts.data as { url: string }).url).toBe('/chat/chat-1');
  });

  it('honors an explicit silent note (reaction tone None) and defaults silent off', () => {
    expect(richNoteOptions({ ...n, silent: true }, '/i.png', '/b.png').silent).toBe(true);
    expect(richNoteOptions({ ...n, silent: undefined }, '/i.png', '/b.png').silent).toBe(false);
  });
});
