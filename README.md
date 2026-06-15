# Ring

A private, end-to-end encrypted messenger and calling app, built as an installable
PWA with a small Go backend. The server only ever relays sealed envelopes and
stores opaque ciphertext. It never sees message bodies, contacts, profiles, or
media. Made by Zuptalo with love for privacy.

## What is in here

This is a single repository with two parts that ship as one container:

- **Client** (repo root): a Vue 3 + Ionic PWA. Double Ratchet / X3DH E2EE
  (libsodium), offline-first IndexedDB, Web Push, and 1:1 + group WebRTC calls.
  Builds to `dist/` with Vite.
- **Server** (`server/`): `ringd`, a Go 1.26 service on `net/http` with PostgreSQL
  (pgx), embedded SQL migrations, an embedded TURN relay + SFU for calls, and
  VAPID Web Push. See `server/README.md` for the API surface.

In production a single image runs `ringd`, which serves the built PWA at `/` and
the API at `/v1`, `/healthz`, and the `/v1/ws` WebSocket on the same origin. In
development Vite serves the client and proxies the API to a local `ringd`.

## Run an instance

You need Docker and a domain. How TLS is handled depends on your setup - the
bundled `docker-compose.yml` ships commented blocks for three scenarios (see
[Deployment scenarios](#deployment-scenarios)); the default expects a
TLS-terminating reverse proxy in front of port 8080.

```sh
export PUBLIC_URL=https://ring.example.com
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export SECRETS_KEY=$(openssl rand -hex 32)   # keep this stable + backed up
docker compose up -d
```

This pulls `ghcr.io/zuptalo/ring:latest` and starts it with PostgreSQL. The app
container is **stateless** - on first boot the server generates its own secrets
(VAPID + token-signing + TURN) and stores them **encrypted in Postgres** (with
`SECRETS_KEY`), so only the database has a volume. It prints a first-run
invitation code in the logs:

```sh
docker compose logs ring | grep FIRST-RUN
```

Register the first account with that code. To build the image from this checkout
instead of pulling it, use `docker compose up -d --build`.

### Configuration

With the `docker compose` quick start above you set `PUBLIC_URL` and `SECRETS_KEY`
(and optionally `POSTGRES_PASSWORD`); `DATABASE_URL` is wired to the bundled
database for you. Running the image standalone (`docker run`) is the only case
where you must pass `DATABASE_URL` yourself. Point it at an empty database; the
server creates every table on boot. Everything else has working defaults. The
notable knobs:

| Variable          | Default        | Purpose                                           |
| ----------------- | -------------- | ------------------------------------------------- |
| `DATABASE_URL`    | (required)     | PostgreSQL connection string.                     |
| `PUBLIC_URL`      | (required)     | Canonical public URL; builds invite links.        |
| `SECRETS_KEY`     | (required)     | Encrypts server secrets at rest in PG; keep stable.|
| `STATIC_DIR`      | `/app/web`     | Built PWA served by ringd (set in the image).     |
| `MAX_BLOB_MB`     | `256`          | Per-upload media cap.                             |
| `ENABLE_CALLS`    | `false` (prod) | Embedded TURN + SFU. Needs TLS (a cert, or `ACME`). |
| `ACME`            | `false`        | ringd auto-provisions/renews its own TLS (autocert). See scenarios B/C. |

Calls (WebRTC) stay off (`ENABLE_CALLS` unset) until you set them up: media rides
TURN-over-TLS on 443, which needs an **L4 / SNI-passthrough** proxy (a plain HTTP
reverse proxy can't carry it). With `ACME=true`, ringd **provisions and renews its
own TLS certs** (autocert, TLS-ALPN-01) for both the HTTPS app listener and the
TURNS listener - cached encrypted in Postgres, no cert files - so the proxy is a
pure passthrough and deploy is just "point DNS at the box." See
**`server/docs/CALLING.md`** for the full recipe (auto-TLS, plus fronting an
HTTP-only proxy like Synology DSM or nginx-proxy-manager with a dedicated edge proxy).

### Deployment scenarios

`ringd` serves plain HTTP on `:8080` (PWA + API + the `/v1/ws` WebSocket), an
HTTPS app listener on `:8443` and a TURNS listener on `:3478` (both when `ACME`
is on). Pick the scenario that matches how TLS reaches the box; `docker-compose.yml`
ships a commented block for each.

**A. Behind a TLS-terminating reverse proxy (default) - messaging.** Your proxy
(Caddy, nginx, Traefik HTTP, nginx-proxy-manager, Synology DSM) terminates TLS for
your domain and forwards HTTP to ringd on `:8080`. It must **proxy WebSocket
upgrades** for `/v1/ws` (in nginx-proxy-manager, enable "Websockets Support";
Caddy and Traefik do it automatically) and **allow large uploads** (e.g. nginx
`client_max_body_size 300m`, at least `MAX_BLOB_MB`). Calls do **not** work through
a TLS-terminating HTTP proxy (TURN media is not HTTP) - leave `ENABLE_CALLS` off.
To run on a shared Docker network instead of publishing `:8080`, swap `ports:` for
`expose: ["8080"]` and join the proxy's external network.

**B. Direct to the internet, ringd serves its own TLS (`ACME=true`) - messaging.**
No separate proxy: ringd auto-provisions a Let's Encrypt cert (autocert,
TLS-ALPN-01) for your domain and serves HTTPS itself - publish `"443:8443"` and
point DNS at the box. Certs are cached **encrypted in Postgres** (still stateless,
no files). Calls need scenario C (two hostnames can't share `:443` without an SNI
router).

**C. Self-sufficient with calls, behind a pure L4 SNI-passthrough proxy.** ringd
auto-certs **both** the app (HTTPS `:8443`) and the TURNS relay (`:3478`); a
passthrough proxy (Traefik TCP, HAProxy, nginx `stream`) on `:443` routes by SNI:
your app host -> `ring:8443`, your TURN host (`TURN_HOST`) -> `ring:3478`. This is
the only setup where **voice/video survives restrictive/censored networks** (media
rides TURN-over-TLS on 443, indistinguishable from HTTPS). Full recipe + an example
Traefik config: **[`server/docs/CALLING.md`](server/docs/CALLING.md)**.

> ACME (scenarios B/C) uses **TLS-ALPN-01**, so the domain's public `:443` must
> reach ringd **un-terminated** (direct, or an SNI-passthrough proxy - not a
> TLS-terminating one). Behind a terminating proxy (scenario A), leave ACME off.

### Image tags

`:latest` (and `:X.Y.Z`) is published when you cut a release (merge `develop` ->
`main`). Before your first release, or to deploy a specific build, pin a tag:
`:1.2.3` for a release, `:1.2.3-rc.1` for a release candidate, or `:develop` /
`:develop-<sha>` for the rolling dev build. Leaving `:latest` floating means a
redeploy picks up whatever is newest; pin if you want redeploys to be deliberate.
For the full upgrade/rollback runbook, see
[`docs/UPGRADING.md`](docs/UPGRADING.md).

### Backups

The app container is stateless, so a backup is just **PostgreSQL** (the `db`
volume, or `docker compose exec db pg_dump -U ring ring > ring.sql`) plus your
**`SECRETS_KEY`**. Keep `SECRETS_KEY` stable and stored somewhere safe: it
decrypts the server's secret material in the database, so changing or losing it
makes those secrets unrecoverable (they get regenerated, invalidating every
device token + push subscription). A database dump on its own, without the key,
cannot use the secrets.

## Develop locally

Requires Go 1.26, Node 22, and Docker (for the dev PostgreSQL).

```sh
make start      # PostgreSQL + ringd (air hot-reload) + Vite, all at once
```

The app comes up on http://localhost:5173 and proxies the API to `ringd` on
:8080. In dev the server seeds fixed invite codes (`RINGDEV1`..`RINGDEV9`,
`TESTCODE`) so you can register test accounts immediately.

## Test

```sh
npm run build                       # client typecheck (vue-tsc) + Vite build
cd server && go test ./...          # backend unit tests (in-memory store, no DB)
npm run test:e2e                    # Playwright e2e (needs `make db-up` running)
```

## Roadmap and contributing

Ring is built **spec-first** with [Spec Kit](https://github.com/github/spec-kit):
every feature or fix starts as a numbered spec under `specs/` and runs through a
fixed pipeline before code lands. The live, auto-generated roadmap is
**[`ROADMAP.md`](ROADMAP.md)** (grouped into planned features, ad-hoc work, and
hotfixes; never hand-edited — `make roadmap` regenerates it from the specs). The
governing principles, including the non-negotiable zero-knowledge boundary, live
in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).

New contributors: start with **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for the full
spec-driven workflow, the spec-number bands, and the test gates.

## Branching and releases

The repo follows a simple GitFlow:

- **`develop`** is the integration branch. Every push runs the full build + test
  suite and publishes the `ghcr.io/zuptalo/ring` image under three tags: the
  rolling `develop`, the immutable `develop-<sha>`, and a `X.Y.Z-dev.<run>`
  prerelease tag (the `package.json` version plus the CI run number).
- **`main`** is production. Open a pull request from `develop` into `main`; CI
  runs the same build + test suite on it. Merging only happens once it is green.
- On merge to `main`, the release pipeline re-verifies the merge commit, then
  tags `main` with the `package.json` version (`vX.Y.Z`), publishes the
  production image (`latest`, `X.Y.Z`, `X.Y`), and cuts a GitHub release with
  auto-generated notes.
- **Release candidates** are cut out-of-band by pushing a `vX.Y.Z-rc.N` tag
  (typically off `develop`). That runs the full build + test suite and, if green,
  publishes a single immutable `:X.Y.Z-rc.N` image plus a GitHub pre-release. An
  RC **never** moves `:latest` or `:X.Y`, so production deploys tracking those
  tags are unaffected - testers opt in by pinning the RC tag.

To ship a release, bump `"version"` in `package.json` on `develop` and open a PR
into `main`. A merge without a version bump re-runs CI but does not re-release.

Operators upgrading an existing instance: see **[`docs/UPGRADING.md`](docs/UPGRADING.md)**.

## License

Ring is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-only).
See [`LICENSE`](LICENSE) for the full text.

In plain terms: you are free to use, study, modify, and self-host Ring. The catch
that matters for a network service - if you run a **modified** Ring server and let
others use it over a network, you must offer those users the complete corresponding
source of your modified version (AGPL §13). There is no warranty.

Copyright (C) 2026 Zuptalo
