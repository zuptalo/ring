# Research: Tech Stack Uplift

Consolidates the target-version research already done during `/speckit-specify`
(via `WebSearch`/`WebFetch` against npm, pkg.go.dev, and GitHub Releases, current
as of 2026-09-28) plus the decisions from `/speckit-clarify`. No unresolved
unknowns remain in the spec's Technical Context; this file documents *why* each
target was chosen, not just what it is, so the choice survives past the initial
research session.

## Phase A — safe (patch/no-op)

| Item | Decision | Rationale | Alternatives considered |
|---|---|---|---|
| Go | 1.26 → 1.27.1 | Latest stable point release; no breaking changes between minors at this distance | Staying on 1.26 — rejected, no reason to hold back a same-cycle point release |
| `golang.org/x/net`/`x/sync`/`x/sys`/`x/text` | → latest patch (0.59.x/0.23.x/0.48.x/0.42.x) | Routine `go get -u`; these are low-level, widely-used stdlib-adjacent modules with no API churn at patch level | N/A |
| `github.com/jackc/pgx/v5` | 5.9.2 → 5.11.x | Same major, no breaking API change expected; picks up driver fixes | N/A |
| `github.com/golang-jwt/jwt/v5` | 5.2.2 → 5.3.1 | Same major | N/A |
| `github.com/gorilla/websocket` | 1.5.3 | Already latest — verified, no bump available | N/A |
| `github.com/SherClockHolmes/webpush-go` | 1.4.0 | Already latest — verified, no bump available | N/A |
| PostgreSQL (`docker-compose.yml`, `server/docker-compose.yml`) | `postgres:18` | Already the latest stable major — verified, no bump; PostgreSQL 19 is still in beta | Moving to 19 — rejected, not stable yet; see spec Out of Scope |
| GitHub Actions (`checkout`, `setup-node`, `setup-go`) | v5/v5/v6 → v7 each | v7 releases (mid-2026) migrate to ESM and are the maintained majors; staying on v5/v6 risks the Node 20 runtime removal GitHub Actions began enforcing in 2026 | Pinning to v6 — rejected, v6 setup-node/setup-go are superseded and the Node 20 runner deprecation makes v5 checkout/setup-node the wrong side of that cutover |
| `actions/cache`, `actions/upload-artifact`, `docker/*` actions, `dorny/paths-filter`, `dataaxiom/ghcr-cleanup-action` | re-check at implementation time | These move independently of the above three; no material research finding changes their risk tier, so re-verify current majors when the Phase A PR is actually opened rather than pin a possibly-stale number now | N/A |
| `@playwright/test` | 1.60.0 → 1.63.x | Same major, routine | N/A |
| Alpine (Dockerfile runtime stage) | 3.24 → 3.24.2 | Latest patch of the already-current stable branch | Moving to a newer Alpine minor — not needed, 3.24 is still supported |
| Small client libs (`@zxing/browser`, `sharp`) | → latest via `npm outdated` | Low blast radius, patch/minor only | N/A |
| `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `emoji-picker-element`, `flubber`, `heic2any`, `lottie-web`, `mp4-muxer`, `qrcode`, `fake-indexeddb` | already latest | Verified via `npm outdated` at implementation time (2026-09-28) — no newer version published | N/A |
| `mp4box` | 0.5.4 → **excluded from Phase A** | `npm outdated` shows 0.5.4 → 2.4.1 — a multi-major jump, not a patch bump as originally assumed. v1.0.0 changed `discardMdatData` to default `true` (parsed media bytes are discarded unless explicitly opted back in via `createFile(true)`), and Ring's video-post pipeline (spec 2041's streaming demux) depends on getting those bytes back. This is a real breaking-change risk, not a safe bump — moved out of Phase A into its own follow-up investigation rather than bundled as a "small lib." | Bumping blindly in Phase A — rejected, discovered during implementation via `npm outdated`, not caught by the original per-package research pass |

## Phase B — moderate (major version, low behavioral risk)

| Item | Decision | Rationale | Alternatives considered |
|---|---|---|---|
| `vue-tsc` | 2.2.12 → 3.3.x | Peer dependency is only `typescript>=5.0.0`; compatible with the TypeScript target below with no known breaking change for this project's usage | N/A |
| `vitest` + `@vitest/coverage-v8` | 3.2.6 → 5.0.x | Major bump, but it's test tooling, not app runtime; the existing coverage-floor gate is the safety net (per the clarify session, no performance/CI-time budget blocks this) | N/A |
| `vue` | 3.5.35 → 3.5.40 | Latest patch on the 3.5 line; 3.6 is still a release candidate as of research date | Jumping to 3.6 — explicitly rejected, see spec's Out of Scope |
| Node.js (CI `actions/setup-node`, Dockerfile `node` base image) | 22 → 24 | Node 24 is Active LTS (through Apr 2028) today; Node 26 doesn't enter LTS until October 2026, so 24 is the actual latest-*supported* target now, per the plan-mode decision already made with the user | Node 26 — rejected for now (not yet LTS at spec time); staying on Node 22 — rejected, it's Maintenance LTS and the stated goal is latest supported |
| `@types/node` | 25.9.1 → ^24.x | Must track the Node runtime major, not float independently; 25 is a stray odd-numbered Current release with no corresponding LTS runtime here | N/A |
| TypeScript | 5.9.3 → latest 5.9.x patch (bump within the line, **not** to 7) | `vue-tsc`/Vue Language Tools do not support TypeScript 7 yet (TS7 dropped the TS6-compatible programmatic API Volar depends on); ecosystem fix expected around TS 7.1 (~October 2026). The version bump itself is low-risk (patch-only within 5.9.x) even though the *decision to hold at 5.9* is what made this worth researching — filed here in Phase B, not Phase C, since the actual change lands with the rest of the low-risk tooling bump | TypeScript 7 — explicitly rejected for this spec, see Out of Scope; revisit once `vue-tsc` documents TS7 support |

## Phase C — coordinated / high-risk

| Item | Decision | Rationale | Alternatives considered |
|---|---|---|---|
| `@ionic/vue` + `@ionic/vue-router` | 8.8.8 → 9.0.x | Latest major; ships Vue Router 5 support, which this project needs anyway | Staying on Ionic 8 — rejected, it's the single largest version gap and blocks `vue-router` 5 |
| `vue-router` | 4.6.4 → 5.3.x | Required by Ionic 9's Vue output target; upstream describes it as "a boring release" (absorbs `unplugin-vue-router`, no breaking changes to the core API), though Ionic's own migration notes flag `next()` in navigation guards as deprecated | Staying on 4.x — rejected, incompatible with the Ionic 9 target |
| `ionicons` | 7.4.0 → latest compatible with Ionic 9 | Exact pin to be confirmed against whatever Ionic 9 itself declares as its icon-set peer at implementation time (this narrow detail is time-sensitive and best re-checked then, not frozen months in advance) | N/A |
| `vite` | 6.4.2 → land on 7.3.x, then 8.3.x only if clear | `vite-plugin-pwa`'s workbox chain still requires Babel 7 while Vite 8 wants Babel 8 — an open conflict as of research date. Landing on 7.3 first (still receiving fixes) de-risks the hop; only advance to 8 once that conflict is confirmed resolved | Jumping straight to Vite 8 — rejected as the primary path due to the open Babel conflict; the spec's Edge Cases already codify holding at 7.3 if the conflict persists |
| `@vitejs/plugin-vue` | 5.2.4 → latest matching chosen Vite major | Standard pairing; no independent research finding beyond "match Vite" | N/A |
| `vite-plugin-pwa` | 1.3.0 (unchanged) | Already latest; its peer range covers Vite 7 and 8, so no version bump is needed here — only the Babel-chain conflict needs re-verification | N/A |
| `libsodium-wrappers-sumo` | 0.7.16 → 0.8.4 | Latest; this is the crypto core, so the version bump itself is low-effort but the verification bar is high — see spec FR-005/SC-003. Native libsodium version moves 1.0.20 → 1.0.22 (minor). A standalone primitive cross-compatibility test (AEAD with a raw key, AEAD with an Argon2id-derived key, X25519 scalarmult, Ed25519 sign/verify — all encrypted/derived/signed under 0.7.16 and decrypted/re-derived/verified under 0.8.4) passed on all 5 cases, 2026-09-28. This de-risks the library swap itself but does not replace FR-005's full regression suite + real-device + security-review gate, since it doesn't exercise the app's Double Ratchet/sender-key protocol code or on-device storage. | N/A |
| `@types/libsodium-wrappers-sumo` | 0.7.8 → matching 0.8.x | Must track the runtime package | N/A |
| `pion/turn` (+ `pion/dtls`, `pion/stun`, `pion/transport`) | v4 line → v5 line | The wider Pion ecosystem has moved: `pion/transport` v4→v5, `pion/stun` v3→v4, and `pion/turn` v5 exists specifically to consume both. Taking the v4 line further would mean staying on an increasingly orphaned dependency graph | Staying on `pion/turn` v4 — rejected as a "latest supported" target since v5 is the actively developed line the rest of the ecosystem has moved to; deferring the whole group entirely — rejected per the plan-mode decision to include it, gated on real-device testing |
| `golang.org/x/crypto` (local patch) | rebase `patches/x-crypto` onto v0.57.0+ | Keeps the existing ACME/autocert retry-exhaustion fix (PR #1154/#1155) alive on a current base rather than freezing the server's crypto module at v0.53.0 indefinitely | Dropping the patch — only valid if upstream has independently fixed the same bug, which MUST be re-verified, not assumed, before dropping it (spec Edge Cases) |

## Clarify-session decisions folded in

- No build/CI-time performance budget gates any phase (functional correctness via
  existing test suites is the bar).
- Upstreaming the `x/crypto` fix is an optional stretch goal, not required to ship.
- The Ionic 9 task requires an explicit codebase audit (not just manual QA) for the
  removed legacy `ion-radio`/`ion-range` prop syntax.
