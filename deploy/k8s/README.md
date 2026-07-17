# Ring on k3s (with auto-deploy)

Deploys Ring to a fresh k3s cluster with **voice/video calls** and **automatic
image updates** from `ghcr.io/zuptalo/ring:develop`. Everything stays in the
cluster: in-cluster PostgreSQL, ringd terminating its own TLS, and **Keel**
rolling the deployment whenever a new image is published.

```
                 :443 (node)            ┌──────────── namespace: ring ───────────┐
  client ─────►  k3s Traefik  ─ SNI ──► │  ringd (1 replica)  ──► ring-postgres   │
  (HTTPS +       (TCP/SNI               │   :8443 app HTTPS                        │
   TURNS)         passthrough)          │   :3478 TURN-over-TLS (call media)       │
                                        │   ACME certs + secrets stored in PG      │
   Keel (ns: keel) ── polls GHCR ──────►│   redeploys on a new :develop digest    │
                                        └──────────────────────────────────────────┘
```

## Why this shape

- **Calls need raw TLS on :443**, not an HTTP proxy. ringd terminates TLS itself
  (its own Let's Encrypt cert via TLS‑ALPN‑01) and runs an embedded TURN relay.
  All call media tunnels over **TURN‑over‑TLS on :443 (TCP)**, with `RELAY_IP`
  staying loopback — so there are **no UDP ports** to expose. k3s's built‑in
  Traefik does the L4 **SNI passthrough** that routes by hostname to ringd.
- **Stateless app**: only Postgres holds state (incl. ringd's secrets + ACME
  certs, encrypted with `SECRETS_KEY`). Migrations run on boot.
- **Single replica**: the WebSocket hub and in‑process SFU are singletons, so the
  Deployment is `replicas: 1` with the `Recreate` strategy. Don't scale it.
- **Pull‑based updates (Keel)**: nothing needs inbound access to your cluster and
  no kubeconfig lives in CI. Keel polls GHCR and redeploys on a new digest.

## Prerequisites

- A running k3s cluster with its **bundled Traefik** (default) and the
  **local-path** storage class (default). Its `:443` (`websecure` entrypoint)
  must be reachable from the internet for ACME to work.
- Two DNS names pointing at the cluster's ingress IP, e.g. `ring.example.com`
  (the app) and `turn.ring.example.com` (the TURN SNI).
- `kubectl` pointed at the cluster, plus `envsubst`, `openssl`, and ideally
  `helm` (to install Keel) on the machine you run the installer from.

## Install

```sh
cd deploy/k8s
APP_HOST=ring.example.com \
ACME_EMAIL=you@example.com \
./install.sh
# TURN_HOST defaults to turn.$APP_HOST; override if you want a different SNI.
```

The installer is **idempotent**: it generates `SECRETS_KEY` + the DB password
**once** and never rotates them on re-runs. Then:

1. Point DNS A/AAAA for **`APP_HOST`** and **`TURN_HOST`** at the cluster IP.
2. `kubectl -n ring rollout status deploy/ringd`
3. Get the first‑run invite code: `kubectl -n ring logs deploy/ringd | grep FIRST-RUN`
4. Open `https://APP_HOST`, install the PWA, register with that code.

> First TLS issuance can take a minute. To avoid Let's Encrypt **rate limits**
> while testing, uncomment `ACME_DIRECTORY_URL` (staging) in `20-ringd.yaml`,
> apply, confirm it works, then remove it and re-apply for a real cert.

## How auto-deploy works

The `ringd` Deployment is annotated for Keel:

```yaml
keel.sh/policy: force          # redeploy when the tag's digest changes
keel.sh/trigger: poll
keel.sh/pollSchedule: "@every 2m"
```

Keel polls `ghcr.io/zuptalo/ring:develop` every ~2 min; when CI publishes a new
`develop` build, Keel forces a rolling (Recreate) redeploy that pulls the new
digest and re‑runs migrations on boot. Nothing else to do.

**Track stable releases instead of develop:** in `20-ringd.yaml` change the image
tag to `:latest` (published on each version release) and re‑apply. Keel `force`
works the same for `:latest`.

**Private GHCR package?** If the image isn't public, create a pull secret and
reference it, and give Keel registry creds:

```sh
kubectl -n ring create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=USER --docker-password=GHCR_PAT
# add `imagePullSecrets: [{name: ghcr}]` to the ringd pod spec, and configure
# Keel's secret (see https://keel.sh) so it can read the registry digest.
```

## Verify calls

```sh
# A cert exists for both hosts and TURNS answers on :443:
echo | openssl s_client -connect ring.example.com:443  -servername ring.example.com 2>/dev/null | openssl x509 -noout -subject -dates
echo | openssl s_client -connect turn.ring.example.com:443 -servername turn.ring.example.com 2>/dev/null | openssl x509 -noout -subject
```

Then place a call between two registered devices. See `server/docs/CALLING.md`
for the full calling/TLS background.

## Backup & restore

Back up **two** things: the Postgres data (this PVC, or a `pg_dump`) **and** the
`SECRETS_KEY` from the `ring-secrets` Secret:

```sh
kubectl -n ring get secret ring-secrets -o jsonpath='{.data.SECRETS_KEY}' | base64 -d
```

Restore = restored Postgres + the **same** `SECRETS_KEY`. Losing the key makes the
stored server secrets/certs unrecoverable (device tokens + push subs invalidated).

## Files

| File | What |
|---|---|
| `00-namespace.yaml` | `ring` namespace |
| `10-postgres.yaml` | PostgreSQL 18 StatefulSet + headless Service + PVC |
| `20-ringd.yaml` | ringd ConfigMap + Deployment (Keel‑annotated) + Service |
| `30-ingressroute-tcp.yaml` | Traefik SNI‑passthrough routes (app→8443, turn→3478) |
| `install.sh` | idempotent installer (secrets once, apply, install Keel) |

Secrets are created by the installer and are **not** committed. The host‑specific
values are substituted from `APP_HOST` / `TURN_HOST` / `ACME_EMAIL` at apply time.
