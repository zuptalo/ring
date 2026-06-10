#!/usr/bin/env bash
# Idempotent installer for Ring on a fresh k3s cluster (calls enabled, Keel
# auto-updates from ghcr.io/zuptalo/ring:develop). Re-runnable: it never rotates
# the existing SECRETS_KEY / DB password.
#
#   APP_HOST=ring.example.com ACME_EMAIL=you@example.com ./install.sh
#
# Optional env:
#   TURN_HOST   TURNS/call-media SNI host (default turn.$APP_HOST). The app host
#               and the TURN host must each SNI-route to the cluster's :443. They
#               need NOT be subdomains of each other: e.g. APP_HOST=ring-dev.x.com
#               with TURN_HOST=m-dev.x.com is fine - pass TURN_HOST explicitly when
#               your TURN host is a sibling domain rather than turn.$APP_HOST.
#   ACME_STAGING=true        use Let's Encrypt staging (untrusted certs, generous
#               rate limits) - run once to validate the SNI-passthrough/ALPN chain,
#               then re-run without it to swap in real certs (ringd sweeps the
#               staging account on the next boot). Ignored if ACME_DIRECTORY_URL set.
#   ACME_DIRECTORY_URL       full ACME directory URL override (any CA).
#   KUBECTL     kubectl binary (default kubectl).
#
# This installer manages only the k3s side. If an upstream L4 proxy (e.g. a
# Synology/Traefik box) fronts the cluster, it must SNI-passthrough both hosts to
# the k3s node's :443 - it must NOT terminate TLS (ringd holds the certs).
set -euo pipefail

: "${APP_HOST:?set APP_HOST, e.g. APP_HOST=ring.example.com}"
: "${ACME_EMAIL:?set ACME_EMAIL, e.g. ACME_EMAIL=you@example.com}"
: "${TURN_HOST:=turn.${APP_HOST}}"
# ACME directory: explicit URL wins; else ACME_STAGING=true picks LE staging; else
# empty => ringd defaults to Let's Encrypt production.
ACME_DIRECTORY_URL="${ACME_DIRECTORY_URL:-}"
if [ -z "$ACME_DIRECTORY_URL" ] && [ "${ACME_STAGING:-}" = "true" ]; then
  ACME_DIRECTORY_URL="https://acme-staging-v02.api.letsencrypt.org/directory"
fi
KUBECTL="${KUBECTL:-kubectl}"
DIR="$(cd "$(dirname "$0")" && pwd)"
export APP_HOST TURN_HOST ACME_EMAIL ACME_DIRECTORY_URL

command -v envsubst >/dev/null || { echo "need 'envsubst' (gettext). install it and re-run." >&2; exit 1; }

echo "==> namespace"
"$KUBECTL" create namespace ring --dry-run=client -o yaml | "$KUBECTL" apply -f -

# Secrets: created exactly once. SECRETS_KEY must stay stable forever (it decrypts
# the server secrets + ACME certs in Postgres). Re-running leaves it untouched.
if "$KUBECTL" -n ring get secret ring-secrets >/dev/null 2>&1; then
  echo "==> ring-secrets exists; keeping SECRETS_KEY + DB password as-is"
else
  echo "==> generating ring-secrets (SECRETS_KEY + DB password) - BACK THESE UP"
  PW="$(openssl rand -hex 16)"
  KEY="$(openssl rand -hex 32)"
  DBURL="postgres://ring:${PW}@ring-postgres:5432/ring?sslmode=disable"
  "$KUBECTL" -n ring create secret generic ring-secrets \
    --from-literal=SECRETS_KEY="$KEY" \
    --from-literal=POSTGRES_PASSWORD="$PW" \
    --from-literal=DATABASE_URL="$DBURL"
fi

echo "==> applying manifests for APP_HOST=$APP_HOST TURN_HOST=$TURN_HOST ACME=${ACME_DIRECTORY_URL:-letsencrypt-production}"
for f in 00-namespace 10-postgres 20-ringd 30-ingressroute-tcp 40-keel; do
  envsubst '${APP_HOST} ${TURN_HOST} ${ACME_EMAIL} ${ACME_DIRECTORY_URL}' < "$DIR/${f}.yaml" | "$KUBECTL" apply -f -
done

# A ConfigMap change does not restart the pod on its own (envFrom is read at boot).
# Roll the Deployment so a re-run that changes hosts / ACME env takes effect now.
"$KUBECTL" -n ring rollout restart deploy/ringd >/dev/null 2>&1 || true

# Keel (cluster-wide image auto-updater) is applied as plain manifests above
# (40-keel.yaml) - no Helm required. Wait for it so a fresh install reports a
# working updater rather than leaving it pending in the background.
echo "==> waiting for Keel"
"$KUBECTL" -n keel rollout status deploy/keel --timeout=120s || \
  echo "!!  Keel not ready yet; check: $KUBECTL -n keel logs deploy/keel"

cat <<EOF

Done. Next:
  1. Point DNS A/AAAA records at your cluster's ingress IP:
        ${APP_HOST}
        ${TURN_HOST}
  2. Watch it come up:        kubectl -n ring rollout status deploy/ringd
  3. First-run invite code:   kubectl -n ring logs deploy/ringd | grep FIRST-RUN
  4. Open https://${APP_HOST}, install the PWA, register with that code.

New :develop images now auto-deploy within ~2 minutes (Keel). To track stable
releases instead, edit 20-ringd.yaml: image tag -> :latest and keep keel policy force.
EOF
