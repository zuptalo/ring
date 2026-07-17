# Implementation Plan: Group call reliability, adaptive quality, caps, audio cues & busy signalling

**Branch**: `feat/0004-group-call-reliability` | **Date**: 2026-06-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/0004-group-call-reliability/spec.md`

## Summary

Harden Ring's mesh-based calling across six independently-shippable slices: (US1) stop
buffered group invites from re-pulling a member who left; (US2) make every un-takeable
incoming call — 1:1 or group — return a clear busy/unavailable instead of ringing forever;
(US3) enforce 4-video / 8-audio participant caps client- and server-side and block the
audio→video upgrade above 4; (US4) replace the publisher-count quality heuristic with a
per-connection AIMD bitrate controller that starts low, climbs only with headroom, backs off
on congestion (local *and* remote-reported), suspends video before sacrificing audio, and runs
independently per mesh leg; (US5) add synthesized audio cues for every call state and toggle;
(US6) delete the dead SFU stack, rewrite `CALLING.md`, and strip migration diagnostics. No new
persistent schema and no new server knowledge — the approach is entirely client-local plus two
small additions to the existing relay metadata the server already sees.

See [research.md](./research.md) for the decisions behind each slice, [data-model.md](./data-model.md)
for the in-memory/on-wire state, [contracts/ws-call-frames.md](./contracts/ws-call-frames.md)
for the frame delta, and [quickstart.md](./quickstart.md) for validation steps.

## Technical Context

**Language/Version**: TypeScript (ES modules, Vue 3 `<script setup>`, Ionic) on the client;
Go 1.26 (stdlib `net/http`) on the server.

**Primary Dependencies**: Client — Vue 3, Ionic, libsodium (unchanged; signalling still sealed
via `messaging.ts`), browser WebRTC (`RTCPeerConnection`, `getStats`, `setParameters`), Web
Audio (`sound.ts`). Server — `pion/webrtc` (removed with the SFU), `gorilla/websocket`, `pgx`.

**Storage**: Client IndexedDB `'calls'` store (existing, schemaless records — no `DB_VERSION`
bump). Server call registry is in-memory; no SQL migration.

**Testing**: Client — vitest (pure units: `nextTier` controller, `cue` rate-limiter) + Playwright
e2e (`e2e/`, real WebRTC, network throttling). Server — `go test ./...` against the in-memory
fake store (`ws/call_test.go`, `call/registry_test.go`).

**Target Platform**: Installable PWA (Chromium + WebKit/iOS Safari + Firefox); single `ringd`
container serving PWA + API + `/v1/ws`.

**Project Type**: Web application (Vue PWA client + Go server) in one repo.

**Performance Goals**: Adaptive controller samples `getStats()` ~every 2 s per connection (≤4
legs video / ≤8 audio) — negligible. Busy/cap responses surface within ~5 s (SC-002). Video call
connects at `low` quickly and only climbs to `hd` on demonstrated headroom (SC-006).

**Constraints**: Zero-knowledge (Principle I) — no plaintext/media/keys to the server; iOS/Safari
must keep working (the mesh exists for this) — adaptive logic degrades gracefully where Safari
lacks `qualityLimitationReason`/`availableOutgoingBitrate`; media stays native DTLS-SRTP over
relay-only TURN-on-443.

**Scale/Scope**: Per-call ≤8 participants (audio) / ≤4 (video). Touches `mesh.ts`, `useCall.ts`,
`sound.ts`, `transport.ts`, `diag.ts`, the participant picker UI, `CallActivePage.vue`; server
`ws/hub.go`, `call/registry.go`, `cmd/ringd/main.go`; deletes `services/call/{sfu,e2ee,
e2ee-worker,e2ee-format}.ts` and `server/internal/sfu/`.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Principle | Status | Notes |
|---|---|---|
| I. Zero-Knowledge (NON-NEGOTIABLE) | ✅ PASS | No new plaintext. Server cap uses the `kind` already on `call-join` + roster it already holds; `call-full`/group `call-busy` carry only `roomId`+`from`/`to`/`kind`. Adaptation + cues emit no frames. Removing the SFU removes the only media-touching server part. **Zero-Knowledge Impact** documented in research.md §"Cross-cutting" and spec FR-032. |
| II. Spec-Driven | ✅ PASS | specify→clarify(done)→plan(this)→tasks→analyze→taskstoissues→implement. |
| III. Test-First | ✅ PASS | tasks.md will order failing tests first: server `registry_test`/`call_test`, client vitest for `nextTier`/`cue`, e2e per story. US1 & US2 are bug-class → start with a failing regression test. |
| IV. Crypto Discipline | ✅ PASS (no crypto change) | Signalling still sealed via existing `sealForChat`/Double Ratchet. Deleting `e2ee.ts` removes the **unused** per-frame insertable-streams layer, not the messaging ratchet. No primitives touched. |
| V. Offline-First | ✅ PASS | New call-history outcomes reuse the existing `'calls'` store (schemaless) — no `DB_VERSION` bump, no migration, no data loss. |
| VI. Stateless Server / Forward Migrations | ✅ PASS | Registry/buffer changes are in-memory; no SQL. Handlers stay stdlib + fake-store tests. Removing the SFU removes state-free code only. |
| VII. Quality Gates | ✅ PASS (enforced at done) | build + vet + go test + vitest + e2e. Commit subjects = plain-language release-note copy. PWA stays `registerType:'prompt'`. |
| VIII. Traceable Delivery | ✅ PASS | ROADMAP regenerated; tasks→issues; PR will `Closes #N`. |
| IX. Privacy / Data Min | ✅ PASS | No new telemetry; the change *removes* verbose server `call-diag` logging. |
| X. a11y / i18n | ✅ PASS | "Call is full" via stock Ionic toast/alert; cues are non-visual aids (complement, not replace, visible state). Text bidi-safe. |
| XI. Ionic-First UI | ✅ PASS | Cap/full messaging uses `ion-toast`/`ion-alert`; tile "busy" state styled with existing `--ring-*` tokens; no bespoke widgets. |

**Domain constraints**: Calls/TLS recipe (TURN-over-TLS-on-443, L4 passthrough) is unchanged;
`CALLING.md` is rewritten for accuracy but the deployment topology stays. Dev parity (`make start`,
e2e stack, stripped `__ringTest`) preserved.

**Result**: PASS — no violations; Complexity Tracking not required. `/speckit-checklist` is
REQUIRED (Principle I is touched) before `/speckit-implement`.

## Project Structure

### Documentation (this feature)
```text
specs/0004-group-call-reliability/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Phase 1 state model
├── quickstart.md        # Phase 1 validation guide
├── contracts/
│   └── ws-call-frames.md
├── checklists/
│   └── requirements.md  # spec quality (passing)
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)
```text
src/
├── composables/
│   └── useCall.ts                 # state machine: busy(US2), caps+upgrade gate(US3),
│                                  #   adaptive wiring(US4), cue triggers(US5), drop dead frames(US6)
├── services/
│   ├── call/
│   │   ├── mesh.ts                # per-leg quality controller(US4); strip DIAG(US6)
│   │   ├── quality.ts             # NEW: pure nextTier() controller + tier ladder (US4)
│   │   ├── diag.ts                # trim SFU decrypt tallies (US6)
│   │   ├── sfu.ts                 # DELETE (US6)
│   │   ├── e2ee.ts                # DELETE (US6)
│   │   ├── e2ee-worker.ts         # DELETE (US6)
│   │   └── e2ee-format.ts         # DELETE (US6)
│   ├── sound.ts                   # new cue recipes + cue() rate-limiter (US5)
│   └── transport.ts               # add call-full; group call-busy; remove sfu-*/call-key*/streamid (US6)
├── views/detail/CallActivePage.vue # busy tile state; keep slimmed stats panel (US6)
└── components/…                    # participant picker cap (US3); call-full toast

server/
├── internal/
│   ├── ws/hub.go                  # clearBufferedCalls(US1); group busy relay(US2);
│   │                              #   JoinIfRoom + call-full(US3); remove sfu-* handlers(US6)
│   ├── call/registry.go           # JoinIfRoom(roomID,userID,max) (US3)
│   └── sfu/                       # DELETE whole package (US6)
└── cmd/ringd/main.go              # remove SFU construction/wiring (US6)

server/docs/CALLING.md             # rewrite for mesh (US6)
e2e/                               # per-story specs (US1–US6)
```

**Structure Decision**: Existing monorepo layout (client at root, server under `server/`). The
only new files are `src/services/call/quality.ts` (pure controller, unit-tested in isolation per
Principle IV's pure-function discipline) and per-story e2e specs; everything else is edits or
deletions in place.

## Phasing & sequencing (delivery)

Independently shippable, ordered by priority and dependency:

1. **US1** (P1, server-only, smallest) — re-invite fix + regression test.
2. **US2** (P1) — busy for group + caller-side resolution + both-sided history (FR-031). US1 and
   US2 together close the two correctness bugs.
3. **US3** (P1) — caps (registry + hub + client picker/upgrade gate + `call-full`).
4. **US6** (P3 but low-risk, unblocks reasoning) — SFU teardown + docs; can land early since it
   only removes dead code. Sequenced after US3 so frame-type edits don't churn twice.
5. **US4** (P2, largest) — adaptive controller (`quality.ts` pure + per-leg wiring + 1:1).
6. **US5** (P3) — audio cues across the state machine.

Each slice: failing tests → implementation → gates green. US4 carries the most e2e/throttling
risk and the most unit value (the pure `nextTier`).

## Complexity Tracking

No constitution violations — section intentionally empty.
