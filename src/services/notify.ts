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
import { personAddOutline } from 'ionicons/icons';
import router from '@/router';
import { getSetting, isChatMuted, getChat } from '@/db/queries';
import { subscribe } from '@/db/idb';
import { notifyLocal, pushSubscriptionActive } from '@/services/push';
import { recordPageShown } from '@/services/sw-inbox';
import { inAppGloballyEnabled, getChatNotifyPrefs } from '@/services/notify-prefs';
import { isUnlockedNow } from '@/services/crypto/identity';
import { ensureHiddenLoaded, isRevealed } from '@/services/hidden-state';
import { playTone } from '@/services/sound';
import { notificationOwner } from '@/services/notify-policy';

/* ---- cached notification preferences ---- */

// notifyIncoming runs on every inbound item; re-reading these keys from IndexedDB
// each time adds latency and races a concurrent toggle. Hydrate once into memory,
// then refresh on any settings write (the change bus already fires for 'settings').
interface NotifyPrefs {
  showMessages: boolean;
  showPreview: boolean;
  inappSounds: boolean;
  messageSound: string;
  inappStyle: string;
}
const PREF_DEFAULTS: NotifyPrefs = {
  showMessages: true,
  showPreview: true,
  inappSounds: false,
  messageSound: 'note',
  inappStyle: 'banners',
};
let prefs: NotifyPrefs = { ...PREF_DEFAULTS };
let prefsHydrated = false;

async function loadPrefs(): Promise<void> {
  const [showMessages, showPreview, inappSounds, messageSound, inappStyle] = await Promise.all([
    getSetting<boolean>('notifications.message.show', PREF_DEFAULTS.showMessages),
    getSetting<boolean>('notifications.showPreview', PREF_DEFAULTS.showPreview),
    getSetting<boolean>('notifications.inapp.sounds', PREF_DEFAULTS.inappSounds),
    getSetting<string>('notifications.message.sound', PREF_DEFAULTS.messageSound),
    getSetting<string>('notifications.inapp.style', PREF_DEFAULTS.inappStyle),
  ]);
  prefs = { showMessages, showPreview, inappSounds, messageSound, inappStyle };
}

async function ensurePrefs(): Promise<NotifyPrefs> {
  if (!prefsHydrated) {
    prefsHydrated = true;
    await loadPrefs();
    subscribe(['settings'], () => void loadPrefs()); // keep the cache live
  }
  return prefs;
}

// 'message' and 'request' are person-to-person; 'system' is an app event (e.g. an
// invitee joining) — it has no chat/avatar, so it shows an ICON instead. 'action' is a
// persistent card carrying its own buttons (the app-update prompt). All flow through the
// SAME banner (NotificationBanners.vue); only the payload differs — so every in-app
// notification, the update prompt included, sits and looks identical (one component).
export type IncomingKind = 'message' | 'request' | 'system' | 'action';

// Default glyph for a system notice that doesn't name its own icon, so every system
// banner shows an icon (parity with the avatar/chat-icon on person notifications).
const DEFAULT_SYSTEM_ICON = personAddOutline;

export interface IncomingNotice {
  kind: IncomingKind;
  chatId?: string; // for messages → deep-link target
  msgId?: string; // the message's id — lets a backgrounded-bridge note be re-asserted by the SW (spec: game-move double)
  name: string; // sender / requester display name (or the subject of a system notice)
  body: string; // preview text ("Hi!", "📷 Photo", "wants to connect", "joined Ring")
  avatar?: string; // optional; messages resolve the chat avatar if omitted
  icon?: string; // system notices: the ionicon shown in the banner (defaults applied)
  url?: string; // system notices: optional deep-link target (default: Contacts tab)
  // This item is being surfaced because a push WOKE the page (ring:drain). Such an
  // item must bypass the post-unlock settle window (it's a single woken delivery,
  // not part of the unlock banner burst the window is meant to damp), and its
  // OS-notification channel is owned by the SW (which already fired for the push),
  // so the page must not double up via notifyLocal. Set by the drain path (App.vue
  // arms markPushWake(); receiveIncoming reads it through pushWakeActive()).
  pushWoken?: boolean;
  // @mentions (spec 1020): this message @mentions me (individually, or a validated
  // @everyone). When true (and the chat's mention pref is on) the alert escalates past
  // mute/quiet, and the banner names the mentioner even under a masked content level.
  mention?: boolean;
  mentionName?: string; // who mentioned me (the sender's display name)
}

/* ---- in-app notification banners (custom green overlay; see NotificationBanners.vue) ---- */

// One action button on an 'action' banner (the app-update prompt). `role: 'cancel'`
// marks the dismissive option (e.g. "Later") so the component can style it quietly.
export interface NotifyAction {
  text: string;
  role?: 'cancel';
  handler: () => void;
}

// 'status' is a transient, non-clickable functional notice (the old appToast cases:
// "Someone left the call", "Invite cancelled", "Copied", errors…). It flows through this
// SAME overlay so every in-app notification shares one style/position/feel — no parallel
// Ionic toast.
export type BannerKind = IncomingKind | 'status';

export interface NotifyBanner {
  id: string;
  kind: BannerKind;
  name: string;
  body: string;
  avatar: string;
  icon?: string; // system / action / status banners: shown in the avatar circle instead of an image
  url: string;
  chatId?: string; // message banners only: target for inline quick-reply
  actions?: NotifyAction[]; // 'action' banners: buttons rendered under the body
  persistent?: boolean; // no auto-dismiss timer + exempt from the cap; stays until acted on
  durationMs?: number; // custom auto-dismiss (status toasts are shorter than message banners)
  tone?: 'danger' | 'success'; // status banners: colour variant (error = red), else the green theme
  onDismiss?: () => void; // fired when the banner is removed (mirror of toast.onDidDismiss)
}
// Live list the overlay renders. Capped + deduped by target so a chatty
// conversation collapses to one banner instead of stacking.
export const notifyBanners = ref<NotifyBanner[]>([]);
const BANNER_MS = 4500;
const MAX_BANNERS = 3;
// Pending auto-dismiss timers by banner id, so a banner can be HELD open while the
// user is composing an inline quick-reply (holdBanner) instead of vanishing mid-type.
const bannerTimers = new Map<string, ReturnType<typeof setTimeout>>();
// URLs whose quick-reply is open: these banners are exempt from the MAX_BANNERS cap so
// a burst of other chats can't silently evict an open reply (+ its typed draft). Keyed
// by url (not id) since a same-chat follow-up replaces the banner with a fresh id.
const pinnedUrls = new Set<string>();

function showBanner(b: Omit<NotifyBanner, 'id'>): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // A persistent banner (the update prompt) is pinned so the cap can never evict it, and
  // gets no auto-dismiss timer below — it stays until the user acts or closes it.
  if (b.persistent) pinnedUrls.add(b.url);
  // Replacing a same-target banner: clear its old timer so it can't dismiss the new one.
  // (A re-prompt of the persistent update banner lands here and simply replaces by url,
  // never stacking a duplicate.)
  for (const old of notifyBanners.value.filter((x) => x.url === b.url)) clearBannerTimer(old.id);
  const merged = [...notifyBanners.value.filter((x) => x.url !== b.url), { ...b, id }];
  // Keep every pinned (open-reply / persistent) banner, then fill the remaining slots with
  // the most recent others, instead of a blind tail-slice that could drop a pinned banner.
  const pinned = merged.filter((x) => pinnedUrls.has(x.url));
  const room = Math.max(0, MAX_BANNERS - pinned.length);
  const others = merged.filter((x) => !pinnedUrls.has(x.url)).slice(-room);
  const kept = new Set([...pinned, ...others].map((x) => x.id));
  for (const dropped of merged.filter((x) => !kept.has(x.id))) clearBannerTimer(dropped.id);
  notifyBanners.value = merged.filter((x) => kept.has(x.id)); // preserves arrival order
  if (!b.persistent) bannerTimers.set(id, setTimeout(() => dismissBanner(id), b.durationMs ?? BANNER_MS));
}

const STATUS_DURATION_MS = 1800; // transient functional notices are briefer than message banners

/**
 * Show a transient functional notice ("Someone left the call", "Invite cancelled", "Copied",
 * an error…) through the SAME in-app banner overlay as messages/requests/system notices, so
 * everything shares one style, position and feel. This is what `appToast` funnels into — there
 * is no separate Ionic toast surface. Identical messages dedup (replace) rather than stack.
 */
export function showStatusBanner(
  message: string,
  opts: { icon?: string; tone?: 'danger' | 'success'; durationMs?: number } = {},
): void {
  showBanner({
    kind: 'status',
    name: message, // the whole notice is the (wrapping) headline; no separate body
    body: '',
    avatar: '',
    icon: opts.icon,
    tone: opts.tone,
    url: `status:${message}`, // dedup identical notices; non-navigating (status isn't a link)
    durationMs: opts.durationMs ?? STATUS_DURATION_MS,
  });
}

// The fixed identity of the (single) app-update prompt: a constant `url` means a
// re-prompt REPLACES the existing card via showBanner's dedup, never stacks a duplicate.
const UPDATE_BANNER_URL = 'app-update';

/**
 * Surface the app-update prompt as a persistent in-app notification card carrying its
 * own action buttons — the SAME overlay/component as message/request/system banners, so
 * it renders identically (rounded card below the header) on every platform. Replaces any
 * existing update card (idempotent) and never auto-dismisses.
 */
export function showActionBanner(opts: {
  name: string;
  body: string;
  icon?: string;
  actions: NotifyAction[];
  onDismiss?: () => void;
  url?: string; // defaults to the single update prompt; pass a distinct id for other action cards
  tone?: 'danger' | 'success'; // e.g. the failed-send retry card is 'danger'
}): void {
  showBanner({
    kind: 'action',
    name: opts.name,
    body: opts.body,
    avatar: '',
    icon: opts.icon,
    url: opts.url ?? UPDATE_BANNER_URL,
    actions: opts.actions,
    persistent: true,
    tone: opts.tone,
    onDismiss: opts.onDismiss,
  });
}

/** Whether the app-update card is currently on screen (so the driver can avoid a needless
 *  re-fetch/re-show while it's already showing). */
export function actionBannerShowing(url = UPDATE_BANNER_URL): boolean {
  return notifyBanners.value.some((b) => b.url === url);
}

/** Dismiss the app-update card (e.g. its "Later" action). */
export function dismissActionBanner(url = UPDATE_BANNER_URL): void {
  const b = notifyBanners.value.find((x) => x.url === url);
  if (b) dismissBanner(b.id);
}

function clearBannerTimer(id: string): void {
  const t = bannerTimers.get(id);
  if (t) clearTimeout(t);
  bannerTimers.delete(id);
}

// Stop a banner's auto-dismiss (the user opened its quick-reply); it then only goes
// away on send, swipe-up dismiss, or tap-through.
export function holdBanner(id: string): void {
  clearBannerTimer(id);
}

// Exempt / un-exempt a target's banner from the cap while its quick-reply is open.
export function pinBanner(url: string): void {
  pinnedUrls.add(url);
}
export function unpinBanner(url: string): void {
  pinnedUrls.delete(url);
}

export function dismissBanner(id: string): void {
  clearBannerTimer(id);
  // Drop any pin for the removed banner's url so the set can't leak (a leaked pin would
  // make every future banner for that chat immortal).
  const gone = notifyBanners.value.find((b) => b.id === id);
  if (gone) pinnedUrls.delete(gone.url);
  notifyBanners.value = notifyBanners.value.filter((b) => b.id !== id);
  // Mirror of toast.onDidDismiss: let the opener react (the update prompt resets its
  // re-prompt guard here so it surfaces again next foreground if the user chose "Later").
  gone?.onDismiss?.();
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
/** How much of the settle window remains (0 = not settling) — test/diagnostic. */
export function settleMsLeft(): number {
  return Math.max(0, settledUntil - Date.now());
}

/* ---- push-wake window + banner-presented hand-off (spec 2010 US2/US3) ---- */

// A ring:drain push woke the page. For a brief window after, an arriving message is
// treated as `pushWoken` so it (a) bypasses the settle window above and (b) does not
// also fire notifyLocal — the SW already owns the OS notification for that push.
// receiveIncoming (queries.ts) stamps `pushWoken` onto the notice from this window.
let pushWakeUntil = 0;
const PUSH_WAKE_WINDOW_MS = 12_000; // comfortably covers the SW fetch+decrypt+drain budget
export function markPushWake(): void {
  pushWakeUntil = Date.now() + PUSH_WAKE_WINDOW_MS;
}
export function pushWakeActive(): boolean {
  return Date.now() < pushWakeUntil;
}

// The page<->SW hand-off ack must be tied to whether the page ACTUALLY rendered an
// in-app banner for a drained message — not merely to "we're unlocked" (the old,
// ambiguous gate that acked even when the settle window / visibility race then
// dropped the banner, leaving NO alert at all). App.vue subscribes a callback for a
// ring:drain's lifetime; notifyIncoming fires it the instant it presents a banner,
// so the page acks (claims the alert) only when it truly showed something. If no
// banner renders within the window, no ack → the SW deterministically owns it.
type BannerPresentedCb = () => void;
const bannerPresentedCbs = new Set<BannerPresentedCb>();
/** Register a listener fired whenever notifyIncoming presents a visible in-app
 *  banner for a message. Returns an unsubscribe. */
export function onBannerPresented(cb: BannerPresentedCb): () => void {
  bannerPresentedCbs.add(cb);
  return () => bannerPresentedCbs.delete(cb);
}
function notifyBannerPresented(): void {
  for (const cb of [...bannerPresentedCbs]) {
    try {
      cb();
    } catch {
      /* a listener error must never break alert presentation */
    }
  }
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
  if (n.kind === 'message') return `/chat/${n.chatId ?? ''}`;
  if (n.kind === 'system') return n.url ?? '/tabs/contacts';
  return '/tabs/contacts'; // request
}

async function inAppSound(): Promise<void> {
  const p = await ensurePrefs();
  if (p.inappSounds) {
    playTone(p.messageSound);
  }
}

/**
 * Decide and present the alerting for one incoming item.
 *
 * Returns true iff the page presented a VISIBLE in-app banner/alert for it. The
 * caller (App.vue's ring:drain hand-off) uses that to ack `ring:handled` only when
 * the page truly showed something — so the SW deterministically owns the OS
 * notification in every case where the page didn't (hidden / suppressed / a
 * locked or settle-swallowed page). This is the core spec-2010 fix: the old code
 * acked the moment it saw "unlocked", then often dropped the banner (settle window
 * / visibility race), leaving no alert at all.
 */
export async function notifyIncoming(n: IncomingNotice): Promise<boolean> {
  // Never surface anything while the keystore is locked (behind the passcode gate).
  if (!isUnlockedNow()) return false;

  // ---- The 'message' kind: decide via the shared notify-policy predicate so the
  // page and the SW reason about visibility / settle / per-chat prefs IDENTICALLY.
  // (Requests / system notices have no chat and always-surface semantics — handled
  // below the predicate, unchanged.)
  if (n.kind === 'message') {
    // Hidden chats (spec 1019, tightened by 1027 FR-012): a LOCKED hidden chat
    // must leave no trace on ANY path the platform doesn't force. (When
    // revealed, the user is actively in hidden mode → normal policy.)
    if (n.chatId && !isRevealed() && (await ensureHiddenLoaded()).has(n.chatId)) {
      if (appVisible()) {
        // Foreground: stay completely silent (no banner, no sound). Claim it so a
        // co-arriving push doesn't make the SW fire its own notification either. The
        // unread badge still reflects it (counted separately in useBadges/countUnread).
        notifyBannerPresented();
        return true;
      }
      // Backgrounded: fully silent — badge only. The old generic local-
      // notification bridge is gone (spec 1027 B6): the page never shows
      // anything for a hidden chat; only a PUSH-woken delivery may surface the
      // generic banner, and that one belongs to the SW (platform contract).
      return false;
    }
    const p = await ensurePrefs();
    if (!p.showMessages) return false; // the global "Show notifications" toggle
    const [muted, chatPrefs, globalInApp] = await Promise.all([
      n.chatId ? isChatMuted(n.chatId) : Promise.resolve(false),
      n.chatId ? getChatNotifyPrefs(n.chatId) : Promise.resolve(null),
      inAppGloballyEnabled(),
    ]);
    const content = chatPrefs?.content ?? 'full';
    // @mentions (spec 1020): escalate only when this message mentions me AND the chat's
    // "mentions even when muted" pref is on. The global master (p.showMessages, checked
    // above) + OS DND still gate everything.
    const isMention = !!n.mention && (chatPrefs?.mentions ?? true);
    const mentionBody = `${n.mentionName ?? 'Someone'} mentioned you`;
    const owner = notificationOwner({
      appVisible: appVisible(),
      unlocked: true, // isUnlockedNow() was checked above
      isActiveChat: !!n.chatId && n.chatId === activeChatId && appVisible(),
      pushWoken: !!n.pushWoken,
      inSettleWindow: Date.now() < settledUntil,
      pref: {
        webPush: chatPrefs?.webPush ?? true,
        // In-app banners need BOTH the global master switch and the per-chat toggle.
        inApp: globalInApp && (chatPrefs?.inApp ?? true),
        content,
        muted,
        isMention,
      },
    });

    if (owner === 'suppress') {
      // Viewing this chat while visible → still give a subtle sound (the user sees
      // the message inline). Every other suppress reason (muted / content=none /
      // in-app off / settle-swallowed) is fully silent.
      if (n.chatId && n.chatId === activeChatId && appVisible()) await inAppSound();
      return false;
    }
    if (owner === 'sw-notification') {
      // The SW owns the OS notification. For a PUSH-WOKEN drain the SW already fired
      // for that push, so the page must NOT also notifyLocal (that double-up + the
      // visibilityState race in notifyLocal were a source of the random "content vs
      // nothing"). For a live, hidden, NON-woken delivery (connected tab, no push),
      // the SW never ran, so the page still bridges it via notifyLocal — the
      // connected-but-hidden gap the OS push doesn't cover.
      // content='none' is badge-only (no OS text anywhere), so it never bridges via
      // notifyLocal even though the predicate routes it through 'sw-notification'
      // (the SW's own none-handling keeps it badge-only there).
      // A mention bridges even when content='none' (it escalated past the content level)
      // and names the mentioner when the text would otherwise be masked.
      if (!n.pushWoken && (content !== 'none' || isMention)) {
        const showFull = content === 'full' && p.showPreview;
        const text = showFull ? n.body : isMention ? mentionBody : 'New message';
        // Preview off hides WHO it's from too, not just the body. A mention is an opt-in
        // escalation and keeps naming the mentioner.
        const title = p.showPreview || isMention ? n.name : 'Ring';
        // A backgrounded recipient (this branch) is marked inactive to the server, so
        // if we hold a push subscription the server ALREADY pushed this delivery and the
        // SW owns the ONE OS notification. Showing our own here too is the recently-
        // backgrounded DOUBLE the user hit (our rich note + the SW's generic on a
        // different tag — iOS won't collapse them). So: with a live subscription, don't
        // show anything ourselves; just seed the shown-summary so that push wake renders
        // the note RICH (via reassertFromSummary) instead of the content-free generic.
        // With NO subscription the SW is never woken, so the page bridge is the only
        // background channel and must still fire.
        if (n.chatId && n.msgId && (await pushSubscriptionActive())) {
          await recordPageShown(
            { tag: `ring:${n.chatId}`, title, body: text, url: targetUrl(n), id: n.msgId },
            Date.now(),
          );
        } else {
          void notifyLocal(title, text, targetUrl(n), n.chatId);
        }
      }
      return false;
    }

    // owner === 'page-banner': show the in-app banner/alert.
    const showFull = content === 'full' && p.showPreview;
    await inAppSound();
    if (p.inappStyle === 'none') return false; // sound only; no visible surface
    const url = targetUrl(n);
    const bodyText = showFull ? n.body : isMention ? mentionBody : 'New message';
    // Preview off → the banner also drops the sender name + avatar (mention keeps the name).
    const display = p.showPreview || isMention ? n : { ...n, name: 'Ring', avatar: '' };
    const presented = await presentMessageBanner(display, bodyText, url, p.inappStyle);
    if (presented) notifyBannerPresented(); // tell the drain hand-off we claimed it
    return presented;
  }

  // ---- Requests / system notices: always-surface, no chat (defaults: content full,
  // in-app on). The settle window still damps a request banner burst, but a 'system'
  // notice (e.g. "X joined Ring") is a single gated event, so it isn't swallowed.
  if (n.kind !== 'system' && Date.now() < settledUntil) return false;
  const p = await ensurePrefs();
  const full = p.showPreview;
  if (!appVisible()) {
    let title: string;
    let body: string;
    if (n.kind === 'request') {
      title = 'Friend request';
      body = full ? `${n.name} ${n.body}` : 'New request';
    } else {
      title = 'Ring';
      body = `${n.name} ${n.body}`; // e.g. "Ada joined Ring"
    }
    void notifyLocal(title, body, targetUrl(n), n.chatId);
    return false;
  }
  // Visible: gated by the GLOBAL in-app master switch (FR-018; suppresses request
  // banners while leaving their web push intact).
  if (!(await inAppGloballyEnabled())) return false;
  await inAppSound();
  if (p.inappStyle === 'none') return false;
  const url = targetUrl(n);
  const bodyText = full ? n.body : '';
  return presentMessageBanner(n, bodyText, url, p.inappStyle);
}

/** Present the visible banner/alert surface for one notice. Returns true once a
 *  banner is shown (or an alert is presented). Factored out so notifyIncoming's
 *  per-kind branches share one renderer (avatar resolution, alert vs banner style). */
async function presentMessageBanner(
  n: IncomingNotice,
  bodyText: string,
  url: string,
  style: string,
): Promise<boolean> {
  if (style === 'alerts') {
    const headline = n.kind === 'request' ? `${n.name} wants to connect` : n.name;
    const a = await alertController.create({
      header: headline,
      message: n.kind === 'request' ? undefined : bodyText,
      buttons: [
        { text: 'Dismiss', role: 'cancel' },
        { text: 'View', handler: () => void router.push(url) },
      ],
    });
    await a.present();
    return true;
  }
  // Default: a banner showing the chat avatar (or an icon for requests / system
  // notices) + name + preview, auto-dismissing, tap to open (see
  // NotificationBanners.vue). Resolve the chat's avatar for a message; a request /
  // system notice has no chat, so it falls back to an icon.
  let avatar = n.avatar ?? '';
  if (n.kind === 'message' && n.chatId && !avatar) {
    avatar = (await getChat(n.chatId))?.avatar ?? '';
  }
  const icon = n.icon ?? (n.kind === 'system' ? DEFAULT_SYSTEM_ICON : undefined);
  showBanner({ kind: n.kind, name: n.name, body: bodyText, avatar, icon, url, chatId: n.chatId });
  return true;
}
