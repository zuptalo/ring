/**
 * Ask for Web Push permission on a FRESH app open when it's still undecided.
 *
 * Why this exists: a reinstall (and, on iOS, an OS-level reset) puts the browser's
 * notification permission back to `default` and drops the push subscription. Web Push
 * can only be (re)granted from a user gesture, so nothing can re-subscribe silently —
 * without a nudge the user is left with no alerts and no obvious prompt until they dig
 * into Settings. This surfaces a single in-app ask on cold start; tapping "Turn on"
 * fires the real prompt (and push.ts then subscribes + registers with the server).
 *
 * Deliberately narrow:
 *  - Only NOTIFICATIONS get an up-front ask. Camera/mic/media stay request-at-use —
 *    they have a natural moment (you tap record / call), notifications don't (they fire
 *    when the app is closed).
 *  - We stay silent during the sign-in/onboarding flow (`/auth`): its own push step owns
 *    the first ask, so we don't double-prompt. If the user skips it there, the nudge
 *    picks up on the NEXT cold start.
 *  - Once the choice is made we stop: `granted` needs nothing here (push.ts subscribes on
 *    connect), and `denied` can't be re-prompted from the page anyway (nagging it would
 *    only annoy). We also respect the user having turned notifications OFF.
 */
import { watch } from 'vue';
import { useRouter } from 'vue-router';
import { alertController } from '@ionic/vue';
import { isUnlocked } from '@/services/crypto/identity';
import { isAuthenticated } from '@/services/auth';
import { isPushSupported, pushPermission } from '@/services/permissions';
import { requestPushPermission } from '@/services/notifications';
import { getSetting } from '@/db/queries';

export function useNotificationNudge(): void {
  const router = useRouter();
  let done = false;
  // If this load ever passes through the auth/onboarding flow, let onboarding own the
  // push ask for THIS load; the nudge then applies on the next cold start.
  let sawAuth = false;

  const stop = watch(
    () => [isUnlocked.value, isAuthenticated.value, router.currentRoute.value.path] as const,
    async ([unlocked, authed, path]) => {
      if (path.startsWith('/auth')) {
        sawAuth = true;
        return;
      }
      if (done || sawAuth || !unlocked || !authed) return;
      done = true;
      stop();
      if (!isPushSupported() || pushPermission() !== 'default') return; // decided/unsupported → nothing to ask
      if (!(await getSetting<boolean>('notifications.push', true))) return; // user turned notifications off
      await promptEnablePush();
    },
    { immediate: true },
  );
}

async function promptEnablePush(): Promise<void> {
  const alert = await alertController.create({
    header: 'Turn on notifications?',
    message: 'Get alerts for new messages and calls, even when Ring is closed.',
    buttons: [
      { text: 'Not now', role: 'cancel' },
      {
        text: 'Turn on',
        handler: () => {
          // Fire the native prompt straight from this tap — a user gesture is required
          // (iOS especially). On a grant, notifications.ts → applyPushPreference subscribes
          // and registers the endpoint with the server.
          void requestPushPermission();
        },
      },
    ],
  });
  await alert.present();
}
