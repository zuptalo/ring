# Feature Specification: Tech Stack Uplift

**Feature Branch**: `feat/1067-upgrade-tech-stack`

**Created**: 2026-09-28

**Status**: in-progress
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "Uplift the entire Ring tech stack (client and server) to the
latest supported versions, staged by risk so nothing lands as one big-bang change."

## Overview

Ring's client and server dependencies have drifted behind current upstream releases:
Ionic 8 vs. released Ionic 9, Vite 6 vs. released 8, Go 1.26 vs. released 1.27, and
several other libraries one or more majors behind. A stale stack accumulates
unpatched CVEs, loses access to upstream bug fixes (including in areas that already
bit this project — see the recent ACME/autocert retry-exhaustion fix, PR #1154), and
makes each future dependency bump harder as the gap widens.

This effort brings every client and server dependency, build tool, and base image to
its latest **supported** version — not necessarily its latest *published* version,
where the published latest isn't actually usable yet (e.g. TypeScript 7 today breaks
`vue-tsc`/Vue Language Tools). Work is staged by risk into three phases landing as
separate PRs under this spec, rather than one large simultaneous bump, so a
regression can be isolated to the phase that caused it and each phase gets the level
of testing its risk warrants.

## Clarifications

### Session 2026-09-28

- Q: Vite 8's Rolldown-based dependency optimization and the vitest 3→5 major bump can both change build/CI run times. Should this spec gate merges on a build/CI-time performance budget? → A: No performance gate — functional correctness (existing test suites green) is sufficient; build/CI time changes are noted but don't block a merge.
- Q: FR-004 says to "consider upstreaming" the `x/crypto` ACME retry-exhaustion fix. Is submitting it upstream required for this spec to ship, or an optional stretch goal? → A: Optional stretch goal — rebase the local patch and re-verify the bug, but an upstream submission is not a merge requirement (external review timelines are outside the maintainer's control).
- Q: Ionic 9 removes the legacy `ion-radio`/`ion-range` prop syntax. Should this be caught by a codebase audit, or by manual QA of the primary flows? → A: Require an explicit audit — grep the codebase for legacy `ion-radio`/`ion-range` prop usage and fix every hit as part of the Ionic 9 task, before relying on manual UI passes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Low-risk dependencies move to latest with no behavior change (Priority: P1)

The maintainer bumps every dependency and tool that has no known breaking change
between its current and target version (Go point release, `golang.org/x/*` modules,
`pgx`, `golang-jwt`, GitHub Actions versions, Playwright, small client libraries,
the Alpine patch release) and the existing quality gates pass unchanged.

**Why this priority**: This is the bulk of the outdated surface and carries the
least risk; landing it first shrinks the diff for everything riskier that follows
and immediately closes the widest gap to "latest supported."

**Independent Test**: Can be fully tested by running the existing CI gates
(`npm run build`, `go build ./... && go vet ./... && go test ./...`) with no test
changes required — a pass with zero behavior change is the acceptance bar.

**Acceptance Scenarios**:

1. **Given** the Phase A dependency set, **When** each is bumped to its target
   version, **Then** `npm run build` and the server build/vet/test gates pass with
   no code changes beyond version manifests and lockfiles.
2. **Given** `gorilla/websocket` and `webpush-go`, **When** checked against upstream,
   **Then** the spec records that they are already at latest (no bump needed) rather
   than silently skipping them.

---

### User Story 2 - Moderate-risk tooling majors land with existing tests as the safety net (Priority: P2)

The maintainer bumps `vue-tsc`, `vitest`/`@vitest/coverage-v8`, `vue` (within its
3.5 line), and the Node.js runtime (CI + Docker image) to their targets, relying on
the existing typecheck, unit, and coverage-floor gates to catch regressions.

**Why this priority**: These are major-version bumps in the tooling that builds and
tests the app, not in the app's own runtime behavior, so the existing gates are a
reliable signal — but a version mismatch here (e.g. a `vue-tsc`/`typescript` peer
conflict) can break the build outright, so it's riskier than Phase A.

**Independent Test**: Can be fully tested by running `npm run build` (typecheck +
build), `npm run test:unit` with coverage floors enforced, and confirming the CI
Node version and the Docker image's Node version both reflect the new target.

**Acceptance Scenarios**:

1. **Given** the Phase B toolchain bump, **When** `npm run build` runs, **Then** the
   typecheck passes with no new errors introduced by the `vue-tsc`/`typescript`
   version pairing.
2. **Given** the coverage floors, **When** the Phase B test suite runs, **Then** no
   existing floor regresses.
3. **Given** the Node version target, **When** CI and the Docker image are inspected,
   **Then** both pin the same new Node major, and `@types/node` matches it.

---

### User Story 3 - High-risk, coordinated bumps land with an explicit verification plan beyond automated tests (Priority: P3)

The maintainer bumps `@ionic/vue`+`@ionic/vue-router` together with `vue-router`
(major, coordinated), `vite` (staged through an intermediate major), the crypto
core (`libsodium-wrappers-sumo`), and the calling-critical Pion/TURN dependency
group — each gated on a verification step beyond `go test`/`npm run build`, matching
the risk it carries.

**Why this priority**: These changes can break the app in ways automated tests won't
catch on their own — Ionic's UI surface is pervasive (Principle XI), the crypto core
is the zero-knowledge boundary itself (Principle IV), and TURN-over-TLS behavior is a
real-network, real-device concern (the Calls/TLS domain constraint) — so each gets
its own PR and its own explicit sign-off, not just a green CI run.

**Independent Test**: Each item in this group is independently testable and
independently mergeable:
- Ionic 9 + Vue Router 5: `npm run build`, `npm run test:e2e`, and a manual pass
  through the primary UI flows (chats, calls, contacts, settings tabs).
- Vite major bump: full client build + e2e green, with the `vite-plugin-pwa`
  Babel-version conflict explicitly checked before advancing past the intermediate
  Vite major.
- `libsodium-wrappers-sumo`: the full crypto regression suite (forgery, replay,
  out-of-order, skipped-key) green, plus a security review sign-off, before merge.
- Pion/TURN group: `go test ./...` green, plus a manual real-device WebRTC call
  (per `server/docs/CALLING.md`) verifying TURN-over-TLS relay and direct P2P paths
  both still work, before merge.

**Acceptance Scenarios**:

1. **Given** the Ionic + Vue Router bump, **When** `npx @ionic/migrate` is run and
   its checklist addressed, **Then** the app builds, e2e passes, and a manual pass
   through each bottom-tab root shows no visual/functional regression.
2. **Given** the `libsodium-wrappers-sumo` bump, **When** the crypto regression
   suite runs, **Then** forgery, replay, out-of-order, and skipped-key cases all
   still pass, and existing encrypted local data / active sessions remain readable
   (no wire-format or key-derivation change).
3. **Given** the Pion/TURN group bump, **When** a real-device call is placed under
   both a direct-P2P-eligible network and a relay-required network, **Then** the
   call connects and audio/video flow in both cases.

### Edge Cases

- What happens if `vite-plugin-pwa`'s Babel-7 dependency is still incompatible with
  Vite 8's Babel-8 requirement at implementation time? → Land on Vite 7.3.x and hold
  the final hop to Vite 8 as a follow-up once the conflict clears; this spec's Phase
  C task for Vite must not force Vite 8 if that conflict is still open.
- What happens if the `golang.org/x/crypto` ACME/autocert retry-exhaustion bug (fixed
  locally via `patches/x-crypto`) turns out to still be unfixed upstream at the newer
  base version? → Rebase the existing local patch onto the new base version rather
  than dropping it; do not regress the fix that shipped in PR #1154/#1155.
- What happens if `libsodium-wrappers-sumo` 0.8.x changes the underlying libsodium
  build in a way that alters ciphertext for existing sessions? → This bump MUST NOT
  ship if any existing encrypted data (device secrets, sessions, sender-key state)
  becomes unreadable; treat that as a blocking defect, not an acceptable migration.
- What happens if a Phase C item's manual/real-device verification step fails? → That
  item's PR does not merge; it is fixed or reverted, and does not block the other
  Phase C items, which merge independently once their own verification passes.
- What happens if a `libsodium-wrappers-sumo` ciphertext-compatibility break is only
  discovered after that PR has already merged and released? → Per FR-005b, revert
  same-day rather than forward-patch; every additional day compounds the number of
  devices that have already pulled the breaking update.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client `package.json` and its lockfile MUST reflect the target
  version matrix (see Assumptions) for all listed dependencies, at the risk-tier
  granularity described (Phase A/B/C), with each phase in its own PR.
- **FR-002**: The server `go.mod`/lockfile, `Dockerfile` base images, `docker-compose*`
  images, and `.github/workflows/*.yml` tool/action versions MUST reflect the target
  version matrix for all listed items, staged the same way.
- **FR-003**: Any dependency already at its latest supported version (e.g.
  `gorilla/websocket`, `webpush-go`, PostgreSQL 18) MUST be explicitly verified and
  recorded as such, not silently left unexamined.
- **FR-004**: The `golang.org/x/crypto` local patch (`patches/x-crypto`) MUST be
  rebased onto the new target base version, and the underlying ACME/autocert
  retry-exhaustion bug MUST be re-verified as still present upstream (or the patch
  dropped if upstream has fixed it) before the server dependency bump merges.
  Submitting the fix upstream (e.g. a CL to `go-review.googlesource.com`) is an
  optional stretch goal, not a merge requirement for this spec.
- **FR-005**: The `libsodium-wrappers-sumo` bump MUST NOT change the ciphertext
  schema, key-derivation inputs/outputs, or decrypt-compatibility for anything
  already encrypted — covering both message/session ciphertext (1:1 X3DH/Double
  Ratchet **and** group sender-key sessions) and PIN-wrapped secrets-at-rest
  (device keys, per Principle IV's Argon2id-AEAD requirement). "Wire format" means
  the ciphertext remains decryptable under the existing protocol/schema —
  byte-for-byte identical output is not the bar, since ciphertext is randomized per
  encryption regardless of library version. This MUST be verified by BOTH the full
  crypto regression suite AND the real-device data-readability check (FR-005c);
  neither alone is sufficient to merge. Verification MUST use the same minimum bar
  Constitution Principle IV names for any crypto change — forgery, replay,
  out-of-order delivery, and skipped-key cases — with no reduced bar because this
  is a version bump rather than new code, run against both the 1:1 ratchet suite
  (`src/services/crypto/ratchet.test.ts`, `ratchet.staged.test.ts`) and the group
  sender-key suite (`src/services/crypto/senderkeys.test.ts`). The sender-key suite
  currently has no explicit replay-of-an-already-processed-frame case (unlike the
  1:1 suite's "replaying an already-committed frame fails to open"); this task MUST
  add one rather than treat the 1:1 coverage as standing in for it.
- **FR-005a**: The security review required by FR-005 MUST be performed against
  this spec's crypto checklist (`checklists/crypto-zk.md`) and MUST explicitly
  confirm: no primitive substitution, no unintended key-derivation parameter
  change, and both FR-005 verification steps passed. An intentional
  security-hardening parameter change (e.g. a raised Argon2id cost) is permitted
  only if applied prospectively to newly-wrapped secrets without breaking
  decryption of already-wrapped ones; a change that would break existing
  decryption is blocked by FR-005 regardless of its motivation.
- **FR-005b**: If a ciphertext-compatibility break is discovered only after this
  bump has merged and released, the response MUST be a same-day revert PR (the
  existing hotfix-band pattern) rather than a forward patch, since every additional
  day compounds the number of devices that have already pulled the breaking
  update.
- **FR-005c**: The real-device data-readability check MUST include, at minimum,
  one 1:1 chat, one group chat, one media message, and the device's own
  PIN-wrapped secrets unlocking with the existing PIN — not merely a successful
  app launch.
- **FR-006**: The Pion/TURN dependency group bump MUST be verified by a manual
  real-device WebRTC call covering both direct-P2P and relay-required network paths
  (per `server/docs/CALLING.md`) before merge, in addition to `go test ./...`.
- **FR-007**: The Ionic 9 + Vue Router 5 bump MUST run `npx @ionic/migrate` (or its
  documented breaking-change checklist) and address every flagged item before merge.
  This MUST include an explicit codebase audit for the legacy `ion-radio`/`ion-range`
  prop syntax Ionic 9 removes, with every hit fixed — not just a manual UI pass over
  the primary flows.
- **FR-008**: TypeScript MUST stay on its latest 5.9.x release in this spec; the
  upgrade to TypeScript 7 is explicitly out of scope (see Out of Scope) because
  `vue-tsc`/Vue Language Tools do not yet support it.
- **FR-009**: The Node.js runtime target (CI `actions/setup-node` and the Dockerfile's
  `node` base image) MUST move to Node 24, with `@types/node` aligned to match.
- **FR-010**: Every phase MUST pass `npm run build`, `go build ./... && go vet ./...
  && go test ./...` before its PR merges; Phase B additionally requires
  `npm run test:unit` coverage floors to hold, and any client-build-tooling or
  Ionic/Vue-Router-affecting phase additionally requires `npm run test:e2e` to pass.

## Zero-Knowledge Impact *(mandatory — Constitution Principle I)*

This is a dependency/toolchain uplift, not a feature: it MUST NOT change what
crosses the wire or what the server can observe. Every Phase A and Phase B item
(Go/x-modules, pgx, golang-jwt, GitHub Actions, Playwright, small client libs,
Alpine, vue-tsc, vitest, vue, TypeScript, Node.js) was individually reviewed, not
just excluded by assumption: none of them touch client/server message, media, or
profile plaintext, the `SECRETS_KEY` encryption-at-rest scheme, or any API
contract — they are build tooling, test tooling, or runtime version changes with
no code path that reads or writes application data. Phase C's Ionic/Vue-Router
and Vite items are client build/UI tooling with the same property. The two Phase C
items with a real zero-knowledge-adjacent surface are named, not asserted away:
the `libsodium-wrappers-sumo` bump, which touches the crypto core directly (FR-005
requires proving it doesn't alter wire format, key derivation, or ciphertext
compatibility before it's considered safe to ship), and the Pion/TURN group, which
touches call-signaling/media relay infrastructure but not message content (FR-006
requires a real-device call to confirm relay/direct-P2P paths still work — no new
metadata is exposed to the TURN relay beyond what it already handles today).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the dependencies, tools, and base images named in the target
  version matrix are either at their target version or explicitly recorded as
  already-latest, by the time this spec's status reaches `shipped`.
- **SC-002**: Zero regressions in existing automated test suites (`npm run
  test:unit`, `go test ./...`, `npm run test:e2e`) attributable to any phase of this
  uplift.
- **SC-003**: The crypto regression suite and a security review — against the
  criteria in FR-005a — both pass before the `libsodium-wrappers-sumo` bump
  merges, with zero loss of access on a real device to the specific data set
  named in FR-005c (a 1:1 chat, a group chat, a media message, and the device's
  own PIN-wrapped secrets), checked against that device's pre-bump state.
- **SC-004**: A real-device call succeeds over both a direct-P2P-eligible network and
  a relay-required (TURN-over-TLS) network after the Pion/TURN group bump, before
  that PR merges.
- **SC-005**: Each of the three phases lands as an independently mergeable PR (or
  small set of PRs) rather than one combined change, so a regression in one phase
  never blocks or gets bundled with another.

## Out of Scope

- **TypeScript 7**: not supported by `vue-tsc`/Vue Language Tools as of this spec
  (needs the TS6-compatible API that TS7 dropped; ecosystem fix expected around
  TS 7.1, ~October 2026). Revisit in a future spec once that support lands.
- **Node.js 26**: not yet Active LTS at spec time (enters LTS October 2026); Node 24
  is the practical "latest supported" target today. Revisit once 26 is LTS.
- **Vue 3.6**: still a release candidate, not stable, at spec time. Stay on the 3.5
  line's latest patch.
- **PostgreSQL 19**: still in beta at spec time; PostgreSQL 18 remains the latest
  stable major.

## Assumptions

- The target version matrix researched for this spec (client: vue, @ionic/vue,
  @ionic/vue-router, vue-router, ionicons, vite, @vitejs/plugin-vue, vite-plugin-pwa,
  typescript, vue-tsc, vitest, @vitest/coverage-v8, @playwright/test,
  libsodium-wrappers-sumo, @types/libsodium-wrappers-sumo, @types/node, Node.js, and
  the smaller client libraries; server: Go, pgx/v5, gorilla/websocket, webpush-go,
  golang-jwt/jwt/v5, golang.org/x/crypto/net/sync/sys/text, the pion/turn ecosystem,
  PostgreSQL, Alpine, and GitHub Actions versions) reflects what was current as of
  2026-09-28 and MUST be re-checked for newer patch releases at implementation time
  for each phase, since some time will elapse between specify and implement.
- "Latest supported" means the latest version whose immediate dependents in this
  project's stack (e.g. `vue-tsc` for TypeScript, `vite-plugin-pwa` for Vite) are
  themselves compatible with it — not simply the newest tag published upstream.
- Existing CI workflows, the in-memory fake store for server tests, and the
  Playwright e2e harness continue to be the test surfaces used to verify each phase;
  no new test framework or harness is introduced by this spec.
- Real-device call verification (Pion/TURN group) and the crypto security review
  (libsodium bump) are manual steps performed by the maintainer outside of CI, and
  their completion is a merge precondition for those specific PRs only.
- The app updates atomically per device (a single PWA bundle version at a time via
  the existing prompt-and-accept update flow) — there is no partial/mixed-version
  window across a user's devices to design for; a device is either on the old
  `libsodium-wrappers-sumo` or the new one, never observably both.
- `@types/libsodium-wrappers-sumo`'s published types are assumed accurate for
  0.8.x; if the underlying package's API shape changed in a way the types don't
  reflect, that would surface as a build/typecheck failure (`npm run build`) rather
  than a silent runtime gap, so no separate verification step is needed beyond the
  existing gate.
- The native libsodium library version bundled by `libsodium-wrappers-sumo` itself
  (not just the JS wrapper's own version number) may differ between 0.7.16 and
  0.8.4; T026/T027 (tasks.md) MUST check this delta and note it, since it's the
  more direct source of any real cryptographic behavior change than the wrapper
  version alone. **Checked 2026-09-28**: native libsodium moves 1.0.20 → 1.0.22.
  A standalone cross-version test (AEAD with both a raw key and an Argon2id-derived
  key, X25519 scalarmult, Ed25519 sign/verify) passed on all cases — see
  research.md. This is corroborating evidence, not a substitute for FR-005's full
  gate (regression suite + real-device check + security review).
- No build-time or CI-run-time performance budget gates any phase's merge; a change
  in build or test-run duration from the Vite or vitest major bumps is acceptable as
  long as the existing functional test suites stay green (see Clarifications).
