// Spec 2047 + desktop fix — `renotify` is PLATFORM-GATED. On iOS 26 / iPadOS 27 a
// `renotify:true` show resolves but never renders (a silent total failure the guard can't
// detect), so it MUST stay omitted on WebKit. But on Chromium it's REQUIRED: without it a
// second same-tag show silently replaces the first, so subsequent messages in a chat never
// banner (the desktop bug). The caller passes platformTrustsSilence(ua): the last arg is
// true on Chromium (renotify on), false/absent on WebKit (renotify omitted).
import { describe, it, expect } from 'vitest';
import { richNoteOptions } from './sw-inbox';

describe('spec 2047 + desktop: richNoteOptions renotify is platform-gated', () => {
  const n = { body: 'hello', tag: 'ring:chat-1', url: '/chat/chat-1', silent: false };

  it('OMITS renotify by default / on WebKit (iOS 26 never renders a renotify:true show)', () => {
    for (const opts of [richNoteOptions(n, '/icon.png', '/badge.png'), richNoteOptions(n, '/i.png', '/b.png', false)]) {
      expect('renotify' in opts).toBe(false);
      expect((opts as Record<string, unknown>).renotify).toBeUndefined();
    }
  });

  it('SETS renotify:true when the platform trusts it (Chromium) so same-tag messages re-banner', () => {
    const opts = richNoteOptions(n, '/i.png', '/b.png', true) as Record<string, unknown>;
    expect(opts.renotify).toBe(true);
    expect(opts.tag).toBe('ring:chat-1'); // tag preserved → still coalesces per chat
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
