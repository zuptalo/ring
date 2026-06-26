// Unit tests for the reveal-session composable (spec 1019, US3). The PIN verifier
// and the leaf reveal flag are mocked; we test the pure session logic: cold-start
// locked, PIN-gated reveal, relock, and the grace-window mapping.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ revealed: { v: false }, validPin: '1234' }));

vi.mock('@/services/hidden-chats', () => ({
  verifyHiddenPin: async (pin: string) => pin === h.validPin,
}));
vi.mock('@/services/hidden-state', () => ({
  setRevealed: (v: boolean) => {
    h.revealed.v = v;
  },
  isRevealed: () => h.revealed.v,
  clearHiddenState: () => {
    h.revealed.v = false;
  },
}));
vi.mock('@/db/queries', () => ({ getSetting: async (_k: string, fb: unknown) => fb }));
vi.mock('@/services/crypto/identity', () => ({ isUnlocked: { value: true } }));

import { revealWithPin, relockHidden, graceLimitMs, GRACE_MS } from './useHiddenChats';
import { isRevealed } from '@/services/hidden-state';

beforeEach(() => {
  h.revealed.v = false;
});

describe('reveal session', () => {
  it('starts locked (cold start)', () => {
    expect(isRevealed()).toBe(false);
  });

  it('reveals only on the correct PIN, with no oracle on failure', async () => {
    expect(await revealWithPin('0000')).toBe(false);
    expect(isRevealed()).toBe(false);
    expect(await revealWithPin('1234')).toBe(true);
    expect(isRevealed()).toBe(true);
  });

  it('relock ends the session', async () => {
    await revealWithPin('1234');
    expect(isRevealed()).toBe(true);
    relockHidden();
    expect(isRevealed()).toBe(false);
  });
});

describe('grace window', () => {
  it('maps the options and defaults unknown to 1 minute', () => {
    expect(graceLimitMs('immediately')).toBe(0);
    expect(graceLimitMs('1m')).toBe(60_000);
    expect(graceLimitMs('5m')).toBe(300_000);
    expect(graceLimitMs('garbage')).toBe(GRACE_MS['1m']);
  });
});
