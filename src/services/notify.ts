/**
 * Central notification dispatcher. Every incoming message / friend request is
 * routed through `notifyIncoming`, which decides, based on the user's
 * Notifications settings (You → Notifications) and whether the app is currently
 * focused, how to surface it:
 *
 *  - App hidden            → OS notification (via the service worker), deep-linked
 *                            to the relevant chat/tab. Honors "Show notifications"
 *                            and "Show preview".
 *  - App visible, off the
 *    relevant chat          → in-app banner (toast) or alert per "In-app
 *                            notifications" style, plus optional sound/vibrate.
 *  - App visible, viewing
 *    the chat               → at most a subtle sound (no banner, they see it).
 *
 * The badge counters are handled separately (useBadges); this only adds the
 * "active" alerting on top.
 */
import { ref } from 'vue';
import { alertController } from '@ionic/vue';
import { personAddOutline } from 'ionicons/icons';
import router from '@/router';
import { getSetting, isChatMuted, getChat } from '@/db/queries';
import { subscribe } from '@/db/idb';
import { notifyLocal } from '@/services/push';
import { inAppGloballyEnabled, getChatNotifyPrefs, type ChatNotifyContent } from '@/services/notify-prefs';
import { isUnlockedNow } from '@/services/crypto/identity';
import { playTone } from '@/services/sound';

/* ---- cached notification preferences ---- */

// notifyIncoming runs on every inbound item; re-reading these keys from IndexedDB
// each time adds latency and races a concurrent toggle. Hydrate once into memory,
// then refresh on any settings write (the change bus already fires for 'settings').
interface NotifyPrefs {
  showMessages: boolean;
  showPreview: boolean;
  inappSounds: boolean;
  messageSound: string;
  inappVibrate: boolean;
  inappStyle: string;
}
const PREF_DEFAULTS: NotifyPrefs = {
  showMessages: true,
  showPreview: true,
  inappSounds: false,
  messageSound: 'note',
  inappVibrate: true,
  inappStyle: 'banners',
};
let prefs: NotifyPrefs = { ...PREF_DEFAULTS };
let prefsHydrated = false;

async function loadPrefs(): Promise<void> {
  const [showMessages, showPreview, inappSounds, messageSound, inappVibrate, inappStyle] = await Promise.all([
    getSetting<boolean>('notifications.message.show', PREF_DEFAULTS.showMessages),
    getSetting<boolean>('notifications.showPreview', PREF_DEFAULTS.showPreview),
    getSetting<boolean>('notifications.inapp.sounds', PREF_DEFAULTS.inappSounds),
    getSetting<string>('notifications.message.sound', PREF_DEFAULTS.messageSound),
    getSetting<boolean>('notifications.inapp.vibrate', PREF_DEFAULTS.inappVibrate),
    getSetting<string>('notifications.inapp.style', PREF_DEFAULTS.inappStyle),
  ]);
  prefs = { showMessages, showPreview, inappSounds, messageSound, inappVibrate, inappStyle };
}

async function ensurePrefs(): Promise<NotifyPrefs> {
  if (!prefsHydrated) {
    prefsHydrated = true;
    await loadPrefs();
    subscribe(['settings'], () => void loadPrefs()); // keep the cache live
  }
  return prefs;
}

// 'message' and 'request' are person-to-person; 'system' is an app event (e.g. an
// invitee joining) — it has no chat/avatar, so it shows an ICON instead. All three
// flow through the SAME banner (NotificationBanners.vue); only the payload differs.
export type IncomingKind = 'message' | 'request' | 'system';

// Default glyph for a system notice that doesn't name its own icon, so every system
// banner shows an icon (parity with the avatar/chat-icon on person notifications).
const DEFAULT_SYSTEM_ICON = personAddOutline;

export interface IncomingNotice {
  kind: IncomingKind;
  chatId?: string; // for messages → deep-link target
  name: string; // sender / requester display name (or the subject of a system notice)
  body: string; // preview text ("Hi!", "📷 Photo", "wants to connect", "joined Ring")
  avatar?: string; // optional; messages resolve the chat avatar if omitted
  icon?: string; // system notices: the ionicon shown in the banner (defaults applied)
  url?: string; // system notices: optional deep-link target (default: Contacts tab)
}

/* ---- in-app notification banners (custom green overlay; see NotificationBanners.vue) ---- */

export interface NotifyBanner {
  id: string;
  kind: IncomingKind;
  name: string;
  body: string;
  avatar: string;
  icon?: string; // system banners: shown in the avatar circle instead of an image
  url: string;
  chatId?: string; // message banners only: target for inline quick-reply
}
// Live list the overlay renders. Capped + deduped by target so a chatty
// conversation collapses to one banner instead of stacking.
export const notifyBanners = ref<NotifyBanner[]>([]);
const BANNER_MS = 4500;
const MAX_BANNERS = 3;
// Pending auto-dismiss timers by banner id, so a banner can be HELD open while the
// user is composing an inline quick-reply (holdBanner) instead of vanishing mid-type.
const bannerTimers = new Map<string, ReturnType<typeof setTimeout>>();
// URLs whose quick-reply is open: these banners are exempt from the MAX_BANNERS cap so
// a burst of other chats can't silently evict an open reply (+ its typed draft). Keyed
// by url (not id) since a same-chat follow-up replaces the banner with a fresh id.
const pinnedUrls = new Set<string>();

function showBanner(b: Omit<NotifyBanner, 'id'>): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // Replacing a same-target banner: clear its old timer so it can't dismiss the new one.
  for (const old of notifyBanners.value.filter((x) => x.url === b.url)) clearBannerTimer(old.id);
  const merged = [...notifyBanners.value.filter((x) => x.url !== b.url), { ...b, id }];
  // Keep every pinned (open-reply) banner, then fill the remaining slots with the most
  // recent others, instead of a blind tail-slice that could drop a pinned banner.
  const pinned = merged.filter((x) => pinnedUrls.has(x.url));
  const room = Math.max(0, MAX_BANNERS - pinned.length);
  const others = merged.filter((x) => !pinnedUrls.has(x.url)).slice(-room);
  const kept = new Set([...pinned, ...others].map((x) => x.id));
  for (const dropped of merged.filter((x) => !kept.has(x.id))) clearBannerTimer(dropped.id);
  notifyBanners.value = merged.filter((x) => kept.has(x.id)); // preserves arrival order
  bannerTimers.set(id, setTimeout(() => dismissBanner(id), BANNER_MS));
}

function clearBannerTimer(id: string): void {
  const t = bannerTimers.get(id);
  if (t) clearTimeout(t);
  bannerTimers.delete(id);
}

// Stop a banner's auto-dismiss (the user opened its quick-reply); it then only goes
// away on send, swipe-up dismiss, or tap-through.
export function holdBanner(id: string): void {
  clearBannerTimer(id);
}

// Exempt / un-exempt a target's banner from the cap while its quick-reply is open.
export function pinBanner(url: string): void {
  pinnedUrls.add(url);
}
export function unpinBanner(url: string): void {
  pinnedUrls.delete(url);
}

export function dismissBanner(id: string): void {
  clearBannerTimer(id);
  // Drop any pin for the removed banner's url so the set can't leak (a leaked pin would
  // make every future banner for that chat immortal).
  const gone = notifyBanners.value.find((b) => b.id === id);
  if (gone) pinnedUrls.delete(gone.url);
  notifyBanners.value = notifyBanners.value.filter((b) => b.id !== id);
}

/* ---- which chat is on screen (set by ChatDetailPage) ---- */

let activeChatId: string | null = null;
export function setActiveChat(chatId: string | null): void {
  activeChatId = chatId;
}

/* ---- settle window ---- */

// Right after the app "lands" (e.g. the passcode gate dismisses and queued
// messages flush/drain), suppress alerting for a moment so the user isn't hit
// with a burst of banners. Badges still update; only the active alert is held.
let settledUntil = 0;
export function deferNotificationsFor(ms: number): void {
  settledUntil = Date.now() + ms;
}

function appVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

/** True when the user is actively looking at this chat (it's open AND the app is
 *  foregrounded), so an arriving message is seen immediately and shouldn't grow
 *  the unread badge. */
export function isChatActive(chatId: string): boolean {
  return activeChatId === chatId && appVisible();
}

function targetUrl(n: IncomingNotice): string {
  if (n.kind === 'message') return `/chat/${n.chatId ?? ''}`;
  if (n.kind === 'system') return n.url ?? '/tabs/contacts';
  return '/tabs/contacts'; // request
}

async function inAppSoundAndHaptics(): Promise<void> {
  const p = await ensurePrefs();
  if (p.inappSounds) {
    playTone(p.messageSound);
  }
  if (p.inappVibrate) {
    try {
      navigator.vibrate?.(40);
    } catch {
      /* unsupported */
    }
  }
}

/** Decide and present the alerting for one incoming item. */
export async function notifyIncoming(n: IncomingNotice): Promise<void> {
  // Never surface anything while the keystore is locked (behind the passcode gate).
  if (!isUnlockedNow()) return;
  // The settle window suppresses the message/request banner BURST right after landing
  // (as the gate dismisses / queued messages drain). A 'system' notice (e.g. "X joined
  // Ring") is a single gated event, not part of that burst, and it fires exactly once —
  // so don't let the settle window silently swallow it.
  if (n.kind !== 'system' && Date.now() < settledUntil) return;
  // Per-chat mute suppresses all alerting for this chat (the message still arrives
  // and grows the unread badge). Requests have no chat to mute.
  if (n.chatId && (await isChatMuted(n.chatId))) return;
  // Per-chat notification controls (spec 1015): content visibility + in-app toggle.
  // A friend request / system notice has no chat, so it uses the defaults (web push
  // on, in-app on, content full).
  const chatPrefs = n.chatId ? await getChatNotifyPrefs(n.chatId) : null;
  const content: ChatNotifyContent = chatPrefs?.content ?? 'full';
  // content = 'none' → badge-only: reveal nothing, anywhere (no banner, no system
  // notification, no lock-screen text). The badge still updates elsewhere (FR-024).
  if (content === 'none') return;
  // content = 'generic' → fire a placeholder with no message text (sender name is
  // not message content, so it may still head the notice, matching showPreview=off).
  const showFull = content === 'full';
  const p = await ensurePrefs();
  // Backgrounded: hand off to an OS notification (covers the connected-but-hidden
  // gap; truly-offline is covered by the server push). Requests always notify;
  // message notifications respect "Show notifications".
  if (!appVisible()) {
    if (n.kind === 'message' && !p.showMessages) return;
    const full = showFull && p.showPreview;
    let title: string;
    let body: string;
    if (n.kind === 'request') {
      title = 'Friend request';
      body = full ? `${n.name} ${n.body}` : 'New request';
    } else if (n.kind === 'system') {
      title = 'Ring';
      body = `${n.name} ${n.body}`; // e.g. "Ada joined Ring"
    } else {
      title = n.name;
      body = full ? n.body : 'New message';
    }
    // Pass chatId so the page- and SW-shown notifications for one conversation
    // share a tag and collapse instead of duplicating.
    void notifyLocal(title, body, targetUrl(n), n.chatId);
    return;
  }

  // Focused on the very chat this message belongs to → no banner; subtle sound.
  if (n.kind === 'message' && n.chatId && n.chatId === activeChatId) {
    await inAppSoundAndHaptics();
    return;
  }

  // In-app banner path. Gated by the GLOBAL in-app master switch (FR-018; this also
  // suppresses friend-request banners while leaving their web push intact) and by
  // the PER-CHAT in-app toggle (FR-019). Both leave the badge + system push alone.
  if (!(await inAppGloballyEnabled())) return;
  if (chatPrefs && !chatPrefs.inApp) return;

  const style = p.inappStyle;
  await inAppSoundAndHaptics();
  if (style === 'none') return;

  const headline = n.kind === 'request' ? `${n.name} wants to connect` : n.name;
  const url = targetUrl(n);
  // For a 'generic' chat, mask the message text in the banner/alert too (no preview).
  const bodyText = showFull ? n.body : n.kind === 'message' ? 'New message' : '';

  if (style === 'alerts') {
    const a = await alertController.create({
      header: headline,
      message: n.kind === 'request' ? undefined : bodyText,
      buttons: [
        { text: 'Dismiss', role: 'cancel' },
        { text: 'View', handler: () => void router.push(url) },
      ],
    });
    await a.present();
    return;
  }

  // Default: a banner showing the chat avatar (or an icon for requests / system
  // notices) + name + preview, auto-dismissing, tap to open (see
  // NotificationBanners.vue). Resolve the chat's avatar for a message; a request /
  // system notice has no chat, so it falls back to an icon.
  let avatar = n.avatar ?? '';
  if (n.kind === 'message' && n.chatId && !avatar) {
    avatar = (await getChat(n.chatId))?.avatar ?? '';
  }
  const icon = n.icon ?? (n.kind === 'system' ? DEFAULT_SYSTEM_ICON : undefined);
  showBanner({ kind: n.kind, name: n.name, body: bodyText, avatar, icon, url, chatId: n.chatId });
}
