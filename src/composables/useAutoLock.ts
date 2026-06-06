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

// Setting value → grace period in ms. 'instant' = lock on any return. There is no
// 'never': a never-locking passcode just risks a forgotten-passcode lockout (you
// can't disable the lock without the passcode), so to stop locking you turn the
// lock OFF. Any stale 'never' from before falls back to '1m' below.
const TIMEOUT_MS: Record<string, number> = {
  instant: 0,
  '30s': 30_000,
  '1m': 60_000,
  '2m': 120_000,
  '3m': 180_000,
  '4m': 240_000,
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
    // One-time migration: the removed 'Never' option becomes '24h' (the gentlest
    // finite grace), so an existing 'never' user gets a real-but-rare lock and the
    // picker shows a valid selection instead of nothing.
    if ((await getSetting<string>('privacy.appLock.timeout', '1m')) === 'never') {
      await setSetting('privacy.appLock.timeout', '24h');
    }
  });
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange));
}
