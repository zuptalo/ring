import { describe, it, expect } from 'vitest';
import { normalizeOutgoing, capitalizeFirst } from './text';

describe('normalizeOutgoing', () => {
  it('strips trailing whitespace on each line', () => {
    expect(normalizeOutgoing('hello   \nworld\t')).toBe('hello\nworld');
  });

  it('collapses 3+ blank lines to a single blank line', () => {
    expect(normalizeOutgoing('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims leading and trailing blank lines', () => {
    expect(normalizeOutgoing('\n\n  hi  \n\n')).toBe('hi');
  });

  it('leaves already-tidy text untouched', () => {
    expect(normalizeOutgoing('one\n\ntwo')).toBe('one\n\ntwo');
  });
});

describe('capitalizeFirst', () => {
  it('uppercases only the first letter', () => {
    expect(capitalizeFirst('ada')).toBe('Ada');
  });

  it('preserves existing casing in the rest', () => {
    expect(capitalizeFirst('mcDonald')).toBe('McDonald');
  });

  it('is a no-op on empty input', () => {
    expect(capitalizeFirst('')).toBe('');
  });
});
