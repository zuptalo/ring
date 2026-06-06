/**
 * Shared state for the keystore gate (create PIN → recovery code → unlock).
 *
 * Singleton module state so both App.vue (to hide the router outlet while the
 * gate is up) and KeyGuard.vue (to render it) read the same source of truth.
 * The gate is rendered as a full ion-page that replaces the app content, so
 * there's nothing behind it to bleed through when the keyboard resizes the app.
 *
 * PIN entry is driven by an in-app numeric keypad (PinPad), not the OS
 * keyboard, so unlock works the same on every platform without depending on
 * the browser raising a keyboard.
 */
import { computed, ref, watch } from 'vue';
import { isAuthenticated, clearToken } from '@/services/auth';
import {
  isInitialized, isUnlocked, loadIdentityState, ensureIdentity, unlock,
  verifyRecoveryCode, recoverWithCode, attemptDeviceUnlock, getPinLength,
} from '@/services/crypto/identity';
import { isPasskeyEnrolled, unlockWithPasskey } from '@/services/crypto/passkey';
import { migrateSecrets } from '@/db/secrets';
import { rememberDevPin } from '@/services/crypto/devUnlock';
import { wipeAllStores } from '@/db/idb';
import { unsubscribePush } from '@/services/permissions';

const stateLoaded = ref(false);
const error = ref('');
const busy = ref(false);
const copied = ref(false);
const recoveryCode = ref<string | null>(null);
// Whether a passkey is enrolled; drives the "Unlock with passkey" button.
// Sourced from the blob's presence (the truth), not the mirrored setting.
const passkeyEnrolled = ref(false);
// Length of the set PIN (4 or 6), or null when passwordless / legacy. The unlock
// pad auto-verifies the instant this many digits are entered.
const pinLength = ref<number | null>(null);

let loadStarted = false;
function ensureStateLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  void isPasskeyEnrolled().then((v) => {
    passkeyEnrolled.value = v;
  });
  // Read the keystore, then try the passwordless device auto-unlock. Only flip
  // stateLoaded once that's settled, so the gate's neutral spinner covers it and
  // an auto-unlock account never flashes the passcode pad. A PIN-locked account
  // (no deviceWrapped) returns false → the gate shows the unlock pad as before.
  void loadIdentityState()
    .then(() => attemptDeviceUnlock())
    .catch(() => false)
    .finally(() => {
      stateLoaded.value = true;
    });
}

const needsGate = computed(
  () => isAuthenticated.value && (!isInitialized.value || !isUnlocked.value),
);

// Refresh the stored PIN length whenever the gate appears (startup, or an auto-lock
// after the user just enabled a passcode in Settings), so the unlock pad always
// auto-verifies at the current length.
watch(
  needsGate,
  (gate) => {
    if (gate) void getPinLength().then((v) => (pinLength.value = v));
  },
  { immediate: true },
);

/** Whether the gate should be shown. It is shown EAGERLY while the keystore
 *  state is still loading (when authenticated) so the real app never flashes
 *  behind it on startup; KeyGuard renders a neutral loading screen until `ready`.
 *  Also held open through the recovery step. */
const showGate = computed(
  () =>
    isAuthenticated.value &&
    (!stateLoaded.value || needsGate.value || recoveryCode.value !== null),
);

/** False until the persisted keystore state has been read (so KeyGuard knows
 *  whether to show create vs unlock rather than guessing). */
const ready = computed(() => stateLoaded.value);

const mode = computed<'create' | 'recovery' | 'unlock'>(() => {
  if (recoveryCode.value) return 'recovery';
  if (!isInitialized.value) return 'create';
  return 'unlock';
});

/** Create the identity protected by `pin`; surfaces the one-time recovery code. */
async function createWithPin(pin: string): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    recoveryCode.value = await ensureIdentity(pin);
    await migrateSecrets(); // encrypt any pre-existing plaintext profile data
    await seedName(); // prefill the profile name with the username on a fresh account
    rememberDevPin(pin); // dev-only: skip the gate on future reloads (no-op in prod)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create your account.';
  } finally {
    busy.value = false;
  }
}

/** Default passwordless create: generate the identity wrapped under the device key
 *  (no passcode) and surface the one-time recovery code. */
async function createAuto(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    recoveryCode.value = await ensureIdentity(); // no pin → device auto-unlock
    await migrateSecrets();
    await seedName(); // prefill the profile name with the username on a fresh account
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create your account.';
  } finally {
    busy.value = false;
  }
}

/** Prefill the profile name from the username on a brand-new account (lazy-imported
 *  so the heavy queries module isn't pulled into the gate's startup path). */
async function seedName(): Promise<void> {
  try {
    await (await import('@/db/queries')).seedProfileName();
  } catch {
    /* best-effort: the profile-setup modal also seeds the name on demand */
  }
}

/** Unlock with `pin`; returns whether it succeeded. */
async function unlockWithPin(pin: string): Promise<boolean> {
  error.value = '';
  busy.value = true;
  try {
    await unlock(pin);
    await migrateSecrets(); // upgrade any legacy plaintext profile data in place
    rememberDevPin(pin); // dev-only: skip the gate on future reloads (no-op in prod)
    return true;
  } catch {
    error.value = 'Incorrect PIN. Try again.';
    return false;
  } finally {
    busy.value = false;
  }
}

/**
 * Unlock with the enrolled passkey. Returns whether it succeeded; on a silent
 * user-cancel the caller just stays on the PIN pad. A 'stale' result means the
 * sealed PIN no longer matches (passcode changed); the service already dropped
 * the enrollment, so we hide the button and ask for the PIN.
 */
async function tryUnlockWithPasskey(): Promise<boolean> {
  error.value = '';
  busy.value = true;
  try {
    const res = await unlockWithPasskey();
    if (res.ok) {
      await migrateSecrets();
      return true;
    }
    if (res.reason === 'stale') {
      passkeyEnrolled.value = false;
      error.value = 'Passkey unlock is out of date. Enter your passcode.';
    } else if (res.reason === 'not-enrolled') {
      passkeyEnrolled.value = false;
    } else if (res.reason !== 'user-cancelled') {
      error.value = 'Passkey unlock failed. Enter your passcode.';
    }
    return false;
  } finally {
    busy.value = false;
  }
}

/** Verify a recovery code (no state change). */
async function checkRecoveryCode(code: string): Promise<boolean> {
  error.value = '';
  busy.value = true;
  try {
    return await verifyRecoveryCode(code);
  } finally {
    busy.value = false;
  }
}

/**
 * Recover with the verified code; unlocks on success and surfaces the freshly-issued
 * recovery code on the recovery-display screen. Passwordless by default (device-key
 * posture, matching registration); pass `newPin` only to recover straight into a
 * PIN lock. Recovery never forces a passcode.
 */
async function completeRecovery(code: string, newPin?: string): Promise<boolean> {
  error.value = '';
  busy.value = true;
  try {
    recoveryCode.value = await recoverWithCode(code, newPin); // shows the new code
    return true;
  } catch {
    error.value = 'Recovery failed. Check your code and try again.';
    return false;
  } finally {
    busy.value = false;
  }
}

async function copyCode(): Promise<void> {
  if (!recoveryCode.value) return;
  try {
    await navigator.clipboard.writeText(recoveryCode.value);
    copied.value = true;
  } catch {
    /* clipboard unavailable; the code is visible to copy manually */
  }
}

function ackRecovery(): void {
  recoveryCode.value = null;
  copied.value = false;
}

/**
 * Forgot-passcode last resort: full LOCAL factory reset, drop the push
 * subscription, erase every on-device store (keys, profile, chats, settings,
 * outbox, …) and clear the token. Works offline; this only guarantees the data
 * is gone from THIS device. Server-side revocation (invalidate the token, delete
 * the push subscription, rotate prekeys) is backend work and is best driven
 * remotely from another device for a truly lost device. See notes in the code.
 */
async function resetDevice(): Promise<void> {
  await unsubscribePush();
  await wipeAllStores();
  clearToken();
}

export function useKeyGuard() {
  ensureStateLoaded();
  return {
    showGate,
    ready,
    mode,
    error,
    busy,
    copied,
    recoveryCode,
    passkeyEnrolled,
    pinLength,
    createWithPin,
    createAuto,
    unlockWithPin,
    tryUnlockWithPasskey,
    checkRecoveryCode,
    completeRecovery,
    copyCode,
    ackRecovery,
    resetDevice,
  };
}
