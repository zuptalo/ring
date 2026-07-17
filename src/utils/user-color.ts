/**
 * A stable, distinct accent color per group member, used to tint each sender's
 * name so different people are separable at a glance (WhatsApp/Telegram-style).
 *
 * When the group's member list is known, colors are assigned by the member's INDEX
 * using an opposite-alternating walk of a hue-sorted palette: successive members
 * get colors from opposite halves of the wheel (red → blue → orange → indigo → …),
 * so freshly-added members are maximally easy to tell apart. Without a member list
 * (or for an unknown id) it falls back to a stable hash of the id.
 *
 * `userColor` returns the base tone; `userColorBright` returns a lighter, more vivid
 * variant intended for the name label (pops on dark bubbles, still legible on light).
 */

// Hue-sorted so index i and index i+N/2 are roughly opposite on the color wheel.
const PALETTE = [
  '#e0564f', // red
  '#d97b2e', // orange
  '#c79a1e', // amber
  '#7fa72b', // yellow-green
  '#3da35d', // green
  '#2b9d8f', // teal
  '#2f93c4', // cyan-blue
  '#3f7fd6', // blue        (opposite of red)
  '#5a6fd6', // indigo      (opposite of orange)
  '#7d5cd0', // violet      (opposite of amber)
  '#9d56c4', // purple      (opposite of yellow-green)
  '#c44fae', // magenta     (opposite of green)
  '#cf4d86', // pink        (opposite of teal)
  '#d65a6b', // rose        (opposite of cyan-blue)
];

// Brighter/more vivid versions of each, same index → used for the name label.
const PALETTE_BRIGHT = [
  '#ff6f68', // red
  '#f5993f', // orange
  '#e6b62f', // amber
  '#9fc93c', // yellow-green
  '#4fc878', // green
  '#33c2b1', // teal
  '#3fb3e6', // cyan-blue
  '#5b9bff', // blue
  '#7e8cff', // indigo
  '#a47bf0', // violet
  '#c071e6', // purple
  '#e96bd0', // magenta
  '#f56aa3', // pink
  '#f57885', // rose
];

const N = PALETTE.length;
const HALF = N / 2;

// Map a member's position to a palette index that alternates between opposite
// halves of the wheel for each successive member: 0→0, 1→HALF, 2→1, 3→HALF+1, …
function memberColorIndex(memberIndex: number): number {
  const k = ((memberIndex % N) + N) % N; // cycle the palette for very large groups
  const pair = Math.floor(k / 2);
  return k % 2 === 0 ? pair : HALF + pair;
}

function hashColorIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h % N;
}

function colorIndex(id: string, members?: string[]): number {
  if (members && members.length) {
    const idx = members.indexOf(id);
    if (idx >= 0) return memberColorIndex(idx);
  }
  return hashColorIndex(id);
}

/** Base accent tone for a member (mid-lightness). */
export function userColor(id: string, members?: string[]): string {
  return PALETTE[colorIndex(id, members)];
}

/** Brighter variant of the member's color, for the name label. */
export function userColorBright(id: string, members?: string[]): string {
  return PALETTE_BRIGHT[colorIndex(id, members)];
}
