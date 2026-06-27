/**
 * Hidden Chats PIN entry. Reuses the numeric PinPad (via PasscodeModal) that the app
 * passcode uses, instead of a text-box alert, so setting/changing the reveal PIN looks
 * and feels the same as the app lock. The PIN is a fixed 4 or 6 digits (chosen on the
 * pad's first step) — that fixed length is what lets the search-bar reveal auto-verify.
 *
 * Kept out of `useHiddenChats.ts` so that composable stays free of `@ionic/vue` (and
 * unit-testable in the node env without pulling Ionic in).
 */
import { modalController } from '@ionic/vue';
import PasscodeModal from '@/components/PasscodeModal.vue';
import { hasHiddenPin, enableHiddenPin } from '@/services/hidden-chats';

const PICK_DESC = 'Type this PIN into the chat search bar to reveal your hidden chats. Keep it safe — it is the only key.';

/**
 * Present the PIN pad to set (pick length → enter → confirm) or verify the Hidden
 * Chats PIN. Resolves the entered PIN, or null on cancel. Pass the known `length` for
 * 'verify' so the pad auto-submits at the right digit count.
 */
export async function presentHiddenPinPad(variant: 'set' | 'verify', length?: number): Promise<string | null> {
  const modal = await modalController.create({
    component: PasscodeModal,
    componentProps: {
      variant,
      length,
      noun: 'PIN',
      pickTitle: 'Set a Hidden Chats PIN',
      pickDesc: PICK_DESC,
    },
  });
  await modal.present();
  const { data, role } = await modal.onWillDismiss();
  return role === 'confirm' && typeof data === 'string' ? data : null;
}

/** Ensure a Hidden Chats PIN exists, prompting to create one (on the pad) if not. */
export async function ensureHiddenPin(): Promise<boolean> {
  if (await hasHiddenPin()) return true;
  const pin = await presentHiddenPinPad('set');
  if (!pin) return false;
  await enableHiddenPin(pin);
  return true;
}
