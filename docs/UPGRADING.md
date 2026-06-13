# Upgrading & operating a Ring instance

This is the operator's runbook for keeping a self-hosted Ring up to date. It
assumes you already have an instance running (see the [README](../README.md) for
first-time setup and the [deployment scenarios](../README.md#deployment-scenarios)).

## How upgrades work

The Ring container is **stateless**. All persistent state - accounts, sealed
envelopes, media ciphertext, and the server's own secret material - lives in
**PostgreSQL**, encrypted at rest under your `SECRETS_KEY`. The container itself
holds nothing you need to preserve.

That makes an upgrade simple: **pull a newer image and restart the container.** On
boot `ringd` runs any embedded SQL migrations the new version added (forward-only,
no external tool), then comes up. There is no separate migration or build step.

Two halves update independently and that is by design:

- **Server (`ringd`)** updates the instant the new container is running.
- **Client (the PWA)** is served by that same container, but installed PWAs cache
  the app shell. Ring builds with `registerType: 'prompt'`, so a client that
  already has the app open does **not** silently reload onto the new version - it
  detects the new deploy (it compares its build version against the server's
  `/v1/config`) and surfaces an in-app "update available" prompt. The new version
  applies when the user accepts. This is intentional: no surprise reloads mid-chat
  or mid-call.

## Before you upgrade: back up

A backup is just two things (same as in the [README](../README.md#backups)):

1. **PostgreSQL** - the `db` volume, or a dump:
   ```sh
   docker compose exec db pg_dump -U ring ring > ring-$(date +%F).sql
   ```
2. **Your `SECRETS_KEY`** - stored somewhere safe and separate. It decrypts the
   server's secret material in the database. A database dump **without** the key is
   useless; losing the key means those secrets are regenerated, invalidating every
   device token and push subscription.

Keep `SECRETS_KEY` stable across upgrades. You never need to change it to upgrade.

## Choosing an image tag

`ghcr.io/zuptalo/ring` is published under several tags; which one you pin decides
how upgrades reach you:

| Tag             | What it is                                  | Use it when…                                         |
| --------------- | ------------------------------------------- | ---------------------------------------------------- |
| `:latest`       | The most recent stable release.             | You want stable, and redeploys to pick up new releases. |
| `:X.Y.Z`        | One specific stable release (immutable).    | You want **deliberate**, pinned upgrades and easy rollback. |
| `:X.Y`          | Newest patch within a minor line.           | You want patch updates but not minor/major jumps.    |
| `:X.Y.Z-rc.N`   | A **release candidate** (pre-release).      | You're helping test an upcoming release (see below). |
| `:develop`      | Rolling build of the `develop` branch.      | You track bleeding edge and accept breakage.         |

Pinning a specific `:X.Y.Z` is the safest posture for production: redeploys are
reproducible and a rollback is just re-pinning the previous number. Leaving
`:latest` floating means any redeploy picks up whatever is newest.

## Upgrade (docker compose)

```sh
# 1. Back up (see above).
# 2. If you pin a version, bump it in docker-compose.yml: image: ghcr.io/zuptalo/ring:X.Y.Z
# 3. Pull and restart:
docker compose pull ring
docker compose up -d ring
# 4. Watch it come up (migrations run here):
docker compose logs -f ring
```

Then reload the PWA (or accept the in-app update prompt) and confirm the version
shown on the **About** page matches the image you deployed.

## Rolling back

Because state lives in Postgres and the container is stateless, rolling the
*server* back is just re-pinning the previous image and restarting:

```sh
# docker-compose.yml: image: ghcr.io/zuptalo/ring:<previous X.Y.Z>
docker compose pull ring && docker compose up -d ring
```

Caveat: migrations are **forward-only**. If the version you are leaving added a
migration, rolling the binary back to a version that predates that schema is not
supported - prefer rolling forward to a fixed release. For anything beyond a
same-schema rollback, restore your database dump.

## Trying a release candidate

Release candidates let you validate an upcoming release on a real instance before
it becomes `:latest`. They are published as immutable `:X.Y.Z-rc.N` images and as
GitHub **pre-releases**; they never move `:latest` or `:X.Y`, so a production box
tracking those tags is unaffected.

To try one, point a **non-production** instance at the RC tag:

```sh
# docker-compose.yml: image: ghcr.io/zuptalo/ring:0.2.0-rc.1
docker compose pull ring && docker compose up -d ring
```

When the real release ships, switch back to `:latest` (or the new `:X.Y.Z`). RCs
may contain unfinished work - don't run them for real users. See
[Branching and releases](../README.md#branching-and-releases) for how RCs are cut.

## Kubernetes / Keel

If you run on k3s with Keel auto-deploy, upgrades are driven by which tag the
deployment tracks (`:develop` for rolling, `:latest`/`:X.Y.Z` for stable) rather
than by `docker compose pull`. See [`deploy/k8s/README.md`](../deploy/k8s/README.md).
