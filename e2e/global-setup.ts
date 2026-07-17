/**
 * e2e global setup: brings up an ISOLATED backend so call tests are hermetic and
 * repeatable. It resets a throwaway `ring_e2e` Postgres database (so the dev
 * invite codes RINGDEV1..9/TESTCODE are fresh every run), then builds and starts
 * a test `ringd` on :8081 with a plaintext TURN relay on :3479 reachable from the
 * localhost browser. Playwright's `webServer` then serves a test vite on :5174
 * proxied at this backend. Torn down in global-teardown.ts.
 *
 * Requires the docker Postgres (`make db-up`) to be running and Go on PATH.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const TMP = path.join(ROOT, '.tmp');
const PIDS_FILE = path.join(TMP, 'e2e-pids.json');

// Defaults to 8081 (CI); override with RING_E2E_PORT when 8081 is taken locally by another
// service (e.g. a docker container publishing it). Keep in sync with playwright.config.ts
// (RING_PROXY_TARGET) and e2e/helpers.ts (BACKEND), which read the same env.
const RINGD_PORT = Number(process.env.RING_E2E_PORT) || 8081;
const DB_URL = 'postgres://ring:ring@localhost:5432/ring_e2e?sslmode=disable';

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function freePort(port: number): void {
  try {
    const pids = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`).toString().trim();
    for (const pid of pids.split('\n').filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  } catch {
    /* lsof missing - ignore */
  }
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(TMP, { recursive: true });

  // Clean any stale test stack from a previous aborted run.
  freePort(RINGD_PORT);

  // 1. Fresh test database (so invite codes reset every run).
  // Separate -c flags so each runs in its own (auto-commit) statement - DROP
  // DATABASE cannot run inside a transaction block.
  execSync(
    `docker compose -f "${SERVER}/docker-compose.yml" exec -T db ` +
      `psql -U ring -d ring ` +
      `-c "DROP DATABASE IF EXISTS ring_e2e WITH (FORCE)" ` +
      `-c "CREATE DATABASE ring_e2e"`,
    { stdio: 'inherit' },
  );

  // 2. Build the test server binary.
  execSync(`go build -o "${TMP}/ringd-e2e" ./cmd/ringd`, { cwd: SERVER, stdio: 'inherit' });

  // 3. Start the test backend with a plaintext, localhost-reachable TURN relay.
  const log = openSync(path.join(TMP, 'ringd-e2e.log'), 'w');
  const ringd = spawn(`${TMP}/ringd-e2e`, [], {
    cwd: SERVER,
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ENV: 'dev',
      PORT: String(RINGD_PORT),
      DATABASE_URL: DB_URL,
      PUBLIC_URL: `http://localhost:${RINGD_PORT}`,
      ALLOWED_ORIGINS: `http://localhost:5174,http://localhost:${RINGD_PORT}`,
      ENABLE_CALLS: 'true',
      TURN_LISTEN: ':3479',
      RELAY_IP: '127.0.0.1',
      SECRETS_KEY: 'e2e-secrets-key',
      // Seed the fixed per-spec invite codes (e.g. DIRTST01 → username u_dirtst01)
      // the specs assert on. A normal dev deployment only seeds INVITE01-10.
      SEED_E2E_CODES: 'true',
    },
  });
  ringd.unref();

  await waitFor(`http://localhost:${RINGD_PORT}/healthz`);
  writeFileSync(PIDS_FILE, JSON.stringify({ ringd: ringd.pid }));
}
