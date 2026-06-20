/**
 * Notification preference access (spec 1015) — a single import surface for the
 * pieces both the page (notify.ts) and the service worker (sw-inbox.ts) need to
 * decide whether/how to surface a notification:
 *
 *  - the GLOBAL in-app master switch (`notifications.inapp.enabled`), read through
 *    a tiny cache refreshed on the settings change bus (it's consulted on every
 *    inbound item, like notify.ts's own NotifyPrefs cache), and
 *  - the PER-CHAT controls (web push / in-app / content visibility), re-exported
 *    from the db layer so callers have one place to import from.
 *
 * Everything here is device-local and enforced client-side; nothing about a
 * user's notification preferences ever leaves the device in plaintext (per-chat
 * controls ride the encrypted own-data sync; FR-026).
 */
import { getSetting, getChatNotifyPrefs, setChatNotifyPrefs, type ChatNotifyPrefs, type ChatNotifyContent } from '@/db/queries';
import { subscribe } from '@/db/idb';

export type { ChatNotifyPrefs, ChatNotifyContent };
export { getChatNotifyPrefs, setChatNotifyPrefs };

const GLOBAL_INAPP_KEY = 'notifications.inapp.enabled';

// Cached so the per-inbound-item check is synchronous-after-hydrate and doesn't
// race a concurrent toggle (the settings bus refreshes it, same pattern as
// notify.ts). Default ON, so a fresh account behaves exactly as before 1015.
let cachedGlobalInApp = true;
let hydrated = false;

async function load(): Promise<void> {
  cachedGlobalInApp = await getSetting<boolean>(GLOBAL_INAPP_KEY, true);
}

/** Whether in-app banners are globally enabled (the master switch). When false,
 *  NO in-app banner is shown for any chat — including friend-request banners
 *  (FR-018); system push + badge are governed separately. */
export async function inAppGloballyEnabled(): Promise<boolean> {
  if (!hydrated) {
    hydrated = true;
    await load();
    subscribe(['settings'], () => void load()); // keep the cache live
  }
  return cachedGlobalInApp;
}
