# Phase 1 — Data Model: Resilient posting & storage

## Object store: `outbox` (IndexedDB, keyPath `id`)

One record per pending post/send (Wall or chat). Created via a `DB_VERSION` bump +
`onupgradeneeded` in `src/db/idb.ts`. Written through the change-bus so `useLiveQuery('outbox')`
keeps the pending UI reactive.

### `OutboxPost`

| Field          | Type                                   | Notes |
|----------------|----------------------------------------|-------|
| `id`           | `string`                               | uid; primary key. |
| `target`       | `'wall' \| 'chat'`                     | where it publishes. |
| `chatId`       | `string \| undefined`                  | required when `target='chat'`. |
| `body`         | `string`                               | caption / message text (may be empty). |
| `audience`     | `'friends' \| 'close' \| undefined`    | Wall only. |
| `lifetime`     | `PostLifetime \| undefined`            | Wall only ('1h' \| '24h' \| '72h'). |
| `items`        | `OutboxItem[]`                         | ordered; the album/media. |
| `status`       | `'uploading' \| 'failed' \| 'canceled'`| see state machine. |
| `error`        | `string \| undefined`                  | last failure reason (free-space, network…). |
| `attempts`     | `number`                               | worker attempts; drives the once-auto-retry. |
| `createdLocally`| `number`                              | ms at Share — ordering of pending items ONLY. |
| `updatedAt`    | `number`                               | change-bus / last-write. |

> NOTE: there is **no** `createdAt` here. `createdAt` is stamped only when the post finalizes
> (envelope confirmed) and is written to the real `posts` store — never derived from `createdLocally`
> (FR-004 / SC-003).

### `OutboxItem`

| Field         | Type                              | Notes |
|---------------|-----------------------------------|-------|
| `localId`     | `string`                          | stable id within the post. |
| `blob`        | `Blob`                            | **cached working copy** (taken at Share; plaintext, local-only). |
| `kind`        | `'image' \| 'video' \| 'voice'`   | item kind. |
| `name`        | `string`                          | filename. |
| `mime`        | `string`                          | source mime. |
| `durationSec` | `number \| undefined`             | audio/video. |
| `width/height`| `number \| undefined`             | images/videos. |
| `poster`      | `string \| undefined`             | embedded video poster (data URL). |
| `blobId`      | `string \| undefined`             | **set when uploaded/confirmed** → per-item confirmation (FR-014). |
| `progress`    | `number`                          | 0..1, encode+upload progress for this item. |

## State machine (per `OutboxPost`)

```text
            enqueue (Share)
                 │
                 ▼
        ┌─────────────────┐   all items have blobId
        │   uploading      │──────────────┐
        │ (worker draining)│              ▼
        └─────────────────┘        seal envelope → createPost()
            │        ▲                     │ 2xx
   network/ │        │ retry / drain       ▼
   storage  │        │                FINALIZED → write to `posts`
   error    ▼        │                (createdAt = now), delete outbox record + blobs
        ┌─────────────────┐
        │     failed       │── auto-retry once on app start ──► uploading
        │ (Retry / Cancel) │── manual Retry ───────────────────► uploading
        └─────────────────┘── Cancel ──► delete record + cached blobs (canceled)
```

### Transitions / rules

- **uploading**: worker processes items sequentially; an item with a `blobId` is skipped on resume
  (re-send only the unconfirmed — FR-014). `progress` updates flow via the change-bus.
- **finalize**: only when every item has a `blobId` AND `createPost()` returns 2xx → create the real
  `Post` with `createdAt = now()`, then **delete** the outbox record + all `item.blob`s (FR-008).
- **failed**: any unrecoverable step (offline after retries, storage exhausted) sets `status='failed'`
  + `error`; the record + blobs persist for Retry. Storage-exhaustion error carries the free-space
  hint (FR-010).
- **auto-retry-once**: on app start/unlock, each `uploading`-but-stalled or `failed` post is retried
  automatically a single time (guarded by `attempts`) before Retry/Cancel is surfaced (FR-013).
- **canceled**: terminal; record + cached blobs removed, no envelope sent (FR-006).

## Validation

- `target='chat'` ⇒ `chatId` present; `target='wall'` ⇒ `audience` + `lifetime` present.
- `items.length ≥ 1` OR `body` non-empty (a text-only post needs no outbox; it's not media-bound).
- `items.length ≤ 10` (existing per-post cap).
- A finalized post MUST NOT leave any `outbox` row or `item.blob` behind (SC-006).
