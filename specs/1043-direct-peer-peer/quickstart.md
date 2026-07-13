# Quickstart: Direct Peer-to-Peer Call Media with Relay Fallback (spec 1043)

## Run it locally

```sh
make start          # Postgres + ringd (:8080) + Vite (:5173)
```

Dev mode already runs the plaintext UDP TURN listener on `:3478`, so both STUN discovery and relay fallback are exercisable locally with no extra config.

## Verify each user story

### US1 — same-LAN direct (two browsers on one machine count as "same network")

1. Open two browser profiles at `http://localhost:5173`, register two accounts (dev invite codes `RINGDEV1`..), pair them, start a 1:1 video call. (Or script it: `node drive/scenarios/...` / the `drive-ui` skill.)
2. In one browser open `chrome://webrtc-internals` → the call's transport → **selected candidate pair**. Expect `host ↔ host` (mDNS/loopback addresses), not `relay`.
3. Group: create a group of 3, start a call, confirm each leg's selected pair is direct.

### US2 — internet-wide direct via the UDP endpoint

1. On a TLS deployment set `TURN_UDP_LISTEN=:3478`, forward `3478/udp`, restart. `GET /v1/turn-credentials` (with a bearer token) now shows the extra `stun:` entry and the `turn:...?transport=udp` URL.
2. Call between two devices on different networks (e.g. phone on LTE vs laptop on home Wi-Fi). Selected pair should be `srflx ↔ srflx` (or `srflx ↔ prflx`) when both NATs allow; `relay` otherwise — the call connects either way.

### US3 — "Always relay calls"

1. Settings → Privacy → switch on **Always relay calls**.
2. Repeat the US1 same-LAN call from that account: selected pair must now be `relay` on the toggled side, and the peer's inspection shows no direct address for the toggled user.
3. Sign the same account in on a second device: the toggle arrives on (own-data sync).

### US4 — zero-change safety

1. Deploy the new server with no new env vars: `ss -ulpn | grep 3478` (or equivalent) shows no new UDP listener; credentials response is byte-shape-identical to before.
2. Cross-network calls still connect (relayed), same as before the upgrade.

## Gates (Definition of Done)

```sh
npm run build                                   # typecheck + build
npx vitest run                                  # unit + coverage floors
cd server && go build ./... && go vet ./... && go test ./...
npm run test:e2e                                # needs `make db-up`
```

## Regression watch

- Call setup time: compare the `markConnect` timing (already instrumented in `useCall.ts`, visible in the drive harness console output) before/after on a relay-only scenario — budget: no more than 300 ms added (SC-004).
- Mid-call fallback (FR-010): during an established direct call on a real device, drop the direct path (toggle Wi-Fi so the device roams to LTE, or briefly disable the interface) — the existing reconnection flow must recover the call, on the relay if that is all that remains.
- webrtc-internals will show *failed* checks for mixed pairs (srflx ↔ relay-at-127.0.0.1) on default `RELAY_IP` — expected and harmless; see research.md D7.
