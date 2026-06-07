import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// App version, exposed to the client as the compile-time constant __APP_VERSION__
// (shown in the UI and compared against the server's /v1/config version to detect a
// new deploy). Prefer RING_VERSION when the build sets it (the Docker image stamps
// the SAME value into both this and the Go binary's main.version, so the UI shows
// the true DEPLOYED version), falling back to package.json for local/dev builds.
// Read package.json via fs rather than process.env.npm_package_version so it works
// under `npx vite` too.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};
const appVersion = process.env.RING_VERSION || pkg.version;

// Backend the dev server proxies /v1 + /healthz to. Defaults to local ringd on
// :8080; the e2e harness overrides it to its isolated test backend.
const proxyTarget = process.env.RING_PROXY_TARGET || 'http://localhost:8080';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: true, // listen on 0.0.0.0 so 10.0.1.50:5173 is reachable on the LAN
    port: 5173,
    allowedHosts: ['ring-dev.zuptalo.com'],
    // Only watch app source. Without this, Vite watches the whole repo and a full
    // page reload fires whenever the Go backend writes runtime state (server/data:
    // secrets, uploaded blobs, the emoji cache), e2e artifacts change, etc.
    watch: {
      ignored: [
        '**/server/**',
        '**/data/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/public/ffmpeg/**',
        '**/dist/**',
        '**/.git/**',
      ],
    },
    // Proxy the backend through the dev server so the client can use same-origin
    // URLs (/v1/...). This makes a single public URL work: the tunnel points at
    // Vite, and Vite forwards API + WebSocket traffic to ringd on :8080. The
    // target is overridable (RING_PROXY_TARGET) so the e2e harness can point a
    // test frontend at an isolated test backend.
    proxy: {
      '/v1': { target: proxyTarget, changeOrigin: true, ws: true },
      '/healthz': { target: proxyTarget, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['ring-dev.zuptalo.com'],
  },
  plugins: [
    vue(),
    VitePWA({
      // 'prompt' (not autoUpdate): a new deploy must not silently reload the page
      // out from under the user. The app surfaces a toast naming the new version and
      // applies it only when the user accepts (see useAppUpdate + sw.ts SKIP_WAITING).
      registerType: 'prompt',
      // Custom service worker (src/sw.ts) so we can handle Web Push in addition
      // to app-shell precaching. esbuild-compiled by the plugin.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'safari-pinned-tab.svg', 'browserconfig.xml'],
      // The main bundle embeds libsodium (sumo) for E2EE crypto, which pushes it
      // past workbox's 2 MiB default precache ceiling. Raise the limit so the
      // service worker precaches the app shell (otherwise the SW build fails).
      // Don't precache the lazily-loaded ffmpeg.wasm core (~32 MB) - it's fetched
      // on demand only when a video is compressed.
      injectManifest: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globIgnores: ['**/ffmpeg/**'],
      },
      // Serve the manifest + service worker in `vite dev` too, so installing
      // to the home screen from the dev server behaves like the real PWA
      // (proper scope/start_url - no breaking out to Safari on navigation).
      // type: 'module' lets the dev SW use ES imports (workbox-precaching).
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Ring',
        short_name: 'Ring',
        description: 'Ring mobile app',
        theme_color: '#10b981',
        background_color: '#0a0a0a',
        display: 'standalone',
        id: '/',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // libsodium-wrappers-sumo's published ESM entry is broken (it imports a
      // missing ./libsodium-sumo.mjs), so Vite's optimizer can't build it.
      // Point the bare import at the self-contained CJS build instead; Vite
      // pre-bundles that into a valid ESM module for the browser. (TypeScript
      // still resolves types via the package name + @types, unaffected.)
      'libsodium-wrappers-sumo': path.resolve(
        __dirname,
        'node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
      ),
    },
  },
  optimizeDeps: {
    include: ['libsodium-wrappers-sumo'],
    // @ffmpeg/* spawns a worker via `new URL('./worker.js', import.meta.url)`,
    // which Vite's dep pre-bundling breaks - exclude so the worker URL resolves.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
