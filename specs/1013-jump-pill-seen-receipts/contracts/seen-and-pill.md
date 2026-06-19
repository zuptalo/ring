# Contracts: Expanding Jump Pill + Visibility-Driven Seen Receipts (spec 1013)

This feature exposes **no new external/network interface**. The contracts that matter are (1) the
unchanged wire receipt, (2) the pure-function API used by the view and unit tests, and (3) the
observable UI/behavior contract the e2e suite asserts.

## 1. Wire contract — UNCHANGED (spec 1010)

The only artifact crossing the client/server boundary is the existing sealed receipt frame:

```
ReceiptFrame = { t: 'receipt', messageId, status: 'seen', at, to, from }
```

- The server relays it opaquely to `to` (1:1 = peer; group = the message's author) and durably
  records it (spec 1010). 1013 does **not** add fields, frames, endpoints, or metadata.
- Invariant: a `'seen'` frame is emitted **only** as a consequence of a message being viewed
  (≥50% on screen, foregrounded) — never merely because a chat was opened.

## 2. Pure-function API — `src/utils/chat-unread.ts`

```ts
// Unchanged (spec 1012):
jumpButtonVisible(distanceFromBottomPx: number, shown: boolean, showPx: number, hidePx: number): boolean
unreadSince(messages: readonly UnreadMsg[], boundary: UnreadBoundary | null, selfId: string):
  { count: number; firstId: string | null }

// New (spec 1013): high-water mark of what THIS device has reported Seen.
// Returns the (timestamp, id) of the newest incoming, non-deleted message with seenReportedAt set,
// or null when none have been reported. Pure; no DOM/IDB.
seenFrontier(messages: readonly UnreadMsg[], selfId: string): UnreadBoundary | null
```

`UnreadMsg` gains the optional `seenReportedAt?: number` it reads (alongside `id`, `timestamp`,
`outgoing?`, `deleted?`, `senderId?`).

**Contract for `seenFrontier`:**
- Considers only incoming (`!outgoing` and `senderId !== selfId`), non-deleted messages.
- Returns the max by `(timestamp, id)` among those with `seenReportedAt != null`; `null` if none.
- Deterministic; ignores ordering of the input array.

**Composition (the pill's count):** `unreadSince(newer, seenFrontier(all, selfId), selfId).count`,
where `newer` is a bounded read of incoming messages after the frontier (cap 100). This yields the
not-yet-Seen count; `firstId` is the first not-yet-Seen message (open-at / tap target).

## 3. Behavior contract (asserted by e2e + manual quickstart)

**Pill control (US1):**
- Count 0 → the control is a circle (chevron only); count ≥ 1 → a stadium/pill with the count
  inline next to the chevron; it grows with the count and shrinks back to a circle at 0.
- Otherwise inherits spec-1012: hidden near bottom, fades in scrolled up, theme-inverted
  translucent disc + solid icon, bottom-trailing above the composer, LTR/RTL, light/dark,
  labeled (name conveys the count), adequate touch target. Tap → first not-yet-Seen else newest.

**Visibility-driven Seen (US2/US3):**
- A message reports Seen iff: incoming, non-deleted, `seenReportedAt == null`, **≥50% visible**,
  chat **foregrounded** (route active + document visible), and the privacy toggle is **on**.
- Reporting a message also reports all **older** not-yet-Seen incoming messages (uniform
  catch-up), stamping `seenReportedAt` and sending each receipt once.
- Off-screen messages are **not** reported; the toggle **off** ⇒ nothing sent regardless of view.
- `seenReportedAt` persists across restarts: no duplicate send on reopen; pill count is stable.
- Open: a chat with not-yet-Seen messages lands at the first such message; a caught-up chat opens
  at the newest.

## 4. Invariants / non-regressions

- No `'seen'` frame is sent for an off-screen message (SC-001).
- A viewed message is reflected Seen on the sender within 5 s; catch-up covers all older (SC-002/3).
- Privacy toggle off ⇒ 0 frames sent (SC-006, spec-1010 guarantee preserved).
- Server relays only the same opaque receipts; no new metadata (SC-007, Zero-Knowledge Impact).
- Spec-1011 scroll momentum / no-yank behavior is unchanged; the visibility observer is read-only
  w.r.t. scroll position (only the open-at-first-unseen `seekTo` moves it, momentum-safe).
