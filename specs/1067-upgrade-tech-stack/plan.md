# Implementation Plan: Tech Stack Uplift

**Branch**: `feat/1067-upgrade-tech-stack` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1067-upgrade-tech-stack/spec.md`

## Summary

Bring every client and server dependency, build tool, and base image to its
latest *supported* version — not simply its latest published tag, where the
published latest isn't actually usable in this stack yet (TypeScript 7 breaks
`vue-tsc` today; Vue 3.6 and PostgreSQL 19 are still pre-release). The work is
staged into three PRs (or small PR groups) by risk, matching the spec's Phase
A/B/C:

- **Phase A** — patch/no-op bumps with no known behavioral change (Go point
  release, `x/*` modules, `pgx`, `golang-jwt`, GitHub Actions majors, Playwright,
  small client libraries, Alpine patch).
- **Phase B** — major-version tooling bumps with low app-runtime risk
  (`vue-tsc`, `vitest`/`@vitest/coverage-v8`, `vue` 3.5.40, Node 22→24).
- **Phase C** — coordinated, high-risk bumps that need verification beyond
  automated tests: Ionic 9 + Vue Router 5 together, the Vite major (staged
  through 7.3 before any hop to 8), `libsodium-wrappers-sumo` (crypto core,
  needs the regression suite + a security review), and the Pion/TURN ecosystem
  group (needs a real-device call test).

No new user-facing behavior, no new entities, no new API contracts. The risk is
entirely in "does the app still work the same," which is why each phase's PR
carries the verification its risk tier warrants rather than one uniform gate.

## Technical Context

**Language/Version**: TypeScript 5.9.x latest patch (TS 7 explicitly deferred), Vue
3.5.40, Ionic 8.8.8 → 9.0.x; Go 1.26 → 1.27.1

**Primary Dependencies**: `@ionic/vue`/`@ionic/vue-router` 9.0.x, `vue-router`
5.3.x, `vite` 7.3.x (→ 8.3.x if the `vite-plugin-pwa` Babel conflict clears),
`libsodium-wrappers-sumo` 0.8.4, `pgx` v5.11.x, `pion/turn` v5 line, stdlib
`net/http`

**Storage**: unchanged — IndexedDB on device (source of truth); PostgreSQL 18
server-side (opaque ciphertext only); no schema/migration changes in this spec

**Testing**: `vue-tsc` typecheck via `npm run build`, vitest units + coverage
floors, Playwright e2e under `e2e/`, Go table tests against the in-memory fake
store, plus two verification steps beyond automation for Phase C: the existing
crypto regression suite (forgery/replay/out-of-order/skipped-key) + a security
review for the `libsodium-wrappers-sumo` bump, and a manual real-device WebRTC
call (direct-P2P path + relay-required path) for the Pion/TURN bump

**Target Platform**: installable PWA, iOS Safari and Chromium; single container
serving PWA + API (unchanged)

**Project Type**: monorepo — Vue PWA at the repo root, Go `ringd` under `server/`

**Performance Goals**: none set for this spec — per the clarify session, no
build/CI-time performance budget gates any phase; functional correctness
(existing test suites green) is the bar

**Constraints**: zero-knowledge boundary must survive the `libsodium-wrappers-sumo`
bump unchanged (wire format, key derivation, ciphertext compatibility); TURN-over-TLS
calling must keep working through the Pion/TURN bump; target choices are bounded
by ecosystem readiness, not just "what's newest" (TS 7, Node 26, Vue 3.6, Postgres
19 are all explicitly deferred — see spec Out of Scope)

**Scale/Scope**: every client (`package.json`) and server (`server/go.mod`,
`Dockerfile`, `docker-compose*.yml`, `.github/workflows/*.yml`) dependency, tool,
and base image named in the spec's target version matrix; three phases, each its
own PR(s)

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. No changes
between the two passes — this spec's shape doesn't move during design because
there's no design to speak of beyond the version matrix and staging already
fixed at `/speckit-specify`/`/speckit-clarify` time.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary | **PASS with a required verification gate** | Only the `libsodium-wrappers-sumo` bump touches the crypto core; FR-005 requires proving no wire-format/key-derivation/ciphertext change before merge. Nothing else in this spec crosses the wire differently. Requires `/speckit-checklist` before implement (Principle IV is also touched — see below; the constitution requires the checklist for either). |
| II. Spec-Driven Development | PASS | specify → clarify → plan done; tasks → analyze → taskstoissues → implement to follow, per phase. |
| III. Test-Driven Development | PASS, adapted | There's no new user-facing behavior to red-green. The adaptation: existing test suites are the regression net for Phase A/B; Phase C requires the suites plus the two manual verification steps above *before* merge, not after. Any incompatibility the bump surfaces gets a regression test before the fix lands, same as any bug fix would. |
| IV. Crypto Discipline | **PASS with a required gate** | No new primitives, no hand-rolled crypto — `libsodium-wrappers-sumo` is the existing reused core, just a newer build of it. The gate is verification, not design: full forgery/replay/out-of-order/skipped-key regression coverage green, plus a security review, before that PR merges (FR-005, SC-003). Requires `/speckit-checklist`. |
| V. Offline-First Data Integrity | PASS | No `DB_VERSION` bump, no `onupgradeneeded` change — no new/altered object store. |
| VI. Stateless Server & Forward-Only Migrations | PASS | No new migration; no `SECRETS_KEY` involvement; Dockerfile base-image bumps don't add volumes/mounts. |
| VII. Quality Gates | PASS | Gates listed under Definition of done below; each phase must clear them before its PR merges. |
| VIII. Traceable Delivery | PASS | `taskstoissues` opens one issue per task/phase-group; each phase's PR lists `Closes #N`. |
| IX. Privacy & Data Minimization | PASS | No telemetry, no new data collected — dependency versions only. |
| X. Accessibility & i18n | PASS | Ionic 9's bidi/RTL and a11y behavior carries forward; `ion-modal`'s `handleBehavior` default change (`"none"` → `"cycle"`) is an a11y *improvement* for keyboard users, not a regression, and Ring doesn't set it explicitly anyway. |
| XI. Ionic-First UI | **PASS with a required audit** | FR-007 requires an explicit codebase audit against Ionic's real `BREAKING.md` for v9 (the clarify session's original premise about `ion-radio`/`ion-range` was itself wrong — corrected during implementation, see `research.md`). The real audit found and fixed a genuine `autocorrect` boolean-coercion regression on `ion-input` (10 occurrences, 5 files) and confirmed clean on every other v9 breaking change (`ion-picker-legacy`, `ion-nav`, `swipeBackEnabled`, `ion-select`, floating labels, custom DOM-class CSS). No new bespoke widgets introduced by this spec. |

### Domain Constraints

| Constraint | Verdict | Notes |
|---|---|---|
| Calls / TLS | **PASS with a required real-device test** | The Pion/TURN ecosystem bump (v4 line → v5 line, pulling `pion/transport` v5 and `pion/stun` v4) is calling-critical. FR-006/SC-004 require a manual real-device call over both a direct-P2P-eligible network and a relay-required (TURN-over-TLS) network before that PR merges, per `server/docs/CALLING.md`. |
| Single image | PASS | Dockerfile stage base-image version bumps (`node`, `golang`, `alpine`) don't change the multi-stage-into-one-image structure. |
| Dev parity | PASS | `make start` and the e2e stack must keep working through the Node/Go/Vite bumps; verified as part of each phase's `npm run build`/`npm run test:e2e` gate. The `window.__ringTest` stripping from production builds is unaffected by dependency versions and is re-confirmed incidentally by the e2e run still passing against a production-style build. |

No violations requiring justification — every row above is a PASS, several with
a required verification step that's already captured as a functional requirement
in the spec rather than left implicit. **Complexity Tracking is empty**; nothing
here trades away a simpler alternative.

## Project Structure

### Documentation (this feature)

```text
specs/1067-upgrade-tech-stack/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 — target-version matrix with rationale
├── data-model.md         # Phase 1 — N/A, no new entities (stated explicitly)
├── quickstart.md         # Phase 1 — verification runbook per phase
├── checklists/
│   ├── requirements.md   # from /speckit-specify
│   └── crypto-zk.md      # to be added by /speckit-checklist — required, Principle IV touched
└── tasks.md              # /speckit-tasks
```

No `contracts/` directory: this spec introduces or changes no API/interface
contract. Every touched surface is a dependency version, build tool, base
image, or CI configuration value — there is nothing for a contract document to
describe that the target-version matrix in `research.md` doesn't already cover.

### Source Code (repository root)

This is a monorepo-wide dependency bump, not new source, so the "structure" is
the set of manifest/config files each phase touches:

```text
# Phase A
server/go.mod, server/go.sum          Go 1.27.1; pgx, golang-jwt, x/net, x/sync, x/sys, x/text
Dockerfile                             golang:1.26-bookworm -> 1.27-bookworm; alpine:3.24 -> 3.24.2
docker-compose.yml,                    verify postgres:18 is already latest supported (no bump);
server/docker-compose.yml               record explicitly, same treatment as gorilla/websocket below
.github/workflows/*.yml                actions/checkout, setup-node, setup-go -> v7; re-check cache/
                                        upload-artifact/docker-*/paths-filter/ghcr-cleanup majors
package.json, package-lock.json        @playwright/test; small client libs via `npm outdated`;
                                        verify gorilla/websocket, webpush-go already latest (no bump)

# Phase B
package.json, package-lock.json        vue-tsc, vitest, @vitest/coverage-v8, vue 3.5.40,
                                        typescript to its latest 5.9.x patch (not 7 — see Out of Scope)
Dockerfile                              node:22-bookworm-slim -> node:24-bookworm-slim
.github/workflows/*.yml                node-version: 22 -> 24
package.json                            @types/node -> ^24.x

# Phase C
package.json, package-lock.json        @ionic/vue, @ionic/vue-router, vue-router, ionicons,
                                        vite, @vitejs/plugin-vue, libsodium-wrappers-sumo,
                                        @types/libsodium-wrappers-sumo
vite.config.ts                          re-verify the libsodium-wrappers-sumo CJS aliasing
                                        workaround still applies post-bump
src/**/*.vue                            fix sites found by the BREAKING.md audit (autocorrect
                                        boolean-coercion on ion-input; files not known ahead)
server/go.mod, server/go.sum            pion/turn, pion/dtls, pion/stun, pion/transport (coordinated)
patches/x-crypto                        rebase onto the new golang.org/x/crypto base version
```

**Structure Decision**: no structural change to the repo — every file above
already exists in its current form; this spec only changes the version pinned
in each. The one net-new artifact is whatever files the Ionic-9 legacy-prop
audit turns up, which can't be enumerated before the audit runs (see
`quickstart.md`'s grep commands).

## Implementation sequencing

Matches the spec's Phase A/B/C exactly; each phase is independently mergeable
and gets its own PR(s), per SC-005.

**Phase A — safe bumps.** Bump Go, the `x/*` modules, `pgx`, `golang-jwt` in
`server/go.mod`; bump the GitHub Actions versions across `.github/workflows/*.yml`;
bump `@playwright/test` and the small client libraries in `package.json`; bump
the Alpine patch tag in `Dockerfile`. Verify (don't bump) `gorilla/websocket`
and `webpush-go` are already latest. Run the full existing gate suite — zero
code changes expected beyond manifests/lockfiles.

**Phase B — moderate tooling bumps.** Bump `vue-tsc`, `vitest`,
`@vitest/coverage-v8`, `vue` (3.5.40) in `package.json`. Move the Node target to
24 across `.github/workflows/*.yml`, `Dockerfile`, and `@types/node`. Run
`npm run build` + `npm run test:unit` with coverage floors enforced.

**Phase C — coordinated/high-risk bumps**, each its own PR:
1. Ionic 9 + Vue Router 5 together (they're coupled): run `npx @ionic/migrate`,
   audit against Ionic's real `BREAKING.md` for v9 and fix every hit, build,
   run e2e, manually click through all four tabs.
2. Vite: land on 7.3.x; attempt 8.3.x only after confirming the
   `vite-plugin-pwa` Babel-7-vs-8 conflict has cleared upstream; build + e2e
   either way.
3. `libsodium-wrappers-sumo`: bump, run the crypto regression suite, get the
   security review sign-off, confirm existing local data/sessions still decrypt
   on a real device.
4. Pion/TURN ecosystem: bump `pion/turn` to the v5 line (pulling
   `pion/transport` v5, `pion/stun` v4); rebase `patches/x-crypto`; run
   `go test ./...`; place the two real-device calls per `server/docs/CALLING.md`.

**Correction found during implementation**: Vite and Ionic+Vue Router are not
independent of each other as originally assumed — `vue-router@5.3.1` carries an
optional peer on `vite@"^7.3.0 || ^8.0.0"` (via `@ionic/vue`'s
`@stencil/vue-output-target` dependency), so installing Ionic 9 + Vue Router 5
before Vite fails with an ERESOLVE conflict. **Vite runs before Ionic +
Vue Router.** libsodium and Pion/TURN remain independent of both and of each
other. Sequencing across A → B → C is still not flexible, since B relies on
A's Node/tooling baseline and C's Ionic/Vite work is easiest to reason about
once B's `vue-tsc`/`vitest` baseline is settled.

## Definition of done

- `npm run build` (vue-tsc typecheck + vite build) passes, for every phase
- `cd server && go build ./... && go vet ./... && go test ./...` pass, for every
  phase touching the server
- `npm run test:unit` passes and coverage floors hold, from Phase B onward
- `npm run test:e2e` passes, for every phase touching client build tooling or
  Ionic/Vue Router
- Phase C additionally: crypto regression suite green + security review
  sign-off (libsodium), and a successful real-device call over both a
  direct-P2P and a relay-required network (Pion/TURN), before those specific
  PRs merge
- Each phase's `package.json` version bump accompanies its own PR per the
  repository's release-guard rule (every PR into `main` bumps the version)

## Complexity Tracking

*Empty — no Constitution Check row required a simpler-alternative justification.*
