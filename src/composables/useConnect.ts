/**
 * The "add a contact" flow, shared by the Contacts tab button and the New-chat
 * modal so both behave identically: gated on a complete profile (a friend
 * request carries your name + photo), then a menu to Invite / Scan a QR / Show
 * your QR / Add by Ring ID. All stock Ionic overlays (action sheet + alert).
 */
import { useRouter } from 'vue-router';
import { alertController, actionSheetController } from '@ionic/vue';
import { addPendingInvite } from '@/db/queries';
import { appToast } from '@/services/toast';
import { createInvitation } from '@/services/api';
import { ensureProfile } from '@/composables/useProfileGate';

export function useConnect() {
  const router = useRouter();

  /** Require a name + photo before connecting; otherwise present the in-context
   *  profile-setup modal (name prefilled with the username, photo required). */
  async function requireProfile(): Promise<boolean> {
    return ensureProfile();
  }

  async function connect(): Promise<void> {
    if (!(await requireProfile())) return;
    const sheet = await actionSheetController.create({
      header: 'Connect',
      buttons: [
        { text: 'New group', handler: () => void router.push('/new-group') },
        { text: 'Browse directory', handler: () => void router.push('/directory') },
        { text: 'Invite someone', handler: () => void inviteSomeone() },
        { text: "Scan a friend's QR", handler: () => void router.push('/scan') },
        { text: 'Show my QR code', handler: () => void router.push('/settings/qr') },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Mint an invite and share it as TWO messages: a short, structured invite
   *  with the install link, then the bare code on its own so the recipient can
   *  copy it in a single tap (a code buried in a paragraph is fiddly to select).
   *  On iOS a link can't deep-link into an installed PWA, hence the install steps. */
  /** Ask for a (required) nickname for the invitee. Resolves to the trimmed name,
   *  or null if cancelled. The Create button stays put until a name is entered. */
  async function promptInviteLabel(): Promise<string | null> {
    return new Promise((resolve) => {
      void alertController
        .create({
          header: 'Invite someone',
          message:
            'Add a nickname so you remember who this invite is for. It updates to their profile once they join.',
          inputs: [{ name: 'label', type: 'text', placeholder: 'Nickname (e.g. Mom)', attributes: { maxlength: 60 } }],
          buttons: [
            { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
            {
              text: 'Create invite',
              handler: (data: { label?: string }) => {
                const label = (data?.label ?? '').toString().trim();
                if (!label) {
                  void appToast({ message: 'Please add a nickname for this invite.', duration: 1600 });
                  return false; // keep the alert open until they enter one
                }
                resolve(label);
                return true;
              },
            },
          ],
        })
        .then((a) => a.present());
    });
  }

  async function inviteSomeone(): Promise<void> {
    const label = await promptInviteLabel();
    if (label === null) return; // cancelled

    let invite: { code: string; publicUrl: string };
    try {
      invite = await createInvitation();
    } catch (e) {
      const a = await alertController.create({
        header: 'Could not create invite',
        message: e instanceof Error ? e.message : 'Please try again.',
        buttons: ['OK'],
      });
      await a.present();
      return;
    }

    const { code } = invite;
    // Track it locally so it shows under Contacts → Invited until they join.
    await addPendingInvite(code, label);
    // Message 1: short + scannable, link to install, no code (it comes next).
    const inviteText =
      `Join me on Ring \u{1F510}\n\n` +
      `1. Install: ${invite.publicUrl}\n` +
      `2. Open Ring and tap Register\n` +
      `3. Enter the invite code (next message)`;

    const copy = (text: string, note: string): boolean => {
      void navigator.clipboard?.writeText(text);
      void appToast({ message: note, duration: 1200 });
      return false; // keep the alert open so multiple copies are possible
    };

    // Copy-based fallback (no Web Share, or the user cancelled it): two clearly
    // separated actions so the code still goes out as its own message.
    const offerCopy = async (): Promise<void> => {
      const a = await alertController.create({
        header: 'Invite someone',
        subHeader: `Invite code: ${code}`,
        message: 'Send the invite, then send the code as a separate message.',
        buttons: [
          { text: 'Copy invite', handler: () => copy(inviteText, 'Invite copied') },
          { text: 'Copy code', handler: () => copy(code, 'Code copied') },
          { text: 'Done', role: 'cancel' },
        ],
      });
      await a.present();
    };

    // Step 2: send the code by itself (its own user gesture → Web Share is
    // allowed again), or copy it.
    const sendCode = async (): Promise<void> => {
      const a = await alertController.create({
        header: 'Now send the code',
        subHeader: code,
        message: 'Send this as a second message, one tap to copy on the other end.',
        buttons: [
          ...(navigator.share
            ? [{ text: 'Send code', handler: () => void navigator.share({ text: code }).catch(() => {}) }]
            : []),
          { text: 'Copy code', handler: () => copy(code, 'Code copied') },
          { text: 'Done', role: 'cancel' },
        ],
      });
      await a.present();
    };

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ring invite', text: inviteText });
      } catch {
        await offerCopy(); // cancelled / failed → copy path
        return;
      }
      await sendCode(); // message 1 sent → prompt for the code as message 2
      return;
    }
    await offerCopy();
  }

  return { connect, requireProfile };
}
