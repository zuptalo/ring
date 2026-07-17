# Contract: Scroll-to-Latest Control

Client-only UI contract. No wire/server/storage-schema change. The control is built from
Ionic primitives and bound to transient view state in `ChatDetailPage.vue`.

## 1. Pure helpers (`src/utils/chat-unread.ts`)

```ts
// Incoming, non-deleted messages newer than the boundary; firstId = earliest such message.
// boundaryTs === null → { count: 0, firstId: null }. Deterministic (timestamp, id) ordering.
export function unreadSince(
  messages: { id: string; timestamp: number; outgoing: boolean; deleted?: boolean }[],
  boundaryTs: number | null,
  selfId: string,
): { count: number; firstId: string | null };

// Hysteresis show/hide decision for the control, from the live distance-from-bottom (px).
// Show when distance > showPx; hide when distance <= hidePx; otherwise keep `shown`.
export function jumpButtonVisible(
  distanceFromBottomPx: number,
  shown: boolean,
  showPx: number,
  hidePx: number,
): boolean;
```

- `unreadSince` treats `outgoing` (or `senderId === selfId`) messages as NOT unread (incoming
  only). `deleted` messages are excluded.
- `jumpButtonVisible` must be monotonic per direction (no oscillation) given `showPx > hidePx`.

## 2. Observable behavior (what e2e asserts)

- **B-1 (hidden at bottom)**: while the view rests at/near the newest message, the control is
  not visible and occupies no interactive space.
- **B-2 (fade in)**: scrolling up past the appear threshold makes the control fade in (opacity
  transition, ≈200ms) at the bottom-trailing corner, above the composer.
- **B-3 (fade out)**: returning to within the hide threshold (by tap or manual scroll) fades the
  control out; no flicker when hovering near the boundary (hysteresis).
- **B-4 (tap → first unread)**: with unread present, activating the control scrolls to the first
  unread message (loading it if it was trimmed from the window) and clears the badge.
- **B-5 (tap → newest)**: with no unread, activating the control scrolls to the newest message;
  auto-follow re-engages once the bottom is reached.
- **B-6 (badge)**: while scrolled up, the control shows the count of unread (incoming-only)
  messages; it does not increment for outgoing/own-device sends, never appears for messages
  received while at the bottom, resets on activation or on reaching the bottom, and caps large
  counts (e.g. `99+`).
- **B-7 (composer clearance)**: across keyboard open/close and reply/edit bar states, the
  control stays above the composer and never overlaps it, the input, or the newest message's
  tap targets.
- **B-8 (a11y/i18n)**: the control is a labeled, adequately-sized, assistive-tech-reachable
  control; it renders on the trailing side in both LTR and RTL and is correct in light/dark.

## 3. Non-goals (out of scope, per spec)

- No persistent "unread divider" line in the message list.
- No change to seen/receipt state, message data, ordering, or any server/wire/storage behavior.
- No new scroll/anchor/windowing mechanics — reuses spec 1011's `scrollToNewest` /
  `scrollToMessage` and the existing pinned-state tracking.

## Test contract

- **vitest** (pure): `unreadSince` (incoming-only count + earliest firstId; boundary null;
  deleted excluded; tie-break by id) and `jumpButtonVisible` (show/hide hysteresis, no
  oscillation).
- **e2e** (`e2e/scroll-to-latest.spec.ts`, real ringd, mobile emulation): B-1..B-7 — hidden at
  bottom; fade-in on scroll up; tap → first-unread (peer sends while scrolled up) vs tap →
  newest (no unread); badge count + reset; composer clearance with the keyboard/reply bar.
- **manual / real-device** (not in CI): fade feel and the appear-threshold magnitude (like spec
  1011's momentum, emulation can't fully prove the tuning).
