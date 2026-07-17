import { onMounted, onUnmounted } from 'vue';
import { getSetting, setSetting } from '@/db/queries';
import { SUMMARY_KEY } from '@/services/sw-inbox';

/**
 * Keeps the app-icon badge in sync: the service worker grows it (to the number
 * of pending push notifications) while the app is closed; here we dismiss any
 * lingering notifications whenever the app is foregrounded, and (when the badge
 * mode is "When opened", notifications.badge) clear the icon badge too. In the
 * "When viewed" mode the badge is left to track the unread total (useBadges).
 */
export function useAppBadge(): void {
  const clearWhenVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        void reg?.getNotifications().then((list) => list.forEach((n) => n.close()));
      });
    }
    // (spec 2017) Foregrounding means the user is now reading; retire the SW's per-chat "last shown"
    // summary so a stray push within its TTL can't silently re-assert a notification for a chat that's
    // just been read (or re-assert a now-stale cumulative count).
    void setSetting(SUMMARY_KEY, []);
    // (spec 1040 FR-009) Retire the SW's per-call badge units: a still-ringing
    // call is now handled by the open app (its increment goes away), and a missed
    // call is represented in the calls store by now, which useBadges counts —
    // keeping the unit too would double-badge it.
    void setSetting('sw.callBadge', []);
    void getSetting<string>('notifications.badge', 'open').then((mode) => {
      if (mode !== 'open') return; // "When viewed" → leave the unread-count badge
      const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
      void nav.clearAppBadge?.();
    });
  };

  onMounted(() => {
    clearWhenVisible();
    document.addEventListener('visibilitychange', clearWhenVisible);
  });
  onUnmounted(() => document.removeEventListener('visibilitychange', clearWhenVisible));
}
