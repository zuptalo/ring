#!/usr/bin/env bash
# Idempotent installer for Ring on a fresh k3s cluster (calls enabled, Keel
# auto-updates from ghcr.io/zuptalo/ring:develop). Re-runnable: it never rotates
# the existing SECRETS_KEY / DB password.
#
#   APP_HOST=ring.example.com ACME_EMAIL=you@example.com ./install.sh
#
# Optional: TURN_HOST (defaults to turn.$APP_HOST), KUBECTL (defaults to kubectl).
set -euo pipefail

: "${APP_HOST:?set APP_HOST, e.g. APP_HOST=ring.example.com}"
: "${ACME_EMAIL:?set ACME_EMAIL, e.g. ACME_EMAIL=you@example.com}"
: "${TURN_HOST:=turn.${APP_HOST}}"
KUBECTL="${KUBECTL:-kubectl}"
DIR="$(cd "$(dirname "$0")" && pwd)"
export APP_HOST TURN_HOST ACME_EMAIL

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

echo "==> applying manifests for APP_HOST=$APP_HOST TURN_HOST=$TURN_HOST"
for f in 00-namespace 10-postgres 20-ringd 30-ingressroute-tcp; do
  envsubst '${APP_HOST} ${TURN_HOST} ${ACME_EMAIL}' < "$DIR/${f}.yaml" | "$KUBECTL" apply -f -
done

# Keel (cluster-wide image auto-updater). Installed via Helm if available; the
# Deployment is annotated either way, so you can also install Keel later.
if ! "$KUBECTL" get ns keel >/dev/null 2>&1; then
  if command -v helm >/dev/null; then
    echo "==> installing Keel via Helm"
    helm repo add keel https://charts.keel.sh >/dev/null 2>&1 || true
    helm repo update >/dev/null
    helm upgrade --install keel keel/keel --namespace keel --create-namespace
  else
    echo "!!  Helm not found - install Keel yourself so auto-updates work:"
    echo "      helm repo add keel https://charts.keel.sh && helm repo update"
    echo "      helm upgrade --install keel keel/keel -n keel --create-namespace"
  fi
else
  echo "==> Keel already installed"
fi

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
