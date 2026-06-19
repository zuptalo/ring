# Data Model: Expanding Jump Pill + Visibility-Driven Seen Receipts (spec 1013)

Client-only. One persisted field is added to the existing `Message` store (IndexedDB); everything
else is view-local reactive state or pure derivations. No server, SQL, or wire-format change.

## Persisted change — `Message.seenReportedAt`

`src/db/types.ts` — extend the `Message` interface:

| Field | Type | Meaning |
|---|---|---|
| `seenReportedAt` | `number` (epoch ms) \| undefined | Set on an **incoming** message when **this device** has sent its `'seen'` receipt for it. `undefined` = not yet reported. Never set on outgoing/own messages. Distinct from `seenAt` (the receipt timestamp on the **sender's** side, spec 1010). Client-local only — never sent, never own-data-synced. |

### Migration (Constitution V — forward-only, preserve data)

`src/db/idb.ts`:
- Bump `DB_VERSION` **6 → 7**.
- Add a pure `migrateMessageToV7(row)` mirroring the existing `migrateMessageToV6` pattern: it is
  a no-op field add — existing messages keep all fields and simply have no `seenReportedAt`
  (`undefined`). Must never throw (a throw aborts the versionchange transaction).
- Wire it into `onupgradeneeded` with the existing per-store cursor loop, guarded
  `oldVersion < 7 && objectStoreNames.contains('messages')`.
- No new index is required (the field is read via the existing per-chat message reads, then
  filtered in memory / via the bounded read).
- **Backfill semantics**: existing messages start `undefined`. On first open after upgrade they
  are re-evaluated by visibility; a one-time duplicate `'seen'` send is possible and is harmless
  (idempotent on the sender + server, per spec 1010). Documented, accepted.

Covered by a unit test in `src/db/idb.migration.test.ts` (pure `migrateMessageToV7`).

## Derived / pure logic — `src/utils/chat-unread.ts`

Reuses spec-1012 pure helpers; adds one small pure function.

- `unreadSince(messages, boundary, selfId) → { count, firstId }` — **unchanged** (spec 1012).
  Counts incoming, non-deleted messages strictly after the `(timestamp, id)` boundary.
- **New** `seenFrontier(messages: UnreadMsg[], selfId) → UnreadBoundary | null` — the
  `(timestamp, id)` of the **newest incoming, non-deleted message with `seenReportedAt` set**
  (the high-water mark of what's been reported Seen), or `null` if none. Pure, unit-tested.

The **not-yet-Seen count** (the pill's number) is then
`unreadSince(newer, seenFrontier(...), selfId).count`, where `newer` is a bounded read from the
frontier timestamp (cap 100 → display `99+`), exactly mirroring spec-1012 `recomputeUnread`.
Because the uniform catch-up rule (FR-014) marks everything older than the frontier as reported,
"after the frontier" is precisely the set of not-yet-Seen messages.

## View-local state — `ChatDetailPage.vue`

| State | Type | Meaning |
|---|---|---|
| `unseenCount` | number (reactive) | Not-yet-Seen incoming count (replaces spec-1012's boundary-based `unreadCount` as the pill's number, per FR-016). Drives the pill: 0 ⇒ circle, ≥1 ⇒ pill with inline count (capped `99+`). |
| `firstUnseenId` | message id \| null | The first (oldest) not-yet-Seen incoming message — the open-at landing target (FR-017) and the tap target (FR-006). |
| `jumpVisible` | boolean (reactive) | Unchanged spec-1012 show/hide hysteresis (scrolled-up affordance). |
| `bubbleVisObs` | IntersectionObserver | New — root = ion-content scroll element, `threshold: 0.5`; observes rendered `.bubble[data-mid]`; callback runs the Seen path (D2/D3). |

### State transitions

- **Open chat**: if `firstUnseenId` exists → `seekTo` it (unread-divider landing, FR-017); else
  open at newest (spec 1011). Attach `bubbleVisObs` after the list is ready.
- **Bubble ≥50% visible while foregrounded** (route active + `document.visibilityState` visible):
  `reportSeenAndOlder(message)` — stamp `seenReportedAt = now()` on that message **and all older
  not-yet-Seen incoming**, and send each `'seen'` receipt (gated by `seenReceiptsEnabled`). The
  frontier advances; `unseenCount` recomputes (shrinks the pill).
- **New incoming while scrolled up**: `unseenCount` increments (pill grows); no receipt until the
  message is brought ≥50% on screen.
- **Reach / report all**: `unseenCount` → 0; pill animates back to a circle.
- **Privacy toggle off**: marking/pill may update locally; `reportSeenAndOlder` sends nothing
  (gate), and others' seen of own messages stays unrendered (spec-1010 reciprocity).

## Messaging layer — `src/composables/useSync.ts`

- Keep the `'seen'` envelope, `seenReceiptsEnabled` gate, and 1:1/group addressing **unchanged**.
- Replace the on-open bulk path with a per-message send used by `reportSeenAndOlder`; persist the
  reported state via `Message.seenReportedAt` (DB) instead of the in-memory `seenReceiptsSent`
  set (which may remain as an in-session fast-path, rebuilt from `seenReportedAt`).
- Remove the on-open / on-foreground `sendSeenReceipts(chatId)` call sites in `ChatDetailPage`.

## Entities recap

- **Seen frontier** — newest incoming message reported Seen `(timestamp, id)`; high-water mark.
- **Not-yet-Seen set** — incoming, non-deleted messages after the frontier; size = pill count.
- **`seenReportedAt`** — the persisted per-message flag that defines the frontier across restarts.
- **Seen receipt** — unchanged spec-1010 sealed envelope `{messageId, status:'seen', at, to}`.
