# Contract: Chat-History Reads, Reactivity, Seed, and Scroll Invariants

Client-only contracts. No wire/server/storage-schema change.

## 1. Bounded read API (`src/db/queries.ts`)

```ts
// The `limit` messages immediately older than `beforeTs` (newest `limit` when null),
// returned oldest→newest. `q` keeps the existing substring filter.
export function listMessagesOlder(
  chatId: string, beforeTs: number | null, limit: number, q?: string,
): Promise<Message[]>;

// The `limit` messages immediately newer than `afterTs`, oldest→newest.
export function listMessagesNewer(
  chatId: string, afterTs: number, limit: number, q?: string,
): Promise<Message[]>;

// Total messages in the chat (for "more above" detection / affordances).
export function countChatMessages(chatId: string): Promise<number>;
```

- Backed by the existing `chatId` index + in-memory sort/slice (no new index, no
  `DB_VERSION` bump — research D2). Ordering is deterministic by `(timestamp, id)`.
- Batches must **dedupe at seams** (a message at exactly `beforeTs`/`afterTs` is not
  returned twice across adjacent batches).
- `listMessages(chatId, q)` (loads-all) remains for search and non-chat-view callers.

## 2. Reactive windowed history (`src/composables/useChatHistory.ts`)

```ts
useChatHistory(chatId: Ref<string> | string, q?: Ref<string>): {
  rows: Readonly<Ref<Message[]>>;     // contiguous loaded run, oldest→newest (bounded)
  hasOlder: Ref<boolean>;
  hasNewer: Ref<boolean>;
  total: Ref<number>;
  loadOlder(): Promise<number>;       // prepend a batch; returns count added
  loadNewer(): Promise<number>;       // append a batch; returns count added
  // internally subscribes to the 'messages' change bus and applies INCREMENTAL updates:
  //   append (only if the run touches the bottom) | patch-by-id | remove-by-id.
}
```

**Contract**:
- MUST NOT re-run a whole-chat query or replace `rows` wholesale on a `messages` write
  (that is the churn this replaces). A single reaction/seen/edit patches exactly one row.
- A new inbound message appends only when the loaded run includes the newest message
  (otherwise it's beyond the loaded run and surfaced via `hasNewer`/badge, not injected).
- Switching `chatId`/`q` resets the run to a fresh newest batch.
- `loadOlder`/`loadNewer` read a fixed internal `BATCH_SIZE` (suggested `≈ ½ × ROW_CAP`)
  so one batch comfortably fills the look-ahead buffer without overshooting `ROW_CAP`.

## 3. Scroll/anchor behavior contract (`ChatDetailPage.vue`)

The rendered slice is a **RenderWindow** `{ start: index, end: index }` into the loaded
`rows` (data-model.md), bounded so `end - start ≤ ROW_CAP`. The invariants below constrain
that window's behavior.

Observable invariants the implementation MUST hold (these are what e2e asserts):

- **INV-1 (anchor)**: across any window mutation (prepend OR eviction), the anchor
  bubble's `getBoundingClientRect().top` changes by **≤2px**.
- **INV-2 (page-before-top)**: when scrolling up, the next older batch's first
  `[data-mid]` is present in the DOM **before** `scrollTop` reaches 0.
- **INV-3 (bounded)**: the count of rendered `.bubble[data-mid]` stays ≈ `ROW_CAP`
  regardless of scroll distance; resolved media stays ≤ `MAX_MEDIA`.
- **INV-4 (no-yank)**: an inbound message/reaction/status while the user is not pinned to
  bottom leaves `scrollTop` unchanged.
- **INV-5 (no momentum fight)**: no `scrollTop` write occurs while a fling is in flight
  (within `MOMENTUM_QUIET_MS` of the last genuine user scroll); the correction re-applies
  after it settles.
- **INV-6 (seek)**: `seekToMessage(id)` for an on-device message older than the window
  loads intervening batches and centers it (no "not available"); jump-to-newest unaffected.
- **INV-7 (group edge)**: avatars/day-dividers at the window's top edge do not
  appear/disappear (flicker) when older rows load.

`withScrollAnchor(mutate)` is the single helper enforcing INV-1/INV-5 for both prepend and
eviction (and is reused by `loadOlder`, eviction, and `seekToMessage`).

## 4. Dev-only seed (`src/services/testhook.ts`)

```ts
// window.__ringTest.seedMessages(chatId, n, opts?) → Promise<void>
// Builds n Message rows (spread timestamps; opts may mix text/media/album/group-sender)
// and writes them with ONE bulkPut('messages', rows). Dev-only (stripped from prod).
seedMessages(chatId: string, n: number, opts?: {
  fromIds?: string[];        // rotate senders (group histories)
  mediaEvery?: number;       // every Nth row is an image/video for height variety
}): Promise<void>;
```

## Test contract

- **vitest** (pure, no IndexedDB): window math (`computeWindow` never exceeds `ROW_CAP`,
  always covers viewport+buffer, evicts the correct edge); pagination cursor math (correct
  slice for `beforeTs`/`afterTs`/`limit`, oldest-first, seam dedupe); anchor-delta math
  (|residual| ≤2px, evicted-anchor falls back to next id); the momentum/echo guard
  predicates (INV-5: defer a `scrollTop` write while a fling is in flight, mark the
  post-correction scroll as self-echo — exercised with fake timers); group-run/day across a
  window boundary with a preserved leading row.
- **e2e** (`e2e/chat-media-scroll.spec.ts`, real ringd, mobile emulation): seed 5,000 via
  `__ringTest.seedMessages`, then assert INV-1 (≤2px), INV-2 (page-before-top), INV-3
  (bounded rendered/media count after scrolling far up+down), INV-4 (no-yank), INV-6
  (jump-to-older).
- **drive/** exercise (`drive/scenarios/lengthy-chat-scroll.mjs`): 5 users connect (request
  +accept) → 1:1 + group → exchange text/voice/video/image-upload/video-upload → build a
  lengthy chat → open + scroll up, screenshot pass for visual confirmation.
- **manual / real-device** (not in CI): **INV-5** fling feel (writing `scrollTop` during
  native iOS WebKit inertia — emulation can't fully prove it) and **INV-7** group-row
  flicker are confirmed by hand (T032). Their deterministic *logic* is unit-tested above
  (INV-5 via the guard predicates; INV-7 via the predecessor-included group-run/day math).
