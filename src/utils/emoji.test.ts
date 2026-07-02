import { describe, it, expect } from 'vitest';
import {
  segmentEmoji,
  emojiOnlyCount,
  hasVariationSelector,
  emojiCodepoints,
  nextEmojiAttempt,
  EMOJI_ATTEMPT_NATIVE,
} from './emoji';

describe('segmentEmoji', () => {
  it('splits text and emoji into alternating runs', () => {
    expect(segmentEmoji('hi 👋 there')).toEqual([
      { text: 'hi ' },
      { emoji: '👋' },
      { text: ' there' },
    ]);
  });

  it('returns a single text run when there is no emoji', () => {
    expect(segmentEmoji('plain text')).toEqual([{ text: 'plain text' }]);
  });

  it('keeps a ZWJ emoji sequence intact as one grapheme', () => {
    const segs = segmentEmoji('👨‍👩‍👧');
    expect(segs).toHaveLength(1);
    expect(segs[0].emoji).toBe('👨‍👩‍👧');
  });
});

describe('emojiOnlyCount', () => {
  it('counts emoji when the message is only emoji (ignoring spaces)', () => {
    expect(emojiOnlyCount('👍')).toBe(1);
    expect(emojiOnlyCount('👍 ❤️ 😂')).toBe(3);
  });

  it('returns 0 when any non-emoji character is present', () => {
    expect(emojiOnlyCount('👍 ok')).toBe(0);
    expect(emojiOnlyCount('hello')).toBe(0);
  });

  it('returns 0 for empty/whitespace-only input', () => {
    expect(emojiOnlyCount('   ')).toBe(0);
    expect(emojiOnlyCount('')).toBe(0);
  });
});

describe('emoji image fallback (spec 1026 US5)', () => {
  // 😀 U+1F600 has no variation selector; ❤️ = U+2764 U+FE0F does.
  const noSelector = '😀';
  const withSelector = '❤️';

  it('detects the FE0F variation selector', () => {
    expect(hasVariationSelector(withSelector)).toBe(true);
    expect(hasVariationSelector(noSelector)).toBe(false);
  });

  it('builds underscore-joined codepoints, optionally dropping FE0F', () => {
    expect(emojiCodepoints(noSelector)).toBe('1f600');
    expect(emojiCodepoints(withSelector)).toBe('2764_fe0f');
    expect(emojiCodepoints(withSelector, true)).toBe('2764');
  });

  it('falls straight to the native glyph for an emoji with no FE0F to retry', () => {
    // The bug: dropping a non-existent FE0F yields the same URL, so the retry would never
    // re-fire an error and the broken image would stick. We must jump to native immediately.
    expect(nextEmojiAttempt(noSelector, 0)).toBe(EMOJI_ATTEMPT_NATIVE);
  });

  it('retries without FE0F first, then goes native, for an emoji that has one', () => {
    expect(nextEmojiAttempt(withSelector, 0)).toBe(1);
    expect(nextEmojiAttempt(withSelector, 1)).toBe(EMOJI_ATTEMPT_NATIVE);
  });

  it('never gets stuck below the native threshold on repeated errors', () => {
    // Simulate the browser firing error → onError → error … from attempt 0.
    let attempt = 0;
    for (let i = 0; i < 5; i++) attempt = nextEmojiAttempt(noSelector, attempt);
    expect(attempt).toBe(EMOJI_ATTEMPT_NATIVE);

    attempt = 0;
    for (let i = 0; i < 5; i++) attempt = nextEmojiAttempt(withSelector, attempt);
    expect(attempt).toBe(EMOJI_ATTEMPT_NATIVE);
  });
});
