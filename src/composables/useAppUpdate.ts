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
import router from '@/router';
import { callState } from '@/composables/useCall';
import { useInstallGuard } from '@/composables/useInstallGuard';

/** True while a call is in any live phase (ringing through connected). Applying an
 *  update reloads the page, which tears down the in-memory WebRTC state — so we must
 *  not surface or apply an update mid-call. 'ended' is the brief post-call display
 *  dwell and counts as done. */
function isInCall(): boolean {
  return callState.value !== 'idle' && callState.value !== 'ended';
}

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
// One silent install-gate auto-update per tab session (loop guard — see maybePrompt).
const GATE_UPDATED_KEY = 'ring.installGateAutoUpdated';

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

// Set once we've armed our own reload so a second controllerchange (workbox also
// listens) can't double-fire window.location.reload mid-unload.
let reloading = false;

/**
 * Apply a waiting update safely. The naive path — vite-plugin-pwa's
 * updateServiceWorker(true) — just posts SKIP_WAITING and relies on workbox's own
 * controllerchange listener to reload. Two ways that bites us, both reported as "the
 * UI breaks / I have to fully close and reopen":
 *
 *   1. Transient route restored with dead state. The reload re-enters the CURRENT
 *      url, but calls (and other transient pages) keep their state in memory only.
 *      Reloading onto /call-active with callState back to 'idle' renders the
 *      full-screen call UI over the tabs with black video tiles and no live call to
 *      end — a wedged screen. So before reloading we bounce any non-tabs route to the
 *      app shell; the reload then lands on /tabs/chats, never a restored-but-dead view.
 *   2. Workbox's reload is gated on event.isUpdate (true only when a controller
 *      existed at page-load time); some cold-start paths leave it false, so the new
 *      worker takes control but the page never reloads — old JS under a new SW, with
 *      mismatched lazy-route chunks → navigation silently dies. We add our OWN one-shot
 *      controllerchange reload so the refresh is guaranteed regardless of that gate.
 *
 * Never applies mid-call (the prompt is hidden then anyway); the guard is belt-and-braces.
 */
async function applyUpdate(updateServiceWorker: (reload?: boolean) => Promise<void>): Promise<void> {
  if (isInCall()) return; // a live call must not be torn down by an update reload
  // Land the post-reload page on the app shell rather than a transient detail/call
  // route whose in-memory state won't survive the reload.
  if (!router.currentRoute.value.path.startsWith('/tabs')) {
    await router.replace('/tabs/chats').catch(() => {});
  }
  const reloadOnce = (): void => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  // Guarantee the reload even if workbox's isUpdate-gated listener no-ops. Installed
  // before SKIP_WAITING so we never miss the controllerchange it triggers. Wrapped in
  // try/catch because some Android WebViews throw on addEventListener here — the timeout
  // fallback below still reloads.
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
    } catch {
      /* listener unavailable; covered by the timeout fallback */
    }
  }
  try {
    await updateServiceWorker(true); // posts SKIP_WAITING → new worker activates → controllerchange → reload
  } catch {
    /* SKIP_WAITING post failed; the new worker may still take over → fallback reload */
  }
  // Fallback for devices where `controllerchange` never fires after the new worker
  // claims clients — observed on some Samsung builds (Galaxy S25): the prompt dismissed
  // but the page never refreshed, so the old JS kept running. By the time this fires,
  // skipWaiting + clients.claim have run, so a plain reload picks up the new build.
  // `reloading` makes this and the controllerchange path mutually exclusive (no double
  // reload). 2.5s comfortably exceeds the activate/claim round-trip.
  window.setTimeout(reloadOnce, 2500);
}

export function useAppUpdate(): void {
  if (started) return; // singleton: one registration + prompt driver per app
  started = true;

  // A visitor still behind the install gate (a plain browser tab on the public origin)
  // is blocked from the app and about to install. They must land on the LATEST build,
  // never a previous deploy's cached shell — see the auto-apply branch in maybePrompt.
  const { mustInstall } = useInstallGuard();

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
    // Install-gate visitor: don't offer a card they'd have to tap — a browser-gated
    // visitor must never install a stale cached build. Silently pull the waiting update
    // (skipWaiting + reload) so the guide they read and the shell they install are the
    // latest. sessionStorage caps it to one auto-apply per tab: if an update somehow
    // fails to take, we stop rather than reload-loop. No call/session to protect here.
    if (mustInstall.value) {
      let already = false;
      try { already = sessionStorage.getItem(GATE_UPDATED_KEY) === '1'; } catch { /* ignore */ }
      if (already) return;
      try { sessionStorage.setItem(GATE_UPDATED_KEY, '1'); } catch { /* ignore */ }
      prompting = true;
      await applyUpdate(updateServiceWorker);
      return;
    }
    // Defer entirely while a call is live: a stray tap on the update banner mid-ring
    // would reload the page and kill the call. The watch on callState below re-fires
    // this the moment the call ends, and every foreground re-checks too, so the
    // deferred update resurfaces on its own — the user never has to hunt for it.
    if (isInCall()) return;
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
            if (wantsUpdate) void applyUpdate(updateServiceWorker);
          });
        },
      });
    }
    actions.push({ text: 'Update', handler: () => void applyUpdate(updateServiceWorker) });
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

  // While the install gate is up, actively check for a newer build so the auto-apply
  // in maybePrompt has something to pull — a gated visitor has no in-app path to the
  // latest, and registerSW's one-shot open check could predate a just-shipped deploy.
  watch(mustInstall, (must) => { if (must) checkForUpdate(true); }, { immediate: true });

  // A pending update deferred during a call (maybePrompt bails while isInCall) should
  // resurface the instant the call settles, not only on the next foreground.
  watch(callState, (s) => {
    if (s === 'idle') void maybePrompt();
  });
}
