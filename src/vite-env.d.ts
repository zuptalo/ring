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
