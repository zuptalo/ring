/**
 * DEV-ONLY keystore auto-unlock. The passcode gate decrypts your identity keys
 * into memory, which resets on every reload (painful under HMR). In development
 * we stash the PIN at the last manual unlock and silently re-unlock ONCE on boot,
 * so the gate stops prompting on reload/restart.
 *
 * BOOT-ONLY on purpose: once the keystore has been unlocked this page-load, a later
 * lock is INTENTIONAL (App-lock timeout via useAutoLock, or a manual lock) and must
 * be left alone, otherwise the dev convenience would silently undo the auto-lock
 * you're trying to exercise locally. (Previously it re-unlocked on every lock, which
 * defeated the App-lock timing in dev.)
 *
 * Everything here is gated on `import.meta.env.DEV`, which Vite compiles to
 * `false` in production builds, so the PIN is NEVER stored and the keystore is
 * NEVER auto-unlocked in a real build (this code tree-shakes away entirely).
 */
import { watch } from 'vue';
import { isInitialized, isUnlocked, unlock } from '@/services/crypto/identity';

const KEY = 'ring.devPin';

/** Remember the PIN for dev auto-unlock (no-op in production). */
export function rememberDevPin(pin: string): void {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(KEY, pin);
  } catch {
    /* private mode, ignore */
  }
}

export function clearDevPin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function devPin(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let unlocking = false;
// True once the keystore has been unlocked by ANY means this page-load (device-key
// auto-unlock, manual PIN, or our boot unlock). After that we never auto-unlock
// again, so a mid-session auto-lock / manual lock is respected.
let everUnlocked = false;

async function attempt(): Promise<void> {
  if (!import.meta.env.DEV || unlocking || everUnlocked) return;
  if (!isInitialized.value || isUnlocked.value) return;
  const pin = devPin();
  if (!pin) return;
  unlocking = true;
  try {
    await unlock(pin);
  } catch {
    clearDevPin(); // stale (PIN was changed) → stop auto-unlocking
  } finally {
    unlocking = false;
  }
}

let installed = false;
/** Install the dev BOOT auto-unlock. Safe to call once. */
export function installDevAutoUnlock(): void {
  if (!import.meta.env.DEV || installed) return;
  installed = true;
  // Latch "unlocked this session" on the first unlock by any means, so a later lock
  // is left alone (the auto-lock you're testing actually sticks).
  watch(isUnlocked, (u) => { if (u) everUnlocked = true; }, { immediate: true });
  void attempt(); // in case identity state already loaded
  // Catches the async identity-state load at boot; once everUnlocked, this no-ops.
  watch([isInitialized, isUnlocked], () => void attempt());
}
