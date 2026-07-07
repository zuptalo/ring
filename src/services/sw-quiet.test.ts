// Spec 1034 — the pure halves of the no-silent-pushes policy: the visible-client
// test that licenses a silent outcome, and the content-free quiet note shown when
// the rich path has nothing it may display.
import { describe, it, expect } from 'vitest';
import { anyClientVisible, quietNote } from './sw-inbox';

describe('spec 1034: anyClientVisible', () => {
  it('no clients → not visible (fully closed app must always show)', () => {
    expect(anyClientVisible([])).toBe(false);
  });
  it('a hidden/frozen background client does NOT license silence', () => {
    expect(anyClientVisible([{ visibilityState: 'hidden' }])).toBe(false);
  });
  it('a visible client licenses a silent outcome', () => {
    expect(anyClientVisible([{ visibilityState: 'hidden' }, { visibilityState: 'visible' }])).toBe(true);
  });
  it('clients without a visibilityState (older platforms) count as not visible', () => {
    expect(anyClientVisible([{}])).toBe(false);
  });
});

describe('spec 1034: quietNote', () => {
  it('message kind keeps the generic message copy, content-free', () => {
    const n = quietNote('msg');
    expect(n.title).toBe('New message');
    expect(n.options.body).toBe('You have a new message.');
    expect(n.options.silent).toBe(true);
  });
  it('activity kinds are the neutral Ring note', () => {
    const n = quietNote('activity');
    expect(n.title).toBe('Ring');
    expect(n.options.body).toBe('New activity');
    expect(n.options.silent).toBe(true);
  });
  it('both flavors are self-replacing on the generic tag with no re-alert', () => {
    for (const kind of ['msg', 'activity'] as const) {
      const n = quietNote(kind);
      expect(n.options.tag).toBe('ring-incoming');
      expect(n.options.renotify).toBe(false);
    }
  });
});
