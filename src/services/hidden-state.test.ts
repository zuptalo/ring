// Unit tests for the hidden-state relock hook (spec 1027 T010, fixes bug B5).
// The hook is how the router learns a reveal session ended, so an OPEN hidden
// conversation can be left immediately (FR-009 "kick out"). It must fire on
// every transition INTO the locked state — grace expiry / manual relock
// (setRevealed(false)) and keystore lock / wipe (clearHiddenState) — and never
// on reveal.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/db/idb', () => ({ touch: () => {} }));

import {
  registerRelockHook,
  registerHiddenLoader,
  ensureHiddenLoaded,
  setRevealed,
  setHiddenIdsCache,
  clearHiddenState,
  isRevealed,
} from './hidden-state';

let fired: number;

beforeEach(() => {
  fired = 0;
  clearHiddenState();
  registerRelockHook(() => {
    fired += 1;
  });
  fired = 0; // ignore any firing caused by the reset itself
});

describe('registerRelockHook', () => {
  it('fires when an active reveal session ends', () => {
    setRevealed(true);
    expect(fired).toBe(0);
    setRevealed(false);
    expect(fired).toBe(1);
    expect(isRevealed()).toBe(false);
  });

  it('does not fire on reveal or on a redundant relock', () => {
    setRevealed(true);
    expect(fired).toBe(0);
    setRevealed(false);
    setRevealed(false); // no state change → no second firing
    expect(fired).toBe(1);
  });

  it('fires on clearHiddenState (keystore lock / wipe), even mid-reveal', () => {
    setRevealed(true);
    clearHiddenState();
    expect(fired).toBe(1);
    expect(isRevealed()).toBe(false);
  });

  it('fires on clearHiddenState even when not revealed (deep-link defense)', () => {
    clearHiddenState();
    expect(fired).toBe(1);
  });

  it('fires when the hidden set becomes known or mutates (cold-start deep-link recheck)', () => {
    // The router's door guard fails open before the set decrypts; this firing
    // is what re-runs the check once it is known. The router callback itself
    // ignores active reveal sessions (checked there via isRevealed).
    setHiddenIdsCache(['c1']);
    expect(fired).toBe(1);
    setHiddenIdsCache(['c1', 'c2']); // every mutation rechecks
    expect(fired).toBe(2);
  });

  it('fires after a successful LAZY load too (the actual cold-start path)', async () => {
    registerHiddenLoader(async () => new Set(['c1']));
    await ensureHiddenLoaded();
    await new Promise<void>((r) => queueMicrotask(r)); // load defers to a microtask
    expect(fired).toBe(1);
  });
});
