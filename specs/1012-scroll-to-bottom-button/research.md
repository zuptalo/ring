# Phase 0 Research: Hovering "Scroll to Latest" Button

Decisions for a momentum-safe, Ionic-native floating "scroll to latest" control layered on
spec 1011's chat scroll. Grounded in a read of the current `ChatDetailPage.vue` (the scroll
state + footer) and `useChatHistory.ts` (the incoming-append path). No `NEEDS CLARIFICATION`
remain — the three product choices were resolved in `/speckit-clarify` (spec ## Clarifications).

## D1 — Control: Ionic `ion-fab-button` (no custom positioning)

- **Decision**: Render the control as an `ion-fab` placed INSIDE `ion-content`, with a small
  `ion-fab-button` (chevron-down `ion-icon`) and an `ion-badge` for the unread count. Styled
  with existing theme tokens.
- **Rationale**: Principle XI (Ionic-first). `ion-fab` anchored to the bottom-trailing corner
  of `ion-content` sits naturally just above the `ion-footer` (the composer/reply-edit bar is
  in the footer, OUTSIDE `ion-content`), and `ion-content` resizes when the keyboard opens, so
  the control tracks the composer/keyboard automatically — no manual height measurement or
  `ResizeObserver`. `ion-badge` gives the count chip for free; `ion-fab-button` is already a
  labeled, adequately-sized touch target.
- **Alternatives rejected**: A hand-rolled absolutely-positioned button keyed to a measured
  footer height (reinvents the FAB, needs keyboard/resize bookkeeping). A separate
  presentational component (unnecessary indirection — the control is a few bound Ionic
  elements; the only non-trivial logic is pure and extracted to `chat-unread.ts`, D6).

## D2 — Visibility: derive from the existing pinned state + appear threshold (hysteresis)

- **Decision**: Show the control when the view is scrolled away from the bottom by more than an
  **appear threshold** (`APPEAR_PX`, a value larger than the existing ~120px pin threshold —
  roughly one viewport so it doesn't flash for tiny scrolls), and hide it once the view is back
  within the pin threshold. Drive this from the already-firing `onContentScroll` (read
  `scrollHeight - scrollTop - clientHeight`); transition opacity over ~200ms via CSS. The
  show/hide decision is a pure predicate with **hysteresis** (separate show vs hide thresholds)
  so it never strobes when the user lingers at the boundary.
- **Rationale**: SC-002/SC-003. Reuses the existing scroll listener (no new hot-path work). The
  ~120px pin threshold is too eager for the *button* (it would appear/disappear with a nudge);
  a larger appear threshold + hysteresis matches WhatsApp/Telegram feel.
- **Alternatives rejected**: Showing whenever `!stickBottom` (120px) — too twitchy near the
  bottom. An IntersectionObserver sentinel — unnecessary; the scroll metric is already read.

## D3 — Unread tracking: a session-local boundary off the change bus (incoming-only)

- **Decision**: When the user leaves the bottom (`stickBottom` flips false), capture
  `unreadBoundaryTs = newestLoadedTs`. While not at the bottom, observe the existing `messages`
  change bus / `useChatHistory` and count **incoming** messages (`senderId !== self`, not
  deleted) with `timestamp > unreadBoundaryTs`; remember the earliest such id as
  `firstUnreadId`. **Reset** `{boundaryTs, count, firstUnreadId}` whenever the user returns to
  the bottom (`stickBottom` → true) or activates the control. The count/first-id computation is
  the pure helper in D6.
- **Rationale**: Honors the clarify decisions (count incoming only; first-unread = earliest
  incoming since leaving the bottom). View-local and ephemeral (Principle IX) — it never reads
  or writes the persistent seen/receipt state. Reuses the one change signal the chat already
  subscribes to; no new data pipeline.
- **Alternatives rejected**: Deriving "unread" from persistent seen-receipts — the chat already
  marks seen on open, so persistent unread is ~always zero here; it would also couple a UI
  affordance to the receipt system. Counting all new messages incl. own-from-another-device —
  rejected per clarify (incoming-only).

## D4 — Tap action: reuse spec-1011 seek / jump-to-newest

- **Decision**: On activation, if there is unread (`count > 0` and a known `firstUnreadId`),
  call `scrollToMessage(firstUnreadId)`; otherwise call `scrollToNewest()`. Clear the unread
  state on activation. Auto-follow re-engages when the bottom is actually reached (existing
  behavior), not merely on a jump-to-first-unread.
- **Rationale**: FR-004. `scrollToMessage` from spec 1011 already **seeks** (loads + centers) a
  target even when it's been trimmed out of the bounded run — exactly what's needed for a
  first-unread that may be below the loaded window. `scrollToNewest` already does the smooth
  pin-to-bottom (and reloads the newest batch if the tail was trimmed).
- **Alternatives rejected**: Always jumping to the very bottom (rejected per clarify). A bespoke
  scroll-to-offset (variable heights make it unreliable; `scrollToMessage` is exact).

## D5 — Staying above the composer across states

- **Decision**: Rely on `ion-fab` inside `ion-content` (D1): it anchors to the content's bottom
  edge, which is above the `ion-footer`, and `ion-content` shrinks when the keyboard opens or a
  reply/edit bar grows the footer — so the control stays above the composer automatically. Add
  a small bottom offset so it floats clear of the last bubble.
- **Rationale**: FR-005/FR-006/SC-004 with no manual measurement. Ionic owns the content/footer
  layout; the fab inherits it.
- **Alternatives rejected**: Absolutely positioning against a measured/observed footer height
  (fragile across keyboard, reply bar, multi-line input).

## D6 — Pure helpers + tests

- **Decision**: Put the testable logic in `src/utils/chat-unread.ts` (pure, no DOM):
  - `unreadSince(messages, boundaryTs, selfId)` → `{ count, firstId }` — incoming messages
    (`!outgoing`/`senderId !== self`, not deleted) with `timestamp > boundaryTs`, deterministic
    by `(timestamp, id)`; `firstId` is the earliest.
  - `jumpButtonVisible(distanceFromBottomPx, shown, showPx, hidePx)` → boolean — the hysteresis
    predicate (show past `showPx`, hide within `hidePx`, otherwise keep current `shown`).
  Unit-test both (vitest); add the module to the `vitest.config.ts` gated-coverage floor.
- **Rationale**: Principles III/VII — the count/threshold logic is where bugs hide; making it
  pure keeps it verifiable without a DOM, and the view becomes thin wiring.
- **Alternatives rejected**: Inlining the logic in the component (untestable without mounting).

## Open risks (carry into implementation)

- The `firstUnreadId` may have been trimmed out of `rows` (when far scrolled up, spec 1011
  trims the tail). Handled by `scrollToMessage`'s seek (it loads the target) — but verify the
  seek lands within the ~1s budget the 1011 work established.
- Appear-threshold magnitude (`APPEAR_PX`) and the hysteresis gap are feel-tuning; pick sane
  defaults (≈ one viewport / ~120px hide) and confirm on a real device, like 1011's momentum.
- Group chats: `senderId !== self` correctly treats all other members as "incoming"; confirm
  the self id source matches the one bubbles use (`selfId`/`m.outgoing`).
