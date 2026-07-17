# Feature Specification: Local Dev Deployment Tooling + Hot Reload

**Feature Branch**: `feat/1002-local-dev-deployment`

**Created**: 2026-06-15

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "set up the local dev environment so the laptop serves the public dev URL (ring-dev.zuptalo.com); add a make command to run the whole thing; use simple INVITE01–INVITE10 dev invite codes; and make it possible to have hot reload over the public URL too, not just localhost"

## Overview

The dev deployment runs `ringd` on the laptop behind the NAS Traefik SNI-passthrough
chain, so `https://ring-dev.zuptalo.com` (app) and `m-dev.zuptalo.com` (TURN) reach
the laptop with auto-provisioned Let's Encrypt certs. This spec captures the
developer-experience tooling around that:

1. A single `make` target to run the whole public-dev deployment.
2. Simple, memorable dev invite codes (`INVITE01`–`INVITE10`) instead of the
   cryptic per-spec pool.
3. **Hot reload over the public URL.** Today the public URL serves the built
   `dist/` (rebuilt on change via `vite build --watch`, full reload). Developers
   want true HMR (instant module updates) through `ring-dev.zuptalo.com`, the same
   as `localhost:5173` — useful when testing on a phone or PWA install.

This is **developer tooling only**: dev-mode behaviour, gated off in production.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One command runs the public dev deployment (Priority: P1)

A developer runs a single `make` target and the laptop serves the app at
`https://ring-dev.zuptalo.com` (TLS + TURN + API), ready to test on any device.

**Why this priority**: Without it, bringing up the deployment is a multi-step manual
dance (build, source env, run ringd) that's easy to get wrong.

**Independent Test**: Run the target; `https://ring-dev.zuptalo.com/healthz` returns
healthy over trusted TLS and the app loads.

**Acceptance Scenarios**:

1. **Given** the laptop's `server/.env` deployment config and Postgres up, **When**
   the developer runs the dev-deployment make target, **Then** ringd serves the app
   over the public URL with valid TLS and TURN, in one command.

---

### User Story 2 - Simple, memorable invite codes (Priority: P2)

A developer (or a person they invite) signs up with an obvious code like `INVITE01`.

**Why this priority**: The cryptic per-spec codes (RINGDEV*, CHATFLT1, …) are hard to
share and remember for manual testing/demos.

**Independent Test**: A fresh dev DB exposes exactly `INVITE01`–`INVITE10`, each
usable once to register.

**Acceptance Scenarios**:

1. **Given** a dev-mode server on a fresh database, **When** it boots, **Then** it
   seeds exactly `INVITE01`–`INVITE10` (8-char, register-UI-valid) and nothing else.
2. **Given** the e2e harness, **When** a spec registers with a code not in the seed
   set, **Then** it still succeeds via the dev-only fresh-code mint (no e2e breakage).

---

### User Story 3 - Hot reload over the public dev URL (Priority: P2)

A developer edits client code and sees the change apply **instantly** in the browser
at `https://ring-dev.zuptalo.com` — true HMR — without a full reload or manual
rebuild, including when testing on a phone.

**Why this priority**: Tight iteration on real devices/PWA is the main reason to use
the public URL during development; `vite build --watch` + full reload is slow.

**Independent Test**: With the dev deployment in hot-reload mode, edit a `.vue`/`.ts`
file; the change appears at `https://ring-dev.zuptalo.com` via HMR (module swap, app
state preserved where applicable), and the HMR websocket connects over the public URL.

**Acceptance Scenarios**:

1. **Given** the dev deployment in hot-reload mode, **When** the developer saves a
   client source file, **Then** the running page at the public URL updates via HMR
   without a manual rebuild or full page reload.
2. **Given** hot-reload mode is off (default/production), **When** ringd serves the
   app, **Then** it serves the built `dist/` (or pure API) exactly as before — no
   proxy, no dev behaviour.
3. **Given** the API and TURN, **When** the app runs in hot-reload mode, **Then**
   `/v1`, `/v1/ws`, and TURN are still served by ringd directly (only non-API app
   assets + the HMR socket are proxied to the dev server).

### Edge Cases

- Hot-reload mode requested but the dev server isn't running → app requests fail
  clearly (proxy target unreachable); ringd itself stays up for API/TURN.
- `DEV_PROXY` set in a non-dev environment → ignored (dev-only).
- The dev server's host check must accept the public dev host (allowed-hosts), and
  the HMR client must target the public origin/port, not the internal dev-server port.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single `make` target MUST bring up the public dev deployment
  (Postgres + ringd with TLS/TURN, serving the app), reading `server/.env`.
- **FR-002**: In dev mode on a fresh database, the server MUST seed exactly
  `INVITE01`–`INVITE10` (8-char, register-UI-valid) and no other codes.
- **FR-003**: A normal dev deployment MUST seed only `INVITE01`–`INVITE10`. The
  fixed per-spec codes the e2e harness depends on (some specs derive and assert a
  deterministic `u_<code>` username, e.g. `directory.spec` → `u_dirtst01`) MUST be
  seeded too, but only under the e2e run (`SEED_E2E_CODES`, set by the harness), so
  they don't clutter the dev deployment. Specs that don't assert a username keep
  working via the dev-only fresh-code mint.
- **FR-004**: ringd MUST support a dev-only reverse-proxy mode (`DEV_PROXY=<url>`)
  that forwards all non-API requests — including the HMR websocket upgrade — to the
  given dev server, instead of serving static assets.
- **FR-005**: In dev-proxy mode, ringd MUST still serve `/v1`, `/healthz`, and
  `/v1/ws` itself, and MUST keep terminating TLS and running TURN.
- **FR-006**: `DEV_PROXY` MUST be ignored outside dev mode; with it unset, behaviour
  is byte-for-byte unchanged (static `dist/` or API-only).
- **FR-007**: The make target for hot-reload mode MUST run the dev server with the
  public dev host allowed and the HMR client configured for the public origin/port,
  so HMR connects through the passthrough chain.
- **FR-008**: The deployment config (`server/.env`) and the chain it depends on
  (Traefik `:8443`, DNS, firewall) MUST be documented so a fresh setup is repeatable.

## Zero-Knowledge Impact *(mandatory)*

- **What crosses the wire / is encrypted**: Unchanged. This spec adds **developer
  tooling only** — a make target, dev invite-code seeding, and a **dev-mode**
  reverse proxy. None of it changes the production client/server boundary, what is
  encrypted, or server-visible metadata.
- **Dev-proxy scope**: `DEV_PROXY` and the HMR proxy are gated to dev mode and are
  never enabled in a production build/deploy (FR-006). They proxy already-public
  app assets + the HMR socket to a local dev server; no user plaintext is involved.
- **Secrets**: The dev deployment's `SECRETS_KEY` lives only in the gitignored
  `server/.env`; the simple invite codes are non-secret dev bootstrap data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single make target yields `https://ring-dev.zuptalo.com/healthz` =
  healthy over trusted TLS, app served, in one step.
- **SC-002**: A fresh dev DB lists exactly the 10 codes `INVITE01`–`INVITE10`.
- **SC-003**: Editing a client source file updates the page at the public dev URL via
  HMR (no full reload / manual rebuild), with the HMR socket connected over the
  public origin.
- **SC-004**: With `DEV_PROXY` unset, ringd serves the built app / API exactly as
  before (no behavioural change); the full test suite stays green.

## Assumptions

- The laptop dev deployment uses ACME auto-TLS behind the NAS Traefik SNI-passthrough
  chain (app `:8443`, TURN `:3478`), per the existing `server/.env`.
- The dev server is Vite; ringd reverse-proxying to it (incl. the HMR ws) is the
  chosen route over having Vite terminate TLS, because ringd already owns the cert,
  the API, and TURN.
- The dev deployment wants only `INVITE01`–`INVITE10`; the e2e harness seeds its
  fixed per-spec codes separately (`SEED_E2E_CODES`) because some specs assert a
  username derived from a known code. Other specs use the dev-only fresh-code mint.
- Hot-reload mode is opt-in (a distinct make target / `DEV_PROXY`); plain local dev
  (`make start` → `localhost:5173`) and production are unaffected.
