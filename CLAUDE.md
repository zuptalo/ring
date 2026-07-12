# CLAUDE.md

Guidance for AI assistants working in this repository. Read this first; it
captures the architecture, workflows, and conventions that aren't obvious from
any single file.

## What Ring is

Ring is a private, end-to-end-encrypted messenger and calling app. It ships as
an installable **PWA** (Vue 3 + Ionic) backed by a small **Go** server. The
defining constraint, which shapes nearly every design decision, is
**zero-knowledge**: the server only ever relays sealed envelopes and stores
opaque ciphertext. It never sees message bodies, contacts, profiles, or media.
When you touch anything that crosses the client/server boundary, assume the
server must remain blind to plaintext — encrypt on the client, send ciphertext.

Ring is licensed **AGPL-3.0-only** (see `LICENSE`); the network-copyleft clause
is part of why the zero-knowledge boundary above is non-negotiable.

## Monorepo layout

One repo, two parts, shipped as a single container.

- **Client** — repo root. Vue 3 + Ionic PWA, built with Vite to `dist/`.
  - `src/views/` — pages. `tabs/` are the four bottom-tab roots (Chats, Calls,
    Contacts, Settings) plus `AuthPage`; `detail/` are full-screen drill-down
    pages pushed outside the tabs (chat, contact, group, call, settings sub-pages).
  - `src/components/` — reusable UI (bubbles, pickers, call overlays, media).
  - `src/composables/` — Vue composition functions (`useCall`, `useSync`,
    `usePresence`, `useTheme`, `useLiveQuery`, etc.). Reactive app state lives here.
  - `src/services/` — non-UI logic: `api.ts` (HTTP), `messaging.ts` (1:1 E2EE
    orchestration), `crypto/` (X3DH + Double Ratchet + sender keys, libsodium),
    `call/` (WebRTC: signalling, SFU, TURN, insertable-streams E2EE), media
    encode/transfer, push/notifications, sync.
  - `src/db/` — IndexedDB layer. `idb.ts` is a tiny promise wrapper with a
    change-notification bus; `queries.ts` is the data-layer orchestration that
    calls into `messaging.ts`.
  - `src/settings/schema.ts` — the entire settings hierarchy as one data
    structure (see "Settings" below).
  - `src/sw.ts` — custom service worker (Web Push + app-shell precaching).
  - `src/router/index.ts` — routes + the auth gate.
- **Server** (`server/`) — `ringd`, a Go 1.26 service on stdlib `net/http`
  (no web framework), PostgreSQL via `pgx` v5, embedded SQL migrations, an
  embedded TURN relay + SFU for calls, and VAPID Web Push.
  - `cmd/ringd/main.go` — entrypoint: config → pool → migrate → secrets → ACME
    → TURN/SFU → router → listeners → graceful shutdown.
  - `internal/api/` — routing (`router.go`) + handlers (one file per area,
    each with a `_test.go`).
  - `internal/store/` — PostgreSQL repositories (one file per domain).
  - `internal/db/migrations/` — embedded, numbered SQL migrations (`NNNN_*.sql`).
  - `internal/{auth,config,httpx,push,secrets,ws,turn,sfu,call,acme}/` — auth
    tokens, env config, HTTP middleware, push, encrypted-at-rest secrets,
    WebSocket hub, TURN, SFU, call registry, ACME cache.
- **`e2e/`** — Playwright multi-browser tests (real WebRTC between accounts).
- **`server/docs/CALLING.md`** — the full calling/TLS deployment recipe.

In production a single image runs `ringd`, which serves the built PWA at `/`
(via `STATIC_DIR`) and the API at `/v1`, `/healthz`, and the `/v1/ws`
WebSocket on the same origin. In dev, Vite serves the client and proxies the
API to a local `ringd`.

## Local development

Requires **Go 1.26, Node 22, Docker** (for dev PostgreSQL).

```sh
make start      # PostgreSQL + ringd (air hot-reload) + Vite, all at once
```

App comes up on http://localhost:5173 and proxies the API to `ringd` on `:8080`.
Other `make` targets: `make backend` / `make frontend` (run one side),
`make db-up` / `make db-down` / `make stop`. Inside `server/`: `make run`,
`make test`, `make vet`, `make fmt`, `make tidy`.

In dev the server seeds fixed invite codes (`RINGDEV1`..`RINGDEV9`, `TESTCODE`,
plus per-spec codes — see `cmd/ringd/main.go`) so you can register test accounts
immediately. First account on a fresh DB uses the `FIRST-RUN` code logged at boot.

## Build, typecheck, and test

Run the relevant gate before claiming work is done. These are the exact checks
CI runs (`.github/workflows/build-test.yml`):

```sh
npm run build                 # client: vue-tsc --noEmit (typecheck) THEN vite build
cd server && go build ./...   # server build
cd server && go vet ./...     # server static checks
cd server && go test ./...    # server unit tests (in-memory fake store, NO DB needed)
npm run test:e2e              # Playwright e2e (needs `make db-up`; spins its own ringd)
```

- `npm run build` is the typecheck. There is no separate lint/test script for the
  client — the e2e suite is the behavioral coverage. After editing TypeScript/Vue,
  run `npm run build` to confirm it still typechecks.
- Server tests use an **in-memory fake store**, so `go test ./...` needs no
  database. Each handler file has a sibling `_test.go`; keep that pattern.
- The e2e harness (`e2e/global-setup.ts`) resets a throwaway `ring_e2e` DB,
  builds and launches an isolated test `ringd` on `:8081` (+ plaintext TURN on
  `:3479`) and a test Vite on `:5174`. It drives the app through the dev-only
  `window.__ringTest` hook (`src/services/testhook.ts`), which is stripped from
  production builds. It does NOT touch your `make start` stack (different ports + DB).

### Driving the dev app for investigation (`drive/`)

When you need to actually *see* the UI behave — reproduce a bug, watch a multi-user
flow, screenshot a state — drive the **already-running** `make start` app with the
`drive/` harness instead of hand-rolling a script. It attaches to the live dev stack
(Vite `:5173` → ringd `:8080`) and drives several throwaway test users through the
same `window.__ringTest` hook the e2e suite uses; a scenario is ~10 lines.

```sh
make start                                   # (in another terminal) dev stack up
node drive/scenarios/group-conversation.mjs  # or: HEADED=1 node drive/scenarios/dm-and-react.mjs
```

`drive/driver.mjs` exports `createAccount` / `pair` / `group` / `say` /
`waitForMessage` / `react` / `chatWith` / `shot` / `sweep` / `done`. Screenshots land
in `.tmp/drive/*.png` (gitignored) — read them to inspect the UI; ids + console
stream to stdout. **Gotchas (the driver handles them; don't undo them):** use the
driver's `poll()`/`waitForMessage`, never `page.waitForFunction(() => promise.then(…))`
(it resolves spuriously in a standalone node script); 1:1 chat ids differ per device
(`chatWith` each side) but group ids are shared; accounts use minted dev codes;
`mobile: true` is iPhone-under-chromium. End scenarios with `sweep([...])`, or wipe
the dev DB with `make db-reset` (stop ringd first). Full guide: `drive/README.md`.

This shares the dev DB and is the fast, interactive complement to the hermetic
`npm run test:e2e` / `npm run showcase` (which boot their own isolated backend).

## Key architectural conventions

**Zero-knowledge boundary.** All message/media/profile plaintext is encrypted
client-side. The server stores/relays opaque ciphertext and capability-style
blob ids. Never add a server feature that would require reading user plaintext.

**Crypto** (`src/services/crypto/`). X3DH for session setup, Double Ratchet for
1:1, sender keys for groups, all on libsodium (`libsodium-wrappers-sumo`). The
crypto core is written as pure functions (testable without IndexedDB); the
stateful service layer persists via the `idb` wrapper. At rest, every secret is
wrapped (AEAD) under an Argon2id key derived from the user's PIN; only public
keys are stored in the clear. `messaging.ts` is crypto-only and never touches
the chats/contacts/messages stores — the dependency is one-directional
(`queries.ts` → `messaging.ts`), no cycle.

**Offline-first data.** IndexedDB is the source of truth on the device. Writes
go through `src/db/idb.ts`, which fires a change-notification bus; `useLiveQuery`
subscribes so the UI is reactive. Bump `DB_VERSION` and extend `onupgradeneeded`
in `idb.ts` when adding an object store. Own-data sync to the server is encrypted
and last-write-wins on `updatedAt`.

**Server HTTP style.** Stdlib `net/http` with method+pattern routes
(`mux.Handle("GET /v1/keys/{userId}", ...)`). Handlers depend on small
interfaces (`AuthStore`, `KeysStore`, …) defined in `router.go` and satisfied by
`*store.Store`; tests pass fakes. Middleware chain is recover → log → CORS.
Bearer-token auth for `/v1/*`; the WebSocket authenticates via `?token=` query
param (browsers can't set WS headers).

**Migrations** are embedded numbered SQL files run on boot — no external tool.
Add the next `NNNN_name.sql` in `internal/db/migrations/`; point new DBs at an
empty database and the server creates everything.

**Stateless server.** All persistent state — including server secret material,
encrypted at rest with `SECRETS_KEY` — lives in Postgres. No volume/mount.
`SECRETS_KEY` must stay stable; losing it makes stored secrets unrecoverable
(regenerated → all device tokens + push subscriptions invalidated).

**Settings** are declarative: `src/settings/schema.ts` is one tree that
`SettingDetailPage.vue` renders with stock Ionic components. Each toggle/choice
carries its own settings `key` + `default`. Adding a settings screen is a data
edit here, not a new component.

**Versioning/update UX.** The build stamps the same `VERSION` into the PWA
(`__APP_VERSION__`) and the Go binary (`main.version`). The PWA is `registerType:
'prompt'` — a new deploy never silently reloads; it surfaces a toast and applies
on user accept (`useAppUpdate` + `sw.ts` `SKIP_WAITING`).

**Calls/TLS.** WebRTC media rides TURN-over-TLS on 443 and needs an L4/SNI
passthrough proxy (not a TLS-terminating HTTP proxy). With `ACME=true`, ringd
provisions and renews its own certs (autocert, TLS-ALPN-01), cached encrypted in
Postgres. See `server/docs/CALLING.md` before touching calling/deploy.

## Spec-driven development

New behavior is built spec-first with **Spec Kit**. The governing principles —
including the non-negotiable zero-knowledge boundary and a TDD mandate — live in
`.specify/memory/constitution.md`; every spec is checked against it. Full
contributor walkthrough is in `CONTRIBUTING.md`.

- **Start a spec** with `make spec CATEGORY=<planned|adhoc|hotfix> DESC="…"` (or
  `scripts/spec-new.sh …`). The number encodes the category: planned `0001+`,
  ad-hoc `1001+`, hotfix/bug `2001+`. The helper allocates the next free number in
  the band, creates the branch (`feat/NNNN-slug` for planned/ad-hoc, `fix/NNNN-slug`
  for hotfixes) and the **flat** `specs/<NNNN-slug>/spec.md` (the directory is never
  prefixed — only the branch is), and writes `.specify/feature.json` (gitignored) so
  the speckit commands target it.
- **Required pipeline** (the `/speckit-*` agent skills, in order): `specify →
  clarify → plan → tasks → analyze → taskstoissues → implement`. `analyze` only
  reports — fix the flagged artifact (spec/plan/tasks) and re-run downstream until
  clean before implementing. `checklist` is required for crypto / zero-knowledge specs.
- **`ROADMAP.md` is generated** from `specs/` — never hand-edit it. Run
  `make roadmap` after adding a spec or changing a `**Status**:` line
  (`planned → in-progress → in-review → shipped`); CI's `Roadmap up to date` guard
  fails if it's stale.
- **Auto-close issues**: `taskstoissues` opens one GitHub issue per task; the
  feature → `develop` PR must list `Closes #N` for each so they close on merge
  (works because `develop` is the default branch).

## Git, branching, and releases

GitFlow. **`develop`** is the integration branch; **`main`** is production.

- Every push to `develop` and every PR runs the full build+test suite. A
  `develop` push also publishes the rolling `ghcr.io/zuptalo/ring:develop` image.
- Releases are driven by `package.json` `version`: bump it on `develop`, open a
  PR into `main`. On merge, the release pipeline re-verifies the merge commit and,
  if green and the `vX.Y.Z` tag doesn't already exist, tags `main`, publishes the
  production image (`latest`, `X.Y.Z`, `X.Y`), and cuts a GitHub release. A merge
  without a version bump re-runs CI but does not re-release.
- Release candidates are cut by pushing a `vX.Y.Z-rc.N` tag (off `develop`):
  `release-candidate.yml` runs the full suite and, if green, publishes a single
  immutable `:X.Y.Z-rc.N` image + a GitHub pre-release. RCs never move `:latest`
  or `:X.Y`; the RC version comes from the tag, not `package.json`. Operator
  upgrade/rollback runbook: `docs/UPGRADING.md`.

**Commit messages** follow Conventional Commits with a scope, e.g.
`feat(call): ...`, `fix(media): ...`, `feat(server): ...`, `test(e2e): ...`,
`ci: ...`, `docs: ...`. The subject describes user-facing behavior, not internals.

**Release-note subjects for end users** (constitution Principle VII). For user-facing
types (`feat`, `fix`, `perf`, `security`) the subject *after* the `type(scope):` prefix is
shown verbatim to users as the "What's new" line on update. Write it as plain-language,
benefit-focused release-note copy — no internal jargon, no implementation shorthand, and
no spec/issue/PR references (`(spec 1016)`, `(#248)`, `US2/US3`, `FR-014`).

- ✅ `feat(notifications): show update reminders in the morning, not overnight`
- ❌ `feat(notifications): 9 AM-local, behind-only version-announcement push (spec 1016)`

Non-user-facing types (`chore`, `ci`, `build`, `docs`, `refactor`, `style`, `test`,
`deps`) never reach "What's new", so they keep developer phrasing. (The client also
strips trailing spec/issue refs at display time as a safety net — `release-notes.ts` —
but the subject is the real lever.)

### Working in this environment

- Develop on the branch the task assigns; create it locally if missing. Commit
  with clear messages and push with `git push -u origin <branch>`. Do **not**
  push to a different branch without explicit permission.
- Do **not** open a pull request unless explicitly asked.
- Use the GitHub MCP tools (`mcp__github__*`) for any GitHub interaction; the
  `gh` CLI is not available here. The session's GitHub scope is `zuptalo/ring`.

## Code style

- **Match the surrounding code.** This codebase favors thorough explanatory
  comments on the *why* (not the *what*) — see the long comments in `main.ts`,
  `vite.config.ts`, `idb.ts`, `router.go`. New non-obvious code should carry
  similar reasoning; don't strip existing comments.
- TypeScript: ES modules, `@/` alias → `src/`. Vue 3 `<script setup>` + Ionic
  components. Composition API; reactive state via composables.
- Go: stdlib-first, small interfaces at call sites, `gofmt`'d, table-ish tests
  against the fake store. Run `go vet` before finishing.
- Keep the zero-knowledge invariant intact in every change that touches the wire.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/1043-direct-peer-peer/plan.md`
<!-- SPECKIT END -->
