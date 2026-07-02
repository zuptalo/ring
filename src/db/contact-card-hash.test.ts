// Guards the contact-card signature input across the NUL-byte cleanup (spec 1027
// FR-020 / T001-T002). `cardSignature` in queries.ts hashes
// `${card.name}\u0000${card.avatar}` — the separator used to be a RAW 0x00 byte
// embedded in the source, which made grep treat the whole file as binary. The fix
// rewrites it as the `\u0000` escape, which MUST produce the identical runtime
// string (and therefore identical SHA-256 signatures — a changed signature would
// make every stored profile-reshare hint fire once for no reason).
//
// queries.ts itself can't load under node vitest (it transitively imports .vue
// components), so this pins the two halves separately:
//   1. escape ≡ raw byte (the language-level equivalence the cleanup relies on)
//   2. the source file contains the escape and NO raw NUL byte (stays clean text)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const QUERIES = path.resolve(__dirname, 'queries.ts');

function sig(name: string, avatar: string, sep: string): string {
  const data = new TextEncoder().encode(`${name}${sep}${avatar}`);
  return createHash('sha256').update(data).digest('hex');
}

describe('contact-card signature separator (FR-020)', () => {
  it('the \\u0000 escape is byte-identical to the raw NUL separator', () => {
    const name = 'Alice';
    const avatar = 'data:image/png;base64,AAA';
    const escaped = sig(name, avatar, '\u0000');
    const raw = sig(name, avatar, String.fromCharCode(0));
    expect(escaped).toBe(raw);
    // Pin the digest itself so any future separator change is a loud failure.
    expect(escaped).toBe('1fe9d4a8ec6475b32bc20a4b07f59de450e3cbb16ce608cecadd2a024ea7c03a');
  });

  it('queries.ts contains the escape and no raw NUL byte', () => {
    const bytes = readFileSync(QUERIES);
    expect(bytes.includes(0)).toBe(false); // grep must see the file as text
    expect(bytes.toString('utf8')).toContain('${card.name}\\u0000${card.avatar}');
  });
});
