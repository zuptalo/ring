# Quickstart: Video quality hotfix (spec 2025)

## Unit / regression tests (the TDD red → green core)

```sh
npx vitest run src/services/call/quality.test.ts
```

Covers: floor-trap recovery (off must climb back on healthy samples and must be a real
pause), bandwidth-limitation needs corroboration, cpu limitation unchanged, start-tier
parameter, downlink classifier minimum-evidence + relaxed trims.

## See it on the dev stack

```sh
make start                          # if not already running
node drive/scenarios/probe-call-quality.mjs
```

The probe prints: captured resolution (expect ≥1280×720 on desktop Chromium), the
outgoing tier over time (expect high → hd within ~6s, then steady), and a floor-
recovery check.

On phones via ring-dev: `npm run build` (dist is what :8443 serves), update both
installed PWAs, place a video call and open the ⓘ panel — `tier=hd` should appear
within seconds on a good link and stay; on a genuinely bad link video may pause
entirely (audio continues) and MUST come back by itself when the link recovers.

## Gates

```sh
npm run build
npx vitest run
npx playwright test e2e/call-adaptive.spec.ts e2e/call-quality.spec.ts \
  e2e/call-connect-speed.spec.ts e2e/mutual-call.spec.ts
```
