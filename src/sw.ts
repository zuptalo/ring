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
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  previewPending, isNothingNew, markShown, unreadCount, ackCall, previewConnections, previewPosts, markConnShown,
  coalesceForShow, loadShownSummary, setting,
  type SwNote, type ConnNote,
} from '@/services/sw-inbox';
import { resubscribePush } from '@/services/sw-push';
import { setPendingNav } from '@/services/pending-nav';
import { userFacing, prettify, displayVersion } from '@/services/release-notes';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

// App-shell precache (manifest injected at build time).
precacheAndRoute(self.__WB_MANIFEST);

// SPA app-shell navigation fallback: serve the precached index.html for ALL page
// navigations (any deep link), so a cold start — notably tapping a push notification,
// which opens the app at /chat/<id> — loads instantly FROM CACHE instead of fetching
// the document over the network. On iOS that first cold network request often fails
// with "the network connection was lost" (NSURLErrorNetworkConnectionLost), which is
// the "Safari can't open the page" interstitial users hit on notification taps. The
// SPA router then resolves the deep link client-side. API/relay/WS/blob paths are
// denylisted so only document navigations are served the shell. Dev is served by Vite
// (index.html isn't precached there), so this is production-only.
if (!import.meta.env.DEV) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('/index.html'), {
      denylist: [/^\/v1\//, /^\/healthz\b/, /^\/relay\//],
    }),
  );
}

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
// Android masks the notification BADGE (the small status-bar icon) by its alpha and
// tints it with the system accent colour. A full-colour square (the old value) has no
// transparency, so it renders as a solid blank box on many Android builds. `badge-96`
// is a flat white shield silhouette on a transparent background — the correct format.
// (iOS/desktop ignore `badge`; they only use `icon`, which stays the full-colour app icon.)
const BADGE = '/badge-96.png';
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
    badge: BADGE,
    tag: GENERIC_TAG,
    data: { url: '/tabs/chats' },
  });
}

async function showCall(): Promise<void> {
  await self.registration.showNotification('Incoming call', {
    body: 'Tap to answer',
    icon: ICON,
    badge: BADGE,
    tag: 'ring-call',
    renotify: true, // each repeated ring push re-alerts (a single updating notification)
    requireInteraction: true, // a ring shouldn't auto-dismiss before it's seen
    data: { url: '/tabs/chats' },
  });
}

/** Format a note's title with its count, e.g. "Alice (3)". The count is the CUMULATIVE per-chat total
 *  (spec 2017), not this pass's slice, so a burst shows one monotonic count. */
const titleWithCount = (n: SwNote): string => {
  const k = n.count ?? n.ids.length;
  return k > 1 ? `${n.title} (${k})` : n.title;
};

/** Show the decrypted rich notes (one updating notification per conversation). Coalesces each note
 *  against the persisted per-chat summary first (spec 2017) so the title count is the cumulative
 *  backlog and overlapping burst wakes converge on ONE notification instead of a jumpy/duplicate pile.
 *  Callers run this inside the serialize lock so the summary read→write can't interleave. */
async function showNotes(notes: SwNote[]): Promise<void> {
  const coalesced = await coalesceForShow(notes, Date.now());
  for (const n of coalesced) {
    try {
      await self.registration.showNotification(titleWithCount(n), {
        body: n.body,
        icon: ICON,
        badge: BADGE,
        tag: n.tag,
        renotify: true, // a genuinely-new message on this tag should re-alert (a silent re-assert
        // for "nothing new" uses reassertFromSummary below, which sets renotify:false)
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
// (spec 2017) Serialize ALL notification work across overlapping push wakes + straggler iterations.
// The server fires one push per message, so a burst wakes the SW several times concurrently; without a
// lock each wake (and each straggler iteration) independently reads the shown-ledger, decrypts, and
// re-shows — producing the duplicate notification and the bouncing per-pass count the user saw. One
// global chain makes each read→show→markShown atomic, so the first wake owns the burst (its straggler
// catches the late frames) and later wakes find everything shown → they re-assert silently, no dup.
let notifyChain: Promise<void> = Promise.resolve();
function serializeNotify<T>(fn: () => Promise<T>): Promise<T> {
  const run = notifyChain.then(fn, fn);
  notifyChain = run.then(() => undefined, () => undefined); // never let a rejection break the chain
  return run as Promise<T>;
}

/**
 * (spec 2017) Honor the per-push notification contract on a "nothing new" wake by re-asserting the ONE
 * authoritative coalesced notification from the persisted per-chat summary — silently (renotify:false),
 * so iOS sees a showNotification call (no own-summary gap) and the user gets no new alert. Drives off
 * the summary rather than getNotifications() (which is racy/empty on iOS during a burst). Only the
 * freshest summary entry within the burst TTL is re-asserted, so a chat read a while ago isn't
 * resurrected; if there's no fresh summary, shows nothing (the mute/badge-only outcome). Also closes a
 * stranded generic placeholder, since a real per-chat notification supersedes it.
 */
async function reassertFromSummary(): Promise<void> {
  try {
    const list = await loadShownSummary(); // already TTL-filtered
    if (!list.length) return; // nothing to re-assert → show nothing (mirrors the badge-only path)
    const n = list.reduce((a, b) => (b.ts > a.ts ? b : a)); // freshest
    const k = n.ids.length;
    await self.registration.showNotification(k > 1 ? `${n.title} (${k})` : n.title, {
      body: n.body,
      icon: ICON,
      badge: BADGE,
      tag: n.tag, // same tag → updates in place, no second banner
      renotify: false, // silent re-assert — do NOT re-alert
      silent: true,
      data: { url: n.url },
    });
    await closeByTag(GENERIC_TAG); // a real per-chat notification supersedes any stranded placeholder
  } catch {
    /* ignore — re-assert is best-effort; the badge still updates */
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
    badge: BADGE,
    tag: 'ring:version',
    data: { url: '/' },
  });
}

/** Generic, identity-safe notification for Wall activity — a new post OR engagement
 *  (reaction/comment), which share the one content-free post tickle. Shown only when the
 *  app is closed; a live page shows the rich in-app banner / live update via the WS
 *  frame, so the SW stays silent there to avoid a duplicate. "Activity" rather than
 *  "post" so it reads honestly for a reaction/comment too. */
async function showPostNotification(): Promise<number> {
  let notes: ConnNote[] = [];
  let newCount = 0;
  try {
    const r = await previewPosts();
    notes = r.notes;
    newCount = r.newCount;
  } catch {
    /* fall through to the generic placeholder */
  }
  if (notes.length) {
    // notes carry "<author> · posted on their Wall"; reuse the conn-note renderer (same shape).
    await showConnNotes(notes);
    return newCount;
  }
  await self.registration.showNotification('Ring', {
    body: 'New activity on your Wall',
    icon: ICON,
    badge: BADGE,
    tag: 'ring:post',
    data: { url: '/tabs/wall' },
  });
  return newCount;
}

/** Show the generic friend-request notifications (identity-safe; no decryption). */
async function showConnNotes(notes: ConnNote[]): Promise<void> {
  for (const n of notes) {
    try {
      await self.registration.showNotification(n.title, {
        body: n.body,
        icon: ICON,
        badge: BADGE,
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
async function showConnNotification(): Promise<number> {
  let notes: ConnNote[] = [];
  let pendingIncoming = 0;
  try {
    const r = await previewConnections();
    notes = r.notes;
    pendingIncoming = r.pendingIncoming;
  } catch {
    /* fall through to the placeholder below */
  }
  if (notes.length) {
    await showConnNotes(notes);
    await markConnShown(notes.flatMap((n) => n.keys));
    return pendingIncoming;
  }
  // Couldn't reconcile (offline / already-seen) but a tickle implies activity →
  // a single generic placeholder keeps the userVisibleOnly contract.
  await self.registration.showNotification('New friend request', {
    body: 'Tap to review',
    icon: ICON,
    badge: BADGE,
    tag: 'ring:conn:req',
    data: { url: '/tabs/contacts' },
  });
  return pendingIncoming;
}

/**
 * Handle a message push: fetch + decrypt the queue for a rich preview, racing a
 * timeout so a slow cold start (libsodium WASM init in a fresh worker) still posts
 * *some* notification (iOS requires one per push). A generic placeholder shown on
 * timeout is UPGRADED to the rich preview when the full decrypt settles.
 */
async function showMessageNotification(): Promise<void> {
  // (spec 2017) Serialize only the critical read→show→markShown sections (NOT the straggler's sleeps),
  // so overlapping burst wakes can't interleave and duplicate a notification or bounce the per-pass
  // count — while a queued wake still gets the lock during another wake's sleep gaps and is never
  // starved past iOS's per-push budget. The first wake's straggler catches the burst's late frames;
  // later wakes find everything shown and re-assert silently. Delivery receipts are unaffected.
  await serializeNotify(async () => {
  const preview = previewPending(); // started once; awaited twice (race, then settle)
  let result: Awaited<ReturnType<typeof previewPending>> = { notes: [], pending: 0, badgePending: 0, suppressed: false, silenced: false, newUnshown: false };
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
    // (spec 2016/2017) Nothing genuinely new — the relay queue was empty (`no-frames`) or every frame
    // was already shown (a burst wake the first wake beat). A new generic here is pure noise. Re-assert
    // the ONE authoritative coalesced notification from the persisted summary silently (spec 2017), so
    // iOS sees a showNotification call (no own-summary gap) without a new alert; shows nothing only when
    // there's no fresh summary (the mute/badge-only outcome). The badge below still stays accurate.
    await reassertFromSummary();
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
  await updateAppBadge(result.suppressed ? 0 : result.badgePending);
  }); // end the initial serialized section (release the lock before the straggler sleeps)

  // Catch stragglers from a rapid burst (see STRAGGLER_WINDOW_MS): re-fetch the
  // pending queue a few times within this wake so messages that arrived after the
  // first fetch still earn their 'delivered' receipt (and get previewed) without the
  // recipient having to reopen the app. Each fetch re-emits 'delivered' for all
  // still-queued frames (idempotent); newly-decryptable notes are shown once.
  const deadline = Date.now() + STRAGGLER_WINDOW_MS;
  while (Date.now() < deadline) {
    // Sleep UNLOCKED — never hold the global notify lock during the wait, or a queued push wake would
    // be starved past iOS's budget (spec 2017 review). Only the fetch→show→mark below is serialized.
    await new Promise((r) => setTimeout(r, STRAGGLER_INTERVAL_MS));
    const stop = await serializeNotify(async () => {
      let more: Awaited<ReturnType<typeof previewPending>>;
      try {
        more = await previewPending();
      } catch {
        return true; // fetch failed → stop the straggler loop
      }
      if (more.notes.length) {
        await closeByTag(GENERIC_TAG);
        await showNotes(more.notes);
        await markShown(allIds(more.notes));
        await updateAppBadge(more.suppressed ? 0 : more.badgePending);
      }
      return false;
    });
    if (stop) break;
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
        if (!clients.length) {
          // Show the notification AND bump the app-icon badge (messages + pending requests);
          // the conn path previously never touched the badge, so a friend request didn't count.
          const pendingIncoming = await showConnNotification();
          await updateAppBadge(pendingIncoming);
        }
        return;
      }
      if (kind === 'post') {
        // New Wall post. A live page owns the rich in-app banner (post-new WS frame
        // via useSync), so the SW shows a generic notification only when the app is
        // fully CLOSED. Nudge any live client to pull the post.
        for (const client of clients) client.postMessage({ type: 'ring:posts' });
        // Honor the Wall notifications toggle (the foreground banner is already gated
        // by notifyNewPost; this gates the app-closed system notification to match).
        if (!clients.length && (await setting('notifications.wall.show', true))) {
          // Name the author AND bump the app-icon badge (the post path previously did neither).
          const newCount = await showPostNotification();
          await updateAppBadge(newCount);
        }
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
      // No window open → cold start. iOS PWAs ignore openWindow's path (they land on the
      // default tab post-unlock), so ALSO stash the target; the app consumes it once unlocked
      // and routes there. On platforms where openWindow honors the path it's a harmless no-op
      // (the app is already there; the consume just re-routes to the same place).
      if (data.url) await setPendingNav(data.url);
      return self.clients.openWindow(data.url || '/');
    })(),
  );
});
