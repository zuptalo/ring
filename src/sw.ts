/// <reference lib="webworker" />
/**
 * Custom service worker (vite-plugin-pwa `injectManifest`). Keeps the app-shell
 * precaching and adds Web Push handling.
 *
 * Push is a content-free "tickle" (zero-knowledge): only the frame TYPE
 * (`{"t":"msg"}` | `{"t":"call"}`) flows through Apple/Google. For a message and
 * auto-unlock on, the SW fetches the queued E2EE frames over the relay and
 * decrypts them READ-ONLY to show a rich preview (sender + text); the message
 * bytes never touch the push service. A call tickle shows an "Incoming call" alert
 * immediately and nudges the page to reconnect for the live ring. If a PIN/passkey
 * lock is set (no device key), the SW can't decrypt and shows a generic message.
 *
 * Every push results in exactly one user-visible notification (Web Push's
 * `userVisibleOnly` contract): the focused/connected page also drains for real and
 * dismisses stale notifications when it foregrounds (useAppBadge), and consistent
 * per-chat tags collapse the page- and SW-shown notes so there's never a duplicate.
 */
import { precacheAndRoute } from 'workbox-precaching';
import { previewPending, markShown, unreadCount, type SwNote } from '@/services/sw-inbox';
import { resubscribePush } from '@/services/sw-push';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

// App-shell precache (manifest injected at build time).
precacheAndRoute(self.__WB_MANIFEST);

// Take control promptly (pairs with registerType: 'autoUpdate').
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const ICON = '/pwa-192x192.png';
const GENERIC_TAG = 'ring-incoming';

async function showGeneric(): Promise<void> {
  await self.registration.showNotification('Ring', {
    body: 'New message',
    icon: ICON,
    badge: ICON,
    tag: GENERIC_TAG,
    data: { url: '/tabs/chats' },
  });
}

async function showCall(): Promise<void> {
  await self.registration.showNotification('Incoming call', {
    body: 'Tap to answer',
    icon: ICON,
    badge: ICON,
    tag: 'ring-call',
    requireInteraction: true, // a ring shouldn't auto-dismiss before it's seen
    data: { url: '/tabs/chats' },
  });
}

/** Show the decrypted rich notes (one updating notification per conversation). */
async function showNotes(notes: SwNote[]): Promise<void> {
  for (const n of notes) {
    try {
      await self.registration.showNotification(n.title, {
        body: n.body,
        icon: ICON,
        badge: ICON,
        tag: n.tag,
        renotify: true, // a same-tag follow-up should re-alert, not update silently
        data: { url: n.url },
      });
    } catch (e) {
      console.warn('[sw] showNotification failed', e);
    }
  }
}

/** Close any lingering notifications with a given tag (used to clear the generic
 *  placeholder once a richer preview is ready, since different tags don't auto-replace). */
async function closeByTag(tag: string): Promise<void> {
  try {
    const list = await self.registration.getNotifications({ tag });
    for (const n of list) n.close();
  } catch {
    /* ignore */
  }
}

const allIds = (notes: SwNote[]): string[] => notes.flatMap((n) => n.ids);

// Set the app-icon badge to the unread total. The new message isn't persisted yet
// (read-only SW), so we add the count of notifications we're showing on top of the
// already-stored unread count. `newCount` is the fresh-notification count.
async function updateAppBadge(newCount: number): Promise<void> {
  try {
    const nav = self.navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> };
    if (!nav.setAppBadge) {
      // setAppBadge in the SERVICE-WORKER context only exists on newer iOS (≈17+).
      // On older iOS (e.g. iPhone 8 / iOS 16) it's absent, so a fully-closed app
      // can't be badged here, the page badges it instead on next open/foreground.
      console.warn('[sw] setAppBadge unavailable in SW (older iOS?), page will badge on open');
      return;
    }
    const total = (await unreadCount()) + newCount;
    if (total > 0) await nav.setAppBadge(total);
    console.info('[sw] setAppBadge', total);
  } catch (e) {
    console.warn('[sw] setAppBadge failed', e);
  }
}

/** Decode the content-free tickle's frame type ('call' shows a ring; anything
 *  else, including an unreadable/absent payload, is treated as a message). */
function pushKind(event: PushEvent): 'call' | 'msg' {
  try {
    const data = event.data?.json() as { t?: string } | undefined;
    if (data?.t === 'call') return 'call';
  } catch {
    /* not JSON → treat as a message */
  }
  return 'msg';
}

/**
 * Handle a message push: fetch + decrypt the queue for a rich preview, racing a
 * timeout so a slow cold start (libsodium WASM init in a fresh worker) still posts
 * *some* notification (iOS requires one per push). A generic placeholder shown on
 * timeout is UPGRADED to the rich preview when the full decrypt settles.
 */
async function showMessageNotification(): Promise<void> {
  const preview = previewPending(); // started once; awaited twice (race, then settle)
  let result: Awaited<ReturnType<typeof previewPending>> = { notes: [], pending: 0, suppressed: false };
  try {
    result = await Promise.race([
      preview,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('preview-timeout')), 6000)),
    ]);
  } catch {
    console.warn('[sw] preview slow/failed → generic fallback');
  }

  let shownGeneric = false;
  if (result.notes.length) {
    await closeByTag(GENERIC_TAG); // clear any earlier generic before the rich note
    await showNotes(result.notes);
    await markShown(allIds(result.notes)); // only mark what we displayed
  } else if (!result.suppressed) {
    // Nothing decryptable yet (cold start / PIN-locked) and the user didn't disable
    // message notifications → keep the userVisibleOnly contract with a placeholder.
    await showGeneric();
    shownGeneric = true;
  }

  // Settle the full preview (bounded) so its /relay/pending fetch lands (→ delivery)
  // even after a generic fallback, we learn the accurate backlog for the badge, and
  // a late-arriving rich preview replaces the generic placeholder.
  let pending = result.pending;
  try {
    const full = await Promise.race([
      preview,
      new Promise<typeof result>((resolve) => setTimeout(() => resolve(result), 9000)),
    ]);
    pending = full.pending || pending;
    if (shownGeneric && full.notes.length) {
      await closeByTag(GENERIC_TAG); // upgrade: drop the placeholder…
      await showNotes(full.notes); // …show the real sender + text…
      await markShown(allIds(full.notes)); // …and don't re-preview them next push
    }
  } catch {
    /* ignore */
  }

  // Badge = on-device unread + the undelivered backlog (updateAppBadge adds the
  // unread part). Falls back to 1 only when we showed something but never learned
  // the backlog; a suppressed (notifications-off) push adds nothing.
  await updateAppBadge(pending || result.notes.length || (result.suppressed ? 0 : 1));
}

// ---- page-ack duplicate suppression ----
//
// A live, UNLOCKED page that receives ring:drain owns the user-facing alert for an
// incoming message (an in-app banner when visible, or an OS notification via
// notifyLocal when hidden), so it replies `ring:handled` and the SW SUPPRESSES its
// own notification, so no double announce. Every no-reply case still shows the SW's
// notification, so the Web Push `userVisibleOnly` contract always holds:
//   - app fully closed        → no client to ask → SW shows it.
//   - page PIN/passkey-locked → notify.ts stays silent, so the page must NOT ack →
//                               SW shows it (generic; it can't decrypt either).
//   - frozen/suspended tab    → JS can't reply within the window → SW shows it.
let ackSeq = 0;
const pendingAcks = new Map<string, () => void>();

self.addEventListener('message', (event) => {
  const data = (event.data ?? {}) as { type?: string; reqId?: string };
  if (data.type === 'ring:handled' && data.reqId) {
    const resolve = pendingAcks.get(data.reqId);
    if (resolve) {
      pendingAcks.delete(data.reqId);
      resolve();
    }
  }
});

/** Nudge every client to reconnect + drain (real persistence) and wait briefly for
 *  an unlocked page to CLAIM the notification. Resolves true if a page acked (the SW
 *  should stay silent), false on timeout (the SW must show the notification). */
async function pageWillNotify(clients: readonly Client[], timeoutMs: number): Promise<boolean> {
  const reqId = `${Date.now()}:${ackSeq++}`;
  let acked = false;
  const settled = new Promise<void>((resolve) => {
    pendingAcks.set(reqId, () => {
      acked = true;
      resolve();
    });
    setTimeout(resolve, timeoutMs);
  });
  for (const client of clients) client.postMessage({ type: 'ring:drain', reqId });
  await settled;
  pendingAcks.delete(reqId);
  return acked;
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (pushKind(event) === 'call') {
        // A call is never queued on the relay; the tickle itself is the signal.
        // Show the ring immediately and nudge any device to reconnect so the live
        // call-offer (buffered briefly server-side) flushes and rings in-app.
        await showCall();
        for (const client of clients) client.postMessage({ type: 'ring:drain' });
        return;
      }
      // Let a live, unlocked page own the notification (avoids a duplicate); the SW
      // shows it only when no page claims it within the window (closed/locked/frozen).
      if (clients.length && (await pageWillNotify(clients, 1200))) return;
      await showMessageNotification();
    })(),
  );
});

// Browser-initiated subscription rotation/expiry while the app is closed: re-
// subscribe and re-register so pushes don't silently stop. (iOS Safari fires this
// unreliably, so the page also force-re-subscribes on connect; this covers the
// closed-app case other platforms handle here.)
self.addEventListener('pushsubscriptionchange', ((
  event: ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null },
) => {
  event.waitUntil(resubscribePush(self.registration, event.oldSubscription, event.newSubscription));
}) as EventListener);

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          // Ask the live app to route (to the deep-link, or to the most relevant
          // tab when the push was content-free and carried no url).
          client.postMessage({ type: 'ring:navigate', url: data.url });
          return client.focus();
        }
      }
      // No window open → cold start at the deep-link (or the app root).
      return self.clients.openWindow(data.url || '/');
    })(),
  );
});
