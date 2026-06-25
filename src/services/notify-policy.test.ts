import { describe, it, expect } from 'vitest';
import { notificationOwner, type NotifyInput } from './notify-policy';

// A sensible default: unlocked, visible, off the active chat, not push-woken, no
// settle window, full content, everything allowed. Each test overrides only the
// fields it cares about so the intent of each case is obvious.
type Override = Partial<Omit<NotifyInput, 'pref'>> & { pref?: Partial<NotifyInput['pref']> };
function input(over: Override = {}): NotifyInput {
  const { pref: prefOver, ...rest } = over;
  return {
    appVisible: true,
    unlocked: true,
    isActiveChat: false,
    pushWoken: false,
    inSettleWindow: false,
    ...rest,
    // Merge pref separately so a test can override one pref field without restating all.
    pref: { webPush: true, inApp: true, content: 'full', muted: false, ...(prefOver ?? {}) },
  };
}

describe('notificationOwner', () => {
  it('unlocked + visible + full + not active → page shows the banner', () => {
    expect(notificationOwner(input())).toBe('page-banner');
  });

  it('unlocked + app hidden → the SW owns the OS notification', () => {
    expect(notificationOwner(input({ appVisible: false }))).toBe('sw-notification');
  });

  it('viewing the active chat (visible) → suppress (just a sound)', () => {
    expect(notificationOwner(input({ isActiveChat: true }))).toBe('suppress');
  });

  it('muted chat → suppress regardless of visibility', () => {
    expect(notificationOwner(input({ pref: { muted: true } }))).toBe('suppress');
    expect(notificationOwner(input({ appVisible: false, pref: { muted: true } }))).toBe('suppress');
  });

  it('content=none + app hidden → still sw-notification (the SW badge-only path)', () => {
    expect(notificationOwner(input({ appVisible: false, pref: { content: 'none' } }))).toBe('sw-notification');
  });

  it('content=none + visible → suppress (badge-only, no banner)', () => {
    expect(notificationOwner(input({ pref: { content: 'none' } }))).toBe('suppress');
  });

  it('a push-woken item bypasses the settle window (visible → still page-banner)', () => {
    expect(notificationOwner(input({ inSettleWindow: true, pushWoken: true }))).toBe('page-banner');
  });

  it('a non-push item inside the settle window is suppressed', () => {
    expect(notificationOwner(input({ inSettleWindow: true, pushWoken: false }))).toBe('suppress');
  });

  it('locked page never claims the alert → hands off to the SW', () => {
    expect(notificationOwner(input({ unlocked: false }))).toBe('sw-notification');
    // even visible, a locked page can't show content, so the SW owns it
    expect(notificationOwner(input({ unlocked: false, appVisible: true }))).toBe('sw-notification');
  });

  it('in-app banners off for this chat (visible) → suppress', () => {
    expect(notificationOwner(input({ pref: { inApp: false } }))).toBe('suppress');
  });

  it('per-chat web push off + hidden → suppress (no OS notification)', () => {
    expect(notificationOwner(input({ appVisible: false, pref: { webPush: false } }))).toBe('suppress');
  });

  it("generic content still yields a page-banner when visible (text is masked, not the banner)", () => {
    expect(notificationOwner(input({ pref: { content: 'generic' } }))).toBe('page-banner');
  });
});
