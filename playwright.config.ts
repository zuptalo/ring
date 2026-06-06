import { defineConfig, devices } from '@playwright/test';

/**
 * e2e config for Ring's WebRTC call tests.
 *
 * global-setup starts an isolated test backend (ringd :8081 + plaintext TURN
 * :3479 + fresh ring_e2e DB); the webServer below serves a test vite on :5174
 * proxied at that backend. Chromium runs with fake media devices so getUserMedia
 * and the PeerConnection work headlessly. Serial, single worker - the call tests
 * coordinate multiple browser contexts against one shared backend.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // CI runs WebRTC across multiple browser contexts on shared runners, which can
  // jitter; retry there to absorb the occasional ICE/timing flake. No retries
  // locally so a real failure surfaces immediately. forbidOnly stops a stray
  // test.only from silently shrinking the CI suite.
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { RING_PROXY_TARGET: 'http://localhost:8081' },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
});
