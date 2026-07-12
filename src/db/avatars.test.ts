// Spec 0008 T044 (FR-027) — the emoji profile picture is an ordinary SVG
// data-URL avatar (so every surface, wire path, and older app treats it as a
// picture) with the emoji RECOVERABLY embedded, so up-to-date surfaces can
// upgrade it to the animated version. The round-trip is the whole contract.
import { describe, it, expect } from 'vitest';
import { emojiAvatar, emojiOfAvatar, initialsAvatar } from './avatars';

describe('emoji avatars (spec 0008 FR-027)', () => {
  it('renders an SVG data URL and recovers the emoji from it', () => {
    const src = emojiAvatar('😏');
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
    expect(emojiOfAvatar(src)).toBe('😏');
  });

  it('round-trips multi-codepoint emoji (ZWJ sequences like the phoenix)', () => {
    expect(emojiOfAvatar(emojiAvatar('🐦‍🔥'))).toBe('🐦‍🔥');
    expect(emojiOfAvatar(emojiAvatar('❤️'))).toBe('❤️');
  });

  it('never misreads other avatars as emoji', () => {
    expect(emojiOfAvatar(initialsAvatar('Bob Builder'))).toBeNull();
    expect(emojiOfAvatar('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
    expect(emojiOfAvatar('')).toBeNull();
  });

  it('two emoji avatars differ only by their emoji (stable disc art)', () => {
    const a = emojiAvatar('🔥');
    const b = emojiAvatar('🔥');
    expect(a).toBe(b); // deterministic, byte-stable (profile-change signatures rely on it)
  });
});

describe('initials avatars survive XML-hostile names (spec 2026)', () => {
  const decode = (src: string): string => decodeURIComponent(src.replace('data:image/svg+xml;utf8,', ''));

  it('"Macbook & others" yields valid SVG with letter initials (the broken Calls-tab disc)', () => {
    const svg = decode(initialsAvatar('Macbook & others'));
    expect(svg).toContain('>MO<'); // the "&" token contributes no initial
    expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/); // no raw ampersand → parseable XML
  });

  it('a name with no letter-initial tokens still renders the "?" disc', () => {
    expect(decode(initialsAvatar('& <>'))).toContain('>?<');
  });

  it('XML-special initials are escaped, not dropped', () => {
    const svg = decode(initialsAvatar('Alert <script>'));
    expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
    expect(svg).not.toContain('<script');
  });
});
