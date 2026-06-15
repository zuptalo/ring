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

/** This build's release notes (changes since the last release tag), injected at
 *  build time from git (see vite.config.ts / scripts/release-notes.sh). Used as the
 *  "running" side of the What's-new delta. Empty array when none / unstamped. */
declare const __RELEASE_NOTES__: import('@/services/release-notes').ReleaseNote[];
