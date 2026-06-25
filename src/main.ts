import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import { iosTransitionAnimation, createAnimation } from '@ionic/core';
import type { TransitionOptions } from '@ionic/core';

import App from './App.vue';
import router from './router';
import { seedIfEmpty } from './db/seed';

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';

/* Official dark palette, class-driven: dark variables apply only when the
   `ion-palette-dark` class is present on <html>. useTheme() (see App.vue)
   toggles that class from the persisted Appearance → Theme choice, with
   'system' following prefers-color-scheme. */
import '@ionic/vue/css/palettes/dark.class.css';

/* Theme variables */
import './theme/variables.css';

// scrollAssist is disabled: we keep focused inputs visible by sizing the app
// to the visual viewport (see useViewportHeight). Leaving scrollAssist on makes
// it scroll the window on every focus change (e.g. each OTP box as focus
// advances), which fights our scroll reset and bounces the page up/down.
// navAnimation overrides Ionic's page transitions app-wide (resolved by
// ion-router-outlet via config.get('navAnimation')). Installed standalone PWAs
// on iOS 16+ get their OWN native edge-swipe back gesture that we cannot disable
// (no web API for it). That native swipe already animates the slide AND fires a
// popstate; Ionic would then play its own back-slide on top, the visible
// "double swipe". So we make the BACK direction instant (empty animation) and
// let the OS provide the slide, while keeping the normal iOS push for forward
// navigations. Header back-button taps are also instant as a result (accepted).
const navAnimation = (baseEl: HTMLElement, opts: TransitionOptions) => {
  if (opts?.direction === 'back') return createAnimation();
  try {
    return iosTransitionAnimation(baseEl, opts);
  } catch (e) {
    // Ionic's iOS large-title transition can throw "Cannot set properties of
    // null (setting 'innerText')" when the entering page's collapsible
    // <ion-title> clone isn't ready yet (getClonedElement → null). A transition
    // animation failing must never break navigation, so fall back to an instant
    // transition instead of letting the router-outlet commit blow up.
    console.warn('[nav] iOS transition failed; using instant transition', e);
    return createAnimation();
  }
};

// swipeBackEnabled: false disables Ionic's own interactive swipe-back gesture:
// it fought the native PWA gesture through the tabs' nested outlet and left
// pages stuck (unresponsive UI / empty-gradient pages). There's no reliable
// per-outlet API in Ionic Vue to scope it, so it's off globally; every
// drill-down page keeps its header back button. scrollAssist stays off (see
// useViewportHeight).
const app = createApp(App)
  .use(IonicVue, { swipeBackEnabled: false, scrollAssist: false, navAnimation })
  .use(router);

// Ionic's iOS large-title transition reads a shared, hidden clone element
// (<ion-title>/<ion-back-button> with class `ion-cloned-element`, appended to
// <body>) and writes into it. That clone is normally created LAZILY by the
// collapsible-header scroll machinery, so the very first large-title transition
// (before any condense header has created it) fetches null and throws
// ("Cannot set properties of null (setting 'innerText')"), breaking navigation.
// Pre-create the clones here (the same thing Ionic's cloneElement does) so the
// transition works from the first navigation. The navAnimation try/catch above
// remains as a belt-and-braces fallback.
function ensureClonedTransitionElements(): void {
  for (const tag of ['ion-title', 'ion-back-button']) {
    if (document.querySelector(`${tag}.ion-cloned-element`)) continue;
    const el = document.createElement(tag);
    el.classList.add('ion-cloned-element');
    el.style.setProperty('display', 'none');
    document.body.appendChild(el);
  }
}

// HMR-proxy dev mode (`make deploy-dev`): no service worker should be active, or a
// previously-installed PWA's precaching SW would serve a cached shell and block hot
// reload. Best-effort unregister any stale SW + clear its caches so the app
// self-heals on load. (A SW already controlling the page only fully releases on the
// next navigation, so a one-time hard refresh may still be needed the first time.)
if (__HMR_NO_SW__ && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  if ('caches' in window) {
    void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
  }
}

// Populate the on-device database with dummy data on first launch, then mount.
seedIfEmpty().finally(() => {
  router.isReady().then(() => {
    app.mount('#app');
    // After mount, the Ionic web components are defined, so the clones upgrade
    // and hydrate before the first page transition.
    ensureClonedTransitionElements();
    // Spec 2010: an installed iOS PWA gets its OWN OS edge-swipe back gesture that no web API can
    // disable, and we deliberately land directly on a tab root at browser-history DEPTH 1 (the `/`
    // redirect + 'replace' tab flattening). At depth 1 that swipe underflows PAST start_url into a
    // blank browser view inside the app shell. Seed ONE base history entry at the same URL so the
    // first OS-back pops to an in-app screen and the user stays in the app. This is a one-time base
    // seed, NOT a gesture interceptor; the catch-all route bounces any popped-to path back in-app.
    if (window.history.length <= 1) {
      window.history.pushState(window.history.state, '', window.location.href);
    }
  });
});

// Mirror the access token into IndexedDB so the service worker can authenticate
// to drain the relay for background decryption (migrates already-logged-in users).
void import('@/services/auth').then((m) => m.ensureSessionMirrored());

// DEV-only: expose a small imperative API (window.__ringTest) for the e2e
// harness to register/pair accounts and drive calls headlessly. Stripped from
// production builds (the import is behind import.meta.env.DEV).
if (import.meta.env.DEV) {
  void import('@/services/testhook').then((m) => m.installTestHook());
  // Stop the passcode gate from re-prompting on every HMR reload: auto-unlock
  // from a PIN stashed at the last manual unlock. Dev-only (stripped in prod).
  void import('@/services/crypto/devUnlock').then((m) => m.installDevAutoUnlock());
}
