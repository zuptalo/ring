# Ring

**A private, end-to-end-encrypted messenger and calling app** — shipped as one small,
stateless container that serves an installable PWA and its Go backend. The server only
ever relays sealed envelopes and stores opaque ciphertext: it never sees message bodies,
contacts, profiles, or media.

- 🔒 **Zero-knowledge** — Double Ratchet / X3DH E2EE (libsodium); the server is blind to plaintext.
- 📱 **Installable PWA** — Vue 3 + Ionic, offline-first, Web Push.
- 📞 **1:1 & group calls** — WebRTC with an embedded TURN relay + SFU, E2EE media.
- 🗂️ **One stateless image** — all state (including encrypted-at-rest secrets) lives in PostgreSQL.
- 🪪 **AGPL-3.0**, self-hostable, invite-only.

## Quick start

```sh
export PUBLIC_URL=https://ring.example.com
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export SECRETS_KEY=$(openssl rand -hex 32)   # keep this stable + backed up
docker compose up -d
```

Then grab the first-run invite code:

```sh
docker compose logs ring | grep FIRST-RUN
```

The container is **stateless** — on first boot it generates its own secrets (VAPID,
token-signing, TURN) and stores them **encrypted in Postgres** under `SECRETS_KEY`, so
only the database needs a volume. Full compose file, TLS/calling scenarios, configuration,
and backups: see the [GitHub repository](https://github.com/zuptalo/ring).

## Tags

| Tag | What it is |
| --- | --- |
| `latest`, `X.Y.Z`, `X.Y` | Production releases. |
| `X.Y.Z-rc.N` | Immutable release candidates (never moves `latest`). |
| `develop`, `develop-<sha>` | Rolling development build. |

Images are multi-arch (`linux/amd64`, `linux/arm64`). The canonical registry is
`ghcr.io/zuptalo/ring`; this Docker Hub repo mirrors the same tags.

## Screenshots

<p>
  <img src="https://raw.githubusercontent.com/zuptalo/ring/develop/showcase/output/iphone/light/02-chats.png" width="240" alt="Chats" />
  <img src="https://raw.githubusercontent.com/zuptalo/ring/develop/showcase/output/iphone/light/03-chat.png" width="240" alt="Conversation" />
  <img src="https://raw.githubusercontent.com/zuptalo/ring/develop/showcase/output/iphone/dark/06-group.png" width="240" alt="Group chat (dark)" />
</p>

## Support

Ring is free and open-source, with no paywall. If it's useful to you, you can chip in
whatever you think it's worth: **[Ko-fi](https://ko-fi.com/zuptalo)** ·
**[Liberapay](https://liberapay.com/zuptalo)** ·
**[GitHub Sponsors](https://github.com/sponsors/zuptalo)**.

## License

[AGPL-3.0-only](https://github.com/zuptalo/ring/blob/develop/LICENSE). © 2026 Zuptalo.
