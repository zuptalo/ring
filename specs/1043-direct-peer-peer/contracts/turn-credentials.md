# Contract: GET /v1/turn-credentials (spec 1043)

Bearer-authenticated. Issues ephemeral ICE configuration for calling clients. **Response shape is unchanged by this feature**; the `iceServers` array gains an optional additional element.

## Request

```
GET /v1/turn-credentials
Authorization: Bearer <token>
```

## Response — today (and after upgrade with no new config)

```json
{
  "iceServers": [
    {
      "urls": ["turns:ring.example.com:443?transport=tcp"],
      "username": "1752300000:u_abc123",
      "credential": "<hmac>"
    }
  ],
  "ttl": 3600
}
```

## Response — UDP endpoint configured (`TURN_UDP_LISTEN` set)

```json
{
  "iceServers": [
    {
      "urls": [
        "turns:ring.example.com:443?transport=tcp",
        "turn:ring.example.com:3478?transport=udp"
      ],
      "username": "1752300000:u_abc123",
      "credential": "<hmac>"
    },
    {
      "urls": ["stun:ring.example.com:3478"]
    }
  ],
  "ttl": 3600
}
```

## Rules

- The credentialed entry always exists and always includes the TURNS-on-443 URL (the universal fallback). The `turn:...?transport=udp` URL joins the same credentialed entry (same REST credentials validate on both listeners).
- The `stun:` entry, when present, carries **no** `username`/`credential` (STUN Binding is unauthenticated address discovery).
- `ttl` stays 3600 (1 hour), credentials time-windowed via the coturn REST scheme from `TURN_SHARED_SECRET`.
- Error cases unchanged: `503` when calling is disabled on the server, `401` when unauthenticated.

## Compatibility matrix

| Client | Server | Result |
|--------|--------|--------|
| old (relay-only policy) | new, UDP configured | extra entries unused under `'relay'` policy; calls unchanged |
| new (`'all'` policy) | old (single turns entry) | no stun entry → LAN-direct (mDNS host) + relay fallback |
| new | new, UDP not configured | same as above — identical to old-server behavior |
| new | new, UDP configured | full behavior: host + srflx + relay candidates |

## Client-side consumption

`getTurnConfig()` (`src/services/call/turn.ts`) already passes `data.iceServers` through verbatim to `RTCPeerConnection` — no client parsing change needed for the new entry. The only client change is the ICE policy in `rtcConfig()`/`callRtcConfig()`.
