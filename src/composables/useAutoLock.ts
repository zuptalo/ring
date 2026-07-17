/**
 * Auto-lock: re-lock the keystore (re-show the KeyGuard passkey/PIN gate) when the
 * app returns to the foreground after sitting in the background longer than the
 * grace period configured in Privacy → App lock.
 *
 * Only active when a passcode lock is enabled (the opt-in posture). Passwordless
 * (auto-unlock) users are never re-locked, the app would just auto-unlock again,
 * and the device key intentionally keeps the keystore reachable for background
 * notifications.
 *
 * The "last hidden" timestamp lives in memory: that survives a background freeze
 * (the page is retained), and if the PWA is fully killed the keystore is already
 * locked on relaunch, so the gate shows regardless.
 */
import { onMounted, onUnmounted } from 'vue';
import { getSetting, setSetting } from '@/db/queries';
import { isUnlockedNow, lock, isLockEnabled } from '@/services/crypto/identity';

// Setting value → grace period in ms used on a foreground return. 'never' = Infinity,
// so the app is never re-locked while it stays alive (backgrounded included); only a
// full close re-locks (the keystore is PIN-wrapped at rest, so a relaunch always
// gates regardless). Any value no longer offered falls back to '1m' below; onMounted
// also migrates stale picks to the nearest current option.
const TIMEOUT_MS: Record<string, number> = {
  never: Infinity,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '8h': 28_800_000,
  '24h': 86_400_000,
};

export function useAutoLock(): void {
  let hiddenAt: number | null = null;

  async function onVisible(): Promise<void> {
    if (hiddenAt === null) return;
    const away = Date.now() - hiddenAt;
    hiddenAt = null;
    if (!isUnlockedNow()) return; // already locked / not set up
    if (!(await isLockEnabled())) return; // passwordless → never auto-lock
    const pref = await getSetting<string>('privacy.appLock.timeout', '1m');
    const limit = TIMEOUT_MS[pref] ?? TIMEOUT_MS['1m'];
    if (away >= limit) lock();
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else void onVisible();
  };

  onMounted(async () => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    // One-time normalization: the picker was trimmed (Immediately/30s/2-4m removed,
    // Never (re)added), so map any stored value no longer offered to the nearest
    // current option — otherwise the picker shows no selection. 'never' is now a
    // valid choice and is preserved.
    const cur = await getSetting<string>('privacy.appLock.timeout', '1m');
    const remap: Record<string, string> = { instant: '1m', '30s': '1m', '2m': '5m', '3m': '5m', '4m': '5m' };
    if (remap[cur]) await setSetting('privacy.appLock.timeout', remap[cur]);
  });
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange));
}
