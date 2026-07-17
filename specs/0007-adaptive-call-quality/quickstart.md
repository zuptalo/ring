# Quickstart: Validate adaptive call quality (spec 0007)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-06-24

## 1. Unit — the controller brain (the gate)

```sh
npx vitest run src/services/call/quality.test.ts
```

Asserts (regression reproduced-then-fixed + new model):
- Healthy 1:1 climbs to **hd** (not stuck at high) even with no candidate-pair estimate.
- iOS encoding for a low/medium tier downscales cleanly (`scaleResolutionDownBy > 1`), not full-res.
- Converges to target quickly; backs off only on **sustained** congestion (a single bad sample
  doesn't drop a tier); no flapping under steady input.
- Effective tier = `min(own, peerRequestedTier, peerCount-ceiling, manualPin)`; a hard receiver cap
  is honored; a stale report is ignored (fallback to send-side).
- `downlink/manual/tile → requestedTier` mapping (min of the three).

## 2. E2E — up to 4 throttled participants (the system behavior)

```sh
make db-up
RING_E2E_PORT=8085 SEED_E2E_CODES=true npx playwright test e2e/call-quality.spec.ts --project=chromium
```

Drives 2–4 real-WebRTC participants and throttles one **on the fly** via CDP
`Network.emulateNetworkConditions`, asserting (via the per-leg tier/diag + inbound-bitrate hooks):
- Healthy network → each leg reaches its target (HD on 1:1, high on group) within ~5s (SC-001).
- Throttle participant X's downlink mid-call → only streams **to X** step down within ~3–5s; streams
  to healthy peers stay high; no frozen/black video (SC-002).
- Un-throttle X → streams to X climb back within ~10s, no flapping (SC-002/SC-005).
- Pin a device to **low** → others' streams **to it** drop (measured inbound) and its outgoing caps,
  while every sender's **self-preview stays full** (SC-003).
- ⓘ diag shows per-leg tier + reported downlink + limitation reason, tracking the throttle (SC-006).

No regression:

```sh
RING_E2E_PORT=8085 SEED_E2E_CODES=true npx playwright test e2e/calls.spec.ts e2e/call-waiting.spec.ts e2e/call-adaptive.spec.ts e2e/call-connect-speed.spec.ts --project=chromium
```

Full gate: `npm run build`; `npm run test:unit`; `cd server && go build ./... && go vet ./... && go test ./...`.

## 3. On-device — iOS/Safari image quality (the hard constraint)

Headless WebKit can't run fake-media WebRTC, so confirm the iOS image cleanliness on a real iPhone:

```sh
make deploy-dev
```

- 1:1 video iPhone↔desktop on a good network: image is clearly good (HD-class), reaches it within a
  few seconds — visibly better than before this spec.
- Force a low tier (pin low, or throttle): the image is a **clean smaller** picture, **not**
  full-resolution blockiness (the regression).
- The iPhone's own self-preview stays full quality regardless of what it's sending.

## What "done" looks like

- Unit gate green (regression assertions flipped from failing → passing).
- 4-instance throttled e2e shows timely, per-receiver, smooth adjustments + manual-cap-affects-inbound.
- On-device iOS image is clean at every tier; self-preview always full.
- No regression to connect speed / hold-swap / caps; zero-knowledge checklist passed (sealed `qos`,
  no new server metadata).
