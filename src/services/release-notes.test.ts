import { describe, it, expect } from 'vitest';
import { computeDelta, userFacing, isUserFacing, prettify, displayVersion, type ReleaseNote } from './release-notes';

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

describe('isUserFacing / userFacing', () => {
  it('keeps features, fixes, perf, and non-conforming subjects', () => {
    expect(isUserFacing(note('a', 'feat(wall): add voice posts'))).toBe(true);
    expect(isUserFacing(note('b', 'fix(call): no echo'))).toBe(true);
    expect(isUserFacing(note('c', 'perf: faster boot'))).toBe(true);
    expect(isUserFacing(note('d', 'security: rotate keys'))).toBe(true); // unknown type → shown
    expect(isUserFacing(note('e', 'just some words'))).toBe(true); // non-conforming → shown
  });

  it('drops build/CI/test/docs/chore/refactor/style/deps noise', () => {
    for (const t of ['build', 'chore', 'ci', 'deps', 'docs', 'refactor', 'style', 'test']) {
      expect(isUserFacing(note('x', `${t}(scope): whatever`))).toBe(false);
      expect(isUserFacing(note('x', `${t}: whatever`))).toBe(false);
    }
  });

  it('filters a mixed list down to the user-facing notes, order preserved', () => {
    const notes = [
      note('a', 'feat: shiny new thing'),
      note('b', 'ci: bump actions'),
      note('c', 'fix: a real bug'),
      note('d', 'docs: update readme'),
      note('e', 'chore: tidy'),
    ];
    expect(userFacing(notes).map((n) => n.sha)).toEqual(['a', 'c']);
  });

  it('is case-insensitive on the type', () => {
    expect(isUserFacing(note('x', 'CI: uppercase noise'))).toBe(false);
    expect(isUserFacing(note('y', 'Feat: uppercase feature'))).toBe(true);
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

  it('strips a trailing spec / issue / PR reference', () => {
    expect(prettify('feat(notifications): reliable push + redesigned in-app notifications (spec 1015)')).toBe(
      'Reliable push + redesigned in-app notifications',
    );
    expect(prettify('fix(media): correct thumbnails (#248)')).toBe('Correct thumbnails');
    expect(prettify('feat: add search (gh-12)')).toBe('Add search');
  });

  it('keeps a meaningful trailing parenthetical that is not a reference', () => {
    expect(prettify('feat: add dark mode (finally)')).toBe('Add dark mode (finally)');
  });

  it('passes a non-conforming subject through, just capitalized', () => {
    expect(prettify('just some words')).toBe('Just some words');
    expect(prettify('Already capitalized')).toBe('Already capitalized');
  });

  it('does not crash on an empty subject', () => {
    expect(prettify('')).toBe('');
  });
});
