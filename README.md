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

You need Docker and a public HTTPS URL (terminate TLS with your own reverse proxy
in front of port 8080).

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
| `ENABLE_CALLS`    | `false` (prod) | Embedded TURN + SFU. Needs a relay IP + TURNS cert.|

Calls (WebRTC) stay off outside dev until you provide a public relay IP and a
TURNS certificate. See `server/.env.example` for the full list.

### Behind a reverse proxy

ringd serves plain HTTP on `:8080` (PWA, API, and the `/v1/ws` WebSocket), so put
a TLS-terminating reverse proxy (Caddy, nginx, Traefik, nginx-proxy-manager) in
front of it. The proxy must:

- forward to the app on port `8080`,
- **proxy WebSocket upgrades** for `/v1/ws` (in nginx-proxy-manager, enable
  "Websockets Support"; Caddy and Traefik handle this automatically), and
- **allow large uploads** so media is not capped at nginx's 1 MB default, e.g.
  `client_max_body_size 300m` (match or exceed `MAX_BLOB_MB`).

To run behind a proxy that is already on a shared Docker network, drop the
`ports:` from the compose, add `expose: ["8080"]`, and attach both services to
that external network; the proxy then reaches the app by container name.

### Image tags

`:latest` (and `:X.Y.Z`) is published when you cut a release (merge `develop` ->
`main`). Before your first release, or to deploy a specific build, pin a tag:
`:1.2.3` for a release, or `:develop` / `:develop-<sha>` for the rolling dev
build. Leaving `:latest` floating means a redeploy picks up whatever is newest;
pin if you want redeploys to be deliberate.

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

To ship a release, bump `"version"` in `package.json` on `develop` and open a PR
into `main`. A merge without a version bump re-runs CI but does not re-release.

## License

Not yet licensed (all rights reserved by default). A license can be added here
when chosen.
