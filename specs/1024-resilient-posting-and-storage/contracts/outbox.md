# Contract — Outbox & upload worker (client)

This feature exposes **no new server API**. The "interface" is the client-side outbox contract
(data layer + worker) plus the **reused** server endpoints whose success responses act as the
confirmation receipt.

## Reused server endpoints (unchanged)

| Endpoint | Role in this feature |
|----------|----------------------|
| `POST /v1/blobs` (`uploadBlob`) | Upload one sealed media blob → returns its **blob id** = per-item confirmation (FR-014). |
| `POST /v1/posts` (`createPost`) | Submit the sealed envelope + recipients → 2xx = the post is **made**; client stamps `createdAt=now` then (FR-004). |
| `POST /v1/messages` (chat send) | Same role for `target='chat'` media sends (FR-012). |

No request/response shape changes; no new fields; zero migration.

## Client data-layer contract (`src/db/queries.ts` + `src/services/outbox.ts`)

```ts
// Enqueue: cache blobs + persist the pending record, then the composer dismisses immediately.
// Returns the outbox id so the UI can show its pending card.
enqueueOutboxPost(input: {
  target: 'wall' | 'chat';
  chatId?: string;
  body: string;
  audience?: 'friends' | 'close';
  lifetime?: PostLifetime;
  items: { blob: Blob; kind: 'image'|'video'|'voice'; name: string; mime: string;
           durationSec?: number; width?: number; height?: number; poster?: string }[];
}): Promise<string>;

// Worker: drain the outbox sequentially (encode → upload each unconfirmed item → seal → createPost).
// Idempotent + resumable; safe to call on enqueue, app start, and 'online'.
drainOutbox(): Promise<void>;

// Auto-retry-once entry point, called on app start / keystore unlock (FR-013).
resumeOutboxOnStart(): Promise<void>;

retryOutboxPost(id: string): Promise<void>;   // manual Retry (failed → uploading; unconfirmed only)
cancelOutboxPost(id: string): Promise<void>;  // delete record + cached blobs (FR-006/008)

listOutbox(): Promise<OutboxPost[]>;           // for useOutbox / useLiveQuery('outbox')
```

## Behavioral contract (assertions for tests)

- `enqueueOutboxPost` resolves **before** any encode/upload starts; the composer can dismiss on its
  resolution (SC-001).
- After enqueue, `listOutbox()` contains the record with `status='uploading'` and each item
  `blobId === undefined`, `progress === 0`.
- `drainOutbox` sets `item.blobId` as each upload confirms; never re-uploads an item that already has
  a `blobId`.
- On full success: a real `Post` exists with `createdAt ≈` the `createPost` time; the `outbox` row
  and every `item.blob` are gone (SC-003/006).
- On forced failure mid-drain: `status='failed'`, `error` set, record + blobs retained;
  `retryOutboxPost` finishes it re-sending only the unconfirmed items.
- `cancelOutboxPost`: record + blobs removed; no envelope/message was sent.
- Storage guard (`services/storage-estimate.ts`): `hasRoomFor(bytes): Promise<boolean>` returns
  `false` when `freeSpace < bytes × 2.5` (floor 50 MB); returns `true` (best-effort) when
  `navigator.storage.estimate` is unavailable.
