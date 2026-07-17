# Contract delta — `POST /v1/push/subscribe`

The only wire-contract change. The endpoint, auth (Bearer), and existing fields are
unchanged; **two optional fields are added** to the request body. No response change.

## Request body (additions in **bold**)

```jsonc
{
  "endpoint": "https://push.example/...",   // existing, required
  "keys": {
    "p256dh": "<base64url>",                // existing, required
    "auth":   "<base64url>"                 // existing, required
  },
  "installedVersion": "0.1.0-dev.131+abc1234",  // NEW, optional — the client's __APP_VERSION__
  "tzOffsetMinutes": -120                        // NEW, optional — new Date().getTimezoneOffset()
}
```

### Field rules
- `installedVersion` (optional, string): the running client build. Sent by the page on
  subscribe/foreground. Omitted by the service-worker resubscribe path.
- `tzOffsetMinutes` (optional, integer): JS `getTimezoneOffset()` (minutes; `UTC − local`,
  e.g. EST → `300`, CEST → `-120`). Omitted by the SW resubscribe path.
- **Omission semantics**: when a field is absent, the server preserves the previously stored
  value for that subscription (COALESCE upsert). Sending both keeps them current; the SW's
  version-less resubscribe never clears them.
- These fields are **not** secret, but they are metadata — the server stores only these two
  coarse values (plus a server-written `last_announced_version`) and nothing more
  (NFR-ZK-002).

## Response
Unchanged (e.g. `204 No Content` / existing success). No new response fields.

## Behavioral contract (server-internal, no external endpoint)
- A periodic job sends the existing content-free `{"t":"version"}` Web Push **only** to
  subscriptions that are behind the current server version, **at the device's local 09:00**,
  with a **short TTL** (expires by ~local midday), **once per current version**
  (`last_announced_version`).
- There is **no** immediate broadcast on deploy and **no** new client-facing endpoint for
  scheduling — it is entirely server-side off the stored subscription metadata.
