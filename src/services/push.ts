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
import { get, put, remove } from '@/db/idb';
import type { Setting } from '@/db/types';

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

/* ---- spec 1037: zombie-subscription self-healing. A push service can accept
 * sends (201) for a subscription the DEVICE no longer honors (observed live:
 * iOS revoked it after the old silent-wake bug, but the browser still returns
 * the object, so re-registering just re-registers the corpse). The signature
 * is detectable on-device: a message that sat queued a long time drained
 * normally, and no push wake ever happened after it was SENT. On that
 * signature, rotate: unsubscribe + fresh subscribe = a new endpoint. A merely
 * offline phone never matches — its held pushes arrive on reconnect and stamp
 * a fresh wake first. ---- */

const STALE_MSG_MS = 10 * 60 * 1000; // queued this long = should have woken us
const ROTATE_GRACE_MS = 60 * 1000; // let a racing held-push wake land first
const ROTATE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // thrash cap

export interface StaleMarker {
  at: number; // the stale message's SEND time
  recordedAt: number; // when the drain observed it
}

/** The pure rotation decision (unit-tested). */
export function shouldRotateForStaleness(args: {
  stale: StaleMarker | null;
  lastWakeAt: number;
  lastRotateAt: number;
  now: number;
}): boolean {
  const { stale, lastWakeAt, lastRotateAt, now } = args;
  if (!stale) return false;
  if (now - stale.recordedAt < ROTATE_GRACE_MS) return false;
  if (lastWakeAt >= stale.at) return false; // a wake since it was sent → not a zombie
  return now - lastRotateAt >= ROTATE_MIN_INTERVAL_MS;
}

/** Record that the drain received a message queued past the staleness bar —
 *  called by the receive path (db/queries); read + consumed here. Keeps the
 *  NEWEST stale send-time (the strongest evidence). */
export async function recordStaleDrain(sentAt: number): Promise<void> {
  const prev = await get<Setting<StaleMarker>>('settings', STALE_KEY);
  if (prev?.value && prev.value.at >= sentAt) return;
  await put<Setting<StaleMarker>>('settings', { key: STALE_KEY, value: { at: sentAt, recordedAt: Date.now() } });
}

const STALE_KEY = 'push.staleMsg';
const WAKE_KEY = 'push.lastWakeAt';
const ROTATED_KEY = 'push.lastRotateAt';

/* ---- One-time FORCED rotation (fleet heal). The silent-wake bug era left a
 * fleet of subscriptions that iOS quietly revoked or blackholed; the browser
 * still returns the corpse object, so devices re-register it forever and the
 * evidence-based signatures below can take days to accumulate. Bumping this
 * epoch forces every device to rotate to a fresh endpoint ONCE on its next
 * open — a rotation is cheap (the new endpoint simply replaces the old row),
 * so the cost of over-rotating healthy devices is nil. Bump when a bug is
 * known to have poisoned subscriptions fleet-wide. ---- */
// 1 = heal the 2026-07 silent-wake/zombie era. 2 = heal subscriptions revoked by
// the guard-gate regression (a stale on-screen notification wrongly suppressed
// the fallback → silent pushes) before that gate was fixed.
const ROTATE_EPOCH = 2;
const EPOCH_KEY = 'push.rotateEpoch';

/* ---- The WEAK zombie signature (iOS 16.x flavor). The strong signature above
 * needs one message queued ≥10 min — but a phone that's checked often drains
 * its queue in minutes, so a subscription the push service still ACCEPTS while
 * the device never SURFACES it can dodge that bar forever (observed live on an
 * iPhone 8 / iOS 16.7: Apple 201s every send, no banner, no SW wake, and the
 * server-side 400/403 pruning never fires because nothing errors). The weak
 * evidence: a drained message old enough that its push should have landed and
 * woken us (90s), with no wake since it was sent — once is normal (a blip, an
 * offline sender's backlog), but a STREAK of ≥3 separate drain sessions with
 * ZERO wakes in between is the frequently-checked-phone zombie. ---- */
const MISSED_WAKE_MIN_MS = 90 * 1000; // sent this long ago → its push should have woken us by now
const MISSED_WAKE_EPISODE_GAP_MS = 5 * 60 * 1000; // closer than this = the same drain session
const MISSED_WAKE_STREAK = 3;

export interface MissStreak {
  count: number; // distinct should-have-woken drain sessions since the last wake
  newestAt: number; // newest missed message's SEND time
}
const MISS_KEY = 'push.missedWakeStreak';

/** The pure weak-signature decision (unit-tested). */
export function shouldRotateForMissedWakes(args: {
  streak: MissStreak | null;
  lastWakeAt: number;
  lastRotateAt: number;
  now: number;
}): boolean {
  const { streak, lastWakeAt, lastRotateAt, now } = args;
  if (!streak || streak.count < MISSED_WAKE_STREAK) return false;
  if (lastWakeAt >= streak.newestAt) return false; // a wake since → push path is alive
  return now - lastRotateAt >= ROTATE_MIN_INTERVAL_MS;
}

/** Record a drained message that should have produced a push wake but didn't.
 *  Called by the receive path for every inbound; cheap early-outs make it a
 *  no-op for live traffic (fresh ts) and for genuine push wakes (the wake stamp
 *  lands first, invalidating the miss). One increment per drain session. */
export async function recordMissedWakeDrain(sentAt: number): Promise<void> {
  try {
    if (Date.now() - sentAt < MISSED_WAKE_MIN_MS) return; // live delivery — nothing owed
    const lastWakeAt = (await get<Setting<number>>('settings', WAKE_KEY))?.value ?? 0;
    if (lastWakeAt >= sentAt) return; // we DID wake since it was sent
    const prev = (await get<Setting<MissStreak>>('settings', MISS_KEY))?.value ?? null;
    // Same drain session (a batch of queued messages arriving together): count once.
    if (prev && lastWakeAt < prev.newestAt && sentAt - prev.newestAt < MISSED_WAKE_EPISODE_GAP_MS) return;
    // A wake between episodes proves the push path works → the streak restarts.
    const count = prev && lastWakeAt < prev.newestAt ? prev.count + 1 : 1;
    await put<Setting<MissStreak>>('settings', {
      key: MISS_KEY,
      value: { count, newestAt: Math.max(sentAt, prev?.newestAt ?? 0) },
    });
  } catch {
    /* best-effort evidence */
  }
}

/** Evaluate BOTH zombie signatures (strong: one ≥10-min-stale drain; weak: a
 *  streak of shorter should-have-woken drains); when either holds, clear the
 *  evidence + stamp the rotation and tell the caller to mint a fresh
 *  subscription. */
async function consumeRotationDecision(): Promise<boolean> {
  try {
    const stale = (await get<Setting<StaleMarker>>('settings', STALE_KEY))?.value ?? null;
    const streak = (await get<Setting<MissStreak>>('settings', MISS_KEY))?.value ?? null;
    if (!stale && !streak) return false;
    const lastWakeAt = (await get<Setting<number>>('settings', WAKE_KEY))?.value ?? 0;
    const lastRotateAt = (await get<Setting<number>>('settings', ROTATED_KEY))?.value ?? 0;
    const now = Date.now();
    const rotate =
      shouldRotateForStaleness({ stale, lastWakeAt, lastRotateAt, now }) ||
      shouldRotateForMissedWakes({ streak, lastWakeAt, lastRotateAt, now });
    if (!rotate) return false;
    await remove('settings', STALE_KEY);
    await remove('settings', MISS_KEY);
    await put<Setting<number>>('settings', { key: ROTATED_KEY, value: now });
    return true;
  } catch {
    return false;
  }
}

export { STALE_MSG_MS };

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
    // One-time epoch rotation (fleet heal): a device below the current epoch
    // rotates unconditionally — we KNOW its era of subscriptions was poisoned.
    if (sub) {
      const epoch = (await get<Setting<number>>('settings', EPOCH_KEY))?.value ?? 0;
      if (epoch < ROTATE_EPOCH) {
        console.warn('[push] rotate epoch bump — minting a fresh subscription');
        try {
          await sub.unsubscribe();
        } catch {
          /* ignore, we resubscribe below regardless */
        }
        sub = null;
      }
    }
    // (spec 1037) The zombie signature: long-queued messages drained with no
    // push wake since they were sent. Rotate to a fresh endpoint — the browser
    // object is not trustworthy evidence that the push service still delivers.
    if (sub && (await consumeRotationDecision())) {
      console.warn('[push] stale-drain signature — rotating the subscription');
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
      // Stamp the epoch only once a subscription is REGISTERED — a failure
      // anywhere above leaves the device below the epoch, so it retries the
      // forced rotation on the next open.
      await put<Setting<number>>('settings', { key: EPOCH_KEY, value: ROTATE_EPOCH });
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
      // Monochrome transparent silhouette: Android tints the badge by alpha, so a
      // full-colour square shows as a blank box. See the BADGE note in sw.ts.
      badge: '/badge-96.png',
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

/** Does this device currently hold an active Web Push subscription? When true, the
 *  server wakes the SW for a backgrounded delivery, so the PAGE must NOT also show
 *  its own OS notification for that delivery — doing so is the recently-backgrounded
 *  DOUBLE (rich from the page + the SW's generic). When false (no permission/endpoint),
 *  the page's notifyLocal bridge is the ONLY background channel and must still fire. */
export async function pushSubscriptionActive(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
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
