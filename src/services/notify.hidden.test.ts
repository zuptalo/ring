// Unit tests for the PAGE-side hidden-chat notification paths (spec 1027
// T020/T026, fixes bug B6). Clarified FR-012: every delivery path the platform
// does not force must be FULLY silent for a hidden chat — the old code bridged
// a generic local notification on the backgrounded-but-connected (non-push)
// path. Only the push-woken SW path may show the generic banner.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  notifyLocal: vi.fn(),
  tones: vi.fn(),
  settings: new Map<string, unknown>(),
}));

vi.mock('@ionic/vue', () => ({ alertController: { create: vi.fn() } }));
vi.mock('@/router', () => ({ default: { push: vi.fn(), currentRoute: { value: { path: '/' } } } }));
vi.mock('@/db/queries', () => ({
  getSetting: async (key: string, fallback: unknown) => h.settings.get(key) ?? fallback,
  isChatMuted: async () => false,
  getChat: async () => undefined,
}));
vi.mock('@/db/idb', () => ({ subscribe: () => () => {}, touch: () => {} }));
vi.mock('@/services/push', () => ({ notifyLocal: h.notifyLocal }));
vi.mock('@/services/notify-prefs', () => ({
  inAppGloballyEnabled: async () => true,
  getChatNotifyPrefs: async () => null,
}));
vi.mock('@/services/crypto/identity', () => ({
  isUnlockedNow: () => true,
  isUnlocked: { value: true },
}));
vi.mock('@/services/sound', () => ({ playTone: h.tones }));

import { notifyIncoming } from './notify';
import {
  registerHiddenLoader,
  setHiddenIdsCache,
  clearHiddenState,
} from './hidden-state';

beforeEach(() => {
  h.notifyLocal.mockClear();
  h.tones.mockClear();
  h.settings.clear();
  clearHiddenState();
  registerHiddenLoader(async () => new Set<string>());
  setHiddenIdsCache(['hidden-1']);
});

const msg = (over: Record<string, unknown> = {}) =>
  ({ kind: 'message', chatId: 'hidden-1', title: 'Peer', body: 'secret', ...over }) as never;

describe('notifyIncoming — hidden chats (FR-012 non-push paths are silent)', () => {
  it('backgrounded-but-connected (no push wake): NO local notification, no sound (B6)', async () => {
    // node env has no `document`, so appVisible() is false = backgrounded.
    const presented = await notifyIncoming(msg({ pushWoken: false }));
    expect(presented).toBe(false);
    expect(h.notifyLocal).not.toHaveBeenCalled();
    expect(h.tones).not.toHaveBeenCalled();
  });

  it('push-woken drain: nothing from the page either (the SW owns the generic)', async () => {
    const presented = await notifyIncoming(msg({ pushWoken: true }));
    expect(presented).toBe(false);
    expect(h.notifyLocal).not.toHaveBeenCalled();
  });

  it('a NON-hidden chat on the same path still notifies (no over-suppression)', async () => {
    const presented = await notifyIncoming(msg({ chatId: 'visible-1' }));
    // Backgrounded + connected for a normal chat → the page bridges its local
    // notification exactly as before this spec.
    expect(presented || h.notifyLocal.mock.calls.length > 0).toBe(true);
  });
});
