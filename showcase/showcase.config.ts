import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root (this config lives in showcase/). webServer.cwd defaults to the config
// dir, so pin it to the root or Vite would start in showcase/ with the wrong root.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Showcase capture harness — NOT a test suite. It boots the same isolated stack as
 * e2e (global-setup: ringd :8081 + fresh ring_e2e DB + test vite :5174), seeds a
 * curated demo dataset via the dev-only test hook, and screenshots the UI across
 * device sizes and light/dark themes into showcase/output/<device>/<theme>/.
 *
 * Prereqs: `make db-up` (Docker Postgres) and the webkit browser
 * (`npx playwright install webkit chromium`). Run with: `npm run showcase`.
 *
 * iPhone/iPad use the device emulation (viewport + iOS user-agent → Ionic iOS mode);
 * Pixel + Desktop use Chromium (Android Material mode + desktop). We render all of
 * them in Chromium because Playwright's WebKit isn't available on every host (e.g.
 * macOS 12). For pixel-perfect iOS Safari, set browserName: 'webkit' on the iPhone/
 * iPad projects on a host that supports it. No fake-media flags — static screens only.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  globalSetup: '../e2e/global-setup.ts',
  globalTeardown: '../e2e/global-teardown.ts',
  outputDir: '../.tmp/showcase-results',
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    cwd: repoRoot,
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    // Generous: a cold `go build` of ringd in global-setup can saturate CPU while
    // Vite is also coming up on the first run.
    timeout: 180_000,
    env: { RING_PROXY_TARGET: 'http://localhost:8081' },
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14 Pro'], browserName: 'chromium' } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
});
