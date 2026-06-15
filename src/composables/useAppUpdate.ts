/**
 * New-version detection + update prompt.
 *
 * The PWA is built with registerType: 'prompt' (vite.config.ts), so a freshly
 * deployed build installs its service worker but WAITS rather than taking over.
 * When that happens we surface a toast that NAMES the new version (read from
 * /v1/config, since the SW update event itself carries no version string) and let
 * the user pull it immediately (skipWaiting + reload) or defer. Deferring keeps the
 * current version running; the prompt reappears on the next launch until accepted.
 *
 * Update checks are EVENT-DRIVEN (no polling): on app open (registerSW's own initial
 * check), on foreground, and on a transport disconnect (useSync calls checkForUpdate,
 * a drop can mean the server restarted for a deploy). checkForUpdate is throttled so
 * a flapping connection can't hammer it.
 */
import { watch } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { toastController, modalController } from '@ionic/vue';
import { fetchServerConfig } from '@/services/api';
import { computeDelta, displayVersion, type ReleaseNote } from '@/services/release-notes';
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
          if (document.visibilityState === 'visible') checkForUpdate();
        });
      }
    },
  });

  let prompting = false;
  watch(
    needRefresh,
    async (need) => {
      if (!need || prompting) return;
      prompting = true;
      // The waiting SW IS the new build; ask the (already-deployed) server which
      // version that is AND its release notes, so the toast can name the version and
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
      // token that otherwise wraps one char per line and wrecks the toast).
      const shown = displayVersion(version);
      const label = version && version !== running ? `Ring ${shown} is ready to install.` : 'A new version of Ring is ready.';

      // Per-user delta: the changes the incoming build adds that this one didn't have.
      const delta = computeDelta(incoming, __RELEASE_NOTES__ ?? []);

      const buttons: { text: string; role?: 'cancel'; handler?: () => boolean | void }[] = [];
      if (delta.length) {
        buttons.push({
          text: `What's new (${delta.length})`,
          // No `return false`: tapping this dismisses the toast and opens the sheet,
          // which carries its own Update / Later actions.
          handler: () => {
            void presentWhatsNew(shown, delta).then((wantsUpdate) => {
              if (wantsUpdate) void updateServiceWorker(true);
            });
          },
        });
      }
      buttons.push({ text: 'Update', handler: () => void updateServiceWorker(true) });
      buttons.push({ text: 'Later', role: 'cancel' });

      const toast = await toastController.create({
        header: 'Update available',
        message: label,
        // Top of the screen, where every other notification (banners, error
        // toasts) surfaces; see the .app-update-toast rules in App.vue.
        position: 'top',
        cssClass: 'app-update-toast',
        // Stack the buttons BELOW the message. The default 'baseline' layout puts
        // the (three) buttons inline with the message and reserves their width, so
        // on a phone the message gets squeezed into a sliver and wraps one word per
        // line. Stacked gives the message the full toast width.
        layout: 'stacked',
        // No duration: stay until the user chooses.
        buttons,
      });
      void toast.onDidDismiss().then(() => {
        prompting = false; // allow a re-prompt if a still-newer build arrives
      });
      await toast.present();
    },
    { immediate: true },
  );
}
