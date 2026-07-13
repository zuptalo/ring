# Tasks: Direct Peer-to-Peer Call Media with Relay Fallback

**Input**: Design documents from `/specs/1043-direct-peer-peer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/turn-credentials.md, quickstart.md

**Tests**: REQUIRED — constitution Principle III (TDD) mandates failing tests before the implementation that satisfies them. Each story phase orders its tests first.

**Organization**: Tasks are grouped by user story so each story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

## Phase 1: Setup

No setup tasks — the feature edits existing files in an existing monorepo; no new projects, dependencies, stores, or migrations (plan.md Structure Decision).

---

## Phase 2: Foundational

No blocking prerequisites shared across stories beyond what US1 itself delivers (the `callRtcConfig()` helper lands inside US1 and is reused by US3; US2 and US4 touch disjoint files). User stories can begin immediately.

---

## Phase 3: User Story 1 - Same-network calls connect directly (Priority: P1) 🎯 MVP

**Goal**: Stop forcing relay: build every call peer connection (1:1 and each mesh leg) with `iceTransportPolicy: 'all'` via one shared, setting-aware config helper, so same-LAN calls pick direct host pairs and everything else still falls back to the relay.

**Independent Test**: Two browsers on one machine (`make start`), 1:1 video call → `chrome://webrtc-internals` selected candidate pair is `host ↔ host`; block direct (or force relay via the not-yet-existing setting default path) → call still connects via relay. quickstart.md US1.

### Tests for User Story 1 (write first, must fail)

- [X] T001 [US1] Create vitest unit test `src/services/call/turn.test.ts` for `rtcConfig`: default policy is `'all'`; `{relayOnly: true}` forces `'relay'`; `bundlePolicy` stays `'max-bundle'`; iceServers passed through. Also cover `callRtcConfig()` reading the `privacy.relayCalls` setting (mock `getSetting`, default false). Run `npx vitest run src/services/call/turn.test.ts` and confirm it FAILS against current code (policy is hard-coded `'relay'`, helper doesn't exist).

### Implementation for User Story 1

- [X] T002 [US1] In `src/services/call/turn.ts`: change `rtcConfig(turn)` to `rtcConfig(turn, opts?: {relayOnly?: boolean})` with `iceTransportPolicy: opts?.relayOnly ? 'relay' : 'all'`; add `callRtcConfig(): Promise<RTCConfiguration>` combining `getTurnConfig()` + `getSetting<boolean>('privacy.relayCalls', false)`; rewrite the stale header (lines 1-7) and `rtcConfig` doc comment (lines 58-62) to explain direct-when-possible + relay fallback + the privacy override (keep the repo's explain-the-why comment style). T001 test now passes.
- [X] T003 [P] [US1] In `src/composables/useCall.ts` `newPeerConnection()` (~line 780): replace `getTurnConfig()` + `rtcConfig(turn)` with `await callRtcConfig()`.
- [X] T004 [P] [US1] In `src/services/call/mesh.ts`: `buildLeg` (~line 783) and `restartLegIce` `setConfiguration` (~line 377) both use `await callRtcConfig()` — the restart path MUST get the same setting-aware config so an ICE restart never flips policy; keep the buildLeg awaits before leg reservation (race re-check at ~784-785 must stay valid); update the file-header claim that media always rides the relay.
- [X] T005 [US1] Gates: `npm run build` (typecheck) and `npx vitest run` pass; then manual quickstart.md US1 check via the drive harness or two browser profiles — selected candidate pair is `host ↔ host` on a same-machine call, and the call still connects when only relay pairs survive.

**Checkpoint**: US1 fully functional — direct on LAN, relay fallback intact, no server change needed.

---

## Phase 4: User Story 2 - Internet-wide direct calls when the operator opts in (Priority: P2)

**Goal**: Optional server UDP endpoint (`TURN_UDP_LISTEN`) that also runs in TLS mode, serving STUN Binding (srflx discovery) and TURN-over-UDP with the existing REST credentials; advertised to clients as an extra credential-less `stun:` iceServers entry plus a `turn:...?transport=udp` URL, per contracts/turn-credentials.md. Unset → no listener, no new port, byte-identical credentials response.

**Independent Test**: With `TURN_UDP_LISTEN` set on a TLS deployment, `GET /v1/turn-credentials` shows the stun entry and a cross-network call selects an `srflx` pair; without it, no UDP socket opens and the response is unchanged. quickstart.md US2/US4.

### Tests for User Story 2 (write first, must fail)

- [X] T006 [P] [US2] Create `server/internal/api/turn_handlers_test.go` (none exists) following the sibling handler-test pattern: 503 when `CallsEnabled` is false; 401 unauthenticated; TURN-only config → exactly one credentialed iceServers entry with the configured URLs and `ttl` 3600; with `StunURLs` set → an additional entry carrying only `urls` (no `username`/`credential`) while the credentialed entry is unchanged. Confirm FAIL (the `StunURLs` field doesn't exist yet).
- [X] T007 [P] [US2] Extend `server/internal/turn/server_test.go`: TLS-mode `Start` with `UDPListen` set answers a STUN Binding request on the UDP socket (reuse the existing pion round-trip test style); TLS-mode without `UDPListen` opens no UDP socket. Confirm FAIL (Config has no `UDPListen`).

### Implementation for User Story 2

- [X] T008 [P] [US2] In `server/internal/config/config.go`: add `TurnUDPListen` (`TURN_UDP_LISTEN`, default "" = disabled), `StunPublicHost` (`STUN_PUBLIC_HOST`, default: TURN public host) and `StunPublicPort` (`STUN_PUBLIC_PORT`, default: port parsed from `TURN_UDP_LISTEN`); boot error on unparseable `TURN_UDP_LISTEN` (match existing listen-addr validation style); fix the stale "TURN relay + SFU" comment at line ~62.
- [X] T009 [US2] In `server/internal/turn/server.go`: add `UDPListen string` to `Config`; when non-empty and `TLSConfig != nil`, additionally open the UDP `PacketConnConfig` the dev branch already uses (lines ~92-101); fix the stale "co-located SFU" (~48-52) and "never expose these publicly" (~90-91) comments. T007 test now passes.
- [X] T010 [US2] In `server/cmd/ringd/main.go` TLS branch (~360-372): when the UDP endpoint is configured, advertise `turn:<stunHost>:<stunPort>?transport=udp` in `TurnURLs` and build `StunURLs = ["stun:<stunHost>:<stunPort>"]`; also correct the "no server-side SFU" adjacent stale wording if touched.
- [X] T011 [US2] In `server/internal/api/turn_handlers.go`: add `StunURLs []string` to `Handlers`, wire it from main.go, and emit it as a separate credential-less iceServers entry; update the "all media rides TURNS on 443 / client forces relay" comment (lines ~22-23). T006 test now passes.
- [X] T012 [US2] Gates: `cd server && go build ./... && go vet ./... && go test ./...` all green; then manual quickstart.md US2 check against a UDP-enabled deployment (or dev stack) — credentials response matches contracts/turn-credentials.md and a cross-network call selects `srflx`. NOTE: go gates + credentials contract verified; the srflx cross-network check needs a UDP-enabled real deployment - deferred to the PR real-device pass alongside T022.

**Checkpoint**: US1 + US2 both work; zero-config deployments byte-identical (US4 acceptance 1 verified by T007's no-socket case + T006's unchanged-response case).

---

## Phase 5: User Story 3 - "Always relay calls" privacy choice (Priority: P3)

**Goal**: Synced `privacy.relayCalls` toggle (default off) that forces `'relay'` policy for all of the user's calls from the next call onward, so peers never learn a direct address for them.

**Independent Test**: Toggle on → same-LAN call selects a `relay` pair on the toggled side; second device receives the setting via own-sync. quickstart.md US3.

### Tests for User Story 3 (write first, must fail)

- [X] T013 [P] [US3] In `src/settings/schema.test.ts`: keep `privacy.protectIp` in the DEAD list but rewrite the stale "calls always relay, so protect IP was a no-op" comment (~33-37) to point at the replacement key; add a positive assertion that the schema contains a `privacy.relayCalls` toggle with default `false`. Confirm FAIL (key not in schema yet).
- [X] T014 [P] [US3] In `src/services/ownsync.test.ts`: extend the allowlist coupling test to expect `privacy.relayCalls` in `SYNCED_PREF_KEYS`. Confirm FAIL.

### Implementation for User Story 3

- [X] T015 [P] [US3] In `src/settings/schema.ts` privacy node (~245): add the toggle — title "Always relay calls", key `privacy.relayCalls`, default `false`, footer in Ring copy voice (plain, "you", no em-dashes or semicolons): "Route your calls through the Ring server so people you call never see your IP address. Calls may connect slower and quality may be lower. Applies from your next call." T013 now passes.
- [X] T016 [P] [US3] In `src/services/ownsync-keys.ts`: add `'privacy.relayCalls'` to `SYNCED_PREF_KEYS`. T014 now passes.
- [X] T017 [US3] Gates: `npm run build` + `npx vitest run` green; manual quickstart.md US3 check — with the toggle ON for exactly one side and OFF for the other (the FR-009 asymmetric pairing), the call connects and the toggled side's selected pair is `relay`; setting arrives on a second signed-in device.

**Checkpoint**: All three behavioral stories independently functional (US1 direct, US2 srflx, US3 forced relay).

---

## Phase 6: User Story 4 - Operator clarity and zero-change safety (Priority: P4)

**Goal**: Docs tell the truth at every exposure level; stale SFU/forced-relay references are gone.

### Implementation for User Story 4 (docs only — no test tasks; behavior covered by T006/T007)

- [X] T018 [P] [US4] In `server/docs/CALLING.md`: the "relay only when a direct path is blocked" wording (~31-39) is now accurate — keep and sharpen it; add a "Direct media paths (optional UDP)" section covering `TURN_UDP_LISTEN=:3478` + forwarding `3478/udp`, `STUN_PUBLIC_HOST`/`STUN_PUBLIC_PORT`, behavior at each exposure level (nothing open → relay + LAN-direct; UDP open → internet-wide direct), the optional public `RELAY_IP` for one-sided relay, and the censorship note (UDP STUN is fingerprintable; TURNS-on-443 remains the covert path with automatic fallback).
- [X] T019 [P] [US4] In `CLAUDE.md`: remove the phantom SFU — "an embedded TURN relay + SFU for calls" (~line 33) and any other SFU mention; describe calls as P2P/mesh, direct when possible, embedded TURN relay as fallback.
- [X] T020 [P] [US4] In `e2e/calls.spec.ts` (~line 6): fix the stale "relayed through the embedded TURN" header comment to reflect direct-when-possible (same-host e2e now connects via host candidates).

**Checkpoint**: Docs match reality end to end.

---

## Phase 7: Polish & Cross-Cutting

- [X] T021 Run all gates from quickstart.md: `npm run build`, `npx vitest run` (coverage floors hold), `cd server && go build ./... && go vet ./... && go test ./...`, and `npm run test:e2e` (needs `make db-up`) — all green.
- [ ] T022 Regression watch (SC-004, FR-010): compare `markConnect` call-setup timings (instrumented in `src/composables/useCall.ts`, visible via the drive harness) before/after on a relay-path scenario; budget +300ms per SC-004. Also exercise mid-call direct-path loss once (e.g. drop one side's network interface or toggle Wi-Fi mid-call on a real device) and confirm the existing reconnection recovers the call on the relay. Record the numbers in the PR description.
- [X] T023 Bump spec `**Status**:` in `specs/1043-direct-peer-peer/spec.md` (planned → in-progress at implement start, → in-review at PR) and run `make roadmap` so the CI roadmap guard stays green.

---

## Dependencies & Execution Order

- **US1 (T001-T005)**: no dependencies — start immediately. MVP.
- **US2 (T006-T012)**: independent of US1 (server-only files). Can run in parallel with US1.
- **US3 (T013-T017)**: depends on T002 (`callRtcConfig()` reads the setting) for end-to-end effect; the schema/sync tasks themselves (T013-T016) only need the key name and can run any time.
- **US4 (T018-T020)**: content depends on US2's final knob names; text-only, run after T008-T011 land.
- **Polish (T021-T023)**: after all desired stories.
- Within each story: test tasks strictly before implementation tasks (constitution III).

### Parallel opportunities

- T001 (client test) ∥ T006/T007 (server tests) — different languages, different files.
- After T002: T003 ∥ T004. After Config lands (T008): T009 → T010 → T011 are sequential (shared wiring), but ∥ any US3 task.
- T013 ∥ T014; T015 ∥ T016; T018 ∥ T019 ∥ T020.

## Implementation Strategy

MVP = US1 alone (client-only, works against unmodified servers). Ship order for production: US2 (server, additive) can deploy before or with the US1/US3 client per contracts/turn-credentials.md compatibility matrix. Each checkpoint is independently demonstrable via quickstart.md.
