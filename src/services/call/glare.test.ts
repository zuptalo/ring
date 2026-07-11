import { describe, it, expect } from 'vitest';
import { glareRole, yieldMode, glareDecision, type GlareAttempt } from './glare';

// Ids chosen so ordering is obvious: ALICE < BOB lexicographically.
const ALICE = 'aaaa1111';
const BOB = 'bbbb2222';
const CARO = 'cccc3333';

const attempt = (over: Partial<GlareAttempt> = {}): GlareAttempt => ({
  direction: 'outgoing',
  isGroup: false,
  kind: 'audio',
  peerUserId: BOB,
  ...over,
});

describe('glareRole (spec 1039): who wins a mutual 1:1 call', () => {
  it('no outgoing attempt → none (normal incoming flow)', () => {
    expect(glareRole(ALICE, BOB, null, true)).toBe('none');
    expect(glareRole(ALICE, BOB, undefined, true)).toBe('none');
  });

  it('attempt at a DIFFERENT peer → none (busy/call-waiting flow, FR-006)', () => {
    expect(glareRole(ALICE, CARO, attempt({ peerUserId: BOB }), true)).toBe('none');
  });

  it('incoming (not outgoing) meta → none', () => {
    expect(glareRole(ALICE, BOB, attempt({ direction: 'incoming' }), true)).toBe('none');
  });

  it('group attempt → none (out of scope)', () => {
    expect(glareRole(ALICE, BOB, attempt({ isGroup: true }), true)).toBe('none');
  });

  it('attempt already answered (connected/connecting) → none — busy rules apply', () => {
    expect(glareRole(ALICE, BOB, attempt(), false)).toBe('none');
  });

  it('smaller self id wins (keeps its own offer)', () => {
    expect(glareRole(ALICE, BOB, attempt({ peerUserId: BOB }), true)).toBe('win');
  });

  it('larger self id yields', () => {
    expect(glareRole(BOB, ALICE, attempt({ peerUserId: ALICE }), true)).toBe('yield');
  });

  it('missing ids → none (never resolve on unknown identity)', () => {
    expect(glareRole('', BOB, attempt(), true)).toBe('none');
    expect(glareRole(ALICE, '', attempt(), true)).toBe('none');
  });

  it('is symmetric: for any id pair, exactly one side wins and the other yields (FR-002)', () => {
    const ids = ['0001', '9zzz', 'aaaa1111', 'aaab', 'zzzz9999'];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const roleA = glareRole(a, b, attempt({ peerUserId: b }), true);
        const roleB = glareRole(b, a, attempt({ peerUserId: a }), true);
        expect([roleA, roleB].sort()).toEqual(['win', 'yield']);
      }
    }
  });
});

describe('yieldMode (spec 1039): consent decides auto-accept vs ring', () => {
  it('same kind → auto-accept (both already asked for exactly this call, FR-003)', () => {
    expect(yieldMode('audio', 'audio')).toBe('auto-accept');
    expect(yieldMode('video', 'video')).toBe('auto-accept');
  });

  it('different kinds → ring (never auto-enable a camera uninvited, FR-004)', () => {
    expect(yieldMode('audio', 'video')).toBe('ring');
    expect(yieldMode('video', 'audio')).toBe('ring');
  });
});

describe('glareDecision (composed decision table from data-model.md)', () => {
  it('no attempt → none', () => {
    expect(glareDecision(ALICE, BOB, null, true, 'audio')).toBe('none');
  });

  it('attempt + smaller self id → ignore', () => {
    expect(glareDecision(ALICE, BOB, attempt(), true, 'audio')).toBe('ignore');
  });

  it('attempt + larger self id + kinds match → auto-accept', () => {
    expect(glareDecision(BOB, ALICE, attempt({ peerUserId: ALICE, kind: 'video' }), true, 'video')).toBe('auto-accept');
  });

  it('attempt + larger self id + kinds differ → ring', () => {
    expect(glareDecision(BOB, ALICE, attempt({ peerUserId: ALICE, kind: 'audio' }), true, 'video')).toBe('ring');
  });
});
