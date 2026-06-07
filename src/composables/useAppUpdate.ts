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
 * We also poll for an update on a timer and on foreground, so a long-lived session
 * still discovers a deploy without the user manually reloading.
 */
import { watch } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { toastController } from '@ionic/vue';
import { fetchServerConfig } from '@/services/api';

let started = false;

const UPDATE_POLL_MS = 60 * 60_000; // hourly background check for a new SW

export function useAppUpdate(): void {
  if (started) return; // singleton: one registration + prompt driver per app
  started = true;

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return;
      const check = (): void => void reg.update().catch(() => {});
      setInterval(check, UPDATE_POLL_MS);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
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
      // version that is, so the toast can name it. A miss just drops the version.
      let version = '';
      try {
        version = (await fetchServerConfig()).version ?? '';
      } catch {
        /* generic message when the version can't be fetched */
      }
      const running = __APP_VERSION__;
      const label = version && version !== running ? `Ring ${version} is ready to install.` : 'A new version of Ring is ready.';
      const toast = await toastController.create({
        header: 'Update available',
        message: label,
        position: 'top',
        // No duration: stay until the user chooses.
        buttons: [
          { text: 'Later', role: 'cancel' },
          { text: 'Update', handler: () => void updateServiceWorker(true) },
        ],
      });
      void toast.onDidDismiss().then(() => {
        prompting = false; // allow a re-prompt if a still-newer build arrives
      });
      await toast.present();
    },
    { immediate: true },
  );
}
