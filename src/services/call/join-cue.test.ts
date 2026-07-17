// Unit tests for the pure join-cue diff (spec 1030, T001). The `call-roster`
// handler feeds every server roster update through newJoiners to decide who gets
// a "{name} joined the call" cue: only genuinely-new members — never self, never
// someone already announced this call (a reconnect or roster re-broadcast doesn't
// change membership, so an announced member can never re-fire — INV-4).
import { describe, it, expect } from 'vitest';
import { newJoiners } from './join-cue';

const SELF = 'self';

describe('newJoiners', () => {
  it('announces a genuinely new member', () => {
    expect(newJoiners(new Set([SELF, 'a']), [SELF, 'a', 'b'], SELF)).toEqual(['b']);
  });

  it('never announces self', () => {
    expect(newJoiners(new Set(), [SELF], SELF)).toEqual([]);
    expect(newJoiners(new Set(['a']), ['a', SELF], SELF)).toEqual([]);
  });

  it('dedups against the already-announced set (reconnect / re-broadcast)', () => {
    // 'a' was announced earlier this call; an identical roster re-broadcast (or a
    // leave+rejoin re-add) must not re-announce them.
    expect(newJoiners(new Set([SELF, 'a']), [SELF, 'a'], SELF)).toEqual([]);
  });

  it('returns multiple genuinely-new members in roster order', () => {
    expect(newJoiners(new Set([SELF]), [SELF, 'b', 'c'], SELF)).toEqual(['b', 'c']);
  });

  it('a coalesced join+leave still announces only the joiner', () => {
    // 'a' left and 'd' joined in one update: 'a' is simply absent; only 'd' is new.
    expect(newJoiners(new Set([SELF, 'a', 'b']), [SELF, 'b', 'd'], SELF)).toEqual(['d']);
  });

  it('empty roster → none', () => {
    expect(newJoiners(new Set([SELF, 'a']), [], SELF)).toEqual([]);
  });

  it('ignores empty ids and duplicates within one update', () => {
    expect(newJoiners(new Set([SELF]), ['', 'b', 'b'], SELF)).toEqual(['b']);
  });
});
