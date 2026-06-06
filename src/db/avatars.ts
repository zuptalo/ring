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
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function initialsAvatar(name: string): string {
  const bg = COLORS[hash(name) % COLORS.length];
  const text = initials(name) || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
<rect width="120" height="120" rx="60" fill="${bg}"/>
<text x="60" y="60" dy="0.35em" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="48" font-weight="600" fill="#ffffff">${text}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
