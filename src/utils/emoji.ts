/**
 * Emoji helpers for message rendering: split a string into emoji / non-emoji
 * runs (grapheme-aware, so ZWJ sequences and flags stay intact), and detect
 * "emoji-only" messages (which render larger).
 */
const EMOJI_RE = /\p{Extended_Pictographic}/u;

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('und', { granularity: 'grapheme' })
    : null;

/** Split into graphemes (falls back to spread for ancient engines). */
function graphemes(text: string): string[] {
  if (segmenter) return [...segmenter.segment(text)].map((s) => s.segment);
  return [...text];
}

export interface EmojiSegment {
  emoji?: string; // an emoji grapheme
  text?: string; // a run of plain text
}

/** Split a (link-free) text run into alternating plain-text and emoji segments. */
export function segmentEmoji(text: string): EmojiSegment[] {
  const out: EmojiSegment[] = [];
  let buf = '';
  for (const g of graphemes(text)) {
    if (EMOJI_RE.test(g)) {
      if (buf) {
        out.push({ text: buf });
        buf = '';
      }
      out.push({ emoji: g });
    } else {
      buf += g;
    }
  }
  if (buf) out.push({ text: buf });
  return out;
}

/** If the whole message is just emoji (no other visible characters), returns the
 *  emoji count; otherwise 0. Used to render up-to-3-emoji messages larger. */
export function emojiOnlyCount(body: string): number {
  const trimmed = body.trim();
  if (!trimmed) return 0;
  let count = 0;
  for (const g of graphemes(trimmed)) {
    if (/\s/.test(g)) continue;
    if (EMOJI_RE.test(g)) count++;
    else return 0; // a non-emoji, non-space character → not emoji-only
  }
  return count;
}
