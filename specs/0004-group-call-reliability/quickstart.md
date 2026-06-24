# Quickstart: validating spec 0004

How to exercise and verify each user story locally. Uses the dev stack and the `drive/`
harness for multi-user flows, `npm run test:e2e` for hermetic runs, and unit tests for the
pure pieces.

## Prerequisites
```sh
make start          # Postgres + ringd (air) + Vite on :5173 → API :8080
```
Group calls need TURN; the dev stack runs TURN in plaintext on :3479 (see CALLING.md).
For per-device behavior use the `drive/` harness (`mobile: true` = iPhone-under-Chromium)
or real devices via the laptop deployment.

## Gates (run before claiming done)
```sh
npm run build                               # vue-tsc typecheck + vite build
cd server && go build ./... && go vet ./... && go test ./...
npm run test:e2e                            # Playwright, real WebRTC
```

## US1 — Leaving means leaving
1. `node drive/scenarios/...` (or 3 real users): A starts a group call inviting B and C.
2. B joins, then B leaves.
3. Force B's socket to reconnect within 60 s (toggle network / background-foreground).
4. **Expect**: B is NOT re-rung and does NOT rejoin. A member who never joined still rings
   when they come online within the window.
- Server unit: `JoinIfRoom`/`clearBufferedCalls` in `ws/call_test.go` — joining clears the
  buffer; a buffered invite is not redelivered after leave.

## US2 — Busy / no dead-end
1. Put A in any call.
2. From B: place a 1:1 audio call, a 1:1 video call, and a group call including A; have A
   decline/ignore each.
3. **Expect**: B sees "unavailable/busy" within ~5 s each time; A is not interrupted; the 1:1
   "decline with message" still posts the canned reply.
4. Both A and B get a call-history entry (B: unavailable; A: missed).

## US3 — Caps
1. Try to start a **video** call with 5 selected, and an **audio** call with 9 → blocked in
   the picker.
2. Fill a video call to 4, then have a 5th join → `call-full`, message + cue; existing call
   undisturbed. Repeat audio at 8 → 9th refused.
3. With >4 in an audio call, attempt to turn on the camera → blocked with an explanation.
4. Bypass the client check (drive harness sends a raw `call-join`) → **server** still refuses.
- Server unit: `registry_test.go` cap admission; `ws/call_test.go` over-cap `call-join` →
  `call-full`, no roster broadcast.

## US4 — Adaptive per-receiver quality
1. e2e under Playwright network throttling: start a video call on a constrained profile.
2. **Expect**: connects quickly at `low`; climbs over ~seconds when headroom exists; never
   starts at `hd`.
3. Throttle mid-call → outgoing video steps down and, at the extreme, suspends while audio
   stays clear and the call stays up; recovers when throttle lifts.
4. 3-peer mesh with one peer throttled → that leg drops tier while the others stay high
   (assert via per-leg `getStats` `outbound-rtp` bitrate/scale).
- Unit: `nextTier(current, snapshot, clamp)` table tests over synthetic snapshots
  (healthy→climb, bandwidth-limited→drop, high loss→drop, clamp respected, floor→`off`).

## US5 — Audio cues
1. Walk a call: calling → ringing → connecting → connected → (throttle) reconnecting →
   ended; toggle mute/unmute, camera on/off; hit a cap; receive a chat message mid-call.
2. **Expect**: a distinct, subtle cue per event; rapid mute/unmute does not storm (de-dup).
3. Disable call/notification tones → silence.
- Unit: the `cue()` rate-limiter (suppresses same cue within the window) and recipe presence.

## US6 — One coherent architecture
1. `rg -n "sfu|insertable|createEncodedStreams|GroupSession" src server` → no reachable
   group-call SFU code remains.
2. Boot ringd with calls enabled → no "group-call SFU ready" log; no SFU advertised.
3. A real group call connects on **iOS/Safari** and Chromium (no regression).
4. `server/docs/CALLING.md` describes the mesh; no SFU/VP8/Chromium-only group claims.

## Zero-knowledge spot check
- Confirm server logs/metrics never print SDP/ICE/media; `call-full`/group `call-busy` carry
  only `roomId` + `from`/`to`/`kind`. Adaptive quality and cues emit no frames.
