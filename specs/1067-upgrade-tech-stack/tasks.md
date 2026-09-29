---

description: "Task list for spec 1067: Tech Stack Uplift"
---

# Tasks: Tech Stack Uplift

**Input**: Design documents from `/specs/1067-upgrade-tech-stack/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: No new tests are requested by the spec. Every gate below runs the
project's *existing* test suites (`npm run build`, `npm run test:unit`,
`go test ./...`, `npm run test:e2e`) plus, for Phase C, two manual verification
steps (crypto regression suite + security review; real-device calls) that the
spec requires as merge preconditions rather than new automated tests.

**Organization**: Tasks are grouped by the spec's three user stories, which are
risk tiers, not features: **US1 = Phase A** (safe bumps), **US2 = Phase B**
(moderate tooling bumps), **US3 = Phase C** (coordinated/high-risk bumps, four
independent tracks). Unlike a typical feature spec, these stories are
*sequential by design* (US1 → US2 → US3) per the plan's Implementation
Sequencing — each phase's PR must merge before the next begins, since B relies
on A's Node/tooling baseline and C's Ionic/Vite work is easiest to reason about
once B's `vue-tsc`/`vitest` baseline is settled.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3
- File paths are exact and relative to the repository root

## Phase 1: Setup

**Purpose**: Establish a clean, known-good baseline before touching any
dependency.

- [ ] T001 Confirm `feat/1067-upgrade-tech-stack` is up to date with `main`, then run and record a passing baseline: `npm run build` and `cd server && go build ./... && go vet ./... && go test ./...`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Re-verify the target-version matrix is still current. Research
for this spec was done on 2026-09-28; if implementation starts materially
later, a target version in `research.md` may itself have moved.

**⚠️ CRITICAL**: This blocks all three phases below — each phase's tasks bump
to whatever `research.md` says, so a stale target there propagates into every
phase.

- [ ] T002 Re-check `npm outdated` and `go list -m -u all` (or equivalent) against every item in `specs/1067-upgrade-tech-stack/research.md`; update `research.md` in place if any target has moved to a newer patch/minor since 2026-09-28 (do not silently re-target a major without re-running the same risk analysis)

**Checkpoint**: Target matrix confirmed current — Phase A (US1) can begin.

---

## Phase 3: User Story 1 — Safe bumps land with zero behavior change (Priority: P1) 🎯 MVP

**Goal**: Every dependency/tool with no known breaking change between current
and target version is bumped, and the existing quality gates pass unchanged.

**Independent Test**: `npm run build` and `go build ./... && go vet ./... &&
go test ./...` pass with no code changes beyond version manifests and
lockfiles.

### Implementation for User Story 1

- [ ] T003 [P] [US1] In `server/go.mod`/`server/go.sum`: bump the `go` directive to 1.27, then `go get -u golang.org/x/net golang.org/x/sync golang.org/x/sys golang.org/x/text github.com/jackc/pgx/v5 github.com/golang-jwt/jwt/v5` and `go mod tidy`
- [ ] T004 [P] [US1] Verify `github.com/gorilla/websocket`, `github.com/SherClockHolmes/webpush-go`, and the `postgres:18` image tag in `docker-compose.yml`/`server/docker-compose.yml` are already at their latest supported version (no change expected for any of the three); note this explicitly in the PR description per FR-003
- [ ] T005 [P] [US1] In `Dockerfile`: bump the server build stage from `golang:1.26-bookworm` to `golang:1.27-bookworm`, and the runtime stage's `alpine` tag to its latest 3.24.x patch
- [ ] T006 [P] [US1] Across `.github/workflows/*.yml`: bump `actions/checkout`, `actions/setup-node`, `actions/setup-go` to v7; re-check and bump `actions/cache`, `actions/upload-artifact`, `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`, `dorny/paths-filter`, `dataaxiom/ghcr-cleanup-action` to their current latest majors
- [ ] T007 [P] [US1] In `package.json`: bump `@playwright/test` to latest 1.63.x, `@zxing/browser`, and `sharp` to latest via `npm outdated`, then `npm install` to refresh `package-lock.json`. `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `emoji-picker-element`, `flubber`, `heic2any`, `lottie-web`, `mp4-muxer`, `qrcode`, `fake-indexeddb` were checked and are already at latest — no action. **`mp4box` excluded**: `npm outdated` revealed a 0.5.4 → 2.4.1 multi-major jump (not the patch bump originally assumed), with a v1.0.0 breaking change (`discardMdatData` defaults to `true`, discarding parsed media bytes) that directly risks the video-post streaming demux (spec 2041). Needs its own dedicated migration task, not a Phase A bump — see research.md.
- [ ] T008 [US1] Run the Phase A verification gate: `npm run build`; `cd server && go build ./... && go vet ./... && go test ./...` (depends on T003, T005, T006, T007)
- [ ] T009 [US1] Bump `package.json` `version` (patch) and open the Phase A PR (depends on T008)

**Checkpoint**: Phase A merged — the widest gap to "latest supported" is closed with zero behavioral change. US2 (Phase B) can begin.

---

## Phase 4: User Story 2 — Moderate tooling majors land on existing test gates (Priority: P2)

**Goal**: `vue-tsc`, `vitest`/`@vitest/coverage-v8`, `vue`, and the Node.js
runtime move to their targets, using the existing typecheck/unit/coverage-floor
gates as the safety net.

**Independent Test**: `npm run build` (typecheck + build) and `npm run
test:unit` (coverage floors enforced) both pass; CI and the Docker image agree
on the same Node major.

**Depends on**: Phase 3 (US1) merged.

### Implementation for User Story 2

- [ ] T010 [US2] In `package.json`: bump `vue-tsc` to latest 3.3.x, `vitest` and `@vitest/coverage-v8` to latest 5.0.x, `vue` to latest 3.5.x (3.5.40), `typescript` to its latest 5.9.x patch per FR-008 (check `npm outdated typescript` — do NOT bump to 7), and `@types/node` to `^24.x`; run `npm install` to refresh `package-lock.json`
- [ ] T011 [P] [US2] Move the Node target from 22 to 24: `node-version` in `.github/workflows/*.yml`, and `node:22-bookworm-slim` → `node:24-bookworm-slim` in `Dockerfile`
- [ ] T012 [US2] Run the Phase B verification gate: `npm run build`; `npm run test:unit` and confirm no existing coverage floor regresses (depends on T010, T011)
- [ ] T013 [US2] Bump `package.json` `version` (patch) and open the Phase B PR (depends on T012)

**Checkpoint**: Phase B merged — tooling majors landed, coverage floors intact, Node 24 pinned everywhere. US3 (Phase C) can begin.

---

## Phase 5: User Story 3 — Coordinated, high-risk bumps ship with explicit verification (Priority: P3)

**Goal**: Ionic 9 + Vue Router 5, the Vite major, `libsodium-wrappers-sumo`,
and the Pion/TURN ecosystem group each land with a verification step beyond
`go test`/`npm run build`, each as its own independently-mergeable PR.

**Independent Test**: see each track below — each is independently testable
and independently mergeable (SC-005); a failure in one track does not block
the others (spec Edge Cases).

**Depends on**: Phase 4 (US2) merged. **Correction found during implementation**:
Track C2 (Vite) MUST land before Track C1 (Ionic + Vue Router) — `vue-router@5.3.1`
carries an optional peer on `vite@"^7.3.0 || ^8.0.0"`, so installing Ionic 9 +
Vue Router 5 while still on Vite 6 fails with an ERESOLVE conflict. Tracks C3
(libsodium) and C4 (Pion/TURN) remain independent of both and of each other.

### Track C1 — Ionic 9 + Vue Router 5

- [ ] T014 [US3] In `package.json`: bump `@ionic/vue` and `@ionic/vue-router` to latest 9.0.x and `vue-router` to latest 5.3.x; run `npm install`
- [ ] T015 [US3] Run `npx @ionic/migrate` and address every item it flags (depends on T014)
- [x] T016 [US3] Audit the codebase against Ionic's actual `BREAKING.md` for v9 per FR-007 (the original ion-radio/ion-range premise was wrong — corrected in research.md) — run the grep commands in `quickstart.md` and fix every hit in `src/**/*.vue` (depends on T014). **Done**: found and fixed a real `autocorrect` boolean-coercion regression on `ion-input` (10 occurrences across 5 files: `PollComposer.vue`, `NotificationBanners.vue`, `ChatDetailPage.vue`, `AuthPage.vue`, `AddByIdPage.vue`), converted to explicit `:autocorrect="true|false"` bindings. Everything else (ion-picker-legacy, ion-nav, swipeBackEnabled, ion-select, floating labels, custom DOM-class CSS, Vue Router 5's `next()` deprecation) checked clean.
- [ ] T017 [P] [US3] Bump `ionicons` in `package.json` to the version Ionic 9 declares as its icon-set peer (depends on T014)
- [ ] T018 [US3] Run `npm run build` and `npm run test:e2e` for the Ionic/Router bump (depends on T015, T016, T017)
- [x] T019 [US3] Manually click through the Chats, Calls, Contacts, and Settings tabs plus every screen touched by the T016 audit, checking for visual/functional regressions (depends on T018). **Done via `claude-in-chrome`** (the `drive/` Playwright harness couldn't run locally — `@playwright/test` 1.63 dropped macOS 12 support, this machine's OS; CI on Ubuntu is unaffected). Full real registration flow, all 5 tab roots (Chats/Calls/Wall/Contacts/Settings — there are 5, not 4), the `appearance-theme` `ion-radio-group` (rendered, selected, and live-switched correctly), `ion-input` typing (username field), and `emoji-picker-element` all confirmed clean with zero console errors. A `drive/scenarios/ionic9-verify-1067.mjs` scenario is committed for CI/another machine to run the fuller multi-account version.
- [ ] T020 [US3] Bump `package.json` `version` (patch) and open the Ionic + Vue Router PR (depends on T019)

### Track C2 — Vite major

- [ ] T021 [US3] In `package.json`: bump `vite` to 7.3.x and `@vitejs/plugin-vue` to the matching major; run `npm install`
- [ ] T022 [US3] Run `npm ls vite vite-plugin-pwa @vitejs/plugin-vue` and check whether `vite-plugin-pwa`'s Babel-7 dependency still conflicts with a Vite 8 peer range (depends on T021)
- [ ] T023 [US3] If T022 finds no conflict, bump `vite` to 8.3.x instead; if a conflict remains, stay on 7.3.x per the spec's Edge Cases (depends on T022)
- [ ] T024 [US3] Run `npm run build` and `npm run test:e2e` for the Vite bump (depends on T023)
- [ ] T025 [US3] Bump `package.json` `version` (patch) and open the Vite PR (depends on T024)

### Track C3 — `libsodium-wrappers-sumo` (crypto core)

- [ ] T026 [US3] In `package.json`: bump `libsodium-wrappers-sumo` to 0.8.4 and `@types/libsodium-wrappers-sumo` to match; run `npm install`; check and note the underlying native libsodium version bundled by 0.7.16 vs. 0.8.4 (not just the JS wrapper version) per FR-005/Assumptions
- [ ] T027 [US3] Re-verify the `libsodium-wrappers-sumo` CJS aliasing workaround in `vite.config.ts` still resolves correctly against the new package's build output (depends on T026)
- [ ] T027a [US3] Add an explicit replay-of-an-already-processed-frame test to `src/services/crypto/senderkeys.test.ts` (the group sender-key suite currently has no equivalent to the 1:1 suite's "replaying an already-committed frame fails to open" case) (depends on T026)
- [ ] T028 [US3] Run the full crypto regression suite — forgery, replay, out-of-order, skipped-key cases — across BOTH `src/services/crypto/ratchet.test.ts`/`ratchet.staged.test.ts` (1:1) and `src/services/crypto/senderkeys.test.ts` (group, including T027a's new case) and confirm every case passes (depends on T027, T027a)
- [ ] T029 [US3] On a real device with existing local data, confirm per FR-005c: the app unlocks with the existing PIN (secrets-at-rest), and at minimum one 1:1 chat, one group chat, and one media message remain readable against that device's pre-bump state — no wire-format or key-derivation change (depends on T028)
- [ ] T030 [US3] Obtain the security review sign-off required by FR-005a: performed against `checklists/crypto-zk.md`, explicitly confirming no primitive substitution, no unintended key-derivation parameter change, and both T028/T029 passed (depends on T029)
- [ ] T031 [US3] Bump `package.json` `version` (patch) and open the `libsodium-wrappers-sumo` PR (depends on T030)

### Track C4 — Pion/TURN ecosystem (calling-critical)

- [ ] T032 [P] [US3] In `server/go.mod`/`server/go.sum`: bump `github.com/pion/turn/v4` to the v5 line (pulling `pion/transport` v5, `pion/stun` v4); run `go mod tidy`
- [ ] T033 [P] [US3] Rebase `patches/x-crypto` onto the new `golang.org/x/crypto` base version (0.57.0+); re-verify the ACME/autocert retry-exhaustion bug (PR #1154/#1155) is still present upstream before keeping the patch — drop it only if upstream has independently fixed it
- [ ] T034 [US3] Run `cd server && go build ./... && go vet ./... && go test ./...` for the combined Pion/TURN + `x/crypto` rebase (depends on T032, T033)
- [ ] T035 [US3] Per `server/docs/CALLING.md`, place a real-device WebRTC call over a direct-P2P-eligible network and confirm audio/video connects (depends on T034)
- [ ] T036 [US3] Per `server/docs/CALLING.md`, place a real-device WebRTC call over a relay-required (TURN-over-TLS) network and confirm audio/video connects (depends on T034)
- [ ] T037 [US3] (Optional stretch, not a merge requirement — see Clarifications) If the bug in T033 is still confirmed present upstream, submit the fix as a CL to `go-review.googlesource.com` (depends on T033)
- [ ] T038 [US3] Bump `package.json` `version` (patch) and open the Pion/TURN + `x/crypto` PR (depends on T035, T036)

**Checkpoint**: All four Phase C tracks merged independently — the tech stack uplift is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Close out the spec once every phase has merged.

- [ ] T039 [P] Run `make roadmap` and flip spec 1067's `Status` line to `shipped` once Phases A–C are all merged
- [ ] T040 Run the full `quickstart.md` validation end-to-end as a final sanity pass across everything bumped

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all three user stories (a stale target matrix would misdirect every phase).
- **US1 / Phase A (Phase 3)**: Depends on Foundational.
- **US2 / Phase B (Phase 4)**: Depends on US1 merged (Node/tooling baseline).
- **US3 / Phase C (Phase 5)**: Depends on US2 merged; **C2 (Vite) must land before C1 (Ionic + Vue Router)** — see the correction note above. C3 (libsodium) and C4 (Pion/TURN) are independent of both and of each other.
- **Polish (Phase 6)**: Depends on all of US1–US3 merged.

### Within Each User Story

- US1: T003/T004/T005/T006/T007 touch disjoint files and can proceed in parallel; T008 (gate) waits on all of them; T009 (PR) waits on T008.
- US2: T010 and T011 touch disjoint files (package.json vs. CI/Dockerfile) and can proceed in parallel; T012 (gate) waits on both; T013 (PR) waits on T012.
- US3: C2 (Vite) before C1 (Ionic + Vue Router); C3 (libsodium) and C4 (Pion/TURN) are independent of both. Within each track, tasks are sequential except where marked [P] (T017 alongside T014's dependents; T032/T033 alongside each other).

### Parallel Opportunities

- Phase 3 (US1): T003, T004, T005, T006, T007 (5-way parallel — five disjoint files/verifications).
- Phase 4 (US2): T010 and T011 (2-way parallel).
- Phase 5 (US3): all of C1, C2, C3, C4 can be worked in parallel by different people/sessions once US2 has merged; within C4, T032 and T033 are parallel.
- Phase 6: T039 and T040 are independent.

---

## Parallel Example: Phase 3 (US1)

```bash
# Five disjoint-file tasks, safe to run together:
Task: "Bump Go directive + x/*, pgx, golang-jwt in server/go.mod"
Task: "Verify gorilla/websocket, webpush-go, and postgres:18 are already latest"
Task: "Bump golang/alpine base image tags in Dockerfile"
Task: "Bump GitHub Actions versions across .github/workflows/*.yml"
Task: "Bump @playwright/test and small client libs in package.json"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (re-verify the target matrix).
3. Complete Phase 3: US1 (Phase A). Merge.
4. **STOP and VALIDATE**: confirm the Phase A PR's gate ran clean with zero behavioral diff.

### Incremental Delivery

1. Setup + Foundational → confirmed baseline and current target matrix.
2. US1 (Phase A) → merge → widest version gap closed, zero risk taken.
3. US2 (Phase B) → merge → tooling majors landed, coverage floors intact.
4. US3 (Phase C), track by track → each of Ionic+Router, Vite, libsodium, Pion/TURN merges independently once its own verification passes.
5. Polish → roadmap flipped to `shipped`.

### Notes

- [P] tasks touch different files with no dependency on an incomplete task.
- Every Phase C track ends its own `package.json` version bump + PR — per the
  repository's release-guard rule, every PR into `main` must carry a version
  bump, and each track is its own PR (SC-005).
- Commit after each task or logical group; stop at any checkpoint to validate
  a phase independently before starting the next.
- Avoid: bundling two Phase C tracks into one PR (defeats SC-005's isolation
  goal), and skipping T002 (re-verifying the target matrix) if implementation
  starts long after 2026-09-28.
