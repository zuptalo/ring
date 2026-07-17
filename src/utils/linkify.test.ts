// Unit tests for the pure phone/email detector (spec 1029). This is where the
// feature's correctness lives — the renderers just consume these segments. The
// matcher must be CONSERVATIVE: zero false "Call"/"Email" affordances on ordinary
// digit/text runs (SC-005), while catching the common phone + email formats.
import { describe, it, expect } from 'vitest';
import { segmentContacts, telValue, telHref, smsHref, mailtoHref } from './linkify';

// Helper: the detected entities (dropping plain-text segments).
const entities = (t: string) =>
  segmentContacts(t).filter((s): s is Extract<typeof s, { kind: string }> => 'kind' in s);

describe('segmentContacts — emails', () => {
  it('detects a plain address', () => {
    expect(entities('mail hello@example.com please')).toEqual([
      { kind: 'email', raw: 'hello@example.com', value: 'hello@example.com' },
    ]);
  });
  it('detects sub-addressed, dotted-local, and multi-label domains', () => {
    expect(entities('a.b+tag@mail.co.uk')[0]).toMatchObject({ kind: 'email', raw: 'a.b+tag@mail.co.uk' });
  });
  it('excludes a trailing period or paren', () => {
    expect(entities('write to bob@x.com.')[0].raw).toBe('bob@x.com');
    expect(entities('(see jane@y.io)')[0].raw).toBe('jane@y.io');
  });
  it('does not match a bare @handle or a domain without a TLD', () => {
    expect(entities('hi @alice and foo@localhost')).toEqual([]);
  });
});

describe('segmentContacts — phones', () => {
  it('detects an international + number with separators', () => {
    expect(entities('call +1 (415) 555-0134 now')[0]).toMatchObject({
      kind: 'phone',
      raw: '+1 (415) 555-0134',
      value: '+14155550134',
    });
  });
  it('detects dashed, dotted, and spaced forms', () => {
    expect(entities('415-555-0134')[0].value).toBe('4155550134');
    expect(entities('415.555.0134')[0].value).toBe('4155550134');
    expect(entities('415 555 0134')[0].value).toBe('4155550134');
  });
  it('detects a bare 10+ digit run', () => {
    expect(entities('4155550134')[0]).toMatchObject({ kind: 'phone', value: '4155550134' });
  });
  it('detects a long international run within the 15-digit cap', () => {
    expect(entities('+441632960961')[0].value).toBe('+441632960961');
  });
});

describe('segmentContacts — conservative NON-matches (SC-005, zero false positives)', () => {
  const nonEntities = [
    'order #1234567 shipped',        // 7 bare digits, no + / separator → not a phone
    'build 8 of 9',
    'meet at 12:30 today',           // time
    'the hex is a1b2c3d4e5',
    'id 550e8400e29b41d4',           // long alnum id
    'ratio 16:9 and 4:3',
    'page 42, line 7',
    'v1.2.3 released',               // version — dotted but too few digits
    '3.14159 is pi',                 // 6 digits, no phone shape
    'error code 42',
  ];
  for (const t of nonEntities) {
    it(`no entity in: "${t}"`, () => {
      expect(entities(t)).toEqual([]);
    });
  }
});

describe('segmentContacts — coexistence + multiplicity (FR-005/SC-004)', () => {
  it('finds both a phone and an email in one string, keeping text between', () => {
    const segs = segmentContacts('ph +1 415 555 0134 or hi@x.com ok');
    expect(entities('ph +1 415 555 0134 or hi@x.com ok').map((e) => e.kind)).toEqual(['phone', 'email']);
    // the plain text between/around is preserved (round-trips to the original)
    expect(segs.map((s) => ('kind' in s ? s.raw : s.text)).join('')).toBe('ph +1 415 555 0134 or hi@x.com ok');
  });
  it('does not treat the digits inside an email as a phone', () => {
    expect(entities('reply to 4155550134@carrier.com')).toEqual([
      { kind: 'email', raw: '4155550134@carrier.com', value: '4155550134@carrier.com' },
    ]);
  });
});

describe('normalizers', () => {
  it('telValue keeps a leading + and strips separators', () => {
    expect(telValue('+1 (415) 555-0134')).toBe('+14155550134');
    expect(telValue('415.555.0134')).toBe('4155550134');
  });
  it('builds tel:/sms:/mailto: hrefs', () => {
    expect(telHref('+1 415 555 0134')).toBe('tel:+14155550134');
    expect(smsHref('415-555-0134')).toBe('sms:4155550134');
    expect(mailtoHref('a@b.com')).toBe('mailto:a@b.com');
  });
});
