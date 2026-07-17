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

/**
 * Whether an Android user agent is an embedded WebView — the one common Android surface
 * that genuinely CANNOT install a PWA (no "Install app" menu; "Add to Home" only makes a
 * shortcut). Pure (UA-only) so it's unit-testable and deterministic.
 *
 * We deliberately do NOT infer incapability from a missing/slow `beforeinstallprompt`
 * event: a fully capable, current Chrome can fire it late or not auto-fire it at all, so
 * that signal produced false "your browser can't install / update Chrome" warnings for
 * real users (spec 2003). Mainstream Android browsers (Chrome, Samsung Internet, Edge,
 * Firefox) can all install via their own menu and are NOT WebViews.
 *
 * Detection: the modern WebView tags itself with "; wv)" in the platform section; the
 * legacy signature is a "Version/x.x" token alongside "Chrome/" (real Chrome / Samsung /
 * Edge on Android do not carry "Version/").
 */
export function isAndroidWebView(ua: string): boolean {
  if (!/android/i.test(ua)) return false;
  if (/;\s*wv[)]/i.test(ua)) return true;
  return /\bVersion\/[\d.]+/i.test(ua) && /\bChrome\/[\d.]+/i.test(ua);
}

// Singleton state shared across the (single) guard component.
const mustInstall = ref(false);
const platform = ref<InstallPlatform>('desktop');
const canPrompt = ref(false);
// Android only: true ONLY for a genuinely-incapable surface — an embedded WebView, which
// has no "Install app" path so "Add to Home" would just make a shortcut. Determined from
// the user agent (isAndroidWebView), NOT from a missing/slow `beforeinstallprompt` event
// (that was a false-negative source on capable Chrome — spec 2003). The guard uses it to
// show accurate "open in your browser app" guidance instead of steps that won't work.
const installUnavailable = ref(false);
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let started = false;

function start(): void {
  if (started) return;
  started = true;
  platform.value = detectPlatform();
  mustInstall.value = !isStandalone() && !isLocalhost();

  // Only an embedded Android WebView genuinely can't install Ring; a normal Android
  // browser can (via its menu), even if `beforeinstallprompt` is slow or never auto-fires.
  if (platform.value === 'android' && mustInstall.value) {
    installUnavailable.value = isAndroidWebView(navigator.userAgent || '');
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
