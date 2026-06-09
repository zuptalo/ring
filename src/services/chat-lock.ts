/**
 * "Lock chat" gating. Locked chats are hidden from the main list into a Locked-chats
 * view that requires a fresh auth check (passkey, else the app passcode) to open. We
 * reuse the app's existing lock stack rather than a per-chat secret (v1): locking a
 * chat is only offered once an app passcode is set.
 */
import { modalController } from '@ionic/vue';
import PasscodeModal from '@/components/PasscodeModal.vue';
import { isLockEnabled, verifyPin, getPinLength } from '@/services/crypto/identity';
import { isPasskeyEnrolled, unlockWithPasskey } from '@/services/crypto/passkey';

/** Whether an app passcode/passkey lock is configured (required before a chat can be
 *  locked). When false, the UI should route the user to App lock setup. */
export function lockConfigured(): Promise<boolean> {
  return isLockEnabled();
}

/** Prompt a fresh auth check (passkey if enrolled, else the passcode). Resolves true
 *  only when the user verifies. Used to gate the Locked-chats view. */
export async function verifyAppLock(): Promise<boolean> {
  if (!(await isLockEnabled())) return false;
  // Prefer a passkey/biometric check; fall back to the passcode on cancel/failure.
  if (await isPasskeyEnrolled()) {
    const res = await unlockWithPasskey();
    if (res.ok) return true;
  }
  const length = (await getPinLength()) ?? undefined;
  const modal = await modalController.create({
    component: PasscodeModal,
    componentProps: { variant: 'verify', length },
  });
  await modal.present();
  const { data, role } = await modal.onWillDismiss();
  if (role !== 'confirm' || typeof data !== 'string') return false;
  return verifyPin(data);
}
