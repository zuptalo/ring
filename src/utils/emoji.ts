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

/* ---- Noto image fallback (used by Emoji.vue) ----
 * The Noto emoji set is served from our own cached proxy at /v1/emoji/<codepoints>/512.webp.
 * When an emoji has no asset there, the renderer must fall back to the platform's native glyph
 * instead of sitting on a broken image. The attempt sequence is:
 *   0 = full codepoint sequence, 1 = retry without the FE0F variation selector, 2 = native glyph.
 * These helpers are pure so the fallback logic is unit-testable without a DOM. */

/** Whether an emoji string carries a U+FE0F variation selector. */
export function hasVariationSelector(emoji: string): boolean {
  return [...emoji].some((c) => c.codePointAt(0) === 0xfe0f);
}

/** Underscore-joined hex codepoints for the asset path; optionally drop the FE0F selector. */
export function emojiCodepoints(emoji: string, dropVariationSelector = false): string {
  return [...emoji]
    .map((c) => c.codePointAt(0) ?? 0)
    .filter((cp) => !(dropVariationSelector && cp === 0xfe0f))
    .map((cp) => cp.toString(16))
    .join('_');
}

/** Attempt index at which we give up on an image and render the native glyph. */
export const EMOJI_ATTEMPT_NATIVE = 2;

/**
 * The next attempt after an image-load error. The FE0F-less retry (attempt 1) only helps when
 * there IS an FE0F to drop; otherwise it would produce an identical URL, the browser would not
 * refetch, no further error would fire, and the broken image would stick forever — so in that
 * case skip straight to the native glyph.
 */
export function nextEmojiAttempt(emoji: string, attempt: number): number {
  return attempt === 0 && hasVariationSelector(emoji) ? 1 : EMOJI_ATTEMPT_NATIVE;
}
