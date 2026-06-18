# Phase 0 Research: Smooth Chat-History Scroll-Up

Decisions for making chat scroll-up smooth to ~5,000+ messages with bounded DOM/memory
and ≤2px anchor stability. Grounded in a verified read of the current implementation
(`ChatDetailPage.vue`, `queries.ts`, `idb.ts`, `useLiveQuery.ts`) and an adversarially
judged comparison of three virtualization approaches. No `NEEDS CLARIFICATION` remain
(the spec's Clarifications resolved the product choices).

## Approach comparison (summary)

| Approach | Bounds DOM+mem | ≤2px anchor | Variable heights | Ionic-safe | Verdict |
|---|---|---|---|---|---|
| **A. Hand-rolled bidirectional window** (extend the existing slice-window) | ✅ | ✅ | ✅ | ✅ | **Recommended (8.5)** |
| B. `@tanstack/vue-virtual` (measured virtualizer) | ✅ | ❌ | ❌ | ❌ | Not primary (5) — index anchoring + async poster/avatar reflow misses the ≤2px bar; forces a swipe-gesture rewrite + ion-content scroll bridge; "spike required". Fallback only. |
| C. CSS `content-visibility:auto` | ❌ | n/a | ✅ | ✅ | Rejected (1.5) — skips off-screen *paint* but does NOT unmount DOM or bound the in-memory array (FR-012/013). Keep only as a cheap paint layer atop A if profiling warrants. |

## D1 — Virtualization: hand-rolled bidirectional window

- **Decision**: Replace `visible: ref(PAGE)` + `visibleMessages = messages.slice(-visible)`
  (ChatDetailPage.vue:2179-2181) with an explicit reactive window `{ start, end }` and
  render `messages.slice(start, end)`. Grow `start` downward (older) on top look-ahead;
  grow `end` upward (newer) on scroll-down re-entry; **evict** by advancing `start` /
  retreating `end` once the window exceeds a row cap (~80-120 rendered rows ≈ several
  screens + buffer). Every window mutation runs through one shared `withScrollAnchor()`
  helper (D4) so prepend AND eviction restore position identically. Optionally layer
  CSS `content-visibility` on rendered rows later if paint cost shows up.
- **Rationale**: This preserves the one mechanism this codebase already relies on for
  prepend anchoring — anchoring on a real, still-rendered `.bubble[data-mid]` and
  correcting `scrollTop` by its measured rect delta *after* layout (`loadOlder`
  ~2218-2225), generalized here and **verified to hold ≤2px by the T015 e2e assertions**
  (not merely assumed). That
  post-layout rect read absorbs late poster decode, group-avatar toggles, album
  collapsing, and reaction reflow — exactly what defeats an estimate/index-based
  virtualizer. It keeps the entire existing chat surface (receipts, reactions,
  disappearing, search, jump-to-newest, swipe, media LRU, v-memo) intact; only the
  slice bounds and the array source change.
- **Alternatives rejected**: `@tanstack/vue-virtual` (anchors by index, estimates
  unmeasured heights, optimizes oldest-at-top forward lists — invisible-prepend +
  late-decode is its documented hard case; would force a swipe rewrite + ion-content
  scroll-metrics bridge; rated HIGH risk / "spike required"). CSS `content-visibility`
  (does not bound DOM or memory; cannot be the windowing strategy).

## D2 — Bounded reads (no DB migration)

- **Decision**: Add `listMessagesOlder(chatId, beforeTs|null, limit, q?)`,
  `listMessagesNewer(chatId, afterTs, limit, q?)`, and `countChatMessages(chatId)` to
  `queries.ts`; the chat view sources its window from these batches (via D3) instead of
  holding the whole chat. **Do NOT** add a `[chatId, timestamp]` compound index and
  **do NOT** bump `DB_VERSION` (stays at 6) for v1.
- **Rationale**: FR-013 wants bounded reads. The existing single `chatId` index
  (idb.ts:91) + an in-memory sort of even 5-10k objects is sub-10ms, so batches can be
  served by a one-time `getByIndex` + sort + slice without a schema change — avoiding a
  forward-only `onupgradeneeded` migration for no real-world payoff at target sizes.
- **Alternatives rejected**: Compound `[chatId, timestamp]` index + `DB_VERSION 6→7`
  (migration cost > benefit until ~50k messages — see the deferred-migration note in
  plan.md Complexity Tracking). Keeping `listMessages` (loads-all) as the chat-view
  source (the full-array source is the churn root — D3).

## D3 — Reactivity without full-array replace

- **Decision**: Introduce a `useChatHistory(chatId)` composable that subscribes to the
  `messages` change bus and applies **incremental** mutations to the in-memory list:
  append (only if the window touches the bottom), patch-by-id (edit/reaction/receipt/
  status → shallow-merge one row), remove-by-id (splice) — instead of re-running the
  whole query and reassigning the array.
- **Rationale**: `useLiveQuery` does `value.value = result` on EVERY `messages` write
  (useLiveQuery.ts:35), re-allocating thousands of objects per reaction/seen/tick — the
  churn that lands extra layout work around a load. Incremental apply removes the churn
  and is what lets virtualization (D1) stay cheap.
- **Alternatives rejected**: Adapting `useLiveQuery` (it's intentionally stateless /
  atomic-replace; pagination + incremental diff don't fit its callback model and would
  risk every other caller). Diffing the replaced array each time (still re-reads all).

## D4 — Anchor + eviction strategy (shared `withScrollAnchor`)

- **Decision**: Extract a single `withScrollAnchor(mutate)` used by BOTH prepend and
  eviction: (1) pick anchor = the topmost fully-rendered `.bubble[data-mid]` still in
  the viewport, record its id + `rect.top` + the scroll element; (2) run the window
  mutation; (3) `await nextTick()`; (4) re-find the anchor by id (fall back to the next
  still-rendered row if it was evicted) and correct `scrollTop` by the measured delta.
- **Rationale**: FR-001/SC-002 require ≤2px across prepend AND eviction; a measured-rect
  anchor is the only thing robust to FR-007 late media decode and FR-005 avatar/album
  height changes. `loadOlder` already does this for prepend (2218-2225) — generalize it.
- **Alternatives rejected**: `scrollHeight`-delta restoration (the `loadOlder` comment
  2213-2216 already documents it skews with the spinner/late layout → jumps).
  Index/estimate-based anchoring (defeated by async height changes).

## D5 — Prefetch-ahead (page before the boundary)

- **Decision**: Load older batches **look-ahead** via a sentinel/threshold positioned
  well before the top edge (`LOOK_AHEAD_PX ≈ 1200`, ~1.5-2 mobile screens of buffer above
  the viewport), so the older batch is present BEFORE the top is reached. Keep
  `ion-infinite-scroll` (or an
  IntersectionObserver sentinel) as the backstop.
- **Rationale**: FR-002/SC-003. Today `ion-infinite-scroll` fires at `threshold=25%`
  (line 98) and `loadOlder` only THEN grows the window — a fast flick outruns it (stall
  → snap).
- **Alternatives rejected**: Idle-time whole-history preload (spec marks optional; would
  reintroduce unbounded memory). Boundary-only load at 25% (the current stall source).

## D6 — `loadOlder` momentum + echo guards

- **Decision**: Apply the same two guards the rest of the view already uses, inside
  `withScrollAnchor`: `MOMENTUM_QUIET_MS` (don't write `scrollTop` while a fling is in
  flight; re-apply once it settles) and `suppressStickUntil` (mark the post-correction
  scroll as our own echo so `onContentScroll` doesn't flip `stickBottom`).
- **Rationale**: `loadOlder` is the ONLY scroll-writing path without these guards
  (2212-2228 vs guarded 2029/2437/2449) — the root of the "load fights momentum"
  symptom (FR-003).
- **Alternatives rejected**: Leaving `loadOlder` unguarded.

## D7 — Jump-to-older seek (US3 / FR-006)

- **Decision**: Generalize the existing jump-to-date retry loop (`onPickDate` ~1010-1015,
  the `[data-mid]` poll) into `seekToMessage(id)` that, when the target isn't in the
  window, loads older batches (grow `start`, or seek the batch containing it by
  timestamp) in a bounded loop until the row mounts, then centers it.
- **Rationale**: `scrollToMessage` (1674-1686) today only works if the row is already
  rendered, else toasts "Original message not available" — wrong for an on-device
  message merely outside the window (US3).
- **Alternatives rejected**: Loading the whole history to find the target (defeats
  bounded memory). Scroll-by-estimated-offset (variable heights make it unreliable).

## D8 — Group-row correctness across the window edge

- **Decision**: Keep `groupRunStart`/`showDay`/`v-memo` keyed on positional index but
  compute run-start/day from the row's **predecessor included in the window** (render one
  extra leading row, or compute from message adjacency) so an avatar/divider doesn't
  appear/disappear when the predecessor is evicted/prepended.
- **Rationale**: `groupRunStart(i)`/`showDay(i)` read `renderItems[i-1]` (1142-1146,
  1605-1613); at the window's top edge that predecessor changes on load → avatar/divider
  flicker + a height jump injected into the anchored frame (FR-005).
- **Alternatives rejected**: Ignoring the boundary predecessor (flicker + jump).

## D9 — Fast bulk-seed testhook (for a 5,000-msg test)

- **Decision**: Add a dev-only `window.__ringTest.seedMessages(chatId, n, opts?)` that
  builds N `Message` records in memory and writes them with ONE `bulkPut('messages', rows)`
  (idb.ts already has `bulkPut`) in a single transaction, with spread timestamps and an
  optional mix of text/media/album/group-sender rows.
- **Rationale**: A 5,000-msg scroll test (SC-008) is impractical through the real send
  pipeline (minutes/run, hits crypto/relay) and `showcase-seed` writes per-row in an
  await loop. `bulkPut` makes it instant + deterministic.
- **Alternatives rejected**: Sending via the real pipeline; reusing `seedShowcase`
  (fixed small dataset).

## Recommendation & fallback

- **Recommendation**: Approach A end-to-end (D1-D9).
- **Fallback** (if full bidirectional eviction proves unstable mid-implementation — most
  likely the eviction-below-viewport / downward-re-entry case): ship the safer subset
  that still delivers the headline smoothness — (1) keep a GROW-only window but add
  aggressive look-ahead prefetch (D5), (2) bound only the in-memory read with cursor
  batches + incremental reactivity (D2/D3) so FR-013 holds, (3) add `overflow-anchor:auto`
  + the `loadOlder` guards (D6). This meets FR-001/002/003 and bounded **memory**, with
  bounded **DOM** (FR-012 strict eviction) deferred. Strictly less than the 5k-DOM target
  but smooth and shippable.

## Open risks (carry into implementation)

These implementation-level risks correspond to the product-level scenarios in spec.md
§Edge Cases (same concerns, two audiences: scenarios for product clarity, risks for
implementation vigilance).

- Eviction BELOW the viewport + downward re-entry is the genuinely new, unproven part
  (prepend anchoring is proven; bottom-edge eviction/re-mount at ≤2px has no precedent here).
- Media LRU (`MAX_MEDIA=60`) can revoke a poster URL for an off-screen row that later
  re-enters — re-entry must re-resolve media AND re-anchor in the same frame.
- Incremental-apply (D3) is a behavioral-equivalence risk: every full-array-replace
  consumer (chatMediaMsgs ~1155, viewerItems, albumMessageIds, preview) must keep working.
- `groupRunStart`/`showDay` at the window's top edge (D8) — flicker/height-jump if unhandled.
- "No compound index" (D2) assumes `getAll`+sort stays cheap; a pathological 20-50k chat
  is a deferred cliff (revisit the index migration then).
- FR-003 iOS momentum: writing `scrollTop` during native WebKit inertia is inherently
  fighty; the guard mitigates but **real-device** verification is needed.
- Search scope: search resets the window and filters the in-memory array today; bounded
  reads + search must agree on scope (loaded-batch vs whole chat).
