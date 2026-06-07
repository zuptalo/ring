/**
 * Profile gate. A user must have a name + photo before they can START a
 * conversation (so the other side never sees them as a nameless, faceless id).
 * Receiving messages/calls is never gated, only initiating.
 *
 * `ensureProfile()` returns true when the profile is already complete (or the user
 * completes it in the presented modal), and false when they dismiss it unfinished,
 * in which case the caller must NOT proceed with starting the chat.
 */
import { modalController } from '@ionic/vue';
import { profileComplete } from '@/db/queries';
import ProfileSetupModal from '@/components/ProfileSetupModal.vue';

let presenting = false;

export async function ensureProfile(opts?: { mandatory?: boolean }): Promise<boolean> {
  if (await profileComplete()) return true;
  if (presenting) return false; // a gate is already up (avoid stacking modals)
  presenting = true;
  try {
    const modal = await modalController.create({
      component: ProfileSetupModal,
      // In mandatory (onboarding) mode the modal has no close button, so finishing
      // is the only exit; otherwise it can be dismissed unfinished (caller stops).
      componentProps: { mandatory: !!opts?.mandatory },
      backdropDismiss: false, // must finish or explicitly close
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    return data === true && (await profileComplete());
  } finally {
    presenting = false;
  }
}
