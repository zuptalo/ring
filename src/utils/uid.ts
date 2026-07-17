/**
 * RFC-4122-ish v4 id built from crypto.getRandomValues, which (unlike
 * crypto.randomUUID) is available in non-secure contexts too, so it works
 * when the dev server is hit over plain http on a LAN IP.
 */
export function uid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}
