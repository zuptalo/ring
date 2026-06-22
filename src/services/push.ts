/**
 * Web Push client wiring (Milestone 7f).
 *
 * Subscribes the service worker to push (using the server's VAPID public key)
 * and registers the subscription with the backend. The backend only ever sends
 * a content-free tickle (see server push package + src/sw.ts), so this carries
 * no message content, the zero-knowledge model holds.
 *
 * Requires notification permission to already be granted (the onboarding wizard
 * handles the prompt); these functions are safe no-ops otherwise.
 */
import { fetchServerConfig, subscribePush, unsubscribePushServer } from './api';
import { get } from '@/db/idb';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function pushReady(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  );
}

/** Whether an existing subscription was created with the given VAPID key. If not,
 *  the server's key rotated (or differs across envs) and pushes to it would
 *  silently fail, so it must be replaced. */
function subMatchesKey(sub: PushSubscription, desired: Uint8Array): boolean {
  const cur = sub.options?.applicationServerKey;
  if (!cur) return false;
  const a = new Uint8Array(cur as ArrayBuffer);
  if (a.length !== desired.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== desired[i]) return false;
  return true;
}

/**
 * Ensure this device has a push subscription registered with the backend, created
 * with the server's CURRENT VAPID key. Idempotent and best-effort: no-op when push
 * is unsupported or permission isn't granted. Reuses an existing browser
 * subscription only when its key still matches the server's, otherwise it
 * re-subscribes, so a rotated/mismatched key can't silently kill delivery. Returns
 * true only when a subscription was successfully registered (so callers can retry).
 */
export async function ensurePushSubscription(): Promise<boolean> {
  if (!pushReady()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { vapidPublicKey } = await fetchServerConfig();
    if (!vapidPublicKey) return false;
    // The bytes are a real ArrayBuffer at runtime; bridge the generic
    // Uint8Array<ArrayBufferLike> to the BufferSource the DOM types want.
    const key = urlBase64ToUint8Array(vapidPublicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !subMatchesKey(sub, key)) {
      try {
        await sub.unsubscribe();
      } catch {
        /* ignore, we resubscribe below regardless */
      }
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as unknown as BufferSource,
      });
    }
    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (json.endpoint && p256dh && auth) {
      // Report this device's running version + local UTC offset (spec 1016), refreshed on
      // each (re)subscribe — app start + every foreground — so the 9-AM-local version
      // announcement targets only devices that are behind, at their local morning.
      await subscribePush({
        endpoint: json.endpoint,
        keys: { p256dh, auth },
        installedVersion: __APP_VERSION__,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      });
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[push] could not subscribe', e);
    return false;
  }
}

/**
 * Show a local notification for an incoming message/request that arrived while
 * the app is in the background (connected but not focused). The server only
 * sends a Web Push when there's NO live connection, so this covers the
 * in-between case (e.g. a background browser tab). No-op when the app is focused
 * or notifications aren't granted.
 */
export async function notifyLocal(title: string, body: string, url?: string, chatId?: string): Promise<void> {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      // Per-chat tag (matching the service worker's preview) so the page- and
      // SW-shown notes for one conversation COLLAPSE into a single notification
      // instead of stacking, and a follow-up re-alerts (renotify).
      tag: chatId ? `ring:${chatId}` : 'ring-incoming',
      renotify: true,
      // Deep-link target read by the service worker's notificationclick handler.
      data: url ? { url } : undefined,
      // `renotify` is valid per the Notifications spec but missing from the DOM lib
      // type in this TS version (present in the webworker lib the SW uses).
    } as NotificationOptions & { renotify?: boolean });
  } catch {
    /* ignore */
  }
}

/* ---- preference-driven subscription ---- */

async function settingBool(key: string, fallback: boolean): Promise<boolean> {
  const r = await get<{ key: string; value: boolean }>('settings', key);
  return r ? r.value : fallback;
}

/**
 * Whether the user wants push notifications at all, a single master switch
 * (`notifications.push`, default on). The server push is one content-free tickle
 * regardless of category, so the subscription is all-or-nothing; the per-category
 * "Show notifications" toggles only gate what's shown in-app while Ring is open.
 */
async function pushDesired(): Promise<boolean> {
  return settingBool('notifications.push', true);
}

let lastApplied: boolean | null = null;

// Bounded backoff so a TRANSIENT subscribe failure (offline, server blip) heals on
// its own instead of waiting for the next reconnect/foreground - the gap that left
// a single device silently unsubscribed. After the last delay we stop and wait for
// the next external trigger (reconnect / settings / permission / revalidate).
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(attempt: number): void {
  clearRetry();
  if (attempt >= RETRY_DELAYS_MS.length) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void applyPushPreference(true, attempt + 1);
  }, RETRY_DELAYS_MS[attempt]);
}

/**
 * Reconcile the push subscription with the user's notification preference:
 * subscribe when notifications are wanted (and permission is granted), or fully
 * unsubscribe (browser + server) when they're not, so a disabled toggle stops
 * the server from pushing, honoring it even when the app is closed (the server
 * simply has no endpoint to push to; nothing leaks about the preference itself).
 *
 * `force` re-applies even when the desired state is unchanged, used on (re)connect
 * to re-register a subscription the server may have lost (e.g. after a wipe).
 */
export async function applyPushPreference(force = false, attempt = 0): Promise<void> {
  // Effective intent = the user wants push AND the OS still allows it. If they
  // revoked notification permission at the OS level, drop the now-dead subscription
  // (browser + server) so the server stops pushing to an endpoint that can never
  // deliver. We deliberately DON'T flip the in-app toggle, so push re-subscribes on
  // its own once permission is re-granted.
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const desired = (await pushDesired()) && granted;
  if (!force && desired === lastApplied) return;
  if (desired) {
    // Latch ON only on a successful (re)subscribe; a transient failure leaves
    // lastApplied unchanged so the next connect/foreground retries instead of
    // believing the device is subscribed when the server has no endpoint.
    const ok = await ensurePushSubscription();
    lastApplied = ok ? true : null;
    if (ok) clearRetry();
    else scheduleRetry(attempt); // self-heal a transient failure with backoff
  } else {
    clearRetry();
    await disablePush();
    lastApplied = false;
  }
}

let lastRevalidate = 0;
const REVALIDATE_THROTTLE_MS = 5 * 60_000;

/**
 * Re-assert the push subscription, throttled so it is cheap to call on every app
 * foreground and on a periodic timer. It re-registers a subscription the server
 * may have dropped (a 410-pruned endpoint, a wiped server) or the browser silently
 * rotated, which is how a device that quietly stopped receiving pushes heals
 * without the user touching settings. No-op while push is disabled/ungranted.
 */
export async function revalidatePushSubscription(): Promise<void> {
  const now = Date.now();
  if (now - lastRevalidate < REVALIDATE_THROTTLE_MS) return;
  lastRevalidate = now;
  await applyPushPreference(true);
}

/** Remove this device's push subscription (on sign-out). */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try {
        await unsubscribePushServer(sub.endpoint);
      } catch {
        /* server-side cleanup is best-effort */
      }
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}
