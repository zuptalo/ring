# syntax=docker/dockerfile:1
#
# All-in-one Ring image: the Go backend (ringd) serving both the API and the
# built PWA on one origin. Three stages keep the final image small:
#   1. web    - build the Vue/Ionic PWA with Vite into dist/
#   2. server - compile a static ringd binary (CGO disabled, so it runs on alpine)
#   3. runtime- alpine with the binary + dist/, ringd serving the app at / via
#               STATIC_DIR and the API at /v1, /healthz, /v1/ws.
#
# Build (multi-arch): docker buildx build --platform linux/amd64,linux/arm64 \
#           -t ghcr.io/zuptalo/ring:develop --build-arg VERSION=develop --push .
# Run:    docker run -p 8080:8080 -e ENV=production \
#           -e DATABASE_URL=postgres://... -e PUBLIC_URL=https://ring.example.com \
#           -e SECRETS_KEY=$(openssl rand -hex 32) ghcr.io/zuptalo/ring:develop
#
# Stateless: all persistent state (incl. the server's secret material, encrypted
# at rest with SECRETS_KEY) lives in Postgres. No volume/mount is needed. Keep
# SECRETS_KEY stable and backed up; losing it makes the stored secrets unrecoverable.

# --- Stage 1: build the PWA -------------------------------------------------
# Pinned to the build host's native arch ($BUILDPLATFORM): the Vite output is
# arch-independent, so we build it once instead of emulating it per target.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
WORKDIR /web
# Install deps from the lockfile first so this layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci
# Then the source. `npm run build` runs vue-tsc (typecheck) then vite build.
COPY . .
# Stamp the SAME version into the PWA as the Go binary below, so the UI reports the
# true deployed version and can detect a newer one. Defaults to dev for plain builds.
ARG VERSION=dev
# Release notes JSON (base64-encoded to dodge quoting through the build-arg chain),
# the SAME value the Go binary gets below. The PWA bakes the decoded JSON into
# __RELEASE_NOTES__ as the "running" side of the What's-new delta. Defaults to [].
ARG RELEASE_NOTES_B64=''
RUN RING_VERSION="$VERSION" \
    RING_RELEASE_NOTES="$([ -n "$RELEASE_NOTES_B64" ] && printf '%s' "$RELEASE_NOTES_B64" | base64 -d || printf '[]')" \
    npm run build

# --- Stage 2: build the server ----------------------------------------------
# Also pinned to $BUILDPLATFORM and cross-compiled to the target arch via
# GOOS/GOARCH (CGO disabled), so the Go toolchain runs natively rather than under
# emulation. TARGETOS/TARGETARCH are provided automatically by buildx per target.
FROM --platform=$BUILDPLATFORM golang:1.26-bookworm AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
ARG VERSION=dev
# Already-base64 release notes JSON, stamped straight into main.releaseNotesB64
# (the server decodes it at boot and serves it at /v1/config). base64 needs no
# escaping in ldflags. Defaults to empty → no notes.
ARG RELEASE_NOTES_B64=''
ARG TARGETOS
ARG TARGETARCH
# Static, stripped binary. -trimpath keeps paths reproducible; the version is
# stamped into main.version for `ringd starting version=...` and ops visibility.
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.releaseNotesB64=${RELEASE_NOTES_B64}" \
    -o /out/ringd ./cmd/ringd

# --- Stage 3: runtime -------------------------------------------------------
# No --platform: this stage is the TARGET arch (linux/amd64 or linux/arm64). Only
# the small apk/adduser layer runs under emulation; the heavy builds above don't.
FROM alpine:3.20
# OCI labels. image.source links the GHCR package to its repo (and lets the
# package inherit the repo's access so Actions can publish with the default token).
LABEL org.opencontainers.image.source="https://github.com/zuptalo/ring" \
      org.opencontainers.image.url="https://github.com/zuptalo/ring" \
      org.opencontainers.image.title="Ring" \
      org.opencontainers.image.description="Private, end-to-end encrypted messenger and calling PWA with a Go backend, served as a single all-in-one image." \
      org.opencontainers.image.vendor="Zuptalo"
# ca-certificates: outbound TLS (Web Push, the emoji proxy). wget: healthcheck.
RUN apk add --no-cache ca-certificates wget tzdata \
    && addgroup -S ring && adduser -S -G ring -h /app ring
WORKDIR /app
COPY --from=server /out/ringd /app/ringd
COPY --from=web /web/dist /app/web
RUN chown -R ring:ring /app
# STATIC_DIR turns on single-container mode (ringd serves /app/web at /). The
# container is stateless: all persistence (including secrets, encrypted with
# SECRETS_KEY) is in Postgres, so no volume is needed.
ENV ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/web
USER ring
# 8080 HTTP (always). 8443 HTTPS + 3478 TURNS are used when ACME / calls are on.
EXPOSE 8080 8443 3478
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/app/ringd"]
