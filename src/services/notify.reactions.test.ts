// Spec 1048 (US1/US2) — the PAGE-side dispatch for reaction alerts and reply-to-you
// escalation. Reactions use their own tone and never escalate; replies escalate
// exactly like mentions (same pref, same silencer set) with "replied to you" wording.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  notifyLocal: vi.fn(),
  tones: vi.fn(),
  settings: new Map<string, unknown>(),
  muted: new Set<string>(),
  chatPrefs: null as null | { webPush: boolean; inApp: boolean; content: string; mentions: boolean },
  // notify.ts hydrates its prefs cache once and refreshes on the settings change
  // bus; capture that subscription so tests can drive the refresh after mutating
  // h.settings (otherwise a tone set in one test leaks into the next).
  onSettings: undefined as undefined | (() => void),
}));

vi.mock('@ionic/vue', () => ({ alertController: { create: vi.fn() } }));
vi.mock('@/router', () => ({ default: { push: vi.fn(), currentRoute: { value: { path: '/' } } } }));
vi.mock('@/db/queries', () => ({
  getSetting: async (key: string, fallback: unknown) => h.settings.get(key) ?? fallback,
  isChatMuted: async (id: string) => h.muted.has(id),
  getChat: async () => undefined,
}));
vi.mock('@/db/idb', () => ({
  subscribe: (_stores: unknown, cb: () => void) => {
    h.onSettings = cb;
    return () => {};
  },
  touch: () => {},
}));
vi.mock('@/services/push', () => ({ notifyLocal: h.notifyLocal, pushSubscriptionActive: async () => false }));
vi.mock('@/services/sw-inbox', () => ({ recordPageShown: vi.fn() }));
vi.mock('@/services/notify-prefs', () => ({
  inAppGloballyEnabled: async () => true,
  getChatNotifyPrefs: async () => h.chatPrefs,
}));
vi.mock('@/services/crypto/identity', () => ({
  isUnlockedNow: () => true,
  isUnlocked: { value: true },
}));
vi.mock('@/services/sound', () => ({ playTone: h.tones }));

import { notifyIncoming, notifyBanners, setActiveChat, deferNotificationsFor } from './notify';
import { registerHiddenLoader, clearHiddenState } from './hidden-state';

const g = globalThis as { document?: { visibilityState: string } };

/** Flush the current h.settings into notify.ts's hydrated prefs cache. */
async function refreshPrefs(): Promise<void> {
  h.onSettings?.();
  await new Promise((r) => setTimeout(r));
}

beforeEach(async () => {
  h.notifyLocal.mockClear();
  h.tones.mockClear();
  h.settings.clear();
  h.muted.clear();
  h.chatPrefs = null;
  notifyBanners.value = [];
  setActiveChat(null);
  deferNotificationsFor(0);
  clearHiddenState();
  registerHiddenLoader(async () => new Set<string>());
  g.document = { visibilityState: 'visible' }; // foregrounded by default
  h.settings.set('notifications.inapp.sounds', true); // make tones observable
  await refreshPrefs();
});

afterEach(() => {
  delete g.document;
});

const reactionNotice = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'message',
    reaction: true,
    chatId: 'c1',
    msgId: 'm1',
    name: 'Alice Smith',
    body: 'Reacted ❤️ to: hi there',
    ...over,
  }) as never;

const replyNotice = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'message',
    replied: true,
    mentionName: 'Alice Smith',
    chatId: 'g1',
    msgId: 'm2',
    name: 'Team',
    body: 'Alice Smith: sure, tomorrow works',
    ...over,
  }) as never;

describe('spec 1048 US1 — reaction alerts on the page path', () => {
  it('foregrounded on another screen: banner with the reaction body + the REACTION tone', async () => {
    h.settings.set('notifications.message.sound', 'note');
    h.settings.set('notifications.reactions.sound', 'chime');
    await refreshPrefs();
    const presented = await notifyIncoming(reactionNotice());
    expect(presented).toBe(true);
    expect(notifyBanners.value).toHaveLength(1);
    expect(notifyBanners.value[0].body).toBe('Reacted ❤️ to: hi there');
    expect(h.tones).toHaveBeenCalledWith('chime');
    expect(h.tones).not.toHaveBeenCalledWith('note');
  });

  it('defaults to the subtle pop tone (not the message tone)', async () => {
    await notifyIncoming(reactionNotice());
    expect(h.tones).toHaveBeenCalledWith('pop');
  });

  it('in-app sounds are ON by default — a banner tones without any setting touched', async () => {
    h.settings.clear(); // no inapp.sounds key at all → the default must play
    await refreshPrefs();
    await notifyIncoming(reactionNotice());
    expect(h.tones).toHaveBeenCalledWith('pop');
  });

  it("reaction tone 'none': the banner still shows, silently", async () => {
    h.settings.set('notifications.reactions.sound', 'none');
    await refreshPrefs();
    const presented = await notifyIncoming(reactionNotice());
    expect(presented).toBe(true);
    expect(notifyBanners.value).toHaveLength(1);
    // playTone('none') is a no-op by contract; nothing else may fire either.
    for (const call of h.tones.mock.calls) expect(call[0]).toBe('none');
  });

  it('viewing the reacted chat: no banner, just the subtle reaction tone', async () => {
    setActiveChat('c1');
    const presented = await notifyIncoming(reactionNotice());
    expect(presented).toBe(false);
    expect(notifyBanners.value).toHaveLength(0);
    expect(h.tones).toHaveBeenCalledWith('pop');
  });

  it('muted chat: fully silent — a reaction never escalates past mute', async () => {
    h.muted.add('c1');
    const presented = await notifyIncoming(reactionNotice());
    expect(presented).toBe(false);
    expect(notifyBanners.value).toHaveLength(0);
    expect(h.tones).not.toHaveBeenCalled();
  });

  it('settle window damps a non-woken reaction like any backlog item', async () => {
    deferNotificationsFor(60_000);
    const presented = await notifyIncoming(reactionNotice({ pushWoken: false }));
    expect(presented).toBe(false);
    expect(notifyBanners.value).toHaveLength(0);
  });

  it("per-chat content 'generic': the banner masks the reaction text", async () => {
    h.chatPrefs = { webPush: true, inApp: true, content: 'generic', mentions: true };
    await notifyIncoming(reactionNotice());
    expect(notifyBanners.value[0]?.body).toBe('New message');
  });

  it('backgrounded (no push subscription): bridges the local notification like a message', async () => {
    g.document = { visibilityState: 'hidden' };
    const presented = await notifyIncoming(reactionNotice({ msgId: undefined }));
    expect(presented).toBe(false);
    expect(h.notifyLocal).toHaveBeenCalled();
    expect(h.notifyLocal.mock.calls[0][1]).toContain('Reacted ❤️');
  });
});

describe('spec 1050 — the group tone is finally a real setting', () => {
  it('a group message notice plays notifications.group.sound, not the message tone', async () => {
    h.settings.set('notifications.message.sound', 'note');
    h.settings.set('notifications.group.sound', 'beacon');
    await refreshPrefs();
    await notifyIncoming({ kind: 'message', group: true, chatId: 'g9', msgId: 'm9', name: 'Team', body: 'Ann: hi all' } as never);
    expect(h.tones).toHaveBeenCalledWith('beacon');
    expect(h.tones).not.toHaveBeenCalledWith('note');
  });

  it('a 1:1 message keeps the message tone', async () => {
    h.settings.set('notifications.message.sound', 'note');
    h.settings.set('notifications.group.sound', 'beacon');
    await refreshPrefs();
    await notifyIncoming({ kind: 'message', chatId: 'c9', msgId: 'm8', name: 'Ann', body: 'hi' } as never);
    expect(h.tones).toHaveBeenCalledWith('note');
  });

  it('a group REACTION still uses the dedicated reaction tone (most specific wins)', async () => {
    h.settings.set('notifications.group.sound', 'beacon');
    await refreshPrefs();
    await notifyIncoming(reactionNotice({ group: true, chatId: 'g9' }));
    expect(h.tones).toHaveBeenCalledWith('pop');
    expect(h.tones).not.toHaveBeenCalledWith('beacon');
  });
});

describe('spec 1048 US2 — reply-to-you escalation on the page path', () => {
  it('escalates past mute exactly like a mention', async () => {
    h.muted.add('g1');
    const presented = await notifyIncoming(replyNotice());
    expect(presented).toBe(true);
    expect(notifyBanners.value).toHaveLength(1);
  });

  it('masked content names the replier: "… replied to you"', async () => {
    h.muted.add('g1');
    h.chatPrefs = { webPush: true, inApp: true, content: 'none', mentions: true };
    await notifyIncoming(replyNotice());
    expect(notifyBanners.value[0]?.body).toBe('Alice Smith replied to you');
  });

  it('the per-chat mentions pref gates it: off → the reply is an ordinary muted message', async () => {
    h.muted.add('g1');
    h.chatPrefs = { webPush: true, inApp: true, content: 'full', mentions: false };
    const presented = await notifyIncoming(replyNotice());
    expect(presented).toBe(false);
    expect(notifyBanners.value).toHaveLength(0);
  });

  it('reply + mention together render the mention wording once', async () => {
    h.muted.add('g1');
    h.chatPrefs = { webPush: true, inApp: true, content: 'none', mentions: true };
    await notifyIncoming(replyNotice({ mention: true }));
    expect(notifyBanners.value).toHaveLength(1);
    expect(notifyBanners.value[0]?.body).toBe('Alice Smith mentioned you');
  });

  it('a reply uses the MESSAGE tone (it is a message, not a reaction)', async () => {
    h.settings.set('notifications.message.sound', 'note');
    h.settings.set('notifications.reactions.sound', 'chime');
    await refreshPrefs();
    await notifyIncoming(replyNotice());
    expect(h.tones).toHaveBeenCalledWith('note');
  });
});
