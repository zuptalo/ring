/**
 * New-version detection + update prompt.
 *
 * The PWA is built with registerType: 'prompt' (vite.config.ts), so a freshly
 * deployed build installs its service worker but WAITS rather than taking over.
 * When that happens we surface an in-app notification card that NAMES the new version
 * (read from /v1/config, since the SW update event itself carries no version string) and
 * let the user pull it immediately (skipWaiting + reload) or defer. Deferring keeps the
 * current version running; the prompt REAPPEARS every time the app returns to the
 * foreground (and on next launch) until accepted, so a user who taps "Later" and
 * never fully closes the app is reminded again instead of having to hunt for a
 * manual reload. (A full close lets the waiting worker activate on its own, so
 * there's nothing left to prompt.)
 *
 * Update checks are EVENT-DRIVEN (no polling): on app open (registerSW's own initial
 * check), on foreground, and on a transport disconnect (useSync calls checkForUpdate,
 * a drop can mean the server restarted for a deploy). checkForUpdate is throttled so
 * a flapping connection can't hammer it.
 */
import { watch } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { modalController } from '@ionic/vue';
import { sparklesOutline } from 'ionicons/icons';
import { fetchServerConfig } from '@/services/api';
import { showActionBanner, type NotifyAction } from '@/services/notify';
import { computeDelta, userFacing, displayVersion, type ReleaseNote } from '@/services/release-notes';
import WhatsNewSheet from '@/components/WhatsNewSheet.vue';

/** Present the "What's new" sheet with the per-user delta. Resolves true when the
 *  user chose to install from the sheet. */
async function presentWhatsNew(version: string, notes: ReleaseNote[]): Promise<boolean> {
  const modal = await modalController.create({
    component: WhatsNewSheet,
    componentProps: { version, notes },
    breakpoints: [0, 1],
    initialBreakpoint: 1,
    cssClass: 'whats-new-modal',
  });
  await modal.present();
  const { role } = await modal.onDidDismiss();
  return role === 'update';
}

let started = false;
let swReg: ServiceWorkerRegistration | null = null;
let lastCheck = 0;
const CHECK_THROTTLE_MS = 10_000;

/**
 * Ask the service worker to check for a newer deployed build. Safe to call on app
 * open, foreground, and whenever the server connection drops or is restored (a deploy
 * restarts the server). Throttled to avoid hammering, EXCEPT when `force` is set:
 * a reconnect is a strong "the server may have just been redeployed" signal, and the
 * offline check that fired moments earlier (often while the network was still down,
 * so it couldn't actually fetch the new worker) would otherwise swallow it within the
 * throttle window. A found update surfaces the version toast via needRefresh.
 */
export function checkForUpdate(force = false): void {
  if (!swReg) return;
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_THROTTLE_MS) return;
  lastCheck = now;
  void swReg.update().catch(() => {});
}

export function useAppUpdate(): void {
  if (started) return; // singleton: one registration + prompt driver per app
  started = true;

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return;
      swReg = reg; // registerSW already does the initial (app-open) check
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          checkForUpdate(); // look for a newer build
          void maybePrompt(); // re-surface a waiting update the user deferred earlier
        });
      }
    },
  });

  let prompting = false;

  // Build + present the update prompt as a persistent in-app notification card (the SAME
  // shared overlay as message/request/system banners — NotificationBanners.vue — so it
  // renders identically: a rounded card below the header, never a top-pinned toast).
  // Idempotent while one is already showing (prompting) and a no-op when nothing is waiting
  // (needRefresh false). Driven by BOTH the needRefresh watch (a new worker just appeared)
  // and every return to the foreground, so tapping "Later" doesn't bury the update forever
  // for someone who never fully closes the app — it comes back next time they reopen it.
  async function maybePrompt(): Promise<void> {
    if (!needRefresh.value || prompting) return;
    prompting = true;
    // The waiting SW IS the new build; ask the (already-deployed) server which
    // version that is AND its release notes, so the card can name the version and
    // offer a per-user "What's new". A miss just drops both (generic message).
    let version = '';
    let incoming: ReleaseNote[] = [];
    try {
      const cfg = await fetchServerConfig();
      version = cfg.version ?? '';
      incoming = cfg.notes ?? [];
    } catch {
      /* generic message + no notes when config can't be fetched */
    }
    const running = __APP_VERSION__;
    // Display version strips the long +<sha> build metadata (it's an unbreakable
    // token that otherwise wraps one char per line and wrecks the layout).
    const shown = displayVersion(version);
    const label = version && version !== running ? `Ring ${shown} is ready to install.` : 'A new version of Ring is ready.';

    // Per-user delta: the changes the incoming build adds that this one didn't have,
    // narrowed to what a regular user cares about (features/fixes, not CI/test/docs/
    // chores) so "What's new" reads as improvements rather than a developer changelog.
    const delta = userFacing(computeDelta(incoming, __RELEASE_NOTES__ ?? []));

    const actions: NotifyAction[] = [];
    if (delta.length) {
      actions.push({
        text: `What's new (${delta.length})`,
        // Opens the sheet, which carries its own Update / Later actions. The card is
        // dismissed by NotificationBanners' onAction; if the user closes the sheet without
        // updating, the prompt re-appears on the next foreground (prompting is reset below).
        handler: () => {
          void presentWhatsNew(shown, delta).then((wantsUpdate) => {
            if (wantsUpdate) void updateServiceWorker(true);
          });
        },
      });
    }
    actions.push({ text: 'Update', handler: () => void updateServiceWorker(true) });
    // "Later": the card dismisses (NotificationBanners' onAction), which fires onDismiss
    // below and re-arms the prompt for the next foreground.
    actions.push({ text: 'Later', role: 'cancel', handler: () => {} });

    showActionBanner({
      name: 'Update available',
      body: label,
      icon: sparklesOutline, // leading glyph, matching the in-app banners' icon/avatar
      actions,
      // Mirror of the old toast.onDidDismiss: re-allow a prompt once the card is gone, so a
      // deferred update resurfaces next foreground (or when a still-newer build appears).
      onDismiss: () => {
        prompting = false;
      },
    });
  }

  // Fire when a new worker first appears; immediate covers an update that was
  // already waiting when the app mounted.
  watch(needRefresh, () => void maybePrompt(), { immediate: true });
}
