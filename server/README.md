# Ring backend (`ringd`)

Go backend for the Ring PWA. **Milestone 7a (Foundation):** accounts -
invitation-code registration and bearer-token auth - on PostgreSQL.

**Zero-knowledge by design:** the server only ever relays sealed envelopes and
stores opaque ciphertext (later milestones). It never sees plaintext message
bodies, contacts, profile data, or media. The 7a schema holds only account ids,
invitation bookkeeping, and **token hashes** (never plaintext tokens).

## Stack
- Go 1.26, standard-library `net/http` routing (no web framework)
- PostgreSQL 18 via `pgx` v5
- Embedded SQL migrations (no external migration tool)

## Run

1. Start PostgreSQL 18. Either:
   - **Docker:** `make db-up` (uses `docker-compose.yml`), or
   - **Local:** Postgres.app or Homebrew `postgresql@18`, then create the role/db:
     ```sh
     createuser ring --pwprompt        # password: ring
     createdb -O ring ring
     ```
2. Start the server (applies migrations + seeds dev invite codes):
   ```sh
   make run        # or: go run ./cmd/ringd
   ```
   You should see `listening addr=:8080 env=dev` and the seeded codes.

Configuration is via environment variables (see `.env.example`); the built-in
defaults work for local dev.

### Zero-config secrets & first-run

In production the inputs you must provide are **`DATABASE_URL`** (an external
Postgres - point it at an **empty** database and a role that may create tables;
the server runs all migrations on boot), **`PUBLIC_URL`** (the externally-
reachable URL), and **`SECRETS_KEY`**. The server fails fast with a clear message
if any is missing when `ENV!=dev`. The container is **stateless** - everything
persists in Postgres, no data volume:

- **Server secrets** (`server_secrets` table) - VAPID keypair for Web Push, a
  token-signing key, and the TURN shared secret. Generated on first boot and
  stored **encrypted at rest** (AES-256-GCM) with a key derived from
  **`SECRETS_KEY`** (`openssl rand -hex 32`), so a database dump on its own cannot
  use them. Keep `SECRETS_KEY` stable + backed up; changing/losing it makes the
  stored secrets unrecoverable (regenerated → tokens + push subscriptions
  invalidated). Forward-compatible (new secret types fill in on the next boot).
  A one-time `LEGACY_SECRETS_FILE=/path/secrets.json` imports an old on-disk
  secrets file into the DB instead of generating fresh keys.
- **First-run invitation code** - when the system has zero accounts, a code is
  ensured (reused if a claimable one exists, else minted) and logged
  (`FIRST-RUN … code=…`). It lives in the `invitations` table; nothing on disk.

Clients can self-configure from **`GET /v1/config`** → `{publicUrl,
vapidPublicKey}` (public, no auth).

## Invitation codes
Registration always requires a code. To avoid a chicken-and-egg on a fresh
system, on every boot **with zero accounts** the server ensures at least one
claimable code exists - minting one and logging it (`FIRST-RUN … code=XXXXXXXX`)
if none are present. This runs in all environments and becomes a no-op once the
first user registers.

In `ENV=dev` a fixed batch of 8-char codes is also seeded for convenience
(registering extra test accounts): `RINGDEV1`…`RINGDEV9`, `TESTCODE`. All codes
are single-use. (Codes are 8 chars because the register UI requires exactly 8.)

## API

### Accounts (7a)
| Method | Path           | Auth   | Body / result |
| ------ | -------------- | ------ | ------------- |
| GET    | `/healthz`     | none   | `{"status":"ok","db":"up"}` (503 if DB down) |
| POST   | `/v1/register` | none   | `{"invitationCode":"RING01"}` → `{"token","userId"}` |
| POST   | `/v1/invitations` | bearer | Mint a single-use invite code to share → `{"code","publicUrl"}` (per-user cap on unused invites) |
| POST   | `/v1/session`  | bearer | → `{"userId"}` (verifies token, bumps last-seen) |
| GET    | `/v1/me`       | bearer | → `{"userId"}` |

### Relay (7c)
| Method | Path      | Auth | Notes |
| ------ | --------- | ---- | ----- |
| GET    | `/v1/ws`  | `?token=` query | WebSocket. Frames: C→S `msg{id,to,ciphertext}` / `ack{refId}` / `receipt{to,...}`; S→C `msg{id,from,ciphertext}` / `receipt{messageId,status}`. Messages for offline recipients are durably queued and drained on connect; ciphertext is opaque (never read by the server). |

### Media blobs (7d)
| Method | Path             | Auth   | Notes |
| ------ | ---------------- | ------ | ----- |
| POST   | `/v1/blobs`      | bearer | Body = raw ciphertext (`application/octet-stream`, ≤25 MiB) → `{"blobId"}`. |
| GET    | `/v1/blobs/{id}` | bearer | Returns the ciphertext bytes. The id is an unguessable capability (any authed user holding it may fetch - that's how a recipient gets an attachment). 404 if unknown. |

### Web Push (7f)
| Method | Path                   | Auth   | Notes |
| ------ | ---------------------- | ------ | ----- |
| POST   | `/v1/push/subscribe`   | bearer | `{endpoint,keys:{p256dh,auth}}` - register a browser push subscription. |
| POST   | `/v1/push/unsubscribe` | bearer | `{endpoint}` - remove it. |

When the relay can't deliver a message to a live connection (recipient offline),
it sends a VAPID-signed, **content-free** push tickle to the recipient's
subscriptions; the app shows a generic "New message" and fetches the real E2EE
content over the relay (push services never see content). Dead endpoints
(404/410) are pruned automatically.

### Encrypted sync + recovery (7e)
| Method | Path             | Auth   | Notes |
| ------ | ---------------- | ------ | ----- |
| POST   | `/v1/sync/push`  | bearer | `{records:[{store,recordId,updatedAt,ciphertext,deleted}]}` → `{cursor}`. Opaque ciphertext; last-write-wins on `updatedAt`. |
| GET    | `/v1/sync/pull`  | bearer | `?cursor=N` → `{records:[{...,seq}],cursor}` (records with seq > cursor). |
| PUT    | `/v1/recovery`   | bearer | `{salt,envelope}` - store the recovery-code-sealed identity wrap. |
| GET    | `/v1/recovery`   | bearer | → `{salt,envelope}` (404 if none). For new-device restore. |

### Prekeys (7b)
All public key material; the server stores/serves but never verifies signatures.
| Method | Path                | Auth   | Body / result |
| ------ | ------------------- | ------ | ------------- |
| PUT    | `/v1/keys`          | bearer | Publish/rotate: `{edPub,xPub,signedPreKey{id,pub,sig},oneTimePreKeys[{id,pub}]}` → `{"oneTimePreKeys":N}` |
| POST   | `/v1/keys/onetime`  | bearer | Replenish: `{oneTimePreKeys:[{id,pub}]}` → `{"oneTimePreKeys":N}` |
| GET    | `/v1/keys/count`    | bearer | → `{"oneTimePreKeys":N}` (remaining in caller's pool) |
| GET    | `/v1/keys/{userId}` | bearer | Peer bundle for X3DH; **consumes one** one-time prekey → `{userId,edPub,xPub,signedPreKey{…},oneTimePreKey?{…}}` (`oneTimePreKey` omitted when pool empty; 404 if user never published) |

### Quick check
```sh
curl -s localhost:8080/healthz
# {"status":"ok","db":"up"}

TOKEN=$(curl -s -XPOST localhost:8080/v1/register \
  -d '{"invitationCode":"RING01"}' | jq -r .token)

curl -s localhost:8080/v1/me -H "Authorization: Bearer $TOKEN"
# {"userId":"..."}

# Reusing a claimed code → 400; a bogus token → 401.
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:8080/v1/register -d '{"invitationCode":"RING01"}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/v1/me -H "Authorization: Bearer nope"
```

## Test
```sh
make test       # go test ./...  (uses an in-memory fake store; no DB needed)
make vet
```

## Layout
```
cmd/ringd            entrypoint (config → pool → migrate → router → graceful shutdown)
internal/config      env-based configuration
internal/db          pgx pool + embedded migration runner (internal/db/migrations)
internal/auth        token mint/hash + bearer auth middleware
internal/httpx       JSON responders + logging/recovery/CORS middleware
internal/store       PostgreSQL repositories
internal/api         routing + handlers
```

## Status
Milestones 7a-7f are implemented and tested (accounts, prekeys, relay, blobs,
encrypted sync + recovery, Web Push). Possible follow-ups: production
TLS/deployment, group messaging over the relay, multi-device restore UI, admin
issuance of invitation codes, and migrating blob storage to object storage.

## License
Part of Ring, licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0-only). See the root [`LICENSE`](../LICENSE) for the full text.

Copyright (C) 2026 Zuptalo
