# Phase 1 Contracts: HTTP / WS API

New endpoints for posts + engagement. All bodies carry **ciphertext or capability ids only** (no
plaintext). Auth is the existing bearer token on `/v1/*`; the WS authenticates via `?token=`.
Friendship reuses the **existing** `/v1/connections/*` endpoints unchanged (see research R1).

Conventions: stdlib `net/http` method+pattern routes; handlers depend on a new small `PostStore`
interface defined in `router.go` and satisfied by `*store.Store`; unit-tested against the fake store.

## Posts

### `POST /v1/posts`
Create a post. Server stores the opaque payload reference + per-recipient envelopes and addresses
delivery to the recipients.

Request:
```json
{
  "id": "uuid",
  "blobId": "cap-id-of-Kpost-sealed-payload",
  "size": 12345,
  "expiresAt": 1750000000000,        // optional; omit = keep
  "envelopes": [
    { "recipient": "userId", "wrappedKey": "b64url" }
  ]
}
```
Response: `201 Created` `{ "id": "uuid" }`.
Server MUST: verify each `recipient` is an accepted connection of the author and not blocked; reject
otherwise. Server MUST NOT learn the audience tier (it only sees a recipient set).

### `GET /v1/posts?since=<cursor>`
Pull posts addressed to the caller (envelopes where `recipient = me`) plus the caller's own posts,
newest-first, with a cursor.

Response:
```json
{
  "posts": [
    { "id": "uuid", "author": "userId", "blobId": "cap", "size": 123,
      "createdAt": 1750000000000, "expiresAt": 1750086400000,
      "wrappedKey": "b64url" }                 // the caller's envelope (omitted for own posts)
  ],
  "cursor": "opaque"
}
```

### `DELETE /v1/posts/{id}`
Author deletes their post. Server removes the post, its envelopes, and engagement, and signals
recipients (best-effort tombstone). Only the author may delete.

## Engagement (reactions / comments / tombstones)

### `POST /v1/posts/{id}/engagement`
Submit one engagement item; the server fans it out to the post's stored audience.

Request:
```json
{
  "id": "uuid",
  "kind": "reaction | comment | tombstone",
  "payload": "b64url-Kpost-sealed"   // emoji / comment text / delete-target, sealed under K_post
}
```
Response: `201 Created`.
Server MUST: verify the submitter ∈ (post audience ∪ author) and not blocked; deliver the opaque
`payload` to every `post_envelopes.recipient` of `{id}` (plus the author). Server MUST NOT read
`payload`. Reaction caps + LWW-per-actor are enforced **client-side** (the server only relays).

### `GET /v1/posts/{id}/engagement?since=<cursor>`
Pull engagement for a post the caller is in the audience of (or authored). Returns opaque items the
client decrypts under `K_post`.

## Views (author-only receipts)

### `POST /v1/posts/{id}/view`
Record that the caller viewed the post (delivered to the author only). Caller sends this **only if**
their `privacy.seenReceipts` is on (client-gated). Idempotent per (post, viewer).
Response: `204 No Content`.

### `GET /v1/posts/{id}/views`
Author-only: list viewers of the author's own post. `403` if caller is not the author.
```json
{ "views": [ { "viewer": "userId", "viewedAt": 1750000000000 } ] }
```

## WS frames (live nudges; reconcile via GET)

Reuse the existing content-free tickle pattern (`connect-req`/`connect-update`). Add:
- `post-new` `{ "t": "post-new", "from": "authorId" }` — a post addressed to you arrived; client pulls
  `GET /v1/posts`.
- `post-engagement` `{ "t": "post-engagement", "post": "postId" }` — engagement on a post you can see;
  client pulls `GET /v1/posts/{id}/engagement`.

Frames carry **no content** — only a nudge to sync, consistent with Principle I and the existing
connection/notification model.

## Zero-knowledge contract checks (for tests)

- No endpoint accepts or returns post/comment/reaction **plaintext** or media keys outside a sealed
  `blobId`/`payload`.
- `POST /v1/posts` envelopes reveal a recipient set but **not** the tier (friends vs close).
- `POST /v1/posts/{id}/engagement` is rejected for non-audience submitters and blocked users.
- `GET /v1/posts/{id}/views` is author-only.
