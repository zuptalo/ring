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
import router from '@/router';
import { getSetting, isChatMuted, getChat } from '@/db/queries';
import { subscribe } from '@/db/idb';
import { notifyLocal } from '@/services/push';
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

export type IncomingKind = 'message' | 'request';

export interface IncomingNotice {
  kind: IncomingKind;
  chatId?: string; // for messages → deep-link target
  name: string; // sender / requester display name
  body: string; // preview text ("Hi!", "📷 Photo", "wants to connect")
  avatar?: string; // optional; messages resolve the chat avatar if omitted
}

/* ---- in-app notification banners (custom green overlay; see NotificationBanners.vue) ---- */

export interface NotifyBanner {
  id: string;
  kind: IncomingKind;
  name: string;
  body: string;
  avatar: string;
  url: string;
}
// Live list the overlay renders. Capped + deduped by target so a chatty
// conversation collapses to one banner instead of stacking.
export const notifyBanners = ref<NotifyBanner[]>([]);
const BANNER_MS = 4500;
const MAX_BANNERS = 3;

function showBanner(b: Omit<NotifyBanner, 'id'>): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  notifyBanners.value = [...notifyBanners.value.filter((x) => x.url !== b.url), { ...b, id }].slice(-MAX_BANNERS);
  setTimeout(() => dismissBanner(id), BANNER_MS);
}

export function dismissBanner(id: string): void {
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
  return n.kind === 'request' ? '/tabs/contacts' : `/chat/${n.chatId ?? ''}`;
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
  // Never surface decrypted content while the keystore is locked (behind the
  // passcode gate), nor during the brief settle window right after landing in
  // the app (avoids a banner burst as the gate dismisses / messages drain).
  if (!isUnlockedNow() || Date.now() < settledUntil) return;
  // Per-chat mute suppresses all alerting for this chat (the message still arrives
  // and grows the unread badge). Requests have no chat to mute.
  if (n.chatId && (await isChatMuted(n.chatId))) return;
  const p = await ensurePrefs();
  // Backgrounded: hand off to an OS notification (covers the connected-but-hidden
  // gap; truly-offline is covered by the server push). Requests always notify;
  // message notifications respect "Show notifications".
  if (!appVisible()) {
    if (n.kind === 'message' && !p.showMessages) return;
    const title = n.kind === 'request' ? 'Friend request' : n.name;
    const body = p.showPreview ? `${n.kind === 'request' ? n.name + ' ' : ''}${n.body}` : 'New message';
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

  const style = p.inappStyle;
  await inAppSoundAndHaptics();
  if (style === 'none') return;

  const headline = n.kind === 'request' ? `${n.name} wants to connect` : n.name;
  const url = targetUrl(n);

  if (style === 'alerts') {
    const a = await alertController.create({
      header: headline,
      message: n.kind === 'request' ? undefined : n.body,
      buttons: [
        { text: 'Dismiss', role: 'cancel' },
        { text: 'View', handler: () => void router.push(url) },
      ],
    });
    await a.present();
    return;
  }

  // Default: a green banner at the top showing the chat avatar + name + preview,
  // auto-dismissing, tap to open (see NotificationBanners.vue). Resolve the chat's
  // avatar/name for a message; a request has no chat (the overlay shows a fallback).
  let avatar = n.avatar ?? '';
  if (n.kind === 'message' && n.chatId && !avatar) {
    avatar = (await getChat(n.chatId))?.avatar ?? '';
  }
  showBanner({ kind: n.kind, name: n.name, body: n.body, avatar, url });
}
