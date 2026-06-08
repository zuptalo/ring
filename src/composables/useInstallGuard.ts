/**
 * Install gate. Ring is meant to run only as an installed app (standalone
 * display mode); that's what unlocks reliable Web Push, a stable storage
 * partition, and the app-like shell. When the site is opened in a plain browser
 * tab we block it behind an install guide (see components/InstallGuard.vue)
 * instead of letting the user continue.
 *
 * Exception: localhost is allowed un-installed so local development in a desktop
 * browser isn't blocked. Real users hit the public origin and must install.
 */
import { ref } from 'vue';

export type InstallPlatform = 'ios' | 'android' | 'desktop';

/** The deferred Android/Chromium install prompt (not in the standard DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      // iOS Safari home-screen apps expose this non-standard flag.
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function isLocalhost(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent || '';
  // iPadOS reports as Mac, so also treat touch-capable "Mac" as iOS for guidance.
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) {
    return 'ios';
  }
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

// Singleton state shared across the (single) guard component.
const mustInstall = ref(false);
const platform = ref<InstallPlatform>('desktop');
const canPrompt = ref(false);
// Android only: set true when we've waited for `beforeinstallprompt` and it never
// fired, which means this browser (e.g. old Chrome / a WebView on Android 6) can't
// install Ring as a real standalone PWA - "Add to Home" would only make a shortcut.
// The guard uses it to explain that, instead of showing steps that won't work.
const installUnavailable = ref(false);
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let started = false;

function start(): void {
  if (started) return;
  started = true;
  platform.value = detectPlatform();
  mustInstall.value = !isStandalone() && !isLocalhost();

  // On Android a capable Chrome fires `beforeinstallprompt` within a moment of load;
  // if it hasn't after a short wait (and we're still gated), this browser can't do a
  // real install, so surface the clearer guidance.
  if (platform.value === 'android' && mustInstall.value) {
    setTimeout(() => {
      if (!canPrompt.value) installUnavailable.value = true;
    }, 2500);
  }

  // If the page is ever (re)evaluated as standalone, drop the gate.
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', (e: MediaQueryListEvent) => {
      if (e.matches) mustInstall.value = false;
    });
  } catch {
    /* Safari < 14 lacks addEventListener on MediaQueryList; ignore. */
  }

  // Chromium fires this when the PWA is installable; stash it to offer a button.
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    canPrompt.value = true;
    installUnavailable.value = false; // a real install IS possible here
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    canPrompt.value = false;
  });
}

/** Trigger the native install prompt (Chromium only). No-op otherwise. */
export async function promptInstall(): Promise<void> {
  const e = deferredPrompt;
  if (!e) return;
  deferredPrompt = null;
  canPrompt.value = false;
  try {
    await e.prompt();
    await e.userChoice;
  } catch {
    /* user dismissed / unsupported */
  }
}

export function useInstallGuard() {
  start();
  return { mustInstall, platform, canPrompt, installUnavailable };
}
