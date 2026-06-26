/**
 * Hidden Chats reveal session (spec 1019, US3).
 *
 * The "revealed" state is deliberately in-memory only — a full app close drops it
 * so hidden chats always re-lock on cold start (FR-005 / SC-009). Revealing is
 * sticky across brief backgrounding for a configurable grace window so switching
 * apps to copy-paste doesn't re-lock every time; the window is measured with
 * `performance.now()` (monotonic) so changing the device clock can't extend a
 * reveal (FR-023). An app auto-lock also ends the session (FR-025).
 *
 * Mirrors `useAutoLock.ts`'s visibilitychange + elapsed-time pattern.
 */
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { getSetting } from '@/db/queries';
import { isUnlocked } from '@/services/crypto/identity';
import { verifyHiddenPin } from '@/services/hidden-chats';
import { setRevealed, isRevealed, clearHiddenState } from '@/services/hidden-state';

/** Grace option → milliseconds. */
export const GRACE_MS: Record<string, number> = {
  immediately: 0,
  '1m': 60_000,
  '5m': 300_000,
};

export function graceLimitMs(pref: string): number {
  return GRACE_MS[pref] ?? GRACE_MS['1m'];
}

// Single shared reveal-session state for all consumers. Starts locked; never
// persisted, so a cold start is always locked.
const revealed = ref(false);
let hiddenAt: number | null = null;

/** Verify the dedicated PIN and, on success, start the reveal session. */
export async function revealWithPin(pin: string): Promise<boolean> {
  const ok = await verifyHiddenPin(pin);
  if (ok) {
    setRevealed(true);
    revealed.value = true;
  }
  return ok;
}

/** End the reveal session — hidden chats hide again immediately. */
export function relockHidden(): void {
  setRevealed(false);
  revealed.value = false;
  hiddenAt = null;
}

async function onForeground(): Promise<void> {
  if (hiddenAt === null) return;
  const away = performance.now() - hiddenAt;
  hiddenAt = null;
  if (!isRevealed()) return;
  const pref = await getSetting<string>('privacy.hiddenChatsGrace', '1m');
  if (away >= graceLimitMs(pref)) relockHidden();
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') hiddenAt = performance.now();
  else void onForeground();
}

export function useHiddenChats(): {
  revealed: typeof revealed;
  reveal: (pin: string) => Promise<boolean>;
  relock: () => void;
} {
  let stopWatch: (() => void) | null = null;
  onMounted(() => {
    revealed.value = isRevealed();
    document.addEventListener('visibilitychange', onVisibility);
    // FR-025: an app auto-lock (keystore re-locks) must also end any reveal
    // session and drop the cached set — hidden chats never sit revealed behind a
    // locked app.
    stopWatch = watch(isUnlocked, (v) => {
      if (!v) {
        relockHidden();
        clearHiddenState();
      }
    });
  });
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    stopWatch?.();
  });
  return { revealed, reveal: revealWithPin, relock: relockHidden };
}
