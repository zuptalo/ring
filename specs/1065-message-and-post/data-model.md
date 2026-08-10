# Phase 1 Data Model: Message and Post Audience Insight (spec 1065)

Notation: **new** = added by this feature, **kept** = exists and is unchanged,
**derived** = computed at read time and never stored.

## 1. Client: IndexedDB

### `Message.receipts` — kept, no schema change

```ts
// src/db/types.ts:264-270 — unchanged
interface Receipt {
  contactId: string;
  deliveredAt?: number;   // server clock, trustworthy
  seenAt?: number;        // member clock on the live path, server clock on reconcile
  downloadedAt?: number;
}
```

US1 needs no storage change at all. `DB_VERSION` is untouched by this story.
The timestamps are already written by `applyGroupReceipt`
(`src/services/message-status.ts:78-135`), which is first-write-wins on
`deliveredAt` and last-write-wins on `seenAt`.

**Derived, not stored**:

| Value | Rule |
|---|---|
| `hasLeftGroup(contactId)` | present in `message.receipts` but absent from `chat.participantIds` (R5) |
| tier membership | as today, except `notDelivered` now derives from `receipts`, not `participantIds` (R5) |
| displayed `seenAt` | clamped, see §4 |

### `PostEngagement` — extended

```ts
// src/db/types.ts:550-568
interface PostEngagement {
  id: string;
  postId: string;
  type: 'reaction' | 'comment' | 'view' | 'game';   // kept, no new member
  actor: string;
  emoji?: string;
  text?: string;
  actorName?: string;
  actorAvatar?: string;
  at: number;
  deleted?: boolean;
  parent?: string;        // NEW: the engagement id of the comment this answers
  updatedAt: number;
}
```

`parent` is present on:

- a **reply**: `type: 'comment'` with `parent` set to the parent comment's
  engagement id. A top-level comment leaves `parent` undefined. There is no new
  `type` value, because `type` mirrors the cleartext server `kind` (R7).
- a **comment reaction**: `type: 'reaction'` with `parent` set to the target
  comment's engagement id. A post reaction leaves `parent` undefined.

**Local id scheme** (never leaves the device, R7):

| row | local id |
|---|---|
| post reaction (kept) | `${postId}:reaction:${actor}:${emoji}` |
| comment reaction (new) | `${postId}:reaction:${actor}:${parent}:${emoji}` |
| comment and reply (kept) | the server engagement id, a fresh `uid()` |

**Migration**: `parent` is an optional field on an existing object store, so no
`DB_VERSION` bump and no `onupgradeneeded` branch is required (Principle V is
satisfied trivially: existing rows read back with `parent === undefined`, which
is exactly "top level").

**Nesting invariant (FR-025)**: `parent` always points at a **top-level**
comment. When someone replies to a reply, the client resolves the parent's own
`parent` and stores that instead, so the tree is at most one level deep by
construction rather than by render-time flattening. This keeps the invariant in
one place and makes it unit-testable.

### `PostView` — new client-side shape

```ts
interface PostViewer {
  viewer: string;
  viewedAt: number;   // first sighting, server clock
}
```

Not persisted in IndexedDB. It is fetched on demand from the author-only
endpoint and held in component state, because it is author-only data about a
single post and caching it would be a privacy footgun for no benefit.

**Locally persisted instead** — a small "already reported" set so FR-017a costs
one request per post for all time:

| store | shape | why |
|---|---|---|
| `settings` (existing kv) | `wall.viewsReported: string[]` capped and pruned with the post sweep | prevents re-POSTing a view for a post already reported, across sessions |

Bounded the same way the SW's shown-ledger is (`WALL_ACT_SHOWN_KEY`, 14 days /
500 entries, `sw-inbox.ts:1747-1749`), and pruned by `sweepExpiredPosts`
(`queries.ts:4120-4132`) so it cannot grow without limit.

## 2. Server: PostgreSQL

### `post_engagement` — index widened, no column added

```sql
-- migrations/0030_engagement_paging.sql (new, forward-only)
CREATE INDEX post_engagement_page_idx ON post_engagement (post_id, created_at, id);
DROP INDEX IF EXISTS post_engagement_post_idx;
```

No new column. The reply's parent and the comment reaction's target both ride
inside the existing opaque `payload` (R7). The server's view of a reply is
byte-for-byte the same shape as its view of a comment.

`created_at` is not unique, so the keyset cursor is the pair `(created_at, id)`
and the index carries `id` to keep the page a pure index scan (R6).

### `post_views` — unchanged

`PRIMARY KEY (post_id, viewer)` with `viewed_at timestamptz DEFAULT now()`
already gives first-view-wins across all of a person's devices, and
`RecordView` is already `ON CONFLICT DO NOTHING` (R11). Nothing to migrate.

### What the server stores, before and after

| field | before | after | visible to server |
|---|---|---|---|
| `post_engagement.kind` | `reaction \| comment \| …` | same values, no new one | yes, unchanged |
| `post_engagement.payload` | sealed | sealed, now also carrying `parent` | no |
| `post_engagement.target` | cleartext, tombstones only | unchanged, **not** reused for replies | yes, unchanged |
| reaction payload length | variable by a few bytes | **padded to a constant** | yes, and now uninformative |
| `notify` on the request | did not exist | **new, cleartext, not persisted** | yes, see below |

## 3. Wire contracts

### `CommentData` — extended

```ts
// src/db/queries.ts:4197-4206
interface CommentData {
  text: string;
  at: number;
  name?: string;
  avatar?: string;
  parent?: string;   // NEW, sealed
}
```

### `ReactionData` — extended and padded

```ts
// src/db/queries.ts:4137-4141
interface ReactionData {
  emoji: string;
  at: number;
  remove?: boolean;
  parent?: string;   // NEW, sealed
  pad?: string;      // NEW, whitespace to a constant plaintext length
}
```

`pad` exists solely so a post reaction and a comment reaction are
indistinguishable by ciphertext length (R7). The padded plaintext length is a
single constant, chosen to comfortably exceed the longest legitimate
`{emoji, at, remove, parent}` and applied to **every** reaction, including
post-level ones.

### `engagementReq` — one new field

```go
// server/internal/api/posts_handlers.go:226-231
type engagementReq struct {
    ID      string   `json:"id"`
    Kind    string   `json:"kind"`
    Payload string   `json:"payload"`
    Target  string   `json:"target,omitempty"`
    Notify  []string `json:"notify,omitempty"` // NEW — FR-031b
}
```

Validation rules, all enforced server-side:

- every entry MUST be a UUID and MUST satisfy `CanSeePost`, else 400
- at most **2** entries, else 400 (the notification rules never name more)
- the actor is silently dropped from the list (you never wake yourself)
- the list is used to route `NotifyPostActivity` and is **not written** to
  `post_engagement`

## 4. Derived display values

### Clamped `seenAt` (FR-034)

```
displaySeen(r, msg) =
  let t = r.seenAt
  if t is undefined            -> none
  if t < (r.deliveredAt ?? 0) - TOL   -> use r.deliveredAt   // cannot be seen before it arrived
  if t < (msg.sentAt ?? 0) - TOL      -> use msg.sentAt      // cannot be seen before it was sent
  if t > now + TOL                    -> use now             // no futures
  else t
```

`TOL` reuses `CLOCK_SKEW_TOLERANCE_MS = 90_000` (`src/utils/message-time.ts:29`).
Pure function, lives beside the other receipt reducers in
`src/services/message-status.ts`, unit-tested there.

### Audience row

The single shape the shared surface renders, for all four uses:

```ts
interface AudienceRow {
  id: string;         // user id, the stable key
  name: string;
  avatar: string;     // never empty; falls back to initialsAvatar
  when?: string;      // pre-formatted by the caller, absent for "not yet"
  emoji?: string;     // reaction lists only
  note?: string;      // e.g. "no longer in this group"
}
```

Callers format `when`; the component prints it. That boundary is already how
`ReactionDetails.vue:18` works and is preserved deliberately.

## 5. Entity relationships

```
Message (outgoing, group)
  └── receipts: Receipt[]        snapshot of the roster at send time
        contactId ─────────────► Contact

Post
  ├── postKey (K_post)           every audience member holds it
  ├── engagement: PostEngagement[]
  │     ├── comment  (parent: undefined)  ◄──┐
  │     ├── reply    (parent: comment.id) ───┘ one level only
  │     ├── reaction (parent: undefined)     post-level
  │     └── reaction (parent: comment.id)    comment-level
  └── views: PostViewer[]        author-only, server-held, never cached locally
```
