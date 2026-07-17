/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vue" />

interface ImportMetaEnv {
  /** Base URL of the Ring backend (ringd). Defaults to http://localhost:8080. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version, injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;

// flubber (the launch reveal's path morphing) ships no type declarations.
declare module 'flubber';

/** This build's release notes (changes since the last release tag), injected at
 *  build time from git (see vite.config.ts / scripts/release-notes.sh). Used as the
 *  "running" side of the What's-new delta. Empty array when none / unstamped. */
declare const __RELEASE_NOTES__: import('@/services/release-notes').ReleaseNote[];

/** True only in HMR-proxy dev mode (`make deploy-dev`): no service worker is
 *  registered, and the app unregisters any stale SW + clears caches on load so an
 *  already-installed PWA self-heals and HMR works. False in normal dev and prod. */
declare const __HMR_NO_SW__: boolean;
