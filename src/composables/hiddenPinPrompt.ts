/**
 * Shared UI helper for creating the Hidden Chats PIN (spec 1019). Used by both the
 * "Hide chat" action and the "New hidden chat" flow so the first-time create flow
 * (double-entry with confirmation, FR-003) lives in exactly one place.
 *
 * Kept out of `useHiddenChats.ts` so that composable stays free of `@ionic/vue`
 * (and unit-testable in the node env without pulling Ionic in).
 */
import { alertController } from '@ionic/vue';
import { hasHiddenPin, enableHiddenPin } from '@/services/hidden-chats';

/** Prompt for a new PIN with confirmation; resolves the PIN, or null on cancel. */
export async function promptCreateHiddenPin(): Promise<string | null> {
  return new Promise((resolve) => {
    void alertController
      .create({
        header: 'Create a Hidden Chats PIN',
        message:
          'Enter this PIN in the chat search bar to reveal hidden chats. Keep it safe — it is the only key.',
        inputs: [
          { name: 'pin', type: 'password', attributes: { inputmode: 'numeric' }, placeholder: 'PIN (4+ digits)' },
          { name: 'confirm', type: 'password', attributes: { inputmode: 'numeric' }, placeholder: 'Confirm PIN' },
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          {
            text: 'Create',
            handler: (data: { pin?: string; confirm?: string }) => {
              const pin = (data.pin ?? '').trim();
              const confirm = (data.confirm ?? '').trim();
              // Keep the alert open on an invalid or mismatched entry.
              if (!/^\d{4,}$/.test(pin) || pin !== confirm) return false;
              resolve(pin);
              return true;
            },
          },
        ],
      })
      .then((a) => a.present());
  });
}

/** Ensure a Hidden Chats PIN exists, prompting to create one if not. */
export async function ensureHiddenPin(): Promise<boolean> {
  if (await hasHiddenPin()) return true;
  const pin = await promptCreateHiddenPin();
  if (!pin) return false;
  await enableHiddenPin(pin);
  return true;
}
