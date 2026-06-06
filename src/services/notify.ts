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
import { toastController, alertController } from '@ionic/vue';
import router from '@/router';
import { getSetting } from '@/db/queries';
import { notifyLocal } from '@/services/push';
import { isUnlockedNow } from '@/services/crypto/identity';
import { playTone } from '@/services/sound';

export type IncomingKind = 'message' | 'request';

export interface IncomingNotice {
  kind: IncomingKind;
  chatId?: string; // for messages → deep-link target
  name: string; // sender / requester display name
  body: string; // preview text ("Hi!", "📷 Photo", "wants to connect")
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
  if (await getSetting<boolean>('notifications.inapp.sounds', false)) {
    playTone(await getSetting<string>('notifications.message.sound', 'note'));
  }
  if (await getSetting<boolean>('notifications.inapp.vibrate', true)) {
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
  // Backgrounded: hand off to an OS notification (covers the connected-but-hidden
  // gap; truly-offline is covered by the server push). Requests always notify;
  // message notifications respect "Show notifications".
  if (!appVisible()) {
    const showMessages = await getSetting<boolean>('notifications.message.show', true);
    if (n.kind === 'message' && !showMessages) return;
    const showPreview = await getSetting<boolean>('notifications.showPreview', true);
    const title = n.kind === 'request' ? 'Friend request' : n.name;
    const body = showPreview ? `${n.kind === 'request' ? n.name + ' ' : ''}${n.body}` : 'New message';
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

  const style = await getSetting<string>('notifications.inapp.style', 'banners');
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

  // Default: a banner at the top, auto-dismissing, with a View action.
  const t = await toastController.create({
    header: headline,
    message: n.kind === 'request' ? undefined : n.body,
    duration: 3500,
    position: 'top',
    buttons: [{ text: 'View', handler: () => void router.push(url) }],
  });
  await t.present();
}
