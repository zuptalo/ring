/**
 * The one place functional toasts are created.
 *
 * "Functional" toasts are the small, transient confirmations ("Muted", "Copied") and
 * errors ("Microphone unavailable"), plus status notices ("Someone left the call",
 * "Invite cancelled"). They render through the SAME in-app banner overlay
 * (NotificationBanners.vue, via notify.showStatusBanner) as messages / requests / system
 * notices / the update prompt — so EVERY in-app notification shares one style, position and
 * feel (one component), instead of a separate Ionic toast. Call sites only supply the
 * message (and optionally a colour variant or duration).
 */
import { showStatusBanner } from '@/services/notify';

export interface AppToastOptions {
  message: string;
  /** ms on screen; defaults to a sensible short duration. */
  duration?: number;
  /** Colour variant: 'danger' for errors, 'success' for confirmations (else the green theme). */
  color?: string;
  /** Optional leading ionicon. */
  icon?: string;
}

/** Present a functional toast through the shared in-app banner overlay. */
export async function appToast(opts: AppToastOptions | string): Promise<void> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  const tone = o.color === 'danger' ? 'danger' : o.color === 'success' ? 'success' : undefined;
  showStatusBanner(o.message, { icon: o.icon, tone, durationMs: o.duration });
}
