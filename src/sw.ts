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
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  previewPending, isNothingNew, markShown, unreadCount, ackCall, previewConnections, markConnShown,
  type SwNote, type ConnNote,
} from '@/services/sw-inbox';
import { resubscribePush } from '@/services/sw-push';
import { userFacing, prettify, displayVersion } from '@/services/release-notes';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

// App-shell precache (manifest injected at build time).
precacheAndRoute(self.__WB_MANIFEST);

// Reusable-asset runtime cache (spec 1017): a given animated emoji's Noto Lottie is immutable and
// served from our own first-party proxy, so cache-first it persistently across sessions — a repeat
// view never hits the network (and it animates offline). Bounded by count + age so it can't grow
// without limit; purged on quota pressure. (Same-session hits are served even faster by the
// in-memory cache in emoji-cache.ts.) Avatars are device-local `data:` URLs, so they need no
// runtime route here.
registerRoute(
  ({ url }) => url.pathname.startsWith('/v1/emoji/'),
  new CacheFirst({
    cacheName: 'emoji-lottie-v1',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 512,
        maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// Update model (pairs with registerType: 'prompt'): a freshly-installed worker
// WAITS instead of taking over, so the page keeps running the version the user is
// on until they accept the update toast (useAppUpdate). Accepting posts SKIP_WAITING
// (below), which activates the new worker and reloads. In dev we skip-wait
// immediately so HMR/reloads aren't left waiting behind a stale worker.
if (import.meta.env.DEV) {
  self.addEventListener('install', () => void self.skipWaiting());
}
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const ICON = '/pwa-192x192.png';
const GENERIC_TAG = 'ring-incoming';

// Slow-cold-start fallback timings (see showMessageNotification). GENERIC_AFTER_MS:
// how long to wait for a decrypted preview before posting the generic placeholder
// (a fresh worker must init libsodium WASM, and the /relay/pending fetch is bounded
// at PENDING_FETCH_TIMEOUT_MS in sw-inbox). SETTLE_MAX_MS: the outer bound we keep
// awaiting so a late preview can UPGRADE the generic and the fetch still lands
// ("delivered"). A *per-type* placeholder (Photo/Voice/Video...) is impossible here:
// the type lives inside the E2EE payload and the push tickle is content-free, so
// before decryption we cannot know it without the server knowing it (which would
// break E2EE). "New message" is the privacy-correct placeholder; the per-type
// preview (notify-preview.ts) appears only once decryption succeeds and upgrades it.
// GENERIC_AFTER_MS: how long to wait for a decrypted preview before posting the
// generic placeholder. SETTLE_MAX_MS: the outer window we keep awaiting so a late
// preview UPGRADES that placeholder. SETTLE_MAX_MS must COMFORTABLY EXCEED
// sw-inbox's PENDING_FETCH_TIMEOUT_MS (8000) — otherwise a decrypt that lands late
// in the fetch budget (≥ GENERIC_AFTER_MS but the fetch only resolves near 8s) was
// stranded as a permanent generic because the settle window closed before it could
// upgrade (spec 2010 root-cause b). 12000 > 8000 leaves headroom for the decrypt +
// the closeByTag/showNotes upgrade after the fetch resolves.
const GENERIC_AFTER_MS = 7000;
const SETTLE_MAX_MS = 12000;
// Straggler catch-up after the first preview. In the background the page is
// suspended, so a queued message only earns its 'delivered' receipt when the SW
// fetches the pending queue (the server emits 'delivered' for every queued frame on
// each fetch). A rapid burst queues more frames AFTER our first fetch, and the
// collapsible push may not wake the SW again, so without this the burst's tail stays
// 'sent' until the app is reopened. Keep re-fetching for a bounded window so the
// whole burst earns receipts (and late messages get previewed) within one wake.
const STRAGGLER_WINDOW_MS = 9000;
const STRAGGLER_INTERVAL_MS = 4500;

// (spec 2014) The dev deployment (ring-dev / localhost) surfaces the generic-fallback REASON in the
// notification for on-device diagnosis; production (same build) never shows internal reason text.
const DEV_HOST = /(^|\.)ring-dev\./.test(self.location.hostname) || self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

async function showGeneric(reason?: string): Promise<void> {
  // (spec 2014 US1) Title is the STATUS, not the literal app name: iOS already shows "Ring" as its
  // forced app-name header, so titling this "Ring" too rendered the app name twice
  // ("Ring › Ring › New message"). (US2) On the dev host only, the body carries why we fell back to
  // generic so the "generic after a while" cause can be confirmed on a real device.
  await self.registration.showNotification('New message', {
    body: DEV_HOST && reason ? reason : 'Tap to open',
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
    renotify: true, // each repeated ring push re-alerts (a single updating notification)
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

// (spec 2016) Honor the Web Push userVisibleOnly per-push contract on a "nothing new" wake WITHOUT
// adding a noisy new "New message" banner. If a notification is already showing (e.g. the rich content
// note a prior push displayed for this same burst), re-show it on its own tag with renotify:false +
// silent — iOS sees a showNotification call but the user gets no new alert. If nothing is showing,
// show nothing: the mute / badge-only (`silenced`) path already returns from a push without any
// showNotification in production, so this is an established, iOS-tolerated outcome. Best-effort.
// Tags we must NOT re-assert: a live call ring ('ring-call') carries requireInteraction and re-showing
// it on its tag would strip that and downgrade the ring (spec 2016 review); the others belong to other
// push categories and re-surfacing them for a message wake is wrong. Only a MESSAGE notification (the
// content note this burst already showed, or the generic) is safe to re-assert silently.
const NON_MESSAGE_TAGS = new Set(['ring-call', 'ring:version', 'ring:post', 'ring:conn:req']);
async function reassertForContract(): Promise<void> {
  try {
    const list = await self.registration.getNotifications();
    const n = list.find((x) => !NON_MESSAGE_TAGS.has(x.tag));
    if (!n) return; // nothing safe to re-assert → show nothing (mirrors the badge-only/silenced path)
    await self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag, // same tag → updates the existing notification in place, no second banner
      data: n.data,
      icon: n.icon,
      badge: n.badge,
      requireInteraction: n.requireInteraction, // preserve the original's semantics defensively
      renotify: false, // update silently — do NOT re-alert
      silent: true,
    });
  } catch {
    /* ignore — re-assert is best-effort; the badge below still updates */
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

/** Decode the content-free tickle's frame type ('call' shows a ring, 'conn' is a
 *  friend-request lifecycle event; anything else, including an unreadable/absent
 *  payload, is treated as a message). */
function pushKind(event: PushEvent): 'call' | 'msg' | 'conn' | 'post' | 'version' {
  try {
    const data = event.data?.json() as { t?: string } | undefined;
    if (data?.t === 'call') return 'call';
    if (data?.t === 'conn') return 'conn';
    if (data?.t === 'post') return 'post';
    if (data?.t === 'version') return 'version';
  } catch {
    /* not JSON → treat as a message */
  }
  return 'msg';
}

/** "What's new" notification after a new version is deployed. The version tickle is
 *  content-free; the actual (public, non-secret) version + user-friendly notes come
 *  from GET /v1/config, so nothing about the release rode through the push service.
 *  Shown only when the app is fully closed; an open app gets the in-app update toast. */
async function showVersionNotification(): Promise<void> {
  let version = '';
  let notes: { sha: string; subject: string }[] = [];
  try {
    const cfg = (await fetch('/v1/config', { cache: 'no-store' }).then((r) => r.json())) as {
      version?: string;
      notes?: { sha: string; subject: string }[];
    };
    version = cfg.version ?? '';
    notes = cfg.notes ?? [];
  } catch {
    /* offline / unreachable → a generic announcement below still honors userVisibleOnly */
  }
  const friendly = userFacing(notes);
  const items = friendly.slice(0, 3).map((n) => prettify(n.subject));
  const shown = displayVersion(version);
  const title = shown ? `Ring ${shown} is here` : 'Ring just got an update';
  const body = items.length
    ? `What's new: ${items.join(' · ')}${friendly.length > items.length ? ' …' : ''}`
    : 'Tap to update and see what’s new.';
  await self.registration.showNotification(title, {
    body,
    icon: ICON,
    badge: ICON,
    tag: 'ring:version',
    data: { url: '/' },
  });
}

/** Generic, identity-safe notification for Wall activity — a new post OR engagement
 *  (reaction/comment), which share the one content-free post tickle. Shown only when the
 *  app is closed; a live page shows the rich in-app banner / live update via the WS
 *  frame, so the SW stays silent there to avoid a duplicate. "Activity" rather than
 *  "post" so it reads honestly for a reaction/comment too. */
async function showPostNotification(): Promise<void> {
  await self.registration.showNotification('Ring', {
    body: 'New activity on your Wall',
    icon: ICON,
    badge: ICON,
    tag: 'ring:post',
    data: { url: '/tabs/wall' },
  });
}

/** Show the generic friend-request notifications (identity-safe; no decryption). */
async function showConnNotes(notes: ConnNote[]): Promise<void> {
  for (const n of notes) {
    try {
      await self.registration.showNotification(n.title, {
        body: n.body,
        icon: ICON,
        badge: ICON,
        tag: n.tag,
        renotify: true,
        data: { url: n.url },
      });
    } catch (e) {
      console.warn('[sw] conn showNotification failed', e);
    }
  }
}

/**
 * Handle a friend-request (conn) push: reconcile connection state and show a
 * generic, identity-safe notification for any NEW request/accept/reject. The conn
 * tickle carries no identity and needs no decryption, so this works even while the
 * device is PIN-locked. Always shows at least a generic placeholder to honor the
 * userVisibleOnly contract when something is pending but can't be reconciled.
 */
async function showConnNotification(): Promise<void> {
  let notes: ConnNote[] = [];
  try {
    notes = await previewConnections();
  } catch {
    /* fall through to the placeholder below */
  }
  if (notes.length) {
    await showConnNotes(notes);
    await markConnShown(notes.flatMap((n) => n.keys));
    return;
  }
  // Couldn't reconcile (offline / already-seen) but a tickle implies activity →
  // a single generic placeholder keeps the userVisibleOnly contract.
  await self.registration.showNotification('Ring', {
    body: 'New friend request',
    icon: ICON,
    badge: ICON,
    tag: 'ring:conn:req',
    data: { url: '/tabs/contacts' },
  });
}

/**
 * Handle a message push: fetch + decrypt the queue for a rich preview, racing a
 * timeout so a slow cold start (libsodium WASM init in a fresh worker) still posts
 * *some* notification (iOS requires one per push). A generic placeholder shown on
 * timeout is UPGRADED to the rich preview when the full decrypt settles.
 */
async function showMessageNotification(): Promise<void> {
  const preview = previewPending(); // started once; awaited twice (race, then settle)
  let result: Awaited<ReturnType<typeof previewPending>> = { notes: [], pending: 0, suppressed: false, silenced: false, newUnshown: false };
  let timedOut = false; // spec 2014: distinguish a slow cold start from a fetched-but-undecryptable result
  try {
    result = await Promise.race([
      preview,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('preview-timeout')), GENERIC_AFTER_MS)),
    ]);
  } catch {
    timedOut = true;
    console.warn('[sw] preview slow/failed → generic fallback');
  }

  let shownGeneric = false;
  if (result.notes.length) {
    await closeByTag(GENERIC_TAG); // clear any earlier generic before the rich note
    await showNotes(result.notes);
    await markShown(allIds(result.notes)); // only mark what we displayed
  } else if (timedOut || (!result.suppressed && !result.silenced && result.newUnshown)) {
    // Show the generic placeholder ONLY when there's a genuinely-new message we couldn't render: a
    // slow cold-start decrypt still in flight at the deadline (timedOut), a fetched-but-undecryptable
    // frame, a PIN-locked device with pending frames, or a failed relay fetch (all → newUnshown). The
    // settle below upgrades it to the rich note if the decrypt lands. `suppressed` (notifications off)
    // and `silenced` (mute / web-push-off / badge-only, spec 1015 FR-022/FR-024) show no placeholder.
    await showGeneric(timedOut ? 'timeout' : result.reason);
    shownGeneric = true;
  } else if (isNothingNew(result)) {
    // (spec 2016) Nothing genuinely new to announce — the relay queue was empty (`no-frames`) or every
    // fetched frame was already shown (the burst straggler beat us). Showing a generic here is pure
    // noise (the "New message / Tap to open" the user reported). Honor the per-push contract the way
    // the `silenced` path already does: re-assert an already-showing notification silently (no new
    // banner/sound) if one exists, otherwise show nothing. The badge below still stays accurate.
    await reassertForContract();
  }

  // Settle the full preview (bounded) so its /relay/pending fetch lands (→ delivery)
  // even after a generic fallback, we learn the accurate backlog for the badge, and
  // a late-arriving rich preview replaces the generic placeholder.
  let pending = result.pending;
  try {
    const full = await Promise.race([
      preview,
      new Promise<typeof result>((resolve) => setTimeout(() => resolve(result), SETTLE_MAX_MS)),
    ]);
    pending = full.pending || pending;
    if (shownGeneric && full.notes.length) {
      await closeByTag(GENERIC_TAG); // upgrade: drop the placeholder…
      await showNotes(full.notes); // …show the real sender + text…
      await markShown(allIds(full.notes)); // …and don't re-preview them next push
    } else if (shownGeneric && full.silenced) {
      // A SLOW cold start showed the generic before the decrypt settled; the settled
      // result says every pending message was per-chat silenced → drop the placeholder
      // so badge-only / web-push-off / mute is honored even on a slow wake. The badge
      // below still counts them (pending), since `silenced` never sets `suppressed`.
      await closeByTag(GENERIC_TAG);
    }
  } catch {
    /* ignore */
  }

  // Badge = on-device unread (added inside updateAppBadge) + the undelivered backlog
  // we actually learned from the fetch. When the fetch failed/timed out, pending is
  // 0 and we badge from the stored unread alone rather than inventing a "+1" that
  // teaches a wrong count. A suppressed (notifications-off) push adds nothing.
  await updateAppBadge(result.suppressed ? 0 : pending);

  // Catch stragglers from a rapid burst (see STRAGGLER_WINDOW_MS): re-fetch the
  // pending queue a few times within this wake so messages that arrived after the
  // first fetch still earn their 'delivered' receipt (and get previewed) without the
  // recipient having to reopen the app. Each fetch re-emits 'delivered' for all
  // still-queued frames (idempotent); newly-decryptable notes are shown once.
  const deadline = Date.now() + STRAGGLER_WINDOW_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, STRAGGLER_INTERVAL_MS));
    let more: Awaited<ReturnType<typeof previewPending>>;
    try {
      more = await previewPending();
    } catch {
      break;
    }
    if (more.notes.length) {
      await closeByTag(GENERIC_TAG);
      await showNotes(more.notes);
      await markShown(allIds(more.notes));
      await updateAppBadge(more.suppressed ? 0 : more.pending);
    }
  }
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
  // The update toast (useAppUpdate -> updateServiceWorker) posts this when the user
  // accepts a new version: activate now so the controllerchange reload loads it.
  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
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
      const kind = pushKind(event);
      if (kind === 'call') {
        // A call is never queued on the relay; the tickle itself is the signal.
        // Show the ring immediately, ack reachability (so the caller's UI flips to
        // "Ringing"), and nudge any device to reconnect so the live call-offer
        // (buffered briefly server-side) flushes and rings in-app.
        await showCall();
        void ackCall();
        for (const client of clients) client.postMessage({ type: 'ring:drain' });
        return;
      }
      if (kind === 'conn') {
        // Friend-request lifecycle. A live page owns the alert (it gets the
        // connect-req / connect-update WS frame and notifies via useSync), so the
        // SW only notifies when the app is fully CLOSED (no client to claim it),
        // avoiding a duplicate. Still nudge any live client to reconcile its lists.
        for (const client of clients) client.postMessage({ type: 'ring:conn' });
        if (!clients.length) await showConnNotification();
        return;
      }
      if (kind === 'post') {
        // New Wall post. A live page owns the rich in-app banner (post-new WS frame
        // via useSync), so the SW shows a generic notification only when the app is
        // fully CLOSED. Nudge any live client to pull the post.
        for (const client of clients) client.postMessage({ type: 'ring:posts' });
        if (!clients.length) await showPostNotification();
        return;
      }
      if (kind === 'version') {
        // A new app version was deployed. A live page owns the alert (useAppUpdate
        // shows the in-app "what's new" update toast), so nudge any open client to
        // check immediately and show the system "what's new" notification only when
        // the app is fully CLOSED — mirroring the post/conn pattern and keeping the
        // userVisibleOnly contract (exactly one visible notification when closed).
        for (const client of clients) client.postMessage({ type: 'ring:checkupdate' });
        if (!clients.length) await showVersionNotification();
        return;
      }
      // Let a live, unlocked page own the notification (avoids a duplicate); the SW
      // shows it only when no page claims it within the window (closed/locked/frozen).
      // The page now acks only once it ACTUALLY renders an in-app banner (spec 2010),
      // which can trail a cold reconnect+decrypt, so wait a touch longer than the old
      // 1200ms — comfortably above the page's own DRAIN_ACK_WINDOW so a page that will
      // show a banner reliably claims it, while a hidden/locked/frozen page (which
      // never acks) still falls through to the SW promptly enough.
      if (clients.length && (await pageWillNotify(clients, 2200))) return;
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
