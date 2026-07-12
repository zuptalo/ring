/**
 * Generates avatar images entirely on-device (initials on a coloured disc)
 * as SVG data-URLs, so avatars work offline with no network requests.
 */

const COLORS = [
  '#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#14b8a6', '#6366f1',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    // Only words that START with a letter or digit contribute an initial: a
    // connective token like the "&" in "Macbook & others" would otherwise
    // become a raw ampersand inside the SVG — invalid XML, broken image.
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Escape a string for an SVG text node / attribute (same rule emojiAvatar
 *  uses) — defense in depth behind the initials() filter above. */
const xmlSafe = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function initialsAvatar(name: string): string {
  const bg = COLORS[hash(name) % COLORS.length];
  const text = xmlSafe(initials(name) || '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
<rect width="120" height="120" rx="60" fill="${bg}"/>
<text x="60" y="60" dy="0.35em" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="48" font-weight="600" fill="#ffffff">${text}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Emoji profile picture (spec 0008 FR-027): the chosen emoji on a coloured disc,
 * as an ordinary SVG data URL — so it flows through every avatar surface, the
 * E2EE profile card, the directory, and OLDER APPS as just a picture. The emoji
 * is embedded recoverably (`data-emoji`) so up-to-date surfaces can upgrade it
 * to the animated version via emojiOfAvatar(). Deterministic and byte-stable:
 * the profile-change signature (cardShared) relies on identical bytes per emoji.
 */
export function emojiAvatar(emoji: string): string {
  const bg = COLORS[hash(emoji) % COLORS.length];
  const safe = emoji.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-emoji="${safe}">
<rect width="120" height="120" rx="60" fill="${bg}"/>
<text x="60" y="60" dy="0.35em" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="62">${safe}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The disc colour behind an emoji avatar (same seed → same colour as the SVG). */
export function emojiDiscColor(emoji: string): string {
  return COLORS[hash(emoji) % COLORS.length];
}

/** The emoji embedded in an emoji avatar, or null for any other avatar/source. */
export function emojiOfAvatar(src: string): string | null {
  if (!src || !src.startsWith('data:image/svg+xml')) return null;
  try {
    const svg = decodeURIComponent(src.slice(src.indexOf(',') + 1));
    const m = svg.match(/data-emoji="([^"]*)"/);
    if (!m || !m[1]) return null;
    return m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  } catch {
    return null;
  }
}

/** Avatar for a "Ghosted" peer (account deleted): a tombstone with "RIP" on a
 *  muted grey disc, so a gone account reads as distinct from any live contact. */
export function ghostAvatar(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
<rect width="120" height="120" rx="60" fill="#9ca3af"/>
<path d="M42 96V58a18 18 0 0 1 36 0v38z" fill="#e5e7eb"/>
<rect x="38" y="92" width="44" height="8" rx="2" fill="#6b7280"/>
<text x="60" y="68" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="16" font-weight="700" fill="#6b7280">RIP</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Default group avatar: a two-person glyph on a coloured disc (seeded by the
 *  group id so each group gets a stable colour). Used until a custom photo is set. */
export function groupAvatar(seed = 'group'): string {
  const bg = COLORS[hash(seed) % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
<rect width="120" height="120" rx="60" fill="${bg}"/>
<g fill="#ffffff">
<circle cx="46" cy="50" r="15"/>
<path d="M46 69c-16 0-27 9-27 21v5h54v-5c0-12-11-21-27-21z"/>
<circle cx="80" cy="47" r="12" fill-opacity="0.8"/>
<path d="M80 63c-6 0-11 1.5-15 4.2 6.5 4.6 10 11.4 10 19.8v1h27v-5c0-11-9-20-22-20z" fill-opacity="0.8"/>
</g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
