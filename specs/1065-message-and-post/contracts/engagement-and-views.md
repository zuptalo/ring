# Contract: engagement paging, wake hints, and views (spec 1065)

Only the deltas from today's behaviour are specified. Everything not mentioned
is unchanged. All routes stay behind `authMW` and keep their existing
`CanSeePost` audience gate.

## 1. `GET /v1/posts/{id}/engagement` — paging added

**Today**: returns every engagement row a post has ever accumulated,
`ORDER BY created_at ASC`, no limit.

**New query parameters** (both optional, additive):

| param | type | default | meaning |
|---|---|---|---|
| `limit` | int, 1..200 | 200 | maximum rows to return |
| `before` | string | absent | keyset cursor from a previous response |

**Response**:

```json
{
  "items": [ { "id": "...", "actor": "...", "kind": "comment",
               "payload": "...", "createdAt": 1753900000000 } ],
  "cursor": "1753899000000.0f3a…",
  "hasMore": true
}
```

- With no `limit` and no `before`, behaviour is **unchanged** except that at
  most 200 rows come back and `hasMore` tells the caller there is more. Existing
  clients that ignore `cursor`/`hasMore` keep working.
- When paging, rows are returned **newest first** so the first page is the one
  the UI needs. `cursor` is an opaque encoding of the last row's
  `(created_at, id)`; passing it as `before` returns the next older page.
- `cursor` is absent when `hasMore` is false.

**Errors**: `400` on an unparseable `before` or an out-of-range `limit`; the
existing `403 not in this post's audience` is unchanged.

**Backing index**: `post_engagement_page_idx (post_id, created_at, id)`, added by
a new forward-only migration. The keyset predicate is
`(created_at, id) < (cur_created_at, cur_id)`.

## 2. `POST /v1/posts/{id}/engagement` — `notify` added

**New request field**:

```json
{ "id": "uuid", "kind": "comment", "payload": "…", "notify": ["uuid"] }
```

`notify` is the FR-031b wake hint: the users the server should push, because it
cannot read the sealed parent that determines who ought to be woken.

**Validation, all server-side, all mandatory**:

| rule | failure |
|---|---|
| each entry parses as a UUID | `400 bad notify` |
| each entry satisfies `CanSeePost(postID, entry)` | `400 notify outside audience` |
| at most 2 entries | `400 notify too long` |
| the submitting actor is removed from the list | silent, never an error |

**Effect**: for `kind` in `{comment, reaction}`, the push target set becomes
`{post author} ∪ notify` instead of `{post author}`. The `game`, `gameover`, and
`follow` branches are untouched. Each target is pushed with the existing
`NotifyPostActivity`, so `AllowPush("activity", …)` still honours the
recipient's "Activity on your posts" opt-out.

**Not persisted.** `notify` is read to route the push and then discarded. It
never reaches `post_engagement`, and no column is added for it.

**Why this is the only new cleartext**: the server routes push and can only
route to someone it can name. It learns who a reply is addressed to. It does not
learn which comment was answered, any text or emoji, or the size or shape of any
thread. See spec FR-031b and research R8.

## 3. Sealed payload shapes — server sees no difference

The server MUST NOT be able to distinguish these four cases. All are opaque
`payload` bytes on a row whose `kind` is an existing value.

| what | `kind` (cleartext) | sealed payload |
|---|---|---|
| comment | `comment` | `{text, at, name?, avatar?}` |
| reply | `comment` | `{text, at, name?, avatar?, parent}` |
| post reaction | `reaction` | `{emoji, at, remove?, pad}` |
| comment reaction | `reaction` | `{emoji, at, remove?, parent, pad}` |

**Padding requirement**: every reaction payload is padded to one constant
plaintext length before sealing, so a comment reaction is not identifiable by
being ~40 bytes longer than a post reaction. Comments need no padding because
their text already varies by orders of magnitude.

**No new `kind`.** Introducing `commentreaction` would tell the server that a
reaction targets a comment and would break FR-031.

**`target` is not reused.** It stays cleartext and tombstone-only.

## 4. `GET /v1/posts/{id}/views` — unchanged, client fixed

The endpoint already returns `{"views":[{"viewer","viewedAt"}]}` and already
enforces strict author equality server-side
(`posts_handlers.go:486-494`, not the looser `CanSeePost`). FR-033 is satisfied
today. No server change.

The **client** currently discards `viewedAt` (`queries.ts:4526-4534`). It must
return the full `{viewer, viewedAt}` pairs.

## 5. `POST /v1/posts/{id}/view` — unchanged

Already idempotent with first-write-wins semantics
(`INSERT … ON CONFLICT (post_id, viewer) DO NOTHING` against a
`(post_id, viewer)` primary key). That is exactly FR-013 including the
multi-device case. No server change.

The client changes only in **when** it calls: additionally from the feed once a
post has been at least half visible for a continuous second, and never more than
once per post per device lifetime.

## 6. WebSocket — unchanged

The `{"t":"post-engagement","post":"<id>"}` frame already fans out to the whole
audience minus the actor (`posts_handlers.go:324-338`) and carries no actor,
kind, or engagement id. Replies and comment reactions ride it unchanged, so the
live path needs no new frame type.

## 7. Test obligations

Server unit tests against the in-memory fake store (no DB), one per rule:

- paging returns at most `limit`, newest first, and `before` walks backwards
  without gaps or repeats across rows sharing a `created_at`
- an unparseable `before` and an out-of-range `limit` are 400s
- an existing client sending neither param still gets a working `items` array
- `notify` naming a non-audience user is a 400, and no push is sent
- `notify` with 3 entries is a 400
- `notify` naming the actor pushes only to the post author
- a valid `notify` pushes to exactly `{author} ∪ notify`, deduplicated
- `notify` never appears in the stored row
