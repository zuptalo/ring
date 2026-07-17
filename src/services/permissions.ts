/**
 * Device-permission helpers for the post-auth onboarding wizard.
 *
 * Each permission is requested behind a user gesture (a button tap) because
 * browsers (iOS Safari / standalone PWA especially) only surface the native
 * prompt in response to one. A denial is sticky (the web can't re-prompt once
 * the user taps "Don't Allow"), so "Skip for now" must NOT call the request
 * function: skipping leaves the permission in its default state so it can be
 * asked again later.
 *
 * Push is the only onboarding permission for now; camera/mic/location are
 * requested just-in-time elsewhere. Keep this file the single source for
 * permission state so a future "Permissions" section (e.g. in the You tab) can
 * reuse it.
 */

const PUSH_HANDLED_KEY = 'ring.onboarding.pushHandled';

export type PushState = NotificationPermission | 'unsupported';

/**
 * Web push needs the Notification API, a service worker, and PushManager. On
 * iOS these are only present when the app is launched from the Home Screen
 * (installed PWA) on 16.4+, so an unsupported result usually means "not
 * installed / not standalone" rather than a true lack of capability.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/** Current push permission, without prompting. */
export function pushPermission(): PushState {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Trigger the native push prompt. Must be called from a user gesture. Records
 * that push was handled (granted or denied) so onboarding doesn't re-ask.
 * Returns the resulting state.
 */
export async function requestPushPermission(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    markPushHandled();
    return result;
  } catch {
    return Notification.permission;
  }
}

/** Mark push onboarding as resolved (allowed, denied, or skipped). */
export function markPushHandled(): void {
  try {
    localStorage.setItem(PUSH_HANDLED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** True once push has been granted, denied, or skipped during onboarding. */
export function wasPushHandled(): boolean {
  try {
    return localStorage.getItem(PUSH_HANDLED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Reset onboarding bookkeeping so the permission wizard runs again for the next
 * authenticated user. Call this on logout.
 *
 * NOTE: this only clears OUR flags; it canNOT revoke the actual browser
 * permission, which is device/origin-scoped and persists (only the user can
 * revoke it in Settings). So after logout the wizard re-appears only when the
 * permission is still undecided (e.g. previously skipped). If it was already
 * granted, there's nothing to re-prompt; if denied, the user must re-enable it
 * in Settings. The genuinely per-user reset is the push *subscription*
 * lifecycle (unsubscribe here, re-subscribe + register with the backend on
 * login). Wire that in once the push backend exists.
 */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(PUSH_HANDLED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Best-effort: drop this device's web-push subscription so the push-service
 * endpoint is invalidated and no further pushes reach it, even if our backend
 * still has the (now-dead) endpoint on file. The local subscription is removed
 * regardless of connectivity. No-op today since we don't subscribe yet, but
 * this is the reliable client side of stopping pushes for a reset device. The
 * server still needs to delete its stored subscription + revoke the token,
 * backend work, ideally also doable remotely from another device.
 */
export async function unsubscribePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* best effort */
  }
}

/**
 * Whether the push onboarding step should be shown after auth. Skip it when
 * already granted, when the user already resolved it, or when unsupported
 * (the standalone/install gating that fronts the whole Auth view is handled
 * separately; here we just don't show a dead "Allow" button).
 */
export function shouldOnboardPush(): boolean {
  const state = pushPermission();
  if (state === 'granted' || state === 'denied') return false;
  if (wasPushHandled()) return false;
  return state === 'default'; // supported and not yet decided
}
