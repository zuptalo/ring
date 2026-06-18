# Phase 1 Data Model: Smooth Chat-History Scroll-Up

No persisted-schema change. The `messages` IndexedDB store and `Message` shape are
unchanged; `DB_VERSION` stays 6. Everything below is **in-memory / derived** state for
the chat view plus the bounded read shapes.

## Unchanged (at rest)

- **`messages` store** — keyed by `id`, indexed by `chatId` (idb.ts). `Message` fields
  unchanged. Read-only for this feature.

## New: bounded read results (queries.ts)

Batches of the existing `Message` type, oldest→newest within the batch:

- `listMessagesOlder(chatId, beforeTs | null, limit, q?) → Message[]`
  the `limit` messages immediately **older** than `beforeTs` (or the newest `limit` when
  `beforeTs` is null), oldest-first. `q` keeps the existing substring filter semantics.
- `listMessagesNewer(chatId, afterTs, limit, q?) → Message[]`
  the `limit` messages immediately **newer** than `afterTs`, oldest-first (for
  scroll-down re-entry after eviction).
- `countChatMessages(chatId) → number`
  total messages in the chat (drives spacer/affordance + "more above" detection).

(Existing `listMessages(chatId, q)` stays for search and other callers.)

## New (in-memory): ChatHistory state — `useChatHistory(chatId)`

The reactive source the view's window slices from. Holds a **bounded** contiguous run of
messages around the rendered window — not the whole chat.

| Field | Type | Meaning |
|---|---|---|
| `rows` | `Message[]` (reactive) | the loaded, contiguous, oldest→newest run currently available to render from |
| `oldestLoadedTs` / `newestLoadedTs` | epoch ms | cursors bounding `rows` (for the next older/newer batch) |
| `hasOlder` / `hasNewer` | boolean | whether more exists beyond the loaded run (vs `countChatMessages` / position) |
| `total` | number | `countChatMessages(chatId)` |

> `rows` is exposed as `Readonly<Ref<Message[]>>` (per contracts/chat-history.md §2):
> script-side callers and unit/e2e tests read `rows.value`; Vue templates unwrap it
> automatically — the same convention as `useLiveQuery`.

**Operations** (incremental — no full-array replace):
- `loadOlder()` → prepend a `listMessagesOlder` batch to `rows`; update `oldestLoadedTs`/`hasOlder`.
- `loadNewer()` → append a `listMessagesNewer` batch; update `newestLoadedTs`/`hasNewer`.
- change-bus apply (subscribed to `messages`): **append** a new message (only if the loaded
  run touches the bottom), **patch-by-id** (edit/reaction/receipt/status → shallow-merge one
  row), **remove-by-id** (splice). Never re-runs a whole-chat query.

## Derived (view): RenderWindow — in `ChatDetailPage.vue`

Replaces `visible: ref(PAGE)` + `slice(-visible)`.

| Field | Type | Meaning |
|---|---|---|
| `start` / `end` | index into `rows` | the rendered half-open slice `rows.slice(start, end)` |
| `ROW_CAP` | const (~80-120) | max rendered rows; eviction keeps `end - start ≤ ROW_CAP` |
| `BUFFER` | const — `LOOK_AHEAD_PX ≈ 1200` (≈ 1.5–2 mobile screens) | look-ahead distance kept beyond the viewport in each direction; doubles as the prefetch sentinel's `rootMargin` (D5) |

- Grows `start` ↓ (older) on top look-ahead; grows `end` ↑ (newer) on downward re-entry.
- Evicts by advancing `start` / retreating `end` once `end - start > ROW_CAP`.
- `renderItems` (album collapse), `groupRunStart`, `showDay` continue to operate on the
  rendered slice, computed with the **predecessor row included in the window** (D8) so the
  top edge doesn't flicker an avatar/divider on load.

## Derived (transient): ScrollAnchor — `withScrollAnchor(mutate)`

Captured immediately before a window mutation, used to restore the viewport after it:

| Field | Type | Meaning |
|---|---|---|
| `id` | message id | the topmost fully-rendered `.bubble[data-mid]` in the viewport |
| `top` | px | that bubble's `getBoundingClientRect().top` before the mutation |
| `scrollEl` | element | the `ion-content` scroll element |

Restore: after `nextTick`, re-find `id` (fall back to the next still-rendered row if it was
evicted), measure its new `top`, set `scrollTop += (newTop - top)`; gated by the
`MOMENTUM_QUIET_MS` + `suppressStickUntil` guards.

## Dev-only: seedMessages (testhook)

`window.__ringTest.seedMessages(chatId, n, opts?)` — constructs `n` `Message` rows
(spread timestamps; optional mix of text/media/album/group-sender) and writes them with a
single `bulkPut('messages', rows)`. Dev-only (stripped from prod). Enables a 5,000-msg
scroll test without the real send pipeline.

## State transitions (smoothness invariants)

- **Open chat** → load newest batch → pin to bottom (`scrollToNewest`) → reveal list.
- **Scroll up** → near top look-ahead → `loadOlder()` (prepend) inside `withScrollAnchor`
  → if `> ROW_CAP`, evict bottom rows inside the same anchored mutation → viewport ≤2px stable.
- **Scroll down (after eviction)** → near bottom look-ahead → `loadNewer()` (append) +
  evict top, anchored.
- **Inbound message / reaction while reading history** → incremental apply; window/scroll
  unchanged unless already pinned to bottom (no yank, FR-004).
- **Jump-to-older (reply/starred)** → `seekToMessage(id)`: load older batches until the row
  is in `rows` and rendered, then center it (US3).
