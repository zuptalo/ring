/**
 * Spec 2010 hand-off: the page acks `ring:handled` to the service worker only when
 * it ACTUALLY rendered an in-app banner for a drained message. If it doesn't ack,
 * the SW owns the OS notification.
 *
 * The bug this pins: a `ring:drain` names no message — it only says "a push woke
 * us, go pull". So a waiting ack cannot tell whether a given banner is the one it
 * caused. The signal used to BROADCAST, so when two pushes landed together and only
 * one banner rendered, that one banner acked BOTH drains and the SW stayed silent
 * for a message nothing ever showed. Silent, and invisible in the logs: the server
 * sees "delivered", the SW sees "the page has it".
 *
 * The contract now is one banner per waiter, oldest first. Being wrong in the other
 * direction costs a duplicate alert; being wrong this way costs a lost one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock('@ionic/vue', () => ({ alertController: { create: vi.fn() } }));
vi.mock('@/router', () => ({ default: { push: vi.fn(), currentRoute: { value: { path: '/' } } } }));
vi.mock('@/db/queries', () => ({
  getSetting: async (key: string, fallback: unknown) => h.settings.get(key) ?? fallback,
  isChatMuted: async () => false,
  getChat: async () => undefined,
}));
vi.mock('@/db/idb', () => ({ subscribe: () => () => {}, touch: () => {} }));
vi.mock('@/services/push', () => ({ notifyLocal: vi.fn() }));
vi.mock('@/services/notify-prefs', () => ({
  inAppGloballyEnabled: async () => true,
  getChatNotifyPrefs: async () => null,
}));
vi.mock('@/services/crypto/identity', () => ({ isUnlockedNow: () => true, isUnlocked: { value: true } }));
vi.mock('@/services/sound', () => ({ playTone: vi.fn() }));

import { notifyIncoming, claimNextBanner } from './notify';
import { registerHiddenLoader, setHiddenIdsCache, clearHiddenState } from './hidden-state';

// The waiter queue is module state, and a case that deliberately leaves a waiter
// UNSATISFIED (the whole point of the second test) would otherwise carry it into
// the next one and eat that test's first banner. Track every claim and cancel the
// leftovers between cases — the same cancel the real 2s ack window performs.
const pending: (() => void)[] = [];
function claim(cb: () => void): () => void {
  const cancel = claimNextBanner(cb);
  pending.push(cancel);
  return cancel;
}

beforeEach(() => {
  h.settings.clear();
  clearHiddenState();
  registerHiddenLoader(async () => new Set<string>());
  // A foreground message for a LOCKED hidden chat is the simplest deterministic
  // path that "claims the alert" without rendering anything user-visible: it is
  // silent by design (spec 1027 FR-012) but still tells the hand-off the page has
  // it covered, which is exactly the signal under test.
  setHiddenIdsCache(['hidden-1']);
  vi.stubGlobal('document', { visibilityState: 'visible' });
});
afterEach(() => {
  while (pending.length) pending.pop()!();
  vi.unstubAllGlobals();
});

/** One drained message the page claims. */
const claimed = () =>
  notifyIncoming({ kind: 'message', chatId: 'hidden-1', title: 'Peer', body: 'secret' } as never);

describe('drain hand-off — one banner satisfies one ack', () => {
  it('acks the waiting drain when a banner is presented', async () => {
    const ack = vi.fn();
    claim(ack);
    await claimed();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('does NOT let one banner ack two drains — the second must fall to the SW', async () => {
    const first = vi.fn();
    const second = vi.fn();
    claim(first);
    claim(second);

    await claimed(); // only ONE message actually surfaced

    expect(first).toHaveBeenCalledTimes(1);
    // The second drain stays unacked, so its window expires and the service
    // worker shows the OS notification. Before the fix this fired too, and the
    // user got nothing at all for that message.
    expect(second).not.toHaveBeenCalled();
  });

  it('acks both when both messages actually surface', async () => {
    const first = vi.fn();
    const second = vi.fn();
    claim(first);
    claim(second);

    await claimed();
    await claimed();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('fires each waiter at most once, however many banners follow', async () => {
    const ack = vi.fn();
    claim(ack);
    await claimed();
    await claimed();
    await claimed();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('cancelling a waiter (its window expired) leaves it out of the queue', async () => {
    const expired = vi.fn();
    const live = vi.fn();
    const cancel = claim(expired);
    claim(live);

    cancel(); // the 2s ack window elapsed before any banner rendered
    await claimed();

    expect(expired).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledTimes(1);
  });
});
