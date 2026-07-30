import { describe, it, expect } from 'vitest';
import { attributedReactions, type ReactionLike } from './reaction-groups';

const r = (actor: string, emoji: string, at: number, deleted = false): ReactionLike => ({
  actor,
  emoji,
  at,
  deleted,
});

const names = (id: string) => ({ a: 'Ali', b: 'Bea', c: 'Cai' })[id] ?? id;

describe('attributedReactions (spec 1065 US3)', () => {
  it('gives one row per reactor with their emoji and moment', () => {
    const rows = attributedReactions([r('a', '👍', 100), r('b', '❤️', 200)], names, () => '');
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => [x.name, x.emoji, x.at])).toEqual(
      expect.arrayContaining([
        ['Ali', '👍', 100],
        ['Bea', '❤️', 200],
      ]),
    );
  });

  it('drops a removed reaction from both the list and the count', () => {
    const rows = attributedReactions([r('a', '👍', 100), r('b', '👍', 200, true)], names, () => '');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ali');
  });

  it('shows someone who changed emoji once, with the current one', () => {
    // A change is a remove of the old plus an add of the new, so the naive
    // grouping would list the person twice.
    const rows = attributedReactions(
      [r('a', '👍', 100, true), r('a', '🎉', 300)],
      names,
      () => '',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe('🎉');
    expect(rows[0].at).toBe(300);
  });

  it('keeps a person who genuinely holds two live emoji as two rows', () => {
    const rows = attributedReactions([r('a', '👍', 100), r('a', '🎉', 200)], names, () => '');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.id)).size).toBe(2); // distinct keys, no Vue dupe warning
  });

  it('gives every row a distinct id so the list keys are stable', () => {
    const rows = attributedReactions([r('a', '👍', 1), r('b', '👍', 2), r('a', '❤️', 3)], names, () => '');
    expect(new Set(rows.map((x) => x.id)).size).toBe(3);
  });

  it('ignores rows carrying no emoji', () => {
    const rows = attributedReactions([{ actor: 'a', at: 1 } as ReactionLike], names, () => '');
    expect(rows).toEqual([]);
  });

  it('resolves names and avatars through the callers it is given', () => {
    const rows = attributedReactions([r('a', '👍', 1)], () => 'Resolved', () => 'avatar:x');
    expect(rows[0].name).toBe('Resolved');
    expect(rows[0].avatar).toBe('avatar:x');
  });
});
