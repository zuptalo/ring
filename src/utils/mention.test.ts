import { describe, it, expect } from 'vitest';
import { findMentions, mentionQueryAt, replaceMentionQuery, substituteMentionNames } from './mention';

const handles = (t: string): string[] => findMentions(t).map((m) => m.handle);

describe('findMentions (spec 1064)', () => {
  it('reads a DOTTED handle whole — the reported bug', () => {
    // Previously the charset stopped at the dot, yielding "parham", which matches no member:
    // the mention rendered as raw text and the send-time resolve produced an EMPTY mentions
    // array, so the mentioned person was never notified.
    expect(handles('Khosh oomadi dayi @parham.hoseini')).toEqual(['parham.hoseini']);
  });

  it('still reads the handle shapes that already worked', () => {
    expect(handles('@sonia hi')).toEqual(['sonia']);
    expect(handles('hey @ashk_1989')).toEqual(['ashk_1989']);
    expect(handles('@amir1353 and @sb74ptud')).toEqual(['amir1353', 'sb74ptud']);
    expect(handles('@shahdokht_1331')).toEqual(['shahdokht_1331']);
  });

  it('does not swallow a sentence-ending period', () => {
    expect(handles('ask @parham.hoseini.')).toEqual(['parham.hoseini']);
    expect(handles('ask @sonia.')).toEqual(['sonia']);
  });

  it('never mistakes an email address for a mention (the dot-charset hazard)', () => {
    // Emails render as their own tappable entity; a mention must not eat one.
    expect(handles('mail me at foo@bar.com')).toEqual([]);
    expect(handles('foo@bar.com')).toEqual([]);
  });

  it('requires a start-or-whitespace boundary', () => {
    expect(handles('a@b')).toEqual([]);
    expect(handles('@b')).toEqual(['b']);
    expect(handles('x @b')).toEqual(['b']);
  });

  it('finds consecutive mentions separated by a single space', () => {
    expect(handles('@a.b @c_d @e')).toEqual(['a.b', 'c_d', 'e']);
  });

  it('reports offsets that slice the token exactly', () => {
    const text = 'hi @parham.hoseini there';
    const [m] = findMentions(text);
    expect(text.slice(m.start, m.end)).toBe('@parham.hoseini');
    expect(text.slice(0, m.start)).toBe('hi ');
    expect(text.slice(m.end)).toBe(' there');
  });

  it('handles a mention at the very start of the text', () => {
    const [m] = findMentions('@sonia hello');
    expect(m.start).toBe(0);
    expect(m.handle).toBe('sonia');
  });

  it('ignores a bare @ and a handle that would start with a dot', () => {
    expect(handles('@ ')).toEqual([]);
    expect(handles('@.foo')).toEqual([]);
  });
});

describe('mentionQueryAt', () => {
  it('opens on a bare @ and tracks the query as it is typed', () => {
    expect(mentionQueryAt('@')).toBe('');
    expect(mentionQueryAt('hi @par')).toBe('par');
  });

  it('stays open across the dot, so a dotted handle can be completed', () => {
    expect(mentionQueryAt('hi @parham.')).toBe('parham.');
    expect(mentionQueryAt('hi @parham.hos')).toBe('parham.hos');
  });

  it('closes once the mention is finished or the caret leaves it', () => {
    expect(mentionQueryAt('hi @parham.hoseini ')).toBeNull();
    expect(mentionQueryAt('hi there')).toBeNull();
    expect(mentionQueryAt('')).toBeNull();
  });

  it('does not open inside an email address', () => {
    expect(mentionQueryAt('foo@bar')).toBeNull();
  });
});

describe('replaceMentionQuery', () => {
  it('completes a partial handle and leaves a trailing space', () => {
    expect(replaceMentionQuery('hi @par', 'parham.hoseini')).toBe('hi @parham.hoseini ');
  });

  it('completes from a partially typed DOTTED handle', () => {
    expect(replaceMentionQuery('hi @parham.', 'parham.hoseini')).toBe('hi @parham.hoseini ');
  });

  it('completes a bare @ at the start', () => {
    expect(replaceMentionQuery('@', 'sonia')).toBe('@sonia ');
  });

  it('leaves earlier text and mentions untouched', () => {
    expect(replaceMentionQuery('yo @a.b and @so', 'sonia')).toBe('yo @a.b and @sonia ');
  });
});

describe('substituteMentionNames (spec 1064)', () => {
  const names: Record<string, string> = { 'parham.hoseini': 'Parham', 'farhad_1328': 'Dadi' };
  const nameFor = (h: string): string | undefined => names[h];

  it('rewrites a dotted handle as the display name', () => {
    expect(substituteMentionNames('Khosh oomadi dayi @parham.hoseini', nameFor)).toBe(
      'Khosh oomadi dayi @Parham',
    );
  });

  it('uses the LOCAL name for a renamed contact', () => {
    // "Dadi" is a local rename of the contact whose handle is farhad_1328.
    expect(substituteMentionNames('salam @farhad_1328', nameFor)).toBe('salam @Dadi');
  });

  it('rewrites several mentions and keeps the surrounding text', () => {
    expect(substituteMentionNames('@parham.hoseini and @farhad_1328 both', nameFor)).toBe(
      '@Parham and @Dadi both',
    );
  });

  it('leaves an unknown handle exactly as written', () => {
    expect(substituteMentionNames('hi @nobody there', nameFor)).toBe('hi @nobody there');
  });

  it('leaves an email address alone', () => {
    expect(substituteMentionNames('mail foo@bar.com now', nameFor)).toBe('mail foo@bar.com now');
  });

  it('returns the text untouched when there are no mentions', () => {
    expect(substituteMentionNames('just a message', nameFor)).toBe('just a message');
  });

  it('handles a name containing spaces', () => {
    expect(substituteMentionNames('@parham.hoseini!', (h) => (h === 'parham.hoseini' ? 'Parham H' : undefined))).toBe(
      '@Parham H!',
    );
  });
});
