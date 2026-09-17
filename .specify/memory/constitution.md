<!--
Sync Impact Report
- Version: 1.3.0 → 1.4.0 (MINOR: Development Workflow gained four delivery rules;
  no principle changed)
- Added: "Time to production is a constraint, not an afterthought"; "Green merges
  itself" (auto-merge on green, hold work back with a draft, not by withholding a
  click); "Every tree that reaches production is covered by a full suite run —
  exactly once" (never publish an unproven tree, never re-run a proven one); "Fail
  fast before you fail slow".
- Rationale: the pipeline was running the full ~33-minute suite twice for one
  change — once on the PR, once on a merge commit with a byte-identical tree —
  and then waited on a human to merge. Both cost time to production and bought no
  confidence. Coverage is unchanged and is now stated in terms of the bytes shipped.
- Templates / docs updated for sync: CLAUDE.md, CONTRIBUTING.md, README.md,
  .github/workflows/release.yml (preflight + proven-tree fast path),
  .github/workflows/auto-merge-release.yml (green PRs merge themselves),
  .github/workflows/ci.yml, scripts/setup-branch-protection.sh.
-
- PREVIOUS REPORT (v1.2.2 → 1.3.0)
- Version: 1.2.2 → 1.3.0 (MINOR: Development Workflow replaced GitFlow with a
  trunk-based, main-only model; no principle changed)
- Modified: "Development Workflow" — `develop` retired. `main` is now the only
  long-lived branch: feature branches PR straight into it, every merge ships a
  release, and every PR must therefore carry a version bump. Production bugs are
  fixed in the next release; release candidates off the feature branch are the
  pre-production validation path. Principle VIII's issue-closing rule retargeted
  from `develop` to `main` (the default branch moved with it).
- Templates / docs updated for sync: CLAUDE.md, CONTRIBUTING.md, README.md,
  docs/UPGRADING.md, .github/workflows/*, .github/PULL_REQUEST_TEMPLATE.md
  (release.md template folded in — every PR is a release PR now),
  scripts/setup-branch-protection.sh, scripts/hooks/pre-push.
-
- PREVIOUS REPORT (v1.1.0 → 1.2.0)
- Version: 1.1.0 → 1.2.0 (MINOR: Principle VII expanded with a new normative rule)
- Added: Principle VII now mandates that user-facing commit subjects (feat/fix/perf/
  security) be plain-language, benefit-focused, reference-free release-note copy, since
  they are shown verbatim to end users as the "What's new" line.
- Modified: Principle VII — added the release-note-copy rule; corrected the update-flow
  wording from "toast-and-accept" to "prompt-and-accept" (the prompt now renders through
  the shared in-app notification surface, not a separate toast). No other principle changed.
- Removed: none.
- Templates / docs reviewed for sync:
  - .specify/templates/plan-template.md — ✅ no change needed (Constitution Check is
    derived generically from this file).
  - .specify/templates/spec-template.md — ✅ no change needed (no new mandatory section).
  - .specify/templates/tasks-template.md — ✅ no change needed.
  - CLAUDE.md — ✅ updated: "Commit messages" now carries matching release-note-subject
    guidance with a good/bad example (spec 2004).
- Prior amendment (1.1.0): Added Principle XI — Ionic-First UI (stock Ionic components +
  existing theme tokens; custom only when no Ionic primitive exists, composed from Ionic).
- Deferred TODOs: none.
-->
# Ring Constitution

Ring is a private, end-to-end-encrypted messenger and calling app: an installable
PWA (Vue 3 + Ionic) backed by a small zero-knowledge Go server (`ringd`). This
constitution governs every spec, plan, task, and change made in this repository.
It supersedes habit and convenience. Where a principle says **MUST**, a violation
blocks merge unless it is explicitly justified in the spec's *Complexity &
Exceptions* section and accepted by a maintainer. Where it says **SHOULD**, a
deviation must be reasoned in the plan.

## Core Principles

### I. Zero-Knowledge Boundary (NON-NEGOTIABLE)

The server only ever relays sealed envelopes and stores opaque ciphertext. It MUST
NOT be able to read message bodies, media, contacts, profiles, group membership,
or any other user content. Metadata MUST be minimized to what relaying physically
requires.

- Every change that crosses the client/server boundary MUST encrypt on the client
  and send ciphertext; the server stores/relays blobs and capability-style ids only.
- No feature, log line, metric, error payload, debug aid, or migration may expose
  plaintext to the server or to server-side storage.
- Every spec MUST contain a **Zero-Knowledge Impact** section answering: what
  crosses the wire, what is encrypted, what metadata is unavoidably visible, and why.
- This principle is non-negotiable. A spec that cannot satisfy it is rejected, not
  excepted.

### II. Spec-Driven Development

No implementation without an approved spec, plan, and task list.

- All work is initiated by a numbered spec under `specs/` in its category band
  (planned `0001+`, ad-hoc `1001+`, hotfix/bug `2001+`). Code that lands without a
  spec id is a defect.
- The required pipeline for every work item, in order, is:
  **specify → clarify → plan → tasks → analyze → (fix the flagged artifact + re-run
  downstream) → taskstoissues → implement**.
- `/speckit-analyze` MUST be run and MUST be clean — or every finding explicitly
  waived in writing — before `/speckit-implement`.
- Every branch, commit, issue, and PR MUST be traceable to its spec id.

### III. Test-Driven Development

Tests come first wherever the work is testable.

- `tasks.md` MUST order failing tests before the implementation tasks that satisfy
  them (Red → Green → Refactor).
- New or changed crypto, auth, store, or HTTP-handler logic MUST ship unit tests.
  New or changed user-facing behavior MUST add or extend an e2e spec under `e2e/`.
- Coverage floors are a ratchet: they may rise, never regress. The pure crypto core
  (client) and `auth`/`config`/`secrets` (server) stay above their gated floors.
- A bug fix (`2001+`) MUST begin with a failing regression test that reproduces the
  bug before the fix lands.

### IV. Crypto Discipline

Cryptography is reused, pure, and adversarially tested — never improvised.

- Reuse the existing libsodium core (X3DH, Double Ratchet, sender keys). MUST NOT
  hand-roll primitives or invent new key-exchange / ratchet schemes.
- The crypto core stays a set of pure functions, testable without IndexedDB;
  stateful persistence stays in the service layer behind the `idb` wrapper.
  `messaging.ts` stays crypto-only (the `queries.ts → messaging.ts` dependency is
  one-directional; no cycle).
- At rest, every secret MUST be AEAD-wrapped under an Argon2id key derived from the
  user PIN; only public keys are stored in the clear.
- Crypto changes MUST include tests for forgery, replay, out-of-order delivery, and
  skipped-key cases, and MUST get a security review.

### V. Offline-First Data Integrity

IndexedDB is the source of truth on the device; upgrades never lose data.

- Writes go through `src/db/idb.ts` and its change-notification bus; the UI stays
  reactive via `useLiveQuery`.
- Adding or altering an object store MUST bump `DB_VERSION` and extend
  `onupgradeneeded` with a forward migration that preserves existing data.
- Own-data sync to the server is encrypted and last-write-wins on `updatedAt`.

### VI. Stateless Server & Forward-Only Migrations

The server holds no state outside Postgres, and the schema only moves forward.

- All persistent state — including secret material encrypted at rest under
  `SECRETS_KEY` — lives in Postgres. No volumes or mounts.
- `SECRETS_KEY` is stable and sacred; any spec that touches it MUST state the
  rotation/recovery impact (regeneration invalidates all device tokens + push subs).
- Schema changes are new numbered embedded SQL migrations, forward-only, applied on
  boot. MUST NOT edit a shipped migration; add the next `NNNN_name.sql`.
- Handlers stay stdlib `net/http`, depend on small interfaces defined at the call
  site, and are tested against the in-memory fake store (no DB in unit tests).

### VII. Quality Gates Are the Definition of Done

"Done" means the CI gates are green — nothing less.

- A change is not done until: `npm run build` (vue-tsc typecheck + vite build)
  passes; `go build ./... && go vet ./... && go test ./...` pass; vitest + its
  coverage floors pass; and e2e passes where behavior changed.
- Commits follow Conventional Commits with a scope describing user-facing behavior
  (`feat(call):`, `fix(media):`, `test(e2e):`, `ci:`, `docs:`).
- Release-note copy: for user-facing commit types (`feat`, `fix`, `perf`,
  `security`) the subject AFTER the `type(scope):` prefix is shown verbatim to end
  users as the "What's new" line, so it MUST read as plain-language, benefit-focused
  release-note copy — no internal jargon, no implementation shorthand, and no
  spec/issue/PR references (`(spec 1016)`, `(#248)`, `US2/US3`, `FR-014`). Write what
  the user gains ("Update reminders now arrive in the morning, not overnight"), not how
  it was built ("9 AM-local, behind-only version-announcement push (spec 1016)").
  Non-user-facing types (`chore`, `ci`, `build`, `docs`, `refactor`, `style`, `test`,
  `deps`) are exempt — they never reach "What's new".
- The PWA stays `registerType: 'prompt'`: a deploy MUST NOT silently reload; the
  prompt-and-accept update flow is preserved (the prompt itself renders through the
  shared in-app notification surface, not a separate toast).

### VIII. Traceable, Auto-Closing Delivery

Every unit of work is visible from roadmap to merge.

- `ROADMAP.md` is generated from spec metadata, never hand-edited, and kept current
  by CI. Its sections are Planned (`0001+`), Ad-hoc (`1001+`), and Hotfixes & Bug
  Fixes (`2001+`).
- Each task (or task group) becomes a GitHub issue with a descriptive title, a
  comprehensive body drawn from the spec/plan, and labels for category band, spec
  id, and area.
- The feature→`main` PR MUST list `Closes #N` for every issue it implements so
  they auto-close on merge (`main` is the default branch; closing keywords only
  fire on merges into the default branch).

### IX. Privacy & Data Minimization

Zero-knowledge is the floor, not the ceiling.

- Collect, transmit, and store the minimum required. No telemetry or analytics that
  reveal user identity, contacts, or behavior.
- AGPL-3.0-only obligations are honored: any networked modified server offers its
  corresponding source; license notices stay intact.

### X. Accessibility & Internationalization

The UI works for everyone, in every direction.

- Build on Ionic-native components and the declarative settings schema; a new
  settings screen is a data edit to `src/settings/schema.ts`, not a new component.
- Text rendering stays bidi-correct (RTL/LTR/mixed); new text surfaces MUST NOT
  regress direction handling. Reasonable a11y (labels, focus, contrast via the
  `--ring-*` tokens) is part of every UI spec.

### XI. Ionic-First UI

The interface is built from stock Ionic, not hand-rolled widgets.

- New UI MUST be composed from stock Ionic components, styled only with the
  project's existing theme tokens (the `--ring-*` CSS variables and the
  `ion-palette-dark` class). No ad-hoc per-component restyling and no hand-rolled
  widget that duplicates an Ionic primitive (e.g. don't build a custom list row,
  toggle, modal, or toast when `ion-item`, `ion-toggle`, `ion-modal`, `ion-toast`
  exist).
- A custom component is justified ONLY when no Ionic component covers the need;
  even then it MUST be composed from existing Ionic components with the minimum
  necessary customization, reusing the existing theme tokens rather than inventing
  new colours/spacings.
- Rationale: this keeps the UI consistent, accessible, theme-correct (light/dark +
  RTL), and upgrade-safe, and it is why a new settings screen is a data edit to
  `src/settings/schema.ts` (Principle X) rather than a bespoke component. Deviations
  are reasoned in the plan; a bespoke widget that an Ionic primitive could have
  provided is a defect.

## Domain Constraints

These are project-specific guardrails every relevant spec MUST respect.

- **Calls / TLS.** WebRTC media rides TURN-over-TLS on 443 and requires an L4/SNI
  *passthrough* proxy — never a TLS-terminating HTTP proxy. With `ACME=true`,
  `ringd` self-provisions and renews certs (autocert, TLS-ALPN-01), cached encrypted
  in Postgres. Read `server/docs/CALLING.md` before touching calling or deploy.
- **Single image.** Client and server ship as one container: `ringd` serves the
  built PWA at `/` and the API at `/v1`, `/healthz`, and `/v1/ws`. The WebSocket
  authenticates via `?token=` (browsers can't set WS headers).
- **Dev parity.** Local dev (`make start`) and the isolated e2e stack must keep
  working; the dev-only `window.__ringTest` hook stays stripped from production.

## Development Workflow

- **Trunk-based.** `main` is the ONLY long-lived branch: it is production and the
  GitHub default branch, and it is where work integrates. Short-lived feature
  branches merge straight into `main` via pull request. There is no `develop` and
  no release branch.
- **Every merge into `main` ships a release.** A bug discovered in production is
  therefore fixed the same way as any other change — a branch, a PR, the next
  release — never by patching a long-lived release branch. Work that needs
  real-device validation before production MUST go out as a release candidate
  (`vX.Y.Z-rc.N` tag off the feature branch) first; an RC never moves `:latest`.
- **Every PR into `main` MUST carry a `package.json` version bump.** Because the
  merge itself is the release, an un-bumped merge would ship nothing and announce
  nothing; the release guard blocks it. The bump is part of the change (patch by
  default; minor/major when the work warrants it), not a separate release step.
  This is a deliberate manual step — GitHub Actions cannot open a bump PR itself
  (org policy forbids Actions from creating pull requests).
- **Time to production is a constraint, not an afterthought.** Once a change is
  proven, nothing between it and users may be waiting for its own sake: not a human
  clicking merge, not a pipeline re-deriving an answer it already has. Latency that
  buys no confidence MUST be removed.
- **Green merges itself.** A PR whose required checks all pass is merged
  automatically, and merging releases. To hold work back, open it as a DRAFT or
  disable auto-merge on that PR — never by withholding a merge that CI has already
  cleared. Automation here removes waiting, never a gate: branch protection still
  holds every merge until the full suite, the roadmap guard and the release guard
  are green.
- **Every tree that reaches production is covered by a full suite run — exactly
  once.** Never zero: a tree nothing has tested MUST NOT be published, so when a
  merge combines work into a tree no run has seen (main moved under the PR), the
  suite runs before anything is tagged. Never twice: when the merge commit's tree is
  identical to the tree whose required checks passed, re-running it proves nothing
  and MUST be skipped. Coverage is defined by what has been proven about the exact
  bytes being shipped, not by how many times a pipeline was invoked.
- **Fail fast before you fail slow.** A check that can invalidate everything after
  it MUST run first. Nothing may spend the full suite to discover something a
  seconds-long check already knew.
- **Supply-chain scan at the start of new work.** Before starting a new feature or
  bug fix, review the Docker Scout vulnerability report for the latest published
  image (Docker Hub → `zuptalo/ring` → the current tag). Any flagged vulnerability
  that has a fix version available MUST be applied as part of that work — bump the
  Go module (`go get pkg@fixed && go mod tidy`) or the base image (`Dockerfile`),
  rebuild and test, and let it ride the same branch. A vulnerability with **no fix
  available** upstream is noted (in the PR) and left until one exists. A fix that is
  itself a shippable improvement (dependency/base-image CVE patch) is `fix`/
  `security`-typed so it reaches users, and is released rather than parked.
- **Spec numbering.** Bands are assigned by category and never reused: planned
  `0001–0999`, ad-hoc `1001–1999`, hotfix/bug `2001+`. The next free number in the
  band is allocated by `.specify/scripts/bash/create-new-feature.sh --category`
  (via `make spec` / `scripts/spec-new.sh`).
- **Branch vs. directory.** The feature branch carries a GitFlow type prefix —
  `feat/NNNN-slug` for planned and ad-hoc work, `fix/NNNN-slug` for hotfixes — while
  the spec directory stays flat (`specs/NNNN-slug/`). Only the branch is prefixed.
- **Spec lifecycle.** A spec's `Status` moves `planned → in-progress → in-review →
  shipped`; the value drives its row in `ROADMAP.md`.
- **Gate sequencing.** `/speckit-clarify` runs before `/speckit-plan`;
  `/speckit-analyze` runs after `/speckit-tasks` and before `/speckit-implement`.
  `/speckit-checklist` is REQUIRED for any spec touching Principle I or IV and
  optional otherwise.

## Governance

- This constitution supersedes other practices. Amendments are made by a PR that
  edits this file and bumps its version using semantic versioning: **MAJOR** for a
  removed or redefined principle, **MINOR** for a new principle or section, **PATCH**
  for clarifications and wording.
- `/speckit-analyze` checks every spec/plan/tasks set against these principles;
  unresolved violations block `/speckit-implement` and merge unless waived in the
  spec's *Complexity & Exceptions* section with maintainer sign-off.
- Complexity must be justified: anything that adds a moving part, a dependency, or a
  server capability must show why a simpler, zero-knowledge-preserving option won't
  do.
- Runtime engineering guidance that is not constitutional lives in `CLAUDE.md` and
  `CONTRIBUTING.md`; where they conflict with this document, this document wins.

**Version**: 1.4.0 | **Ratified**: 2026-06-15 | **Last Amended**: 2026-09-17
