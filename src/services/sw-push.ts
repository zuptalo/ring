/**
 * Service-worker-safe Web Push (re)subscription.
 *
 * The page normally manages the subscription (services/push.ts), but a browser can
 * rotate or revoke a push subscription on its own while the app is CLOSED, firing
 * a `pushsubscriptionchange` event in the service worker. If nothing re-registers
 * the new endpoint, the device silently stops receiving pushes until the user
 * happens to reopen the app. This module re-subscribes and re-registers from inside
 * the worker so delivery self-heals.
 *
 * Import-clean for the SW: only idb + fetch. The VAPID key comes from the public
 * /v1/config endpoint; the bearer token from the IDB-mirrored session.
 */
import { readSessionToken } from './session';

const API = `${import.meta.env.VITE_API_URL ?? ''}/v1`;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API}/config`); // public, no auth
    if (!res.ok) return null;
    const { vapidPublicKey } = (await res.json()) as { vapidPublicKey?: string };
    return vapidPublicKey || null;
  } catch {
    return null;
  }
}

async function registerSub(sub: PushSubscription): Promise<boolean> {
  const token = await readSessionToken();
  if (!token) return false;
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return false;
  try {
    const res = await fetch(`${API}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh, auth } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function unregisterEndpoint(endpoint: string): Promise<void> {
  const token = await readSessionToken();
  if (!token) return;
  try {
    await fetch(`${API}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    /* best effort */
  }
}

/**
 * Handle a browser-initiated subscription rotation/expiry from inside the SW:
 * re-subscribe (reusing the provided newSubscription when present) and register the
 * new endpoint with the backend, pruning the old one. Best-effort and idempotent.
 */
export async function resubscribePush(
  registration: ServiceWorkerRegistration,
  oldSub?: PushSubscription | null,
  newSub?: PushSubscription | null,
): Promise<void> {
  let sub = newSub ?? (await registration.pushManager.getSubscription());
  if (!sub) {
    const key = await fetchVapidKey();
    if (!key) return;
    try {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
      });
    } catch (e) {
      console.warn('[sw-push] resubscribe failed', e);
      return;
    }
  }
  await registerSub(sub);
  if (oldSub?.endpoint && oldSub.endpoint !== sub.endpoint) {
    await unregisterEndpoint(oldSub.endpoint);
  }
}
