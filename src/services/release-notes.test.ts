import { describe, it, expect } from 'vitest';
import { computeDelta, prettify, displayVersion, type ReleaseNote } from './release-notes';

const note = (sha: string, subject = 'feat: x'): ReleaseNote => ({ sha, subject });

describe('displayVersion', () => {
  it('drops the +<sha> build metadata that the develop image stamps', () => {
    expect(displayVersion('0.1.0-dev.127+3ddacbf1750c4e1b75ca0b869f7985b26c24a595')).toBe('0.1.0-dev.127');
  });
  it('leaves a clean release or rc version untouched', () => {
    expect(displayVersion('0.2.0')).toBe('0.2.0');
    expect(displayVersion('0.2.0-rc.1')).toBe('0.2.0-rc.1');
  });
});

describe('computeDelta', () => {
  it('returns the incoming notes the running build did not have (by sha)', () => {
    const running = [note('a'), note('b')];
    const incoming = [note('c'), note('b'), note('a')];
    expect(computeDelta(incoming, running).map((n) => n.sha)).toEqual(['c']);
  });

  it('preserves incoming order (newest-first)', () => {
    const running = [note('a')];
    const incoming = [note('d'), note('c'), note('a'), note('b')];
    expect(computeDelta(incoming, running).map((n) => n.sha)).toEqual(['d', 'c', 'b']);
  });

  it('empty running → the whole incoming list (everything since the release)', () => {
    const incoming = [note('c'), note('b')];
    expect(computeDelta(incoming, [])).toEqual(incoming);
  });

  it('identical lists → empty delta', () => {
    const same = [note('a'), note('b')];
    expect(computeDelta(same, same)).toEqual([]);
  });

  it('disjoint lists → all incoming', () => {
    const incoming = [note('x'), note('y')];
    expect(computeDelta(incoming, [note('a')]).map((n) => n.sha)).toEqual(['x', 'y']);
  });

  it('empty incoming → empty delta', () => {
    expect(computeDelta([], [note('a')])).toEqual([]);
  });
});

describe('prettify', () => {
  it('drops the conventional-commit prefix and capitalizes', () => {
    expect(prettify('fix(sync): stabilize message status')).toBe('Stabilize message status');
    expect(prettify('feat: add full-text search')).toBe('Add full-text search');
  });

  it('handles a breaking-change marker and scopes', () => {
    expect(prettify('feat!: drop legacy API')).toBe('Drop legacy API');
    expect(prettify('refactor(call/sfu): simplify routing')).toBe('Simplify routing');
  });

  it('passes a non-conforming subject through, just capitalized', () => {
    expect(prettify('just some words')).toBe('Just some words');
    expect(prettify('Already capitalized')).toBe('Already capitalized');
  });

  it('does not crash on an empty subject', () => {
    expect(prettify('')).toBe('');
  });
});
