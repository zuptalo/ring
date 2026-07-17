# Contract: Seen Receipts — wire frame, relay, durable store, reconcile

Two interfaces change/extend. Both mirror the existing **delivered** machinery.

## 1. Receipt frame (WebSocket) — status value renamed

Existing `receipt` frame, with the seen status value renamed (hard cutover):

```jsonc
{ "t": "receipt", "messageId": "<id>", "status": "seen", "at": <ms>, "to": "<author>", "from": "<server-stamped sender>" }
```

- Client-originated statuses accepted by the server: **`"seen"` | `"downloaded"`**
  (was `"read"|"downloaded"`). `"sent"`/`"delivered"` from a client are still
  rejected (server-authoritative, anti-forgery — spec 2001).
- The server stamps `from` = the authenticated sender (the member who saw it) and
  live-relays to `to` (the message author), exactly as today.
- **NEW**: when `status == "seen"`, the server ALSO durably records it
  (`RecordSeen(author, sender, messageId, at)`) — the durable parallel of how the
  `ack` case calls `RecordDelivery`. `"downloaded"` is NOT recorded (unchanged).

## 2. `POST /v1/seen/check` — durable reconcile (mirror `/v1/deliveries/check`)

Request (the caller's own originated message ids):
```jsonc
{ "messageIds": ["<id1>", "<id2>", ...] }
```
Response (one entry per member who has seen each — like deliveries):
```jsonc
{ "seen": [ { "messageId": "<id>", "recipient": "<member>", "at": <ms> }, ... ] }
```

- Backed by `store.SeenFor(sender, msgIds)`.
- Client `api.ts checkSeen(ids)` → `SeenEntry{messageId, recipient, at}`.
- On reconnect, `useSync` replays each as a synthetic frame
  `{t:'receipt', status:'seen', messageId, at, from: recipient}` through the normal
  `applyReceipt` path → `applyGroupReceipt` stamps that member's `seenAt`. So
  "Seen X/N" is rebuilt after the sender was offline.
- `collectUnconfirmedOutgoing` also flags group messages with any `receipts[]`
  entry missing `seenAt` (in addition to the existing missing-`deliveredAt`), so
  they're included in the check.

## Privacy (client-enforced; server is unaware)

- A recipient with `privacy.seenReceipts` **off** never sends a `seen` receipt →
  the server never relays or records it → the author never sees them reach seen
  (they stay counted as delivered). The store has no preference column.
- Reciprocity is a client display gate (off ⇒ the author's own messages don't show
  the seen tier). Not a wire/server concern.

## Test contract

- `store/seen.go` (fake + real): `RecordSeen` is idempotent; `SeenFor` returns one
  row per member for a group msg.
- `hub.go` "receipt" case: a client `seen` receipt is relayed `from`-stamped to the
  author AND recorded; a client `read`/`sent`/`delivered` is dropped (anti-forgery
  / post-cutover); `downloaded` relays but is NOT recorded.
- `POST /v1/seen/check`: returns per-member seen entries for the caller's messages;
  empty for unknown/foreign ids.
