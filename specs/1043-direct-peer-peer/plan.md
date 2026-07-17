# Implementation Plan: Direct Peer-to-Peer Call Media with Relay Fallback

**Branch**: `feat/1043-direct-peer-peer` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1043-direct-peer-peer/spec.md`

## Summary

Today every call leg (1:1 and each group-mesh leg) is forced through the embedded TURN relay: the client builds all peer connections with `iceTransportPolicy: 'relay'` (`src/services/call/turn.ts:63-68`) and `/v1/turn-credentials` advertises a single `turns:` entry (`server/internal/api/turn_handlers.go`). This plan removes the forced relay: the client switches to `iceTransportPolicy: 'all'` so ICE can pick direct paths (same-LAN mDNS host candidates immediately; internet-wide srflx when the operator exposes an optional UDP endpoint), with the relay remaining in the candidate set as automatic fallback. A new synced setting `privacy.relayCalls` (default off) forces relay-only per user. The server gains two opt-in env knobs (`TURN_UDP_LISTEN`, `STUN_PUBLIC_HOST/PORT`); with them unset, no new listener opens and behavior is unchanged. No cryptographic change: media stays native DTLS-SRTP end-to-end on every path; signalling stays sealed over the Double Ratchet.

## Technical Context

**Language/Version**: TypeScript 5 / Vue 3 + Ionic (client), Go 1.26 (server)

**Primary Dependencies**: WebRTC (browser-native `RTCPeerConnection`), `pion/turn/v4` (embedded TURN/STUN relay), libsodium (unchanged, untouched)

**Storage**: Client settings store in IndexedDB via existing `settings` mechanism (no new object store, no `DB_VERSION` bump); server env config only (no migration)

**Testing**: Go handler/relay unit tests against the fake-store pattern (`server/internal/api/*_test.go`, `server/internal/turn/server_test.go`); vitest for `rtcConfig` policy + settings schema + own-sync allowlist; Playwright e2e (`e2e/calls.spec.ts`, unchanged assertions); manual path verification via `drive/` harness + `chrome://webrtc-internals`

**Target Platform**: Installable PWA (evergreen browsers, iOS/Android WebKit/Chromium) + single-container `ringd` deployment

**Project Type**: Web application (client at repo root, Go server in `server/`)

**Performance Goals**: SC-004 — call setup time must not regress by more than a few hundred ms in relay-only network scenarios (ICE gathers a few extra candidates); SC-001/002 — direct legs remove the server round-trip and its media bandwidth entirely

**Constraints**: Relay fallback must never get weaker (SC-003: every call that connected before still connects); zero-deployment-change installs must behave identically except same-LAN direct; response shape of `/v1/turn-credentials` stays `{iceServers, ttl}` for cross-version interop; TURNS-on-443 + SNI-passthrough remains the baseline deployment (constitution Domain Constraints)

**Scale/Scope**: ~6 client files (2 call-path call sites + config helper + settings schema/tests + sync allowlist), ~4 server files (config, turn server, main wiring, handler) + 2 new test files, 3 docs files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero-Knowledge Boundary | PASS | Spec carries the required Zero-Knowledge Impact section. No plaintext crosses the wire; server learns nothing it doesn't already see (client IPs on HTTP/WS); direct legs mean the server sees **less** (no media volume/timing). Peer-visible IP exposure is bounded, documented, and opt-out via `privacy.relayCalls`. |
| II. Spec-Driven Development | PASS | Spec 1043 (ad-hoc band), branch `feat/1043-direct-peer-peer`, full pipeline being followed. |
| III. Test-Driven Development | PASS | tasks.md will order failing tests first: new `turn_handlers_test.go` + `server_test.go` UDP cases, vitest `rtcConfig` policy cases, schema/own-sync guard updates — all before implementation tasks. |
| IV. Crypto Discipline | PASS (no-op) | No crypto change. `messaging.ts` and the crypto core are untouched; sealed-signalling path unchanged (only candidate *count* grows, and sealing is already mutex-serialized with mesh-side buffering). `/speckit-checklist` will still run (required: spec touches Principle I territory). |
| V. Offline-First Data Integrity | PASS | New setting uses the existing settings store; no schema/`DB_VERSION` change. Synced via existing own-sync allowlist (last-write-wins). |
| VI. Stateless Server & Migrations | PASS | No DB change, no migration, no new state. Two new env knobs; UDP listener is in-process and off by default. |
| VII. Quality Gates | PASS | Gates enumerated in Verification below; commit subjects drafted as user-facing release-note copy. |
| VIII. Traceable Delivery | PASS | `taskstoissues` will open one issue per task; PR lists `Closes #N`. ROADMAP regenerated. |
| IX. Privacy & Data Minimization | PASS | Strictly reduces server-side metadata; peer exposure minimized (mDNS masking) with a synced opt-out. |
| X. Accessibility & i18n | PASS | One toggle added declaratively to `src/settings/schema.ts`; stock Ionic rendering, no new component. |
| XI. Ionic-First UI | PASS | No new UI beyond the schema-driven toggle. |
| Domain: Calls/TLS 443 + SNI passthrough | PASS (additive) | The TURNS-on-443 passthrough path stays the baseline and the universal fallback. The UDP endpoint is an *additional*, operator-opt-in listener; `CALLING.md` is updated to describe both levels and their trade-offs (UDP is more fingerprintable; 443 relay remains the covert path). |

No violations → Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/1043-direct-peer-peer/
├── spec.md              # Feature specification (with Zero-Knowledge Impact)
├── plan.md              # This file
├── research.md          # Phase 0: decisions + rationale + alternatives
├── data-model.md        # Phase 1: entities (setting, config knobs, response shape)
├── quickstart.md        # Phase 1: how to run + verify each user story
├── contracts/
│   └── turn-credentials.md  # /v1/turn-credentials response contract (before/after)
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── services/call/
│   ├── turn.ts              # rtcConfig() policy change + new callRtcConfig() helper
│   └── mesh.ts              # buildLeg (:783) + restartLegIce (:377) use callRtcConfig()
├── composables/
│   └── useCall.ts           # newPeerConnection (:780) uses callRtcConfig()
├── settings/
│   ├── schema.ts            # new privacy.relayCalls toggle (declarative)
│   └── schema.test.ts       # DEAD-guard comment update + positive assertion
└── services/
    ├── ownsync-keys.ts      # add privacy.relayCalls to SYNCED_PREF_KEYS
    └── ownsync.test.ts      # allowlist coupling test update

server/
├── cmd/ringd/main.go        # TLS branch: advertise stun:/turn:udp when configured
├── internal/config/config.go    # TURN_UDP_LISTEN, STUN_PUBLIC_HOST/PORT; fix stale SFU comment
├── internal/turn/server.go      # optional UDP listener in TLS mode; fix stale comments
└── internal/api/
    ├── turn_handlers.go     # StunURLs as extra credential-less iceServers entry
    └── turn_handlers_test.go  # NEW: handler tests (none exist today)

e2e/calls.spec.ts            # stale header comment fix only (no assertion changes)
server/docs/CALLING.md       # "Direct media paths (optional UDP)" section; now-true fallback wording
CLAUDE.md                    # drop phantom "TURN relay + SFU" wording
```

**Structure Decision**: Existing web-app monorepo layout (client at root, server in `server/`); this feature only edits files in place — no new directories or modules beyond one new server test file.

## Design Decisions (Phase 0 summary — full detail in research.md)

1. **`iceTransportPolicy: 'all'` with the relay always in the candidate set** — ICE natively prefers working direct pairs and falls back to relay; no custom path selection logic.
2. **Setting read at peer-connection construction** via one shared helper `callRtcConfig()` so all four call sites (1:1 create, mesh `buildLeg`, mesh `restartLegIce` `setConfiguration`, and any future ICE restart) can never diverge in policy.
3. **New key `privacy.relayCalls`, default `false`** — do NOT resurrect `privacy.protectIp` (stale encrypted own-sync snapshots could silently re-apply it); keep it in the DEAD list.
4. **No ICE-candidate batching** — sealing is mutex-serialized (`src/services/messaging.ts:62-79`) and the mesh already buffers local ICE until the leg is negotiated (`mesh.ts:822-838`); a new batched signal type would break cross-version calls.
5. **Server advertises, client decides** — the stun entry rides the existing `{iceServers, ttl}` response as an extra credential-less element; old clients ignore it, new clients against old servers simply get no stun entry (LAN-direct + relay). Ship server first.
6. **UDP endpoint serves both STUN and TURN-over-UDP** — once the listener exists, advertising `turn:<host>:<port>?transport=udp` too is free and gives UDP-relay quality > TCP-relay when reachable; ICE still prefers direct pairs.
7. **`RELAY_IP` stays loopback by default** — mixed pairs (one side direct-capable, other relay) still connect because both sides always allocate relay candidates; document that UDP-enabled operators may set `RELAY_IP` public for one-sided relay efficiency. Cosmetic failed-pair checks in diagnostics are expected and documented.

## Reconnection & Quality Interplay (verified against current code)

- 1:1: `disconnected` → grace + wait; `failed` → caller-side `iceRestart: true` offer (`useCall.ts:789-848`). With `'all'`, `failed` still means "every pair including relay failed" — semantics unchanged. Direct-pair blips surface as `disconnected` and recover inside the existing grace window.
- Mesh: `onLegState` (`mesh.ts:985`) restarts on `failed`; `restartLegIce` (`mesh.ts:377-389`) must receive the same setting-aware config as `buildLeg` (covered by decision 2).
- Adaptive quality (`src/services/call/quality.ts`) is path-agnostic AIMD per leg, capped at `hd`/4 Mbps — no change; direct paths simply reach higher tiers more often.

## Verification (Definition of Done, Principle VII)

- `npm run build` (vue-tsc typecheck + vite build)
- `cd server && go build ./... && go vet ./... && go test ./...`
- `npx vitest run` (coverage floors hold)
- `npm run test:e2e` (no spec asserts relay; same-host browsers will pick host candidates)
- Manual: two-browser call on `make start` → selected candidate pair is `host↔host`; toggle `privacy.relayCalls` on one side → pair becomes `relay`; UDP-enabled deployment across networks → `srflx` pair. Compare `markConnect` timings before/after (SC-004).
