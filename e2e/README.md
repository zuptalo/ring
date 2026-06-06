# Ring e2e call tests

Headless multi-browser tests that exercise real WebRTC calling between separate
accounts - registration, the friend-request handshake (which establishes the
E2EE session), and an end-to-end call over the embedded TURN relay.

## How it works

- **Isolated stack per run.** `global-setup.ts` resets a throwaway `ring_e2e`
  Postgres database (so the dev invite codes `RINGDEV1..9` / `TESTCODE` are fresh
  every run), builds and starts a test `ringd` on **:8081** with a plaintext TURN
  relay on **:3479** (reachable from the localhost browser). Playwright's
  `webServer` serves a test vite on **:5174** proxied at that backend. Torn down
  in `global-teardown.ts`.
- **Fake media.** Chromium runs with `--use-fake-device-for-media-stream` so
  `getUserMedia` and the PeerConnection work without real hardware.
- **Driving the app.** Tests use the dev-only `window.__ringTest` hook
  (`src/services/testhook.ts`, stripped from prod builds) to register, pair, and
  place calls - calling the same service functions the UI does.

## Prerequisites

- Docker Postgres running: `make db-up` (or the full `make start`).
- Go on PATH (the harness builds a test `ringd`).
- Browsers installed: `npx playwright install chromium`.

## Run

```bash
npm run test:e2e          # headless
npm run test:e2e:headed   # watch it in a browser
```

The isolated test stack does not touch your `make start` dev stack (different
ports + database).

## Coverage

- `calls.spec.ts` - 1:1 audio call connects end-to-end and both sides receive
  media (validated, passing).
- A skipped group-call (SFU) test is scaffolded; it's enabled once the SFU +
  insertable-streams E2EE worker land.
