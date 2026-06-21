# Phase 1 Data Model: Zero-Knowledge Social Wall

Entities for the client (IndexedDB, source of truth) and server (Postgres, opaque ciphertext only).
All user content is encrypted client-side; server columns marked **opaque** hold ciphertext or
capability ids.

## Client (IndexedDB) — `src/db/idb.ts` `DB_VERSION` 8 → 9

### Contact (EDIT existing `contacts` store)
Add one author-private field; rides existing own-data sync (LWW on `updatedAt`).

| Field | Type | Notes |
|---|---|---|
| `closeFriend` | `boolean` (default false) | Curated close-friends membership. Client-only; never sent to server. Distinct from `Chat.favorite`. |

"Friends" are not a new field: a friend = an **accepted connection** (`connectedPeers` ledger /
`Connected()`); add a `listFriends()` query helper that returns contacts whose peer is connected.

### Post (NEW store `posts`, keyPath `id`)

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | Stable post id. |
| `author` | string (userId) | Self for own posts; peer for received. |
| `kind` | `'text' \| 'voice' \| 'video' \| 'image'` | Post media type. |
| `body` | string? | Decrypted text/caption (plaintext in IDB; encrypted at rest by the keystore as today). |
| `mediaId` | string? | Local media record id (reuses existing `media` store) for voice/video/image. |
| `audience` | `'friends' \| 'close'` | Author's chosen tier (own posts). Display-only for received posts. |
| `expiresAt` | number? | Epoch ms; absent = "keep". Drives the sweep. |
| `createdAt` | number | Author timestamp; feed ordering. |
| `outgoing` | boolean | True for self-authored. |
| `updatedAt` | number | For reactive bus / dedup. |

### PostEngagement (NEW store `postEngagement`, keyPath `id`)
Reactions, comments, and view receipts, all keyed by `postId`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `${postId}:${type}:${actor}` for reaction/view (LWW per actor); uuid for comment. |
| `postId` | string | The post engaged with. |
| `type` | `'reaction' \| 'comment' \| 'view'` | Engagement kind. |
| `actor` | string (userId) | Who reacted/commented/viewed (profile resolved from contacts/directory). |
| `emoji` | string? | For reactions. |
| `text` | string? | For comments (decrypted). |
| `at` | number | Actor timestamp; LWW per actor for reactions; ordering for comments. |
| `deleted` | boolean? | Tombstone (own comment deleted, author-moderated, or post deleted). |
| `updatedAt` | number | Reactive bus. |

Caps: reactions reuse existing per-item reaction caps + LWW-per-actor. Views are author-only
(present only in the author's store).

## Server (Postgres) — migration `0021_posts.sql` (all content **opaque**)

### `posts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `author` | uuid | FK users; the only identity the server needs. |
| `blob_id` | text | **opaque** — capability id of the `K_post`-sealed post payload. |
| `size` | int | Coarse size (routing/quotas). |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz NULL | Coarse expiry; NULL = keep. Pruned when past. |

### `post_envelopes`
| Column | Type | Notes |
|---|---|---|
| `post_id` | uuid | FK posts (cascade). |
| `recipient` | uuid | Audience member. **This is the audience the server addresses + reuses to fan out engagement.** |
| `wrapped_key` | bytea | **opaque** — `K_post` wrapped to the recipient's session. |
| PK | `(post_id, recipient)` | |
| index | `(recipient)` | Fast "posts addressed to me" pull. |

### `post_engagement`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `post_id` | uuid | FK posts. |
| `actor` | uuid | Submitter; server verifies actor ∈ post_envelopes.recipient ∪ {author} and not blocked. |
| `kind` | text | `'reaction' \| 'comment' \| 'tombstone'`. |
| `payload` | bytea | **opaque** — sealed under `K_post` (emoji/comment-text/target). |
| `created_at` | timestamptz | |
| index | `(post_id)` | Fan-out + fetch by post. |

Delivery: a new engagement row is fanned out to `post_envelopes.recipient` for `post_id` (same set as
the post). The server never reads `payload`.

### `post_views`
| Column | Type | Notes |
|---|---|---|
| `post_id` | uuid | FK posts. |
| `viewer` | uuid | Author-only view receipt; delivered to the post's author only. |
| `viewed_at` | timestamptz | |
| PK | `(post_id, viewer)` | One per viewer (gated by viewer's seen-receipts setting client-side). |

## State & lifecycle

- **Friendship**: `none → pending(out/in) → accepted` (existing connections) ; `accepted →` ended by
  block/withdraw. Audience "friends" = accepted set at post time.
- **Post**: `draft(local) → queued(offline) → published(envelopes delivered) → expired/deleted`
  (swept locally + pruned server-side). Audience frozen at publish.
- **Engagement**: `submitted → fanned-out → (optionally) tombstoned`. Reactions LWW per actor; comments
  appended + deletable by commenter or post author.
- **View**: recorded once per viewer when a post is opened, iff the viewer has seen-receipts on.

## Zero-knowledge invariants (assert in tests)

1. No `posts`/`post_engagement` row exposes plaintext content or media keys (all `bytea`/blob ids).
2. `post_envelopes.recipient` is the *only* place audience membership lives server-side; **close-friend
   vs all-friend tier is indistinguishable** to the server (it sees a recipient set either way).
3. `closeFriend` never appears in any request body or server table.
4. View lists exist only for the author; a seen-receipts-off viewer produces no `post_views` row.
