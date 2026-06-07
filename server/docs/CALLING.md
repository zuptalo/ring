# Enabling voice & video calling in production

Ring's calling is **fully self-hosted**: the `ringd` process embeds a TURN relay
and a group-call SFU - no external STUN/TURN/SFU services. This doc covers what
the deployment needs so calls work for real users over the public URL.

It applies to a deployment fronted by a **layer-4 (SNI-routable) proxy/tunnel**
on a single public `:443` (the `ring-dev.zuptalo.com` setup). If your front proxy
is HTTP-only (e.g. Synology DSM's reverse proxy or nginx-proxy-manager), front it
with a small dedicated L4 edge proxy - see section 3.

---

## How calling reaches the server (the one thing to get right)

WebRTC media can't go through a normal HTTPS reverse proxy (that proxy terminates
TLS and speaks HTTP; it can't carry the raw TLS/UDP streams media needs). Ring
solves this by sending **all** call media over **TURN-over-TLS (TURNS) on 443**:

```
            ┌─────────── :443 (public) ───────────┐
            │   L4 SNI router (TLS passthrough)    │
            └───────┬──────────────────────┬───────┘
   SNI = app host   │                      │  SNI = turn.<host>
        (HTTPS)     ▼                      ▼  (raw TLS, passthrough)
              web reverse proxy        ringd TURNS listener  (terminates TLS)
              (app + /v1 API)          internal :3478
```

- **1:1 calls** are peer-to-peer (DTLS-SRTP, natively E2EE); media is relayed
  through the TURN only when a direct path is blocked.
- **Group calls** go through the embedded SFU, reached *through* the same TURN.
  Media stays E2EE from the SFU via insertable streams.

Because TURNS is TLS, it carries an **SNI** the L4 router can switch on. The
router must do **SNI-based TLS passthrough**: forward `turn.<host>:443` to
ringd's internal TURNS listener (ringd terminates the TLS with its cert), and
send every other SNI to the existing web proxy.

> **Why `RELAY_IP` is loopback (not the public IP):** every participant tunnels
> into the *same* embedded TURN over 443, and the relay-to-relay hop happens
> inside the `ringd` process - it never leaves the host. So the relay address
> only needs to be locally deliverable. `RELAY_IP` defaults to `127.0.0.1`;
> leave it unset. (This is exactly what the e2e tests exercise.)

### Choosing the TURN hostname (and censorship resistance)

The TURN host is yours to name; it appears as the **SNI in the TLS ClientHello**,
so in censored networks pick a **neutral name** (e.g. `m.<domain>`) rather than
`turn.<domain>` to avoid SNI-keyword blocking. What actually defeats DPI is that
the media rides **TURNS on 443**, byte-for-byte indistinguishable from HTTPS - a
"discreet" non-443 port does **not** help (censors fingerprint the TURN protocol
regardless of port and routinely drop UDP / non-443 ports). Set this name as
`TURN_HOST` and use it in the SNI rule below.

---

## Requirements checklist

1. **DNS** - `turn.ring-dev.zuptalo.com` → the deployment's `:443`.
2. **TLS cert** for `turn.ring-dev.zuptalo.com` (or a cert whose SAN covers it),
   readable by `ringd` - **or** `ACME=true` to let ringd issue it automatically
   (see "Auto-TLS" below).
3. **L4 SNI passthrough** rule: `turn.<host>:443` → `ringd:3478` (raw TCP).
4. **ringd env** (below) with `ENABLE_CALLS=true` and the cert source.
5. `ALLOWED_ORIGINS` includes the app origin (`https://ring-dev.zuptalo.com`) - it
   already does in the current `server/.env`.

---

## Auto-TLS (ACME) - recommended

Set **`ACME=true`** and ringd provisions and renews its own Let's Encrypt certs
(Go autocert, **TLS-ALPN-01**) for **both** the HTTPS app listener (`TLS_PORT`,
default `:8443`) and the TURNS listener - no cert files, no renewal chores. The
account key + certs are cached **encrypted in Postgres** (`acme_cache`, with
`SECRETS_KEY`), so the container stays stateless. Deploy becomes "point DNS at
the box":

```bash
ENABLE_CALLS=true
ACME=true
ACME_EMAIL=you@example.com            # optional account contact
TURN_HOST=m.ring-dev.zuptalo.com      # neutral SNI for the TURNS host
# TLS_PORT=8443                         # the HTTPS app port the proxy passes through to
# ACME_DIRECTORY_URL=...staging...      # use LE staging first to avoid rate limits
```

With ACME on, the L4 SNI proxy is a **pure passthrough** for both hosts (no certs
in the proxy): app host `:443` → `ringd:8443`, TURN host `:443` → `ringd:3478`.
Because validation is **TLS-ALPN-01 on `:443`**, those hosts' public `:443` must
reach ringd **un-terminated** (an SNI-passthrough proxy, not a TLS-terminating
one). Behind a proxy that terminates TLS (Synology DSM, nginx-proxy-manager),
leave ACME off and use `:8080` + the proxy's own cert, per the manual sections
below. autocert renews automatically; nothing to restart.

> **Staging → production cutover (no manual cleanup):** test against LE staging
> first (`ACME_DIRECTORY_URL` above) to avoid rate limits, then **delete that line
> and restart**. ringd namespaces cached certs by ACME environment (the
> `acme_cache` keys are prefixed `le-staging/` vs `le-prod/`), so switching is a
> clean re-issue: the production manager sees a cache miss and mints a real cert
> on the next handshake, and a startup sweep drops the leftover staging cert +
> account key. You can confirm the environment of what's cached with
> `SELECT key FROM acme_cache;`.

---

## 1. TLS certificate for the TURN host (manual / static cert alternative)

ringd terminates the TLS for `turn.<host>`, so it needs the cert + key. Because
`:443` is SNI-passthrough'd to ringd, HTTP-01 validation to that host won't hit
an HTTP server - use **DNS-01**, e.g.:

```bash
certbot certonly --dns-<provider> -d turn.ring-dev.zuptalo.com
# → /etc/letsencrypt/live/turn.ring-dev.zuptalo.com/{fullchain,privkey}.pem
```

Or, if your app cert already covers `turn.<host>` (wildcard `*.ring-dev.zuptalo.com`
or an explicit SAN), point ringd at that PEM pair.

ringd loads the cert **at startup**; on renewal, restart ringd.

---

## 2. ringd environment

Set these wherever `ringd`'s environment is defined (e.g. `server/.env`, sourced
by the Makefile, or the service unit):

```bash
ENABLE_CALLS=true
TURN_HOST=turn.ring-dev.zuptalo.com     # default: turn.<PUBLIC_URL host>
TURN_LISTEN=:3478                        # internal port the L4 router forwards to
TURN_TLS_CERT=/etc/letsencrypt/live/turn.ring-dev.zuptalo.com/fullchain.pem
TURN_TLS_KEY=/etc/letsencrypt/live/turn.ring-dev.zuptalo.com/privkey.pem
# RELAY_IP - leave unset (defaults to 127.0.0.1; see note above)
# TURN_REALM - leave unset (defaults to the PUBLIC_URL host)
```

With `TURN_TLS_CERT`/`KEY` set, ringd starts the TURN listener in **TLS mode** and
the `GET /v1/turn-credentials` endpoint advertises `turns:turn.<host>:443?transport=tcp`.
On boot you'll see:

```
INFO TURN relay ready   listen=:3478 ... url="turns:turn.ring-dev.zuptalo.com:443?transport=tcp" tls=true
INFO group-call SFU ready relayVia="turn:127.0.0.1:<port>?transport=udp"
```

---

## 3. L4 SNI passthrough rule

Route the TURN host's `:443` to ringd's TURNS listener (e.g. `127.0.0.1:3478`),
passing the TLS through untouched. Pick the one matching your proxy:

> **If your existing reverse proxy is HTTP-only** (Synology DSM, nginx-proxy-manager):
> it terminates TLS and can't passthrough, so it can't be this router. Run one of the
> configs below as a **dedicated edge proxy that owns `:443`** (a separate box, or in
> front of the NAS): send the TURN SNI to ringd's TURNS listener and point the
> **default backend at your existing proxy's TLS port** (passthrough) so it keeps
> serving everything else unchanged. Note the app host and the TURN host are
> **different ports on ringd**: HTTP `:8080` (the edge proxy terminates TLS and forwards
> HTTP) vs TURNS `:3478` (raw TLS passthrough; ringd terminates). With this, only `:443`
> stays internet-facing - ringd's `:8080`/`:3478` are reached over the LAN.

### nginx (`stream` + `ssl_preread`)

```nginx
stream {
  map $ssl_preread_server_name $upstream {
    turn.ring-dev.zuptalo.com  ringd_turn;
    default                    web_tls;     # your existing HTTPS backend
  }
  upstream ringd_turn { server 127.0.0.1:3478; }
  upstream web_tls    { server 127.0.0.1:8443; }   # the web reverse proxy's TLS port
  server {
    listen 443;
    ssl_preread on;
    proxy_pass $upstream;
  }
}
```

### Traefik (TCP router, TLS passthrough)

```yaml
tcp:
  routers:
    ring-turn:
      entryPoints: [websecure]            # :443
      rule: "HostSNI(`turn.ring-dev.zuptalo.com`)"
      tls: { passthrough: true }
      service: ring-turn
  services:
    ring-turn:
      loadBalancer:
        servers: [{ address: "127.0.0.1:3478" }]
```

(The app's normal HTTP routers on the same `websecure` entrypoint keep handling
every other SNI.) On Pangolin/Newt-tunneled setups, expose `turn.<host>` as a
**raw TCP / TLS-passthrough** resource pointing at `ringd:3478` - not an HTTP one.

### HAProxy

```haproxy
frontend https
  bind :443
  mode tcp
  tcp-request inspect-delay 5s
  tcp-request content accept if { req_ssl_hello_type 1 }
  use_backend turn if { req_ssl_sni -i turn.ring-dev.zuptalo.com }
  default_backend web
backend turn
  mode tcp
  server ringd 127.0.0.1:3478
backend web
  mode tcp
  server web 127.0.0.1:8443
```

### Caddy (`caddy-l4` plugin)

```caddyfile
{
  layer4 {
    :443 {
      @turn tls sni turn.ring-dev.zuptalo.com
      route @turn { proxy 127.0.0.1:3478 }
      route       { proxy 127.0.0.1:8443 }   # hand the rest to your HTTPS backend
    }
  }
}
```

> Cloudflare's standard HTTP proxy can't pass arbitrary TLS streams. To front
> TURNS through Cloudflare you'd need Spectrum (TCP) or a direct/Tunnel TCP
> route; otherwise terminate TURNS on a host the L4 rule can reach directly.

---

## 4. Verify

1. **TLS reaches ringd** (SNI passthrough + cert):
   ```bash
   openssl s_client -connect ring-dev.zuptalo.com:443 -servername turn.ring-dev.zuptalo.com
   # → presents the turn.<host> certificate (served by ringd), handshake OK
   ```
2. **Credentials endpoint** (with a bearer token from a registered account):
   ```bash
   curl -s https://ring-dev.zuptalo.com/v1/turn-credentials -H "Authorization: Bearer <token>" | jq
   # → { "iceServers":[{ "urls":["turns:turn.ring-dev.zuptalo.com:443?transport=tcp"], ... }], ... }
   ```
   and `GET /v1/config` shows `"callsEnabled": true`.
3. **Relay candidate gathers** - paste the iceServers entry into
   <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>;
   you should get a `relay` candidate and "Done".
4. **A real call** between two devices/accounts: place a 1:1 call (connects,
   audio/video both ways, clean hang-up), then a group call from a group chat
   (each participant sees the others). Chromium/Edge required for group (E2EE
   insertable streams); 1:1 works in every browser.

---

## Notes & limits

- **Group E2EE browser support:** group calls need `createEncodedStreams`
  (Chromium/Edge). Other browsers are blocked from group calls with a message;
  1:1 works everywhere.
- **Group key distribution** is peer-to-peer over each pair's 1:1 ratchet, so all
  group members must be mutual contacts (have exchanged friend requests).
- **Background ringing** is best-effort on the web: the server briefly buffers an
  offer and the Web Push tickle wakes a backgrounded-but-alive client to
  reconnect and ring. A fully-closed app shows the OS notification; tapping it
  opens the app (the offer may have expired if that takes too long).
- **Local development** needs none of this: `ringd` runs the TURN in plaintext on
  `:3478` and advertises `turn:127.0.0.1:3478`, reachable by a localhost browser
  (this is what `npm run test:e2e` uses).
