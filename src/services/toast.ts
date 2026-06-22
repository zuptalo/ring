/**
 * The one place functional toasts are created.
 *
 * "Functional" toasts are the small, transient confirmations ("Muted", "Copied") and
 * errors ("Microphone unavailable") scattered across the app — as opposed to the
 * notification-class cards (messages / requests / system notices / the update prompt),
 * which all render through the shared in-app banner overlay (NotificationBanners.vue).
 *
 * Routing every functional toast through `appToast` gives them ONE consistent
 * position, corner rounding (via the `app-toast` cssClass styled once in App.vue), and
 * default duration — tunable in a single place — so individual call sites only supply
 * the message text (and optionally a colour variant or an explicit duration). These stay
 * simple Ionic toasts on purpose; they are NOT forced into the avatar-card component.
 */
import { toastController } from '@ionic/vue';

export interface AppToastOptions {
  message: string;
  /** ms on screen; defaults to a sensible short duration. */
  duration?: number;
  /** Ionic colour variant, e.g. 'danger' for errors, 'success' for confirmations. */
  color?: string;
  /** Optional leading ionicon. */
  icon?: string;
}

const DEFAULT_DURATION_MS = 1800;

/** Present a functional toast with the app's shared styling. */
export async function appToast(opts: AppToastOptions | string): Promise<void> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  const t = await toastController.create({
    message: o.message,
    duration: o.duration ?? DEFAULT_DURATION_MS,
    color: o.color,
    icon: o.icon,
    position: 'top',
    cssClass: 'app-toast',
  });
  await t.present();
}
