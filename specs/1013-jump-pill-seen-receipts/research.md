# Research: Expanding Jump Pill + Visibility-Driven Seen Receipts (spec 1013)

Phase 0 mapping of the exact existing primitives this feature reuses, and the decisions that
resolve the open technical choices. Cited line numbers are approximate (the code moves).

## Existing primitives (what we build on)

- **Seen-receipt sending** — `src/composables/useSync.ts` `sendSeenReceipts(chatId)` (~L495–516):
  bulk-sends a `'seen'` receipt for **every** incoming message when the chat is opened/foregrounded.
  Dedup via an in-memory `Set` `seenReceiptsSent` (~L478, resets on restart). Privacy gate
  `seenReceiptsEnabled` (~L56, from `privacy.seenReceipts`, default true; set by `applySeenPref` ~L647).
  Addressing: 1:1 → `to = chat.participantIds[0]`; group → `to = m.senderId` (the author).
- **Wire envelope** — `src/services/transport.ts` `ReceiptFrame` (~L27–38):
  `{ t:'receipt', messageId, status, at, to, from }`. **Unchanged by 1013.**
- **Receiving (sender) side** — `src/services/sync.ts` `applyReceipt` (~L166) advances the
  message to `seen` (`message-status.ts`); `reconcileSeen` (~L156) on reconnect. **Unchanged.**
- **Current call sites** — `src/views/detail/ChatDetailPage.vue`: `onMounted` →
  `markChatSeenIfVisible()` (~L2213) and `onVisibilityChange()` (~L2236). These are the on-open
  triggers we replace.
- **Message type** — `src/db/types.ts` `Message` (~L213–270): has `outgoing`, `seenAt` (1:1),
  `receipts` (group per-member), `timestamp`, `senderId`, `deleted`.
- **IndexedDB** — `src/db/idb.ts`: `DB_VERSION` currently **6** (~L29); `onupgradeneeded` runs a
  cursor migration per store (the `migrateMessageToV6` pattern); `idb.migration.test.ts` exists.
- **Pill control + count** — `src/views/detail/ChatDetailPage.vue` spec-1012 `jump-fab`
  (template + CSS), `jumpVisible`, `unreadBoundary {ts,id}`, `unreadCount`, `firstUnreadId`,
  `onJumpToLatest`, `recomputeUnread`; pure logic in `src/utils/chat-unread.ts`
  (`jumpButtonVisible`, `unreadSince(messages, boundary, selfId)`).
- **Bounded list + scroll** — `src/composables/useChatHistory.ts` bounds rendered rows to
  `MAX_ROWS` (≤~200 in memory / ≤~100 DOM); `seekTo(ts)` lands the window on a message;
  `ChatDetailPage` `scrollToMessage` / `scrollToNewest` / `stickBottom` / `suppressStickUntil`
  (spec 1011/1012). Bubbles render as `.bubble[data-mid]`; scroll element via `ensureScrollEl()`.
- **Foreground signals** — `ChatDetailPage` already tracks route-active + `document.visibilityState`
  (`onVisibilityChange`); window sentinels are set up in `setupWindowSentinels(root)` (~L2152).

## Decisions

### D1 — Per-message persistence: `Message.seenReportedAt?: number`
**Decision**: Add an optional `seenReportedAt?: number` (epoch ms) to `Message` — set on an
**incoming** message when this device has sent its Seen receipt; `undefined` = not yet sent.
**Rationale**: FR-018 needs the not-yet-Seen count and the no-resend guarantee to survive
restarts; an in-memory `Set` resets. Mirrors the existing `seenAt` naming/shape; a timestamp is
strictly richer than a boolean (debuggable, future-proof) at no extra cost.
**Alternatives**: boolean `seenReported` (less information); keep in-memory only (fails FR-018);
sync to server (no privacy gain, adds wire + violates "client owns Seen policy").

### D2 — Visibility trigger: a second `IntersectionObserver`, `threshold: 0.5`
**Decision**: Add `bubbleVisObs` rooted on the ion-content scroll element, `threshold: 0.5`,
observing each rendered `.bubble[data-mid]`. A bubble crossing ≥50% visible (while foregrounded)
fires the Seen path. Set it up next to the existing window sentinels and (un)observe bubbles as
the render window slides.
**Rationale**: Native, batched, no per-scroll-event math; 0.5 directly encodes the FR-007
"≥50% visible" decision and drops thin slivers during a fling without a dwell timer. Observer
target count is bounded by `MAX_ROWS`, so churn is cheap.
**Alternatives**: manual viewport math in `onContentScroll` (more code, runs on the hot path);
a dwell timer (the user chose the no-dwell ≥50% option); a library (needless dependency).

### D3 — Catch-up in the observer callback (uniform rule, FR-014)
**Decision**: When a bubble fires, mark **that message and all older not-yet-Seen incoming
messages** as `seenReportedAt = now()` and send their receipts in one pass
(`reportSeenAndOlder(m)`).
**Rationale**: Matches the clarified uniform rule (view ⇒ everything older is seen); reading
down clears the backlog without dwelling on each. In practice batches are small because we open
at the first unseen (D5) and advance incrementally.
**Alternatives**: report only the visible message (forces dwelling on every old message);
deferred queue (adds latency/complexity).

### D4 — Pill count from a seen-frontier, reusing `unreadSince`
**Decision**: Pill count = incoming, non-deleted messages **after the seen-frontier**, where the
frontier is the `(timestamp, id)` of the newest incoming message with `seenReportedAt` set.
Reuse `unreadSince(newer, frontier, selfId)` over a bounded read from the frontier (cap 100 →
`99+`), exactly as spec 1012's `recomputeUnread` reads from its boundary. Add a tiny pure helper
`seenFrontier(messages)` in `chat-unread.ts`.
**Rationale**: FR-016 (count = not-yet-Seen-reported). The uniform catch-up rule guarantees
everything older than the frontier is reported, so "after the frontier" is exactly the
not-yet-Seen set. Reuses spec-1012 pure logic (already unit-tested) instead of new mechanics.
**Alternatives**: count over only the loaded window (wrong for a backlog > MAX_ROWS); a separate
counter store (redundant with `seenReportedAt`).

### D5 — Open at the first not-yet-Seen message (FR-017)
**Decision**: On chat open, if any incoming `seenReportedAt == null` messages exist, `seekTo`
the first (oldest) one (unread-divider style); otherwise open at the newest as today.
**Rationale**: With the uniform catch-up rule, opening at the bottom would mark the whole backlog
Seen instantly and defeat the privacy goal; opening at the first unseen lets Seen advance as the
user reads down. Reuses spec-1011 `seekTo`/`scrollToMessage`; the seek must honor spec-1011
momentum safety (`suppressStickUntil`).
**Alternatives**: keep spec-1011 open-at-bottom (privacy benefit only when manually scrolling up).

### D6 — Expanding pill from the existing `ion-fab-button` (Ionic-first, Principle XI)
**Decision**: Keep the spec-1012 `ion-fab-button`; render chevron + inline count inside it and
drive a CSS width/border-radius transition between a circle (count 0) and a stadium/pill
(count ≥ 1). No new widget; theme-inverted translucent disc + solid icon retained; logical CSS
for RTL; accessible name conveys the count.
**Rationale**: Constitution XI (compose from stock Ionic + existing theme tokens). The corner
`ion-badge` from 1012 is removed in favor of the inline count.
**Alternatives**: a bespoke button (violates XI); keep the corner badge (the user asked for a pill).

### D7 — Foreground gate reused; defer sends during a fling (perf, optional)
**Decision**: Gate the Seen path on route-active **and** `document.visibilityState === 'visible'`
(reuse existing signals). Marking can be immediate; receipt **sends** may be deferred until a
fling settles (reuse `lastScrollAt`) to batch — an optimization, not a behavior change.
**Rationale**: FR-012 foreground definition; avoids a burst of sends during a fast fling without
adding a dwell.
**Alternatives**: also require window focus (the user chose visible-only); no deferral (more
sends during a fling, still correct).

## Risks / mitigations

- **Migration safety** — adding `seenReportedAt` is a no-op field add; the v6→v7 cursor migration
  must be pure and never throw (else the versionchange tx aborts). Existing messages stay
  `undefined`; on first open they are re-evaluated by visibility (a one-time, idempotent
  possibility of a re-send, which spec 1010 says is harmless). Covered by `idb.migration.test.ts`.
- **Observer lifecycle** — (un)observe bubbles as the render window slides; clean up on unmount;
  guard callbacks against a message id whose row/Message has since been removed.
- **Fling burst** — 0.5 threshold + optional send-deferral keep it bounded; cap the per-fire
  catch-up send batch and `log` if a very large backlog is collapsed.
- **Open-at-first-unseen race** — defer the `seekTo` until the history has loaded (reuse the
  spec-1011 ready/seek path); apply `suppressStickUntil` so it doesn't fight momentum.
- **Privacy toggle off** — the observer/pill may still update locally, but the send path stays
  gated by `seenReceiptsEnabled`; nothing leaves the device.

## Out of scope (confirmed)

No server/Go, SQL-migration, or wire-format change. No change to delivered/downloaded receipts,
group progress counter, or spec-1011 scroll mechanics (only the count *source* changes).
