import { describe, it, expect } from 'vitest';
import { segmentEmoji, emojiOnlyCount } from './emoji';

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
