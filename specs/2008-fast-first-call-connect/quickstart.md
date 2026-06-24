# Quickstart: Validate the fast first-call connect

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-06-24

How to verify spec 2008 — that the **first** call connects as fast as a **second** (call-waiting)
call, deterministically and on-device.

## 1. Automated — Playwright (the gate)

The new `e2e/call-connect-speed.spec.ts` runs on chromium (real fake-media WebRTC):

```sh
make db-up                       # throwaway e2e Postgres (if not already up)
RING_E2E_PORT=8085 SEED_E2E_CODES=true npx playwright test e2e/call-connect-speed.spec.ts --project=chromium
```

It asserts:

1. **Caller overlap (regression gate)** — placing a first call warms TURN without waiting for
   `getUserMedia` first (`turnWarmStart <= gumStart`). Fails on pre-fix code, passes after.
2. **Callee overlap (regression gate)** — accepting a first call sets the remote description /
   creates the PC without first awaiting `getUserMedia` (capture overlaps SDP/PC setup).
3. **Time-to-first-media parity (success)** — the first call's median time-to-first-media is within
   a generous margin of the second/call-waiting call path, both audio and video, both directions.
4. **No dropped early ICE** — the first call still connects on the first attempt.

No regressions in the existing call suites:

```sh
RING_E2E_PORT=8085 SEED_E2E_CODES=true npx playwright test e2e/calls.spec.ts e2e/call-waiting.spec.ts --project=chromium
```

Plus the full gate:

```sh
npm run build        # typecheck + build
npm run test:unit    # vitest
cd server && go build ./... && go vet ./... && go test ./...   # unaffected, must stay green
```

## 2. Manual — feel it on the dev stack

```sh
make start           # PostgreSQL + ringd + Vite
node drive/scenarios/dm-and-react.mjs    # or drive two accounts and place a call
```

Place a **fresh** first call between two accounts and watch how quickly audio/video appear after
the callee answers — it should feel like accepting a second call, not the old long pause.

## 3. On-device — iOS/Safari (the hard constraint, FR-008)

Headless WebKit can't run fake-media WebRTC, so confirm on a real iPhone via the dev deployment:

```sh
make deploy-dev      # ring-dev (ringd + Vite); open the installed PWA on the phone
```

- Place a first 1:1 **audio** call iPhone↔desktop; confirm media appears promptly after answer.
- Repeat for a first 1:1 **video** call; confirm both sides see/hear each other quickly, and the
  camera does **not** turn on before you tap accept (privacy check).
- Optionally compare against taking a second call (call waiting) — the two should feel similar.

## What "done" looks like

- The two overlap assertions pass (they fail on `develop` today).
- First-call TTFM is within the margin of the second-call path (SC-001/SC-002).
- Existing `calls` + `call-waiting` e2e suites and the full build/unit/server gate stay green.
- On-device iOS first call feels as snappy as a second call, with no pre-accept camera.
