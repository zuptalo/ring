/// <reference types="vitest" />
// Vitest config for client-side unit tests. Kept separate from vite.config.ts on
// purpose: the unit tests don't need the PWA plugin / dev-server / proxy machinery,
// and loading the VitePWA plugin under the test runner is pure overhead. We only
// re-declare the two resolve aliases the source actually depends on.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Same shim as vite.config.ts: libsodium-wrappers-sumo's published ESM entry
      // imports a missing file, so point the bare specifier at the self-contained
      // CJS build. Without this, every crypto import fails to load under Vitest.
      'libsodium-wrappers-sumo': path.resolve(
        __dirname,
        'node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
      ),
    },
  },
  test: {
    // The crypto core is pure (no DOM/IndexedDB), so the fast Node environment is
    // enough. Add happy-dom + @vue/test-utils here if/when component tests land.
    environment: 'node',
    include: ['src/**/*.test.ts'], // unit tests; e2e/*.spec.ts is Playwright's (testDir: ./e2e)
    // Force libsodium through Vite's transform so the CJS shim interops cleanly.
    server: { deps: { inline: ['libsodium-wrappers-sumo'] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // Gate the pure crypto-operation modules we exercise directly — an honest
      // number for the tested core, not a meaningless whole-app percentage. The
      // idb-persistence tails of ratchet/senderkeys and the large identity.ts
      // surface (passkey, prekey management) are stateful/integration territory,
      // covered behaviorally by identity.test.ts + the e2e suite; fold them into
      // this gate as they gain dedicated unit tests. Ratchet the floor upward then.
      include: [
        'src/services/crypto/primitives.ts',
        'src/services/crypto/envelope.ts',
        'src/services/crypto/message.ts',
        'src/services/crypto/ratchet.ts',
        'src/services/crypto/senderkeys.ts',
        // Pure message-status reducers + the serialization primitive behind the
        // status-stability fix (spec 2001). Pure, fully unit-tested — gate them too.
        'src/services/message-status.ts',
        'src/services/keyed-mutex.ts',
        // Pure release-note delta/prettify behind the What's-new toast (spec 0001).
        'src/services/release-notes.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
