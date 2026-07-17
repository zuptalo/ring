/**
 * notify-policy — the single, deterministic predicate the live page (notify.ts)
 * and the service worker (sw.ts / sw-inbox.ts) BOTH agree on for "who owns the
 * user-visible alert for this incoming message?".
 *
 * Why this exists: the page and the SW each independently decide whether to show
 * something for a message, then hand off via `ring:drain` / `ring:handled`. When
 * the two sides reason about visibility / settle-window / per-chat prefs with
 * subtly different logic, the SAME chat randomly shows real content, a generic
 * "New message", or nothing — depending on which side won the race (spec 2010
 * US2/US3). Centralizing the decision into one pure function makes the hand-off
 * unambiguous: the page acks (claims) iff this returns 'page-banner' AND it
 * actually rendered; otherwise the SW deterministically owns the OS notification.
 *
 * Pure: no DOM, no IndexedDB, no time — every input is passed in, so it's trivially
 * unit-testable and behaves identically wherever it runs.
 */

/** Who should present the user-visible alert for one incoming message:
 *  - 'page-banner'      → the live, foregrounded page shows an in-app banner; the
 *                         SW must stay silent (no duplicate OS notification).
 *  - 'sw-notification'  → the SW owns the OS notification (app hidden/closed). For
 *                         content==='none' this is the badge-only path: the SW's
 *                         existing per-chat handling shows no banner but still badges.
 *  - 'suppress'         → no banner anywhere (active chat in view, or muted); the
 *                         badge + any subtle sound are handled by the caller.
 */
export type NotifyOwner = 'page-banner' | 'sw-notification' | 'suppress';

export interface NotifyInput {
  /** The app document is foregrounded/visible right now. */
  appVisible: boolean;
  /** The keystore is unlocked (auto-unlock on / passcode entered). */
  unlocked: boolean;
  /** The user is currently viewing this exact chat. */
  isActiveChat: boolean;
  /** This item arrived because a push WOKE us (ring:drain). Such an item must
   *  bypass the post-unlock settle window — it's a single woken delivery, not part
   *  of the unlock banner burst the settle window is meant to damp. */
  pushWoken: boolean;
  /** The page's post-unlock settle suppression is currently active. */
  inSettleWindow: boolean;
  pref: {
    /** Per-chat web push allowed (the OS-notification channel). */
    webPush: boolean;
    /** In-app banners allowed (global master AND per-chat in-app toggle). */
    inApp: boolean;
    /** Content visibility for this chat. */
    content: 'full' | 'generic' | 'none';
    /** Chat is muted. */
    muted: boolean;
    /** This message @mentions the user (or a validated @everyone) AND the chat's
     *  "Notify for mentions even when muted" pref is on (spec 1020). When true, the
     *  alert escalates past the per-chat silencers — mute, in-app-off, content=none,
     *  web-push-off, and the settle window — while the structural gates (locked,
     *  active-chat) and the GLOBAL "Show notifications" master + OS DND (enforced by
     *  the caller before this runs) still hold. Computed by each caller (page + SW).
     *  Spec 1048 widened what FEEDS this flag: a direct reply to a message the user
     *  authored is an implicit mention (same pref, same silencer set) — the callers
     *  pass mention-or-replied here, so this predicate stays byte-identical. */
    isMention?: boolean;
  };
}

/**
 * Decide who owns the alert. Mirrors the semantics already encoded in notify.ts
 * (visible/hidden split, active-chat = sound-only, settle window) and in
 * sw-inbox.ts (per-chat mute / web-push-off / content=none are intentional
 * silences the SW handles as badge-only), but in ONE place both sides consult.
 */
export function notificationOwner(i: NotifyInput): NotifyOwner {
  const { appVisible, unlocked, isActiveChat, pushWoken, inSettleWindow, pref } = i;

  // An escalated @mention (spec 1020) pierces the per-chat SILENCERS below — mute,
  // in-app-off, content=none, web-push-off, and the settle window — so being called
  // out reaches you even in a muted/quiet chat. The structural gates (locked,
  // active-chat) and the GLOBAL master + OS DND (enforced by the caller) still hold.
  const mention = !!pref.isMention;

  // Muted → never alert, UNLESS it's an escalated mention.
  if (pref.muted && !mention) return 'suppress';

  // While locked the page can't decrypt/show content, and must NOT claim the alert
  // (otherwise it would swallow the message and the SW would stay silent). Hand off
  // to the SW, which shows a generic placeholder per its userVisibleOnly contract.
  // (A mention can't be known here yet — detection requires a successful decrypt.)
  if (!unlocked) return 'sw-notification';

  // App is foregrounded and unlocked → the page is the natural owner.
  if (appVisible) {
    // Viewing this very chat → the user already sees the message; at most a subtle
    // sound (handled by the caller). No banner, and the SW stays out of it.
    if (isActiveChat) return 'suppress';
    // The settle window damps the unlock banner BURST, but a push-woken delivery (or
    // an escalated mention) is a single discrete event and must not be swallowed.
    if (inSettleWindow && !pushWoken && !mention) return 'suppress';
    // In-app banners turned off for this chat (or globally) → no banner, UNLESS it's
    // an escalated mention the user opted to be pinged about.
    if (!pref.inApp && !mention) return 'suppress';
    // content==='none' is badge-only — UNLESS escalated: a mention may show who
    // called you out (the caller composes "X mentioned you" past the content level).
    if (pref.content === 'none' && !mention) return 'suppress';
    // Otherwise the page shows the in-app banner (content 'full' or 'generic';
    // 'generic' masks the text but may still head with the sender name).
    return 'page-banner';
  }

  // App is hidden/closed → the OS notification is the only channel. The SW owns it
  // (the page's notifyLocal hand-off is removed in favor of the SW per spec 2010).
  // Per-chat web-push-off → no OS notification, UNLESS it's an escalated mention.
  if (!pref.webPush && !mention) return 'suppress';
  // content==='none' stays 'sw-notification' so the SW runs its existing none-handling
  // (no banner, badge only) rather than us second-guessing it here; a mention upgrades
  // the SW's note text via its own isMention check.
  return 'sw-notification';
}
