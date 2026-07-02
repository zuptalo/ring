/**
 * Conservative phone-number + email detector (spec 1029). Pure and dependency-free
 * so the two renderers (chat `bodyParts`, `EmojiText.vue`) can consume typed
 * segments and stay token-based (XSS-safe — nothing here builds HTML). The caller
 * has already split out URLs and @mentions; this segments the remaining plain text
 * runs into text + email + phone.
 *
 * Design goal: NO false "Call"/"Email" affordances on ordinary digit/text runs
 * (order numbers, hex ids, times, versions). Emails win over phones (so the digits
 * inside `4155550134@carrier.com` are never a phone), and a bare digit run must be
 * long enough (or carry a `+`/separator) to read as a phone.
 */

export type ContactSeg =
  | { text: string }
  | { kind: 'email' | 'phone'; raw: string; value: string };

// local@ (label.)+ TLD — requires a dot and a 2+ alpha TLD, so `foo@localhost`
// and trailing punctuation are excluded.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

// A phone CANDIDATE: optional +, then digits with common separators. Bounded so it
// can't run away across a paragraph. Validated (digit count + shape) in isPhone.
// The surrounding lookarounds keep it from firing inside a longer alphanumeric
// token or an email local part.
const PHONE_CAND_RE = /(?<![\w@+])\+?\d[\d\s().-]{4,}\d(?![\w])/g;

interface Span {
  start: number;
  end: number;
  seg: Extract<ContactSeg, { kind: string }>;
}

/** Digits only, preserving a single leading '+' (dial-safe for tel:/sms:). */
export function telValue(raw: string): string {
  const plus = raw.trimStart().startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}

export function telHref(raw: string): string {
  return `tel:${telValue(raw)}`;
}
export function smsHref(raw: string): string {
  return `sms:${telValue(raw)}`;
}
export function mailtoHref(raw: string): string {
  return `mailto:${raw}`;
}

/** Is a candidate run a plausible phone number? Conservative:
 *  - 7–15 digits (E.164 upper bound), and
 *  - a bare run (no '+' and no separator) must be ≥ 10 digits, so 7–9 bare digits
 *    (order numbers, ids) are NOT linkified. */
function isPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  const hasPlus = raw.includes('+');
  const hasSep = /[\s().-]/.test(raw);
  if (!hasPlus && !hasSep) return digits.length >= 10;
  return true;
}

export function segmentContacts(text: string): ContactSeg[] {
  const spans: Span[] = [];

  // Emails first — they take priority over any phone-shaped digits inside them.
  for (const m of text.matchAll(EMAIL_RE)) {
    const raw = m[0];
    spans.push({ start: m.index, end: m.index + raw.length, seg: { kind: 'email', raw, value: raw } });
  }

  // Phones, skipping any range already covered by an email.
  for (const m of text.matchAll(PHONE_CAND_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (spans.some((s) => start < s.end && end > s.start)) continue; // overlaps an email
    if (!isPhone(m[0])) continue;
    spans.push({ start, end, seg: { kind: 'phone', raw: m[0], value: telValue(m[0]) } });
  }

  if (!spans.length) return text ? [{ text }] : [];
  spans.sort((a, b) => a.start - b.start);

  const out: ContactSeg[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) out.push({ text: text.slice(cursor, s.start) });
    out.push(s.seg);
    cursor = s.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}
