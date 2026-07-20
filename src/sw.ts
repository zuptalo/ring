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
  previewPending, isNothingNew, markShown, unreadCount, ackCall, previewConnections, previewPosts, previewPostActivity, markConnShown,
  coalesceForShow, loadShownSummary, setting, shouldReassert, loadShownSigs, saveShownSig,
  mayEndWakeSilently, quietNote, stampPushWake, countAccepted,
  runGuardedWake, recordWake, type WakeCtx,
  isLegacyIOS, withTimeout, fetchPendingFrames, richNoteOptions, shouldShowPlaceholderFirst,
  previewCallRing, recordCallTickle, recordCallOutcome, withdrawCallBadgeUnit, callBadgeCount,
  readRingShown, recordRingShown, clearRingShown,
  previewInline, loadShown, postNotified,
  type SwNote, type ConnNote, type InlinePreview,
} from '@/services/sw-inbox';
import type { CallEventSignal } from '@/services/crypto/message';
import { readSessionToken } from '@/services/session';
import { hasFreshRing, ringReassert, ringAlreadyNamed } from '@/services/call-events';
import { drainPersistPending, ackFrames } from '@/services/sw-drain';
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
// The content-upgrade window: after the generic placeholder shows, keep waiting
// this long for the decrypt to land and replace it with the real sender+text.
// Restored to a full window (was briefly cut to 3–4s while chasing an iOS-16
// lock-contention issue, which starved the cold decrypt on HEALTHY iOS 17
// devices and turned real content into generics). A healthy handler resolves
// well before this; it only ever waits the full time when the decrypt is slow.
const SETTLE_MAX_MS = 12000;
// Straggler catch-up after the first preview. In the background the page is
// suspended, so a queued message only earns its 'delivered' receipt when the SW
// fetches the pending queue (the server emits 'delivered' for every queued frame on
// each fetch). A rapid burst queues more frames AFTER our first fetch, and the
// collapsible push may not wake the SW again, so without this the burst's tail stays
// 'sent' until the app is reopened. Keep re-fetching for a bounded window so the
// whole burst earns receipts (and late messages get previewed) within one wake.
// Restored to the full burst-catch window. It runs AFTER the notification is
// already shown (so it never delays the alert) and on a healthy device the
// handler is fast, so holding the SW briefly to catch a burst's late frames is
// cheap — the shortened value was an iOS-16-only concession that isn't worth the
// lost receipts on the healthy fleet.
const STRAGGLER_WINDOW_MS = 9000;
const STRAGGLER_INTERVAL_MS = 4500;

// (spec 2014) The dev deployment (ring-dev / localhost) surfaces the generic-fallback REASON in the
// notification for on-device diagnosis; production (same build) never shows internal reason text.
const DEV_HOST = /(^|\.)ring-dev\./.test(self.location.hostname) || self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

async function showGeneric(reason?: string): Promise<void> {
  // (spec 2014 US1) Title is the STATUS, not the literal app name: iOS already shows "Ring" as its
  // forced app-name header, so titling this "Ring" too rendered the app name twice
  // ("Ring › Ring › New message"). (US2) The body carries WHY we fell back to generic so the
  // "generic after a while" cause can be confirmed on a real device — on the dev host always, and
  // (spec 2043) on production when the user opts into the push diagnostics toggle. Content-free:
  // the reason is an internal token (timeout / clean-resolve-no-show / an error message), never
  // sender or message text.
  // (spec 2044) The diagnostics read is BOUNDED: this is the last-resort show, and on iOS-16-class
  // devices a wedged SW-context IndexedDB leaves a read pending forever — an unbounded await here
  // would hang the one notification the whole guard chain exists to guarantee (the exact silent
  // wake that strikes the subscription out). Fail toward the plain body; the show must not wait.
  const showReason = reason && (DEV_HOST || (await withTimeout(setting('diagnostics.pushReasonText', false), 300, false)));
  await self.registration.showNotification('New message', {
    body: showReason ? reason : 'Tap to open',
    icon: ICON,
    badge: BADGE,
    tag: GENERIC_TAG,
    data: { url: '/tabs/chats' },
  });
}

async function showCall(named?: { title: string; body: string }, opts?: { realert?: boolean }): Promise<void> {
  // (spec 1040) The generic ring shows IMMEDIATELY (the tickle wake never waits on
  // decryption), then previewCallRing / the marker's own msg wake may upgrade it
  // with the caller's name.
  // (spec 2026) Every re-show CLOSES the previous ring alert first: iOS keeps a
  // separate Notification Center entry per showNotification call even on the same
  // tag (the spec-2020 lesson), so the old same-tag+renotify:false "in-place"
  // upgrade actually read as a DOUBLE notification there — generic and named
  // stacked — and each group reminder push stacked one more generic. Callers keep
  // total shows minimal via the sw.ringShown signature (never downgrade to
  // generic on a reminder, never repeat an identical naming). Closing first is
  // safe: this wake's visible ending is the show right below; and if that show
  // somehow fails after the close, the catch re-asserts a generic ring so the
  // callee is never left ring-less mid-ring (the rejection still reaches the
  // caller's visibility accounting).
  await closeByTag('ring-call');
  const show = (title: string, body: string, silent: boolean) =>
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: BADGE,
      tag: 'ring-call',
      // Naming is SILENT: the generic ring already alerted for this call, so the
      // upgrade must not buzz a second time (close-first makes it a fresh
      // notification, which would otherwise re-alert). A generic show, and a
      // reminder's named re-assert (opts.realert — re-alerting is the reminder's
      // whole job), should keep alerting.
      silent,
      requireInteraction: true, // a ring shouldn't auto-dismiss before it's seen
      data: { url: '/tabs/chats' },
    });
  try {
    await show(named?.title ?? 'Incoming call', named?.body ?? 'Tap to answer', !!named && !opts?.realert);
  } catch (e) {
    if (named) await show('Incoming call', 'Tap to answer', true).catch(() => {});
    throw e;
  }
}

/** (spec 1040) Apply decrypted call-event outcomes: hand the badge unit over
 *  (missed) or retire it, and close the stale ring alert when the call was
 *  answered on another device (the missed/cancelled case needs no close — its
 *  own note REPLACES the ring via the shared 'ring-call' tag). Idempotent:
 *  outcome frames can be previewed again on later wakes until the page drains. */
async function applyCallEventEffects(evs?: CallEventSignal[]): Promise<void> {
  for (const ev of evs ?? []) {
    if (ev.phase !== 'ended' || !ev.outcome) continue;
    try {
      await recordCallOutcome(ev.callId, ev.outcome);
      if (ev.outcome === 'answered') await closeByTag('ring-call');
      // (spec 2026) The ring is over either way — retire the shown-signature so a
      // late reminder tickle can't re-assert a stale name. Only for the call the
      // signature is actually about (a fresh overlapping ring keeps its own).
      const sig = await readRingShown();
      if (!sig?.callId || sig.callId === ev.callId) await clearRingShown();
    } catch (e) {
      console.warn('[sw] call-event effect failed', e);
    }
  }
}

/** (spec 2026) A msg wake decrypted a fresh dial-time ring marker: name the ring
 *  notification in place. The {"t":"call"} tickle wake showed the undelayed
 *  generic ring, but the marker itself rides the queued message channel a few
 *  seconds later (its send is deliberately deferred off the call-setup hot
 *  path), so THIS wake is where the caller's name becomes available —
 *  previewCallRing applies the same naming / hidden-chat / badge rules as the
 *  tickle path. Returns true when a named re-show happened (a real
 *  showNotification: it counts as the wake's visible ending, so a marker-only
 *  wake adds no "New message" noise). */
async function upgradeRingFromMarkers(evs?: CallEventSignal[]): Promise<boolean> {
  if (!hasFreshRing(evs, Date.now())) return false;
  try {
    const ring = await previewCallRing();
    if (ring?.kind === 'named') {
      await recordCallTickle(ring.callId); // claim the tickle's heuristic unit under its real id
      // Show even when a tickle wake already named the alert identically: the
      // re-show is SILENT and replaces on the same tag, and it doubles as this
      // wake's visible ending — the alternative was the quiet "New message"
      // generic, which reads as a confusing extra notification during a ring.
      // (Interleaving with the tickle wake's naming is excluded by the caller's
      // serializeNotify section, so at most one naming is ever in flight.)
      await showCall({ title: ring.title, body: ring.body });
      await recordRingShown({ callId: ring.callId, named: true, title: ring.title, body: ring.body, ts: Date.now() });
      return true;
    }
    // Hidden chat: the ring stays generic AND its unit must never badge.
    if (ring?.kind === 'generic') await withdrawCallBadgeUnit(ring.callId);
  } catch (e) {
    console.warn('[sw] ring upgrade from marker failed (ring stays generic)', e);
  }
  return false;
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
 *  Callers run this inside the serialize lock so the summary read→write can't interleave.
 *  Returns how many shows the platform ACCEPTED (spec 2023 FR-007): a wake whose every
 *  show was rejected has NOT ended visibly — the caller must fall through to its
 *  quiet/fallback terminal instead of counting this batch as a visible ending. */
async function showNotes(notes: SwNote[]): Promise<number> {
  const coalesced = await coalesceForShow(notes, Date.now());
  return countAccepted(coalesced.map((n) => async () => {
    try {
      // (spec 2026) A missed/cancelled call note REPLACES the ring alert (spec
      // 1040 FR-012) — but iOS stacks same-tag re-shows as separate Notification
      // Center entries instead of collapsing them, so close the ring explicitly
      // before showing its replacement.
      if (n.tag === 'ring-call') await closeByTag('ring-call');
      // (spec 2047) Options via richNoteOptions — deliberately NO `renotify` (iOS 26 /
      // iPadOS 27 accept but never render a renotify:true show; the per-chat `tag`
      // still coalesces, exactly as the working generic does).
      await self.registration.showNotification(titleWithCount(n), richNoteOptions(n, ICON, BADGE));
    } catch (e) {
      console.warn('[sw] showNotification failed', e);
      throw e; // rethrow so countAccepted doesn't count a rejected show
    }
    // Record what the user SAW on this tag (spec 2020), so a later nothing-new
    // wake can tell "identical re-assert" (skip) from "content changed" (show).
    // Best-effort AFTER the accepted show: a sig bookkeeping failure must not
    // make an on-screen notification count as not-shown.
    try {
      await saveShownSig(n.tag, { body: n.body, count: n.count ?? n.ids.length, ts: Date.now() });
    } catch {
      /* sig is bookkeeping only */
    }
  }));
}

/** (spec 1034/2023) The content-free QUIET generic — the terminal fallback that
 *  keeps the Web Push userVisibleOnly contract when the rich path has nothing it
 *  may display. Deliberately NO catch here (spec 2023 FR-005): when this is the
 *  wake's only visible ending, a failure must reach guardedPush so the
 *  last-resort generic runs — a swallowed failure here IS a silent push, and
 *  guardedPush cannot see a failure that never propagates. The two call sites
 *  where the wake is already visibly ended or re-routed (the settle downgrade of
 *  an accepted loud generic; the authoritative-drain degrade) contain it locally
 *  via their own existing catches. */
async function showQuietNote(kind: 'msg' | 'activity'): Promise<void> {
  const n = quietNote(kind);
  await self.registration.showNotification(n.title, {
    ...n.options,
    icon: ICON,
    badge: BADGE,
    data: { url: kind === 'msg' ? '/tabs/chats' : '/' },
  });
}

/** (spec 2023, amending 1034) Show the quiet generic unless silence is LICENSED,
 *  which now takes the platform AND the client state: only a Chromium-engine
 *  browser (whose push service documents the focused-page exemption and never
 *  revokes) may skip, and only when a Ring window is focused AND visible. On
 *  WebKit — where webpushd's cumulative three-strike counter has NO on-screen
 *  exemption — plus Firefox and anything unrecognized, every wake ends visibly
 *  no matter what the client list claims. */
// (spec 2043) Returns whether it actually SHOWED the quiet note. `false` means
// silence was licensed (trusted platform + focused & visible window) — the caller
// treats that as satisfied-but-not-shown, so a clean wake doesn't trip the backstop
// yet a reject/timeout still falls back (the wake produced no OS notification).
async function showQuietUnlessVisible(kind: 'msg' | 'activity'): Promise<boolean> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (mayEndWakeSilently(self.navigator.userAgent, clients)) return false; // licensed: trusted platform + focused & visible window
  await showQuietNote(kind);
  return true;
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
async function reassertFromSummary(): Promise<boolean> {
  try {
    const list = await loadShownSummary(); // already TTL-filtered
    if (!list.length) return false; // no fresh summary — the caller shows the quiet generic (spec 1034)
    const n = list.reduce((a, b) => (b.ts > a.ts ? b : a)); // freshest
    // (spec 2020) A re-assert that is VISUALLY IDENTICAL to what the user already
    // sees (same body + cumulative count on this tag) shows nothing at all: iOS
    // renders even a silent same-tag re-show as a fresh banner + a duplicate
    // Notification Center entry, which read as "the same message notified twice"
    // in a burst. A CHANGED body/count still re-asserts silently below.
    const sigs = await loadShownSigs();
    // (spec 1034, amending spec 2020) An identical re-assert no longer SKIPS —
    // skipping consumed the wake invisibly, which is subscription-fatal on iOS.
    // The caller shows the quiet generic instead: silent, content-free, its own
    // self-replacing tag — the rich per-chat banner still never repeats.
    if (!shouldReassert(sigs[n.tag], n)) return false;
    const k = n.ids.length;
    await saveShownSig(n.tag, { body: n.body, count: k, ts: Date.now() });
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
    return true;
  } catch {
    /* ignore — re-assert is best-effort; the badge still updates */
    return false;
  }
}

const allIds = (notes: SwNote[]): string[] => notes.flatMap((n) => n.ids);

// Set the app-icon badge to the unread total. On the preview path the new message
// isn't persisted, so we add the count of fresh notifications on top of the
// already-stored unread count (`newCount`). On the authoritative drain path
// (spec 1032) applied frames ARE persisted — unreadCount() already includes them —
// so the caller passes only the still-pending (deferred) count, never both.
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
    // (spec 1040) + the per-call units: one per ringing/missed-unseen call while
    // the app is closed. The page clears them on foreground (the calls store is
    // authoritative from then on), so they never double-count a stored missed call.
    const total = (await unreadCount()) + newCount + (await callBadgeCount());
    if (total > 0) await nav.setAppBadge(total);
    console.info('[sw] setAppBadge', total);
  } catch (e) {
    console.warn('[sw] setAppBadge failed', e);
  }
}

/** Decode the content-free tickle's frame type ('call' shows a ring, 'conn' is a
 *  friend-request lifecycle event; anything else, including an unreadable/absent
 *  payload, is treated as a message). 'post-activity' (spec 1031) is the one tickle
 *  that carries data: the id of OUR post that received engagement — returned as
 *  `post` so the handler can pull exactly that post's engagement. */
function pushKind(event: PushEvent): {
  kind: 'call' | 'msg' | 'msgx' | 'conn' | 'post' | 'post-activity' | 'version';
  post?: string;
  inline?: InlinePreview;
} {
  try {
    const data = event.data?.json() as
      | { t?: string; post?: string; id?: string; from?: string; pv?: { h: unknown; p: unknown } }
      | undefined;
    if (data?.t === 'call') return { kind: 'call' };
    if (data?.t === 'conn') return { kind: 'conn' };
    if (data?.t === 'post') return { kind: 'post' };
    if (data?.t === 'post-activity') return { kind: 'post-activity', post: data.post };
    if (data?.t === 'version') return { kind: 'version' };
    // (spec 1055) Inline preview: a rich notification is decryptable from the push
    // body itself — no fetch. Malformed → fall through to the plain message tickle.
    if (data?.t === 'msgx' && data.id && data.from && data.pv) {
      return { kind: 'msgx', inline: { id: data.id, from: data.from, h: data.pv.h as InlinePreview['h'], p: data.pv.p as InlinePreview['p'] } };
    }
  } catch {
    /* not JSON → treat as a message */
  }
  return { kind: 'msg' };
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

/** Generic, identity-safe notification for a NEW Wall post (since spec 1031 the post
 *  tickle is new-posts-only — engagement rides the 'post-activity' tickle to the post
 *  owner and is rendered by previewPostActivity instead). Shown only when the app is
 *  closed; a live page shows the rich in-app banner / live update via the WS frame,
 *  so the SW stays silent there to avoid a duplicate. */
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
    // notes carry "<author> · posted on their Wall" (or the urgent challenge
    // line when the SW could unseal a game post, spec 0009); reuse the
    // conn-note renderer (same shape). Zero ACCEPTED shows (spec 2023 FR-007)
    // falls through to the generic placeholder below.
    if ((await showConnNotes(notes)) > 0) return newCount;
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

/** Show the generic friend-request notifications (identity-safe; no decryption).
 *  Returns the ACCEPTED show count (spec 2023 FR-007) — callers fall through to
 *  their placeholder/quiet terminal when it is zero. */
async function showConnNotes(notes: ConnNote[]): Promise<number> {
  return countAccepted(notes.map((n) => async () => {
    try {
      // (spec 2047) NO `renotify` — see showNotes: iOS 26/iPadOS 27 accept but do not
      // render a renotify:true notification; the per-chat `tag` handles coalescing.
      await self.registration.showNotification(n.title, {
        body: n.body,
        icon: ICON,
        badge: BADGE,
        tag: n.tag,
        data: { url: n.url },
      });
    } catch (e) {
      console.warn('[sw] conn showNotification failed', e);
      throw e; // rethrow so countAccepted doesn't count a rejected show
    }
  }));
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
    const accepted = await showConnNotes(notes);
    await markConnShown(notes.flatMap((n) => n.keys));
    // Zero ACCEPTED shows (spec 2023 FR-007) → the wake has not ended visibly;
    // fall through to the generic placeholder below (the reconcile state stays
    // marked — it is bookkeeping, not visibility).
    if (accepted > 0) return pendingIncoming;
  }
  // Couldn't reconcile (offline / already-seen) but a tickle implies activity →
  // a single generic placeholder keeps the userVisibleOnly contract. The copy is
  // EVENT-NEUTRAL (spec 1040 FR-021): this wake may be a new request, an accept,
  // or a decline — claiming "New friend request" told acceptees the opposite of
  // what happened.
  await self.registration.showNotification('Contact updates', {
    body: 'Tap to review',
    icon: ICON,
    badge: BADGE,
    tag: 'ring:conn:req',
    data: { url: '/tabs/contacts' },
  });
  return pendingIncoming;
}

/**
 * Spec 1032 (sw.fullPersist): attempt the AUTHORITATIVE drain — decrypt + persist
 * eligible frames atomically, show their notifications, then ack. Returns true
 * when this wake is fully handled; false hands the wake (or its deferred
 * remainder) to showMessageNotification() below, whose preview flow is also the
 * fallback for every degrade (flag off, no Web Locks, locked device, lock
 * timeout, fetch/commit failure). Ordering per frame is commit → notify → ack:
 * an ack is only ever sent for a durably-committed frame, and the notification
 * is shown before the ack so a kill can't consume a frame silently.
 */
async function tryAuthoritativeDrain(ctx: WakeCtx): Promise<boolean> {
  try {
    return await serializeNotify(async () => {
      const r = await drainPersistPending();
      if (r.mode === 'degrade') return false; // includes 'no-frames' — the preview
      // path owns the nothing-new / re-assert behavior (spec 2016/2017).
      let accepted = 0;
      if (r.notes.length) {
        // (spec 1055 FR-012) Don't re-notify a message the inline preview already showed
        // (or a prior wake surfaced): the warm still persists + acks it below, silently.
        const seen = new Set(await loadShown());
        const fresh = r.notes.filter((n) => n.ids.some((id) => !seen.has(id)));
        if (fresh.length) {
          await closeByTag(GENERIC_TAG);
          accepted = await showNotes(fresh);
        }
      }
      // Mark applied frames in the preview ledger too: if the ack below fails they
      // linger in the queue, and the preview path must not re-decrypt them (their
      // message keys are consumed — it would misread them as decrypt failures).
      await markShown(r.ackIds);
      await ackFrames(r.ackIds); // strictly after commit + notifications
      if (r.deferred > 0) {
        // Preview flow handles the deferred remainder AND sets ctx there. Any notes
        // we accepted above still count toward this wake having shown.
        if (accepted > 0) ctx.shown = true;
        return false;
      }
      // Fully handled: applied rows are already in unreadCount(), nothing pending.
      await updateAppBadge(0);
      // (spec 1034/2023) Persisted + acked but nothing made it on screen — every
      // frame was for a muted/hidden/badge-only chat, or every show was REJECTED
      // (FR-007): either way the wake still needs a visible ending. The frames
      // stay acked (they are durably committed locally); only the visibility is
      // owed. A failure of the quiet note itself is contained by this function's
      // catch, which degrades to the preview flow — whose own quiet terminal
      // propagates (FR-005 carve-out).
      let shown = accepted > 0;
      if (!r.notes.length || accepted === 0) shown = (await showQuietUnlessVisible('msg')) || shown;
      // (spec 2043) A fully-handled drain always ends satisfied (shown or licensed).
      ctx.shown = shown;
      ctx.satisfied = true;
      return true;
    });
  } catch (e) {
    console.warn('[sw] authoritative drain failed → preview fallback', e);
    return false;
  }
}

/**
 * Handle a message push: fetch + decrypt the queue for a rich preview, racing a
 * timeout so a slow cold start (libsodium WASM init in a fresh worker) still posts
 * *some* notification (iOS requires one per push). A generic placeholder shown on
 * timeout is UPGRADED to the rich preview when the full decrypt settles.
 */
async function showMessageNotification(ctx: WakeCtx, placeholderShown = false): Promise<void> {
  // (spec 2017) Serialize only the critical read→show→markShown sections (NOT the straggler's sleeps),
  // so overlapping burst wakes can't interleave and duplicate a notification or bounce the per-pass
  // count — while a queued wake still gets the lock during another wake's sleep gaps and is never
  // starved past iOS's per-push budget. The first wake's straggler catches the burst's late frames;
  // later wakes find everything shown and re-assert silently. Delivery receipts are unaffected.
  // (spec 2026) Whether a fresh ring marker already upgraded the 'ring-call'
  // notification with the caller's name this wake — the upgrade is idempotent
  // but re-running it pays previewCallRing's queue refetch, so once is enough.
  let ringUpgraded = false;
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

  // (spec 2048) The show-first placeholder (if dispatchPush already put one up) IS a
  // generic on GENERIC_TAG, so seed shownGeneric with it: the settle's upgrade
  // (rich)/downgrade (quiet) machinery gates on shownGeneric.
  let shownGeneric = placeholderShown;
  let shownAny = false; // spec 1034: track whether THIS wake produced anything visible
  if (result.notes.length) {
    await closeByTag(GENERIC_TAG); // clear any earlier generic before the rich note
    const accepted = await showNotes(result.notes);
    await markShown(allIds(result.notes)); // only mark what we displayed
    // (spec 2023 FR-007) an all-rejected batch is NOT a visible ending — leaving
    // shownAny false routes this wake to the quiet terminal below.
    shownAny = accepted > 0;
    // (spec 2048) The rich note REPLACED the placeholder (closeByTag above), so the
    // settle must not re-show/re-buzz the generic for it.
    if (accepted > 0) shownGeneric = false;
  } else if (timedOut || (!result.suppressed && !result.silenced && result.newUnshown)) {
    // Show the generic placeholder ONLY when there's a genuinely-new message we couldn't render: a
    // slow cold-start decrypt still in flight at the deadline (timedOut), a fetched-but-undecryptable
    // frame, a PIN-locked device with pending frames, or a failed relay fetch (all → newUnshown). The
    // settle below upgrades it to the rich note if the decrypt lands. `suppressed` (notifications off)
    // and `silenced` (mute / web-push-off / badge-only, spec 1015 FR-022/FR-024) show no placeholder.
    // (spec 2048) Skip if the show-first placeholder is already up — a same-tag re-show re-buzzes on
    // iOS (spec 2020); the placeholder is this branch's visible ending.
    if (!placeholderShown) await showGeneric(timedOut ? 'timeout' : result.reason);
    shownGeneric = true;
    shownAny = true;
  } else if (isNothingNew(result)) {
    // (spec 2016/2017) Nothing genuinely new — the relay queue was empty (`no-frames`) or every frame
    // was already shown (a burst wake the first wake beat). A new generic here is pure noise. Re-assert
    // the ONE authoritative coalesced notification from the persisted summary silently (spec 2017), so
    // iOS sees a showNotification call (no own-summary gap) without a new alert; shows nothing only when
    // there's no fresh summary (the mute/badge-only outcome). The badge below still stays accurate.
    shownAny = await reassertFromSummary();
  }
  // (spec 2026) A fresh dial-time ring marker decrypted this pass names the
  // ongoing ring alert in place. Runs even when notes were shown (a text can
  // arrive in the same wake as the marker), and its named re-show counts as the
  // wake's visible ending — a marker-only wake must upgrade the ring, not add a
  // generic "New message".
  ringUpgraded = await upgradeRingFromMarkers(result.callEvents);
  shownAny = shownAny || ringUpgraded;
  // (spec 1034) Silence is not an outcome: muted / hidden / badge-only / web-push-
  // off (`silenced`), the master-toggle race (`suppressed`), and a nothing-new
  // wake with nothing to re-assert all still consumed a push — end them with the
  // content-free quiet generic unless Ring is actually on screen.
  if (!shownAny) shownAny = await showQuietUnlessVisible('msg');
  // (spec 2043) Record the wake's per-event outcome for the guard: a real show or
  // a licensed-silent quiet skip both satisfy it; only an actual show sets `shown`.
  ctx.shown = shownAny;
  ctx.satisfied = true;

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
    // (spec 1040) Call outcomes decrypted this pass: badge-unit handover, and the
    // ring alert closes when the call was answered elsewhere. Runs before the
    // updateAppBadge below so the badge reflects the handover.
    await applyCallEventEffects(full.callEvents);
    // (spec 2026) The timed-out race above had no callEvents yet — a slow cold
    // start's ring marker still names the ring once the full preview settles.
    if (!ringUpgraded) ringUpgraded = await upgradeRingFromMarkers(full.callEvents);
    if (shownGeneric && full.notes.length) {
      // Upgrade the placeholder to the real sender + text. Show FIRST, close the
      // generic only once a rich note was actually ACCEPTED (spec 2023 FR-007):
      // closing first and then failing every show would destroy the wake's only
      // accepted visible ending. The brief rich+generic overlap is harmless —
      // different tags, and the generic is closed the next instant.
      const upgraded = await showNotes(full.notes);
      if (upgraded > 0) await closeByTag(GENERIC_TAG);
      await markShown(allIds(full.notes)); // don't re-preview them next push
    } else if (shownGeneric && full.silenced) {
      // A SLOW cold start showed the loud generic before the decrypt settled; the
      // settled result says every pending message was per-chat silenced. Spec 1034:
      // don't vanish it (a wake must stay visible) — downgrade it in place (same
      // tag) to the QUIET generic, so mute/badge-only keeps its no-buzz spirit
      // while the notification remains.
      await showQuietUnlessVisible('msg');
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
      await applyCallEventEffects(more.callEvents); // spec 1040: stragglers can carry outcomes too
      // (spec 2026) A marker that arrived after the first fetch (the dial-time
      // send is deferred a few seconds) still names the ring within this wake.
      if (!ringUpgraded) ringUpgraded = await upgradeRingFromMarkers(more.callEvents);
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

/**
 * (spec 2044) The LITE wake for legacy iOS (<= 16): show first, decrypt never.
 *
 * On that tier the network layer works — the iPhone-8 evidence is delivered receipts
 * firing for exactly the messages that never produced a banner — but SW-context
 * IndexedDB transactions hang/throw and the rich pipeline (device unlock, settings
 * reads, decrypt, ledger writes) dies AFTER the fetch, silently. Every such wake was
 * a webpushd strike; three strikes killed the subscription. So here the visible
 * notification comes FIRST, from IDB-free primitives only, and the single IDB read
 * this path ever risks (the session token, needed to fire delivered receipts) is
 * time-bounded and happens strictly after the show. Cold open is the accepted cost:
 * the page WS-drains durably on open, exactly as it already does on this tier.
 * setAppBadge doesn't exist in the iOS-16 SW, so skipping badge math loses nothing.
 */
async function dispatchLiteWake(
  kind: ReturnType<typeof pushKind>['kind'],
  clients: readonly Client[],
  ctx: WakeCtx,
): Promise<void> {
  if (kind === 'call') {
    // Generic ring immediately — no readRingShown dedup (an IDB read that can hang
    // here). A reminder tickle may re-ring generically; on this tier an extra audible
    // ring beats a missed call. Ack reachability so the caller flips to "Ringing",
    // and nudge any live page to reconnect so the buffered call-offer rings in-app.
    for (const client of clients) client.postMessage({ type: 'ring:drain' });
    await showCall(undefined, { realert: true });
    ctx.shown = true;
    ctx.satisfied = true;
    void ackCall();
    return;
  }
  if (kind === 'conn' || kind === 'post' || kind === 'post-activity') {
    // No previews (they read IDB before showing). The content-free quiet generic is
    // the visible ending; live pages still get their reconcile nudges.
    const nudge = kind === 'conn' ? 'ring:conn' : 'ring:posts';
    for (const client of clients) client.postMessage({ type: nudge });
    await showQuietNote('activity');
    ctx.shown = true;
    ctx.satisfied = true;
    return;
  }
  if (kind === 'version') {
    // Already IDB-free (one network fetch + show); keep the rich "what's new" when
    // the app is closed, but degrade to the quiet generic if the fetch fails — the
    // wake must end visibly either way.
    for (const client of clients) client.postMessage({ type: 'ring:checkupdate' });
    try {
      if (!clients.length) await showVersionNotification();
      else await showQuietNote('activity');
    } catch {
      await showQuietNote('activity');
    }
    ctx.shown = true;
    ctx.satisfied = true;
    return;
  }
  // Message. A live, unlocked page may still claim the alert (this arm is IDB-free
  // and identical to the modern path, preserving the app-open no-double UX); the
  // platform gate is always untrusted on iOS, so a claimed wake still ends with the
  // quiet note.
  if (clients.length && (await pageWillNotify(clients, 2200))) {
    const nowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!mayEndWakeSilently(self.navigator.userAgent, nowClients)) {
      await showQuietNote('msg');
      ctx.shown = true;
    }
    ctx.satisfied = true;
    return;
  }
  // Unclaimed: the generic shows NOW (bounded diagnostics read inside, spec 2044),
  // before any keystore/decrypt work is even attempted.
  await showGeneric('legacy-lite');
  ctx.shown = true;
  ctx.satisfied = true;
  // Best-effort delivered receipts AFTER the show: one bounded keystore read for the
  // token, one bounded fetch. The server emits 'delivered' for every queued frame on
  // fetch (idempotent, no ack/dequeue — the page drains durably on open). A hung
  // token read just skips this wake's receipts; the next wake or app open recovers
  // them.
  try {
    const token = await withTimeout<string | null>(readSessionToken(), 3000, null);
    if (token) await fetchPendingFrames(token);
  } catch {
    /* receipts are best-effort — the notification already showed */
  }
}

async function dispatchPush(event: PushEvent, ctx: WakeCtx): Promise<void> {
      // (spec 1037) Every wake stamps its time FIRST — the page-side zombie
      // detector treats "no wake since a stale message was sent" as the
      // rotate-the-subscription signature. It's best-effort telemetry though, so
      // never let it BLOCK the alert: on a wedged iOS-16 SW the IDB write can
      // stall, and the notification must not wait on it (it completes in the
      // background if the DB later frees up).
      await Promise.race([stampPushWake(), new Promise((r) => setTimeout(r, 1500))]);
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const { kind, post, inline } = pushKind(event);
      // (spec 2044) Legacy iOS (<= 16) takes the LITE wake: show first, decrypt never.
      // On that tier the SW's network layer works (delivered receipts prove the queue
      // fetch succeeds) but IndexedDB transactions and the decrypt/present pipeline
      // hang or die silently — each such wake was a webpushd strike, and the
      // subscription was dead within a burst. The gate is a pure UA parse that fails
      // toward modern, so devices on iOS 17+ never enter this branch.
      if (isLegacyIOS(self.navigator.userAgent)) {
        // Legacy never decrypts (incl. the inline preview) — the lite path shows a
        // generic first; a 'msgx' wake is just a message there.
        await dispatchLiteWake(kind === 'msgx' ? 'msg' : kind, clients, ctx);
        return;
      }
      if (kind === 'msgx' && inline) {
        // (spec 1055) The rich notification is decryptable from the push itself — show
        // it WITHOUT any /relay/pending fetch, then best-effort warm the DB. Show first
        // (the guaranteed, window-fitting part), warm second (pure upside), so a
        // suspend during the warm can never cause a silent wake.
        const result = await previewInline(inline);
        if (result.ok && result.notes.length) {
          await closeByTag(GENERIC_TAG); // in case a prior wake left a placeholder
          const accepted = await showNotes(result.notes);
          if (accepted > 0) {
            ctx.shown = true;
            await markShown(allIds(result.notes)); // so the warm/open path won't re-notify (FR-012)
          }
        } else if (result.ok && (result.silenced || result.suppressed)) {
          // Muted / notifications-off: intentionally no content. On iOS the wake must
          // still end visibly, so show the content-free quiet note unless a page is up.
          ctx.shown = (await showQuietUnlessVisible('msg')) || ctx.shown;
        } else {
          // Locked / decrypt failure → spec-2048 show-first placeholder (rich on open).
          try {
            await showGeneric('inline-fallback');
            ctx.shown = true;
          } catch (e) {
            console.warn('[sw] inline fallback placeholder failed', e);
          }
        }
        ctx.satisfied = true;
        // notified receipt: the device DECRYPTED the preview (regardless of display),
        // so the sender flips to "delivered" now — fire-and-forget, no mute/hidden leak.
        if (result.ok) void postNotified(inline.id);
        // Best-effort warm tail (spec 1032, default-on for non-legacy): persist + ack so
        // the app opens warm. Runs AFTER the show; self-gates on eligibility; on the
        // inline path its notify step is deduped by the markShown above (FR-012).
        try {
          await tryAuthoritativeDrain(ctx);
        } catch (e) {
          console.warn('[sw] inline warm tail failed (DB warms on open)', e);
        }
        return;
      }
      if (kind === 'call') {
        // A call is never queued on the relay; the tickle itself is the signal.
        // Show the ring immediately, ack reachability (so the caller's UI flips to
        // "Ringing"), and nudge any device to reconnect so the live call-offer
        // (buffered briefly server-side) flushes and rings in-app.
        // (spec 2026) A reminder tickle for a ring we already NAMED re-asserts the
        // named alert (re-alerting is the reminder's whole job) — never downgrades
        // it back to the generic, which on iOS would stack yet another entry and
        // then need re-naming. A first tickle shows the undelayed generic (FR-004).
        const sig = await readRingShown();
        const reassert = ringReassert(sig, Date.now());
        await showCall(reassert ?? undefined, { realert: true });
        // (spec 2043) The ring alert is up; any later naming upgrade is a bonus. If
        // showCall threw, ctx stays unshown → the guard's fallback fires.
        ctx.shown = true;
        ctx.satisfied = true;
        if (reassert && sig) {
          await recordRingShown({ ...sig, ts: Date.now() });
        } else if (!ringReassert(await readRingShown(), Date.now())) {
          // Re-read before recording "generic": the ring marker's own msg wake can
          // name the alert concurrently (the tickle and the marker push land
          // back-to-back), and a stale {named:false} write here would make the
          // preview below re-show a name the alert already carries.
          await recordRingShown({ named: false, ts: Date.now() });
        }
        void ackCall();
        for (const client of clients) client.postMessage({ type: 'ring:drain' });
        // (spec 1040) One badge unit per call while closed. The tickle carries no
        // callId (content-free), so this pass uses the ring-window heuristic; the
        // marker preview below claims/keys the unit once it decrypts.
        await recordCallTickle();
        await updateAppBadge(0);
        // Name the ring from the caller's sealed dial-time marker (the queued
        // callEvent frame) — an in-place upgrade AFTER the generic alert, so the
        // first ring is never delayed (FR-004). Locked/unresolvable stays generic;
        // a hidden chat's ring stays generic AND never badges. Skipped when the
        // alert already carries exactly this name (every extra show is an extra
        // Notification Center entry on iOS).
        try {
          const ring = await previewCallRing();
          if (ring?.kind === 'named') {
            await recordCallTickle(ring.callId); // claim the heuristic unit under its real id
            // The check→show→record must be atomic against the marker msg wake's
            // upgradeRingFromMarkers (whose enclosing section holds this same
            // lock): the tickle and marker pushes land back-to-back, and two
            // unserialized namings each read "not named yet" and BOTH showed —
            // the double named alert. The slow previewCallRing above stays
            // outside the lock; only the naming is serialized.
            await serializeNotify(async () => {
              if (!ringAlreadyNamed(await readRingShown(), ring.title, ring.body, Date.now())) {
                await showCall({ title: ring.title, body: ring.body });
                await recordRingShown({ callId: ring.callId, named: true, title: ring.title, body: ring.body, ts: Date.now() });
              }
            });
          } else if (ring?.kind === 'generic') {
            await withdrawCallBadgeUnit(ring.callId);
            await updateAppBadge(0);
          }
        } catch (e) {
          console.warn('[sw] call-ring preview failed (ring stays generic)', e);
        }
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
          ctx.shown = true;
          ctx.satisfied = true; // showConnNotification always ends with a visible show
        } else {
          // (spec 1034) A client EXISTS but may be a frozen background PWA (the norm
          // on iOS) that will never render the page-side alert — end visibly anyway.
          ctx.shown = await showQuietUnlessVisible('activity');
          ctx.satisfied = true;
        }
        return;
      }
      if (kind === 'post') {
        // New Wall post (since spec 1031 this tickle is new-posts-only; engagement
        // rides 'post-activity'). A live page owns the rich in-app banner (post-new
        // WS frame via useSync), so the SW shows a generic notification only when the
        // app is fully CLOSED. Nudge any live client to pull the post.
        for (const client of clients) client.postMessage({ type: 'ring:posts' });
        // Honor the Wall notifications toggle (the foreground banner is already gated
        // by notifyNewPost; this gates the app-closed system notification to match).
        if (!clients.length && (await setting('notifications.wall.show', true))) {
          // Name the author AND bump the app-icon badge (the post path previously did neither).
          const newCount = await showPostNotification();
          await updateAppBadge(newCount);
          ctx.shown = true;
          ctx.satisfied = true; // showPostNotification always ends with a visible show
        } else {
          // (spec 1034) Toggle off, or a (possibly frozen) client exists: the wake
          // still consumed a push — end it with the content-free quiet generic.
          ctx.shown = await showQuietUnlessVisible('activity');
          ctx.satisfied = true;
        }
        return;
      }
      if (kind === 'post-activity') {
        // Engagement (a reaction/comment by someone else) on OUR post — spec 1031's
        // owner-only wake. A live page owns the in-app banner (it gets the
        // post-engagement WS frame via useSync), so just nudge it to sync and stay
        // silent. Fully closed → honor the "Activity on your posts" toggle, then let
        // previewPostActivity decide: it re-checks ownership on the local post row,
        // names the actor from the public directory, and opens sealed reaction
        // payloads locally so a REMOVAL shows nothing at all.
        for (const client of clients) client.postMessage({ type: 'ring:posts' });
        let shownActivity = false;
        if (!clients.length && (await setting('notifications.wall.activity', true))) {
          const notes = await previewPostActivity(post ?? '');
          if (notes.length) {
            // (spec 2023 FR-007) only ACCEPTED shows end the wake visibly.
            shownActivity = (await showConnNotes(notes)) > 0;
          }
        }
        // (spec 1034) Toggle off, frozen client, or a removal that previews to zero
        // notes: still a consumed push — end visibly (content-free; a removal shows
        // the neutral "New activity", never who or what).
        if (!shownActivity) shownActivity = await showQuietUnlessVisible('activity');
        ctx.shown = shownActivity;
        ctx.satisfied = true;
        return;
      }
      if (kind === 'version') {
        // A new app version was deployed. A live page owns the alert (useAppUpdate
        // shows the in-app "what's new" update toast), so nudge any open client to
        // check immediately and show the system "what's new" notification only when
        // the app is fully CLOSED — mirroring the post/conn pattern and keeping the
        // userVisibleOnly contract (exactly one visible notification when closed).
        for (const client of clients) client.postMessage({ type: 'ring:checkupdate' });
        if (!clients.length) {
          await showVersionNotification();
          ctx.shown = true;
          ctx.satisfied = true; // showVersionNotification always ends with a visible show
        } else {
          // (spec 1034) A frozen background client can't show the update toast.
          ctx.shown = await showQuietUnlessVisible('activity');
          ctx.satisfied = true;
        }
        return;
      }
      // Let a live, unlocked page own the notification (avoids a duplicate); the SW
      // shows it only when no page claims it within the window (closed/locked/frozen).
      // The page now acks only once it ACTUALLY renders an in-app banner (spec 2010),
      // which can trail a cold reconnect+decrypt, so wait a touch longer than the old
      // 1200ms — comfortably above the page's own DRAIN_ACK_WINDOW so a page that will
      // show a banner reliably claims it, while a hidden/locked/frozen page (which
      // never acks) still falls through to the SW promptly enough.
      // (spec 2048) SHOW-FIRST. Only a FOCUSED+VISIBLE page renders the rich in-app
      // banner itself, so ONLY then may we spend the tight iOS wake window awaiting its
      // claim (via pageWillNotify). With no such window — locked / backgrounded /
      // frozen-PWA / closed, the norm on iOS — waiting up to 2200ms and THEN fetching
      // /relay/pending and decrypting is too slow: iOS suspends the SW before any
      // showNotification lands (the fetch fires, so the server logs "delivered", but
      // nothing renders), counts the wake as a SILENT push, and after ~4 REVOKES the
      // subscription (status=410 Unregistered). So there we put a visible placeholder up
      // IMMEDIATELY, before the drain/preview, and let the durable work upgrade it.
      if (!shouldShowPlaceholderFirst(clients) && (await pageWillNotify(clients, 2200))) {
        // (spec 2023 FR-003) A focused+visible page claimed the RICH in-app alert, but
        // an in-app banner is invisible to the OS push service, so a claimed wake that
        // shows no OS notification is a SILENT push. Re-sample and end silently ONLY
        // when mayEndWakeSilently holds (trusted platform + focused+visible); otherwise
        // show the content-free quiet note. iOS is unaffected (platformTrustsSilence
        // false → always the quiet note).
        const nowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (!mayEndWakeSilently(self.navigator.userAgent, nowClients)) {
          await showQuietNote('msg');
          ctx.shown = true;
        }
        ctx.satisfied = true;
        return;
      }
      // No focused+visible client to own the alert. Still nudge any (frozen/background)
      // client to reconnect + drain durably — but DON'T await it; that 2200ms wait was
      // the window-burn we are removing (the page-side handler drains on a bare
      // 'ring:drain' without a reqId, just skipping the ack). Then show the placeholder
      // NOW, before the fetch + decrypt.
      for (const client of clients) client.postMessage({ type: 'ring:drain' });
      try {
        await showGeneric('show-first');
        ctx.shown = true;
        ctx.satisfied = true;
      } catch (e) {
        // The platform denied even the placeholder — the drain/preview below (or the
        // guard's last-resort generic) still owns the visible ending; leave ctx unset.
        console.warn('[sw] show-first placeholder failed', e);
      }
      // Spec 1032: with sw.fullPersist on, persist + ack eligible frames right now so
      // the app opens warm; either way the durable work UPGRADES the placeholder in
      // place (closeByTag(GENERIC_TAG) + rich note, or same-tag quiet downgrade when
      // the batch is muted/suppressed/nothing-new). placeholderShown=true tells
      // showMessageNotification the generic is already up so it doesn't re-buzz it.
      if (await tryAuthoritativeDrain(ctx)) return;
      await showMessageNotification(ctx, true /* placeholderShown */);
}

// The Web Push `userVisibleOnly` contract is unforgiving on iOS: a push event
// that resolves WITHOUT a visible notification is a "silent push", and after a
// few of them iOS REVOKES the subscription (browser still hands back the corpse
// object, so it re-registers forever and delivery is dead — this is the exact
// failure that mass-revoked subscriptions here). The handler above touches
// IndexedDB throughout, and SW-context IndexedDB can HANG or throw on older iOS
// (16.x) WebKit where it's fine on iOS 17+. So bound the handler and guarantee a
// visible notification no matter what — a throw, or a hang past the deadline,
// still ends with a generic (whose body carries the reason on the dev host, so a
// broken device finally says WHY on-screen).
const PUSH_DEADLINE_MS = 20000; // under iOS's ~30s SW-event budget, over our own straggler+settle window

// (spec 2043) Guard one push wake with a PER-EVENT context. dispatchPush threads a
// WakeCtx and marks it `shown` the instant an OS notification is accepted and
// `satisfied` when the wake ends shown OR with licensed silence. runGuardedWake then:
//   - reject/deadline → last-resort generic UNLESS this event already showed
//     (ctx.shown). Because the flag is per-event, a sibling wake's show can no longer
//     suppress this one's fallback — the module-global stamp that did exactly that
//     (a later push's show bleeding past an earlier push's start → a silent wake →
//     an iOS subscription strike) is GONE.
//   - clean resolve, not satisfied → backstop generic. The "every iOS wake shows
//     something" invariant every terminal used to assume is now ENFORCED here.
// `showGeneric` is the registration's native showNotification path (no monkeypatch);
// the reason is surfaced only on the dev host / when the diagnostic toggle is on.
async function guardedPush(event: PushEvent): Promise<void> {
  const { kind } = pushKind(event);
  const res = await runGuardedWake((ctx) => dispatchPush(event, ctx), (reason) => showGeneric(reason), PUSH_DEADLINE_MS);
  // (spec 2043) Content-free ledger entry: which tickle kind, and did the wake end
  // shown / licensed-silent / on the backstop generic. Surfaced (behind the
  // diagnostics toggle) so a real device can finally say WHY it fell silent.
  void recordWake(kind, res.fellBack ? 'fallback' : res.shown ? 'shown' : 'licensed-silent');
}

self.addEventListener('push', (event) => {
  event.waitUntil(guardedPush(event));
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
